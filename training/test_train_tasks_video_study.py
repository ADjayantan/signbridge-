"""Engineering invariants for the bounded Tasks study; not recognition evidence."""
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from camera_aligned_study import export_candidate, sha256, write_new
from test_camera_aligned_study import GuardedInventory, inventory_fixture, pose
from train_tasks_video_study import (CONFIG, FORMAT, INITIAL_SHA256, MANIFEST_FORMAT, OE_WEIGHT,
    arrays_for_fit, camera_quality, choose_archive_outliers, evaluate, fit, learning_inventory,
    outlier_loss, parse_args, prepare_tasks, source_outcome, task_report, tasks_features,
    training_loss, validate_initial, validate_manifest, validate_plan_binding, warm_start_parity)


def manifest_fixture():
    labels = [f"WORD-{index}" for index in range(49)]
    rows = [{"clipId": f"{split}/clip.MOV", "localFile": f"{split}.MOV", "label": labels[0] if not split.startswith("unknown") else f"UNSUPPORTED {split}",
             "split": split, "sha256": f"{index+1:064x}"} for index, split in enumerate(("train", "val", "unknown_train", "unknown_val", "test", "unknown_test"))]
    return labels, {"format": MANIFEST_FORMAT, "frozenPlanSha256": "a"*64, "clips": rows}


def record_fixture(row, count=8):
    original = pose(count)
    frames = [{"atMs": index*125, "pose": [[float(point[0]), float(point[1]), float(conf)]
              for point, conf in zip(points, confidence)]}
              for index, (points, confidence) in enumerate(zip(original["keypoints"], original["confidences"]))]
    return {"clipId": row["clipId"], "videoSha256": row["sha256"], "status": "ok", "frames": frames,
            "geometry": {"width": 1280, "height": 720},
            "source": {"width": 1920, "height": 1088, "durationMs": count*125}, "cameraGate": {"passed": True, "code": ""}}


def payload_fixture(manifest, group="learning"):
    splits = {"train", "val", "unknown_train", "unknown_val"} if group == "learning" else {"test", "unknown_test"}
    return {"format": FORMAT, "manifestHash": "b"*64, "extractorModuleHash": "c"*64,
            "partitionGroup": group, "config": dict(CONFIG),
            "records": [record_fixture(row) for row in manifest["clips"] if row["split"] in splits]}


def prepared_fixture():
    labels, manifest = manifest_fixture()
    rows = validate_manifest(manifest, labels)
    return labels, manifest, rows, prepare_tasks(payload_fixture(manifest), rows, labels, "b"*64, "c"*64, "learning")


