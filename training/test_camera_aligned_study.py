"""Synthetic engineering checks only; none establish sign recognition accuracy."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import numpy as np

from camera_aligned_study import (MARGIN, PROFILES, STRESS, THRESHOLD, artifact_scores,
                                  augmented_pose, canonical_pose, evaluate_frozen,
                                  export_candidate, features, fit_candidate, fixed_metrics,
                                  inventory_from_dataset, parse_args, sha256,
                                  verify_archive_binding, write_new)


def pose(frames=24):
    points = np.zeros((frames, 75, 3), dtype=np.float32)
    confidence = np.zeros((frames, 75), dtype=np.float32)
    points[:, 11, :2], points[:, 12, :2] = [.3, .45], [.7, .55]
    confidence[:, [11, 12]] = 1
    for t in range(frames):
        points[t, 33:54, :] = [.55 + t * .002, .7, -.02]
    confidence[:, 33:54] = 1
    return {"keypoints": points, "confidences": confidence}


class GuardedInventory(dict):
    def __getitem__(self, key):
        if key.startswith("X_") or key in ("y_test", "y_unknown_test"):
            raise AssertionError("Fitting inventory must not read final targets or any legacy features")
        return super().__getitem__(key)


def inventory_fixture():
    labels = [f"WORD-{i}" for i in range(49)]
    data = {"labels": np.asarray(labels)}
    for split in ("train", "val", "test", "unknown_validation", "unknown_test"):
        count = 2 if split.startswith("unknown") else 49
        data[f"clip_ids_{split}"] = np.asarray([f"{split}/clip-{i}.MOV" for i in range(count)])
        data[f"y_{split}"] = np.full(count, -1, dtype=np.int64) if split.startswith("unknown") else np.arange(49, dtype=np.int64)
    metadata = {"language": "isl", "labels": labels, "preprocessing": {"contract": "signbridge-pose27-xyc-v1"}}
    return data, metadata


class CameraStudyTests(unittest.TestCase):
    def test_canonical_conversion_precedes_normalization_and_does_not_mutate(self):
        original = pose(); original["keypoints"][:, :, 0] *= 1080; original["keypoints"][:, :, 1] *= 1920
        before = copy.deepcopy(original)
        canonical = canonical_pose(original)
        np.testing.assert_allclose(canonical["keypoints"], pose()["keypoints"], atol=1e-7)
        np.testing.assert_array_equal(original["keypoints"], before["keypoints"])
        np.testing.assert_array_equal(canonical["keypoints"][:, :, 2], original["keypoints"][:, :, 2])
        np.testing.assert_array_equal(canonical["confidences"], original["confidences"])
        self.assertGreater(float(np.max(np.abs(features(original) - features(canonical)))), .1)

    def test_profiles_select_only_measured_observations_without_repeated_hold_tails(self):
        original = pose()
        for profile in PROFILES + STRESS:
            with self.subTest(profile=profile["name"]):
                result = augmented_pose(original, profile)
                selected = np.arange(profile["phase"], 24, profile["stride"])
                self.assertEqual(len(result["keypoints"]), len(selected))
                np.testing.assert_array_equal(result["keypoints"][:, :, 0], original["keypoints"][selected, :, 0])
                np.testing.assert_array_equal(result["keypoints"][:, :, 2], original["keypoints"][selected, :, 2])
                np.testing.assert_array_equal(result["confidences"], original["confidences"][selected])
                self.assertNotIn("prefix", profile); self.assertNotIn("suffix", profile)
        self.assertEqual(PROFILES[0]["stride"], 1)
        self.assertEqual(PROFILES[0]["verticalFactor"], 1.)

    def test_aspect_augmentation_preserves_missing_points_and_source_immutability(self):
        original = pose(); before = copy.deepcopy(original)
        result = augmented_pose(original, STRESS[0])
        np.testing.assert_array_equal(result["keypoints"][:, 0], np.zeros((24, 3)))
        np.testing.assert_allclose(result["keypoints"][:, 33, 1], .5 + (.7 - .5) * .75)
        np.testing.assert_array_equal(original["keypoints"], before["keypoints"])
        np.testing.assert_array_equal(original["confidences"], before["confidences"])

    def test_sparse_candidate_requires_simultaneous_hand_and_shoulders_like_camera(self):
        original = pose(18)
        original["confidences"][:, [11, 12]] = 0
        original["confidences"][[0, 2, 4, 6], 11] = 1
        original["confidences"][[0, 2, 4, 6], 12] = 1
        features(original)
        sparse = augmented_pose(original, PROFILES[2])
        self.assertEqual(len(sparse["keypoints"]), 6)
        with self.assertRaisesRegex(ValueError, "simultaneous"):
            features(sparse)
        # Historical baseline retains its exact existing archive preprocessing.
        self.assertEqual(features(sparse, require_camera_quality=False).shape, (32, 81))

    def test_learning_inventory_never_reads_final_targets_or_legacy_feature_arrays(self):
        data, metadata = inventory_fixture()
        labels, inventory = inventory_from_dataset(GuardedInventory(data), metadata)
        self.assertEqual(len(labels), 49)
        self.assertEqual(set(inventory), {"train", "val", "unknown_validation"})
        self.assertEqual(len(inventory["train"]), 49)

    def test_inventory_rejects_alias_leakage_missing_labels_and_unknown_positive_targets(self):
        for fault in ("alias", "labels", "unknown"):
            data, metadata = inventory_fixture()
            if fault == "alias":
                data["clip_ids_test"][0] = "TRAIN\\CLIP-0.mov"
            elif fault == "labels":
                data["y_val"][0] = 1
            else:
                data["y_unknown_validation"][0] = 0
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                inventory_from_dataset(data, metadata)

    def test_final_targets_are_only_available_to_explicit_final_inventory_mode(self):
        data, metadata = inventory_fixture()
        _, inventory = inventory_from_dataset(data, metadata, include_final=True)
        self.assertEqual(set(inventory), {"train", "val", "unknown_validation", "test", "unknown_test"})

    def test_official_outer_archive_and_cached_nested_bytes_are_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); outer, cache = root / "INCLUDE.zip", root / "INCLUDE-Pose_Signs.zip"
            with zipfile.ZipFile(outer, "w") as archive:
                archive.writestr("INCLUDE/Pose_Signs.zip", b"original-nested-bytes")
            cache.write_bytes(b"original-nested-bytes")
            paths = {"outerArchive": outer, "archive": cache}
            with patch("camera_aligned_study.verify_archive", return_value={"md5": "verified"}) as official:
                result = verify_archive_binding(paths)
                official.assert_called_once_with(outer, "isl")
                self.assertTrue(result["cachedArchiveMatchesOfficial"])
                self.assertEqual(result["nestedSha256"], sha256(cache))
            cache.write_bytes(b"changed-nested-bytes!")
            with patch("camera_aligned_study.verify_archive", return_value={}), self.assertRaisesRegex(ValueError, "differs"):
                verify_archive_binding(paths)

    def test_fixed_metrics_keep_strict_gates_and_source_coverage_denominators(self):
        scores = np.asarray([[.96, .04], [.94, .06], [.03, .97]])
        target = np.asarray([0, 0, 1]); unknown = np.asarray([[.94, .06], [.98, .02]])
        measured = fixed_metrics(scores, target, unknown, ["A", "HELLO"], source_known=4, source_unknown=3)
        self.assertEqual((THRESHOLD, MARGIN), (.95, .3))
        self.assertEqual(measured["accepted_correct"], 2)
        self.assertEqual(measured["correctKnownCoverage"], .5)
        self.assertEqual(measured["knownPrecision"], 1.)
        self.assertAlmostEqual(measured["unknownFalseAcceptRateAllSource"], 1 / 3)
        self.assertEqual(measured["perClass"]["HELLO"]["acceptedCorrect"], 1)

    def test_no_eligible_stress_observations_remain_rejected_without_crashing(self):
        measured = fixed_metrics(np.empty((0, 2)), np.empty(0, dtype=np.int64), np.empty((0, 2)), ["A", "B"], 4, 3)
        self.assertEqual(measured["correctKnownCoverage"], 0.)
        self.assertIsNone(measured["knownPrecision"])

    def test_export_is_research_only_identity_camera_v2_with_fixed_gates_and_native_scores(self):
        from train_model import SignGRU
        import torch
        torch.manual_seed(42)
        candidate = export_candidate(SignGRU(2), ["A", "HELLO"], np.zeros(81), np.ones(81))
        self.assertEqual(candidate["cameraInput"], {"format": "signbridge-camera-coordinates-v1", "space": "normalized-image", "scaleX": 1, "scaleY": 1})
        self.assertEqual(candidate["threshold"], .95); self.assertEqual(candidate["margin"], .3)
        self.assertFalse(candidate["research"]["promoted"])
        scores = artifact_scores(candidate, np.stack([features(pose())]))
        self.assertEqual(scores.shape, (1, 2)); np.testing.assert_allclose(scores.sum(axis=1), 1.)

    def test_fitting_is_bounded_and_uses_train_validation_only(self):
        raw = np.stack([features(pose()), features(pose())])
        arrays = {split: {"X": raw.copy(), "y": np.asarray([0, 1])} for split in ("train", "val")}
        args = SimpleNamespace(seed=42, threads=1, epochs=2, max_seconds=.001)
        candidate, report = fit_candidate(args, arrays, ["A", "B"])
        self.assertEqual(report["stopReason"], "wall-clock-budget")
        self.assertEqual(report["epochs"], 1)
        self.assertEqual(report["bestEpoch"], 1)
        self.assertEqual(candidate["threshold"], .95)

    def test_modified_candidate_blocks_benchmark_before_any_dataset_access(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_new(root / "candidate.json", {"original": True}); write_new(root / "protocol.json", {})
            write_new(root / "frozen-candidate.json", {"format": "signbridge-camera-aligned-candidate-freeze-v1", "candidateSha256": sha256(root / "candidate.json"), "protocolSha256": sha256(root / "protocol.json")})
            (root / "candidate.json").write_text("{}", encoding="utf-8")
            with patch("camera_aligned_study.study_sources") as sources, self.assertRaisesRegex(ValueError, "changed"):
                evaluate_frozen(SimpleNamespace(evaluate_study=root))
            sources.assert_not_called(); self.assertFalse((root / "benchmark.json").exists())

    def test_output_json_refuses_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "report.json"
            write_new(path, {"first": True})
            with self.assertRaises(FileExistsError):
                write_new(path, {"second": True})
            self.assertEqual(json.loads(path.read_text()), {"first": True})

    def test_cli_has_bounded_budget_and_separate_modes(self):
        args = parse_args(["--check-only"])
        self.assertEqual((args.seed, args.epochs, args.max_seconds, args.threads), (42, 120, 600, 4))
        for invalid in (["--check-only", "--epochs", "121"], ["--check-only", "--threads", "5"],
                        ["--check-only", "--max-seconds", "601"], ["--check-only", "--prepare-only"], []):
            with self.subTest(args=invalid), self.assertRaises(SystemExit):
                parse_args(invalid)


if __name__ == "__main__":
    unittest.main()