class TasksStudyTests(unittest.TestCase):
    def test_manifest_members_bind_pre_acquisition_plan_identity_and_crc_size(self):
        selected = {"clip_id": "train/source.MOV", "label": "HELLO", "raw_label": "48. Hello", "split": "train",
                    "local_file": "source.MOV", "uncompressed_bytes": 300, "crc32": 123, "archive": "Greetings_1of1.zip"}
        saved = {"clipId": selected["clip_id"], "label": "HELLO", "rawLabel": "48. Hello", "split": "train",
                 "localFile": "source.MOV", "bytes": 300, "crc32": 123, "archive": selected["archive"],
                 "crc32Verified": True, "savedHashVerified": True, "archiveFullMd5Verified": False}
        plan = {"format": "signbridge-tasks-video-study-v1", "clips": [selected]}
        validate_plan_binding({"clips": [saved]}, plan)
        for fault in ("split", "bytes", "crc32", "crc32Verified", "archiveFullMd5Verified"):
            changed = copy.deepcopy(saved); changed[fault] = not saved[fault] if isinstance(saved[fault], bool) else "changed"
            with self.subTest(fault=fault), self.assertRaisesRegex(ValueError, "integrity"):
                validate_plan_binding({"clips": [changed]}, plan)

    def test_manifest_enforces_clip_file_hash_and_unknown_word_separation(self):
        labels, manifest = manifest_fixture()
        self.assertEqual(len(validate_manifest(manifest, labels)), 6)
        for fault in ("basename", "duplicate", "word", "plan", "count", "known-unknown", "unsafe-id"):
            changed = copy.deepcopy(manifest)
            if fault == "basename": changed["clips"][0]["localFile"] = "C:/private.MOV"
            elif fault == "duplicate": changed["clips"][1]["sha256"] = changed["clips"][0]["sha256"]
            elif fault == "word": changed["clips"][-1]["label"] = changed["clips"][2]["label"]
            elif fault == "plan": changed["frozenPlanSha256"] = "wrong"
            elif fault == "count": changed["clips"] *= 17
            elif fault == "known-unknown": changed["clips"][2]["label"] = labels[0]
            elif fault == "unsafe-id": changed["clips"][0]["clipId"] = "../train.MOV"
            with self.subTest(fault=fault), self.assertRaises(ValueError): validate_manifest(changed, labels)

    def test_camera_quality_measured_complete_sequence_and_no_duplicate_timestamps(self):
        _, manifest = manifest_fixture(); record = record_fixture(manifest["clips"][0])
        self.assertEqual(camera_quality(record["frames"], 1000), (True, ""))
        record["frames"][2]["atMs"] = 125
        self.assertEqual(camera_quality(record["frames"], 1000), (False, "timing"))
        record = record_fixture(manifest["clips"][0])
        for frame in record["frames"]: frame["pose"][11][2] = 0
        self.assertEqual(camera_quality(record["frames"], 1000), (False, "framing"))

    def test_feature_conversion_uses_confidence_third_channel_not_z(self):
        _, manifest = manifest_fixture(); record = record_fixture(manifest["clips"][0])
        expected = pose(8)
        expected["keypoints"][:, :, 2] = 0
        from camera_aligned_study import features
        np.testing.assert_array_equal(tasks_features(record), features(expected))
        model_space = copy.deepcopy(expected)
        model_space["keypoints"][:, :, 0] *= 1080; model_space["keypoints"][:, :, 1] *= 1920
        adapted = tasks_features(record, {"format": "signbridge-camera-coordinates-v1", "space": "axis-scaled-image", "scaleX": 1080, "scaleY": 1920})
        np.testing.assert_array_equal(adapted, features(model_space))
        self.assertGreater(float(np.abs(adapted-tasks_features(record)).max()), .1)

    def test_learning_export_requires_every_selected_outcome_and_no_test_record(self):
        labels, manifest, rows, tasks = prepared_fixture()
        self.assertEqual({row["split"] for row in tasks}, {"train", "val", "unknown_train", "unknown_val"})
        for fault in ("missing", "test", "hash", "extractor", "config", "source-timing", "declared-quality"):
            payload = payload_fixture(manifest)
            if fault == "missing": payload["records"].pop()
            elif fault == "test": payload["records"].append(record_fixture(rows[-1]))
            elif fault == "hash": payload["records"][0]["videoSha256"] = "f"*64
            elif fault == "extractor": payload["extractorModuleHash"] = "f"*64
            elif fault == "config": payload["config"]["width"] = 640
            elif fault == "source-timing": payload["records"][0]["frames"].pop()
            elif fault == "declared-quality": payload["records"][0]["cameraGate"]["passed"] = False
            with self.subTest(fault=fault), self.assertRaises(ValueError):
                prepare_tasks(payload, rows, labels, "b"*64, "c"*64, "learning")

    def test_errors_remain_in_denominator_but_cancelled_learning_cannot_fit(self):
        labels, manifest = manifest_fixture(); rows = validate_manifest(manifest, labels)
        payload = payload_fixture(manifest)
        record = payload["records"][2]
        record.update(status="error", frames=[], cameraGate={"passed": False, "code": "extraction-error"})
        tasks = prepare_tasks(payload, rows, labels, "b"*64, "c"*64, "learning")
        self.assertEqual(len(tasks), 4); self.assertIsNone(tasks[2]["features"])
        self.assertNotIn("features", source_outcome(tasks[0])); self.assertNotIn("cameraFrames", source_outcome(tasks[0]))
        record.update(status="cancelled", cameraGate={"passed": False, "code": "cancelled"})
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            prepare_tasks(payload, rows, labels, "b"*64, "c"*64, "learning")

    def test_inventory_cannot_read_final_targets_or_any_prepared_features(self):
        data, metadata = inventory_fixture()
        labels, rows = learning_inventory(GuardedInventory(data), metadata, [])
        self.assertEqual(len(labels), 49); self.assertNotIn("test", rows)
        with self.assertRaisesRegex(ValueError, "move"):
            learning_inventory(GuardedInventory(data), metadata, [{"clipId": "test/clip-0.MOV", "split": "train"}])

    def test_outlier_selection_excludes_all_holdout_ids_words_and_manifest_ids_balanced(self):
        class Source(dict):
            @property
            def files(self): return list(self)
        source = Source(raw_labels=np.asarray(["1. Known"]), clip_ids_train=np.asarray(["A/excluded.MOV"]),
                        clip_ids_test=np.asarray(["A/held.MOV"]), source_labels_unknown_test=np.asarray(["3. Old negative"]))
        csv = [{"FilePath": name, "Word": word} for name, word in (
            ("A/excluded.MOV", "2. First"), ("A/held.MOV", "2. First"), ("A/new.MOV", "2. First"),
            ("A/new2.MOV", "2. First"), ("B/new.MOV", "4. Second"), ("C/old.MOV", "3. Old negative"),
            ("D/new.MOV", "5. New held"), ("E/new.MOV", "6. Manifest train"), ("F/new.MOV", "1. Known"))]
        archive = SimpleNamespace(index={row["FilePath"].removesuffix(".MOV").lower()+".pkl": [None] for row in csv})
        rows = [{"clipId": "D/other.MOV", "label": "NEW HELD", "rawLabel": "5. New held", "split": "unknown_val"},
                {"clipId": "E/new.MOV", "label": "MANIFEST TRAIN", "split": "unknown_train"}]
        with patch("train_tasks_video_study.read_csv", return_value=csv):
            result = choose_archive_outliers(Path("ignored"), source, rows, archive, limit=3)
        self.assertEqual([row["clipId"] for row in result], ["A/new.MOV", "B/new.MOV", "A/new2.MOV"])

    def test_training_arrays_read_only_original_train_and_weight_real_tasks_rows(self):
        labels, manifest, rows, tasks = prepared_fixture()
        original = {"train": [{"clipId": "old/train.MOV", "target": 0}], "val": object(), "test": object()}
        raw = pose(); raw["keypoints"][:, :, 0] *= 1080; raw["keypoints"][:, :, 1] *= 1920
        with patch("train_tasks_video_study.read_original_pose", return_value=raw) as reader:
            arrays, report = arrays_for_fit(original, object(), [{"clipId": "fresh/negative.MOV", "sourceLabel": "UNKNOWN"}], tasks)
        self.assertEqual([call.args[1] for call in reader.call_args_list], ["old/train.MOV", "fresh/negative.MOV"])
        self.assertEqual(len(arrays["X"]), 5); self.assertEqual(len(arrays["unknown"]), 2)
        self.assertEqual(report["tasksKnownClips"], 1); self.assertEqual(report["tasksRowWeight"], 4)
        self.assertNotIn("cameraFrames", report["taskOutcomes"][0])

    def test_oe_loss_is_uniform_cross_entropy_with_exact_quarter_weight_and_gradients(self):
        import torch
        known = torch.tensor([[2., -1., .5]], requires_grad=True)
        unknown = torch.tensor([[3., .2, -2.], [.1, .3, .5]], requires_grad=True)
        targets = torch.tensor([0])
        expected_oe = -(unknown.log_softmax(-1) * torch.full_like(unknown, 1/3)).sum(-1).mean()
        torch.testing.assert_close(outlier_loss(unknown), expected_oe)
        loss = training_loss(known, targets, unknown)
        torch.testing.assert_close(loss, torch.nn.functional.cross_entropy(known, targets)+.25*expected_oe)
        loss.backward()
        torch.testing.assert_close(unknown.grad, .25*(unknown.detach().softmax(-1)-1/3)/2)
        self.assertTrue(torch.isfinite(known.grad).all()); self.assertEqual(OE_WEIGHT, .25)

    def test_model_warm_reconstruction_probability_parity_and_normalization(self):
        import torch
        from train_model import SignGRU, probabilities
        labels, _, _, tasks = prepared_fixture(); torch.manual_seed(42)
        model = SignGRU(49).eval()
        initial = export_candidate(model, labels, np.zeros(81), np.ones(81))
        validate_initial(initial, labels)
        from camera_aligned_study import artifact_scores
        values = np.stack([tasks[0]["features"], tasks[1]["features"]])
        native = probabilities(model, torch.from_numpy(values))
        np.testing.assert_allclose(artifact_scores(initial, values), native, atol=1e-5)
        self.assertTrue(warm_start_parity(initial, tasks)["passed"])
        with self.assertRaises(ValueError): validate_initial(initial, labels[::-1])

    def test_task_report_has_all_source_denominators_including_failed_known_and_unknown(self):
        labels, _, _, tasks = prepared_fixture()
        failed_known = {**tasks[1], "clipId": "failed-known", "status": "error", "qualityCode": "extraction-error", "features": None}
        failed_unknown = {**tasks[-1], "clipId": "failed-unknown", "status": "error", "qualityCode": "extraction-error", "features": None}
        score = np.zeros((1,49)); score[0,0] = .98; score[0,1:] = .02/48
        with patch("train_tasks_video_study.artifact_scores", return_value=score):
            result = task_report({"labels": labels}, tasks+[failed_known, failed_unknown], "val", "unknown_val")
        self.assertEqual(result["knownSourceClips"], 2); self.assertEqual(result["unknownSourceClips"], 2)
        self.assertEqual(result["correctKnownCoverage"], .5); self.assertEqual(result["unknownFalseAcceptRateAllSource"], .5)
        self.assertEqual(result["macroRecallAllSource"], .5)

    def test_bounded_toy_fit_keeps_49_outputs_fixed_gates_and_unchanged_normalization(self):
        import torch
        from train_model import SignGRU
        labels, _, _, tasks = prepared_fixture(); torch.manual_seed(42)
        initial = export_candidate(SignGRU(49), labels, np.zeros(81), np.ones(81))
        arrays = {"X": np.stack([tasks[0]["features"]]), "y": np.asarray([0], dtype=np.int64), "unknown": np.stack([tasks[2]["features"]])}
        candidate, report = fit(SimpleNamespace(seed=42, threads=1, epochs=1, max_seconds=.001), initial, arrays, tasks)
        self.assertEqual(report["epochs"], 1); self.assertEqual(report["stopReason"], "wall-clock-budget")
        self.assertEqual(candidate["labels"], labels); self.assertEqual(candidate["mean"], initial["mean"])
        self.assertEqual(candidate["std"], initial["std"]); self.assertEqual(candidate["threshold"], .95)
        self.assertEqual(candidate["margin"], .30); self.assertFalse(candidate["research"]["promoted"])

    def test_changed_candidate_blocks_final_test_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); write_new(root/"candidate.json", {"original": True}); write_new(root/"protocol.json", {})
            write_new(root/"frozen-candidate.json", {"candidateSha256": sha256(root/"candidate.json"), "protocolSha256": sha256(root/"protocol.json")})
            (root/"candidate.json").write_text("{}")
            with patch("train_tasks_video_study.prepare_tasks") as loader, self.assertRaisesRegex(ValueError, "changed"):
                evaluate(SimpleNamespace(evaluate_study=root, test_poses=Path("unopened-test.json")))
            loader.assert_not_called(); self.assertFalse((root/"benchmark.json").exists())

    def test_cli_fixed_seed_threads_budgets_and_separate_test_mode(self):
        flags = ["--"+name for name in ("manifest", "poses", "initial", "protocol", "extractor", "output")]
        fitting = [value for flag in flags for value in (flag, "unused")]
        parsed = parse_args(fitting)
        self.assertEqual((parsed.seed, parsed.threads, parsed.epochs, parsed.max_seconds), (42,4,120,600))
        self.assertEqual(len(INITIAL_SHA256), 64)
        for invalid in (fitting+["--seed","43"], fitting+["--threads","3"], fitting+["--max-seconds","601"], fitting+["--test-poses","test.json"], ["--evaluate-study","study"], fitting+["--evaluate-study","study","--test-poses","test.json"]):
            with self.subTest(args=invalid), self.assertRaises(SystemExit): parse_args(invalid)


if __name__ == "__main__": unittest.main()
