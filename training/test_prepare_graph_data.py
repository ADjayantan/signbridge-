"""Exact split reconstruction, source immutability and training-only statistics."""
import hashlib
import io
import json
from pathlib import Path
import pickle
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np

from prepare_data import JOINTS
from prepare_graph_data import prepare_language, read_only_archive, sha256_file
from pose_graph import SPLITS
from test_pose_graph import synthetic_pose


def fixture_repository(root, language="asl", invalid_source=False):
    archive_dir, prepared_dir = root / "archives", root / "prepared"
    archive_dir.mkdir()
    prepared_dir.mkdir()
    arrays = {"labels": np.asarray(["HELLO", "THANK YOU"]), "raw_labels": np.asarray(["hello", "thanks"])}
    archive_path = archive_dir / ("WLASL.zip" if language == "asl" else "INCLUDE.zip")
    pose_bytes = io.BytesIO()
    with zipfile.ZipFile(pose_bytes, "w") as poses:
        for split in SPLITS:
            count = 1 if split.startswith("unknown") else 2
            clips = [f"{split}-{i}" for i in range(count)]
            arrays[f"X_{split}"] = np.zeros((count, 32, 81), dtype=np.float32)
            arrays[f"y_{split}"] = np.full(count, -1, dtype=np.int64) if split.startswith("unknown") else np.arange(count)
            arrays[f"clip_ids_{split}"] = np.asarray(clips)
            arrays[f"source_labels_{split}"] = np.asarray(["outside"] * count if split.startswith("unknown") else ["hello", "thanks"])
            arrays[f"signer_ids_{split}"] = np.full(count, -1, dtype=np.int64)
            for clip in clips:
                pose = synthetic_pose("no-hands" if invalid_source and split == "test" else "regular")
                if split != "train":
                    pose["keypoints"][:, 36, 0] += .2
                poses.writestr(f"source/{clip}.pkl", pickle.dumps(pose, protocol=4))
    if language == "isl":
        with zipfile.ZipFile(archive_path, "w") as outer:
            outer.writestr("INCLUDE/Pose_Signs.zip", pose_bytes.getvalue())
        (archive_dir / "INCLUDE-Pose_Signs.zip").write_bytes(pose_bytes.getvalue())
    else:
        archive_path.write_bytes(pose_bytes.getvalue())
    np.savez_compressed(prepared_dir / f"{language}.npz", **arrays)
    metadata = {"language": language, "signLanguage": language, "labels": arrays["labels"].tolist(),
                "preprocessing": {"contract": "signbridge-pose27-xyc-v1", "frames": 32, "joints": JOINTS, "mirroring": False},
                "split_policy": "synthetic explicit clips", "signer_evaluation": {"signer_independent_claim": False},
                "underlying_license": "synthetic", "skipped_count": 0, "skipped_files": []}
    (prepared_dir / f"{language}.metadata.json").write_text(json.dumps(metadata))
    return arrays


class PrepareGraphDataTests(unittest.TestCase):
    def test_rehydrates_exact_clip_order_preserves_old_files_and_normalizes_train_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = fixture_repository(root)
            paths = list((root / "archives").iterdir()) + list((root / "prepared").iterdir())
            before = {path: sha256_file(path) for path in paths}
            output = root / "graph"
            with patch("prepare_graph_data.verify_archive", return_value={"synthetic": True}):
                metadata = prepare_language("asl", root, output)
            with np.load(output / "asl.npz", allow_pickle=False) as data:
                for split in SPLITS:
                    np.testing.assert_array_equal(data[f"clip_ids_{split}"], old[f"clip_ids_{split}"])
                    np.testing.assert_array_equal(data[f"y_{split}"], old[f"y_{split}"])
                    self.assertEqual(data[f"X_{split}"].shape[1:], (32, 75, 3))
                    np.testing.assert_array_equal(data[f"mask_{split}"], data[f"X_{split}"][..., 2] >= .5)
                expected = data["X_train"][..., 36, 0][data["mask_train"][..., 36]].mean()
                self.assertAlmostEqual(metadata["normalization"]["mean"][36][0], float(expected), places=6)
                self.assertGreater(float(data["X_val"][..., 36, 0].mean()), float(data["X_train"][..., 36, 0].mean()))
            self.assertIs(metadata["featuresStandardized"], False)
            self.assertEqual(metadata["normalization"]["stage"], "model")
            self.assertTrue(metadata["exactLegacyClipOrder"])
            self.assertTrue(metadata["sourceInputsUnchanged"])
            self.assertEqual(before, {path: sha256_file(path) for path in paths})
            with self.assertRaisesRegex(ValueError, "already exists"):
                prepare_language("asl", root, output)

    def test_existing_include_cache_is_read_without_being_rewritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_repository(root, "isl")
            cache = root / "archives" / "INCLUDE-Pose_Signs.zip"
            previous = cache.stat().st_mtime_ns
            with patch("prepare_graph_data.verify_archive", return_value={"synthetic": True}):
                metadata = prepare_language("isl", root, root / "graph")
            self.assertEqual(previous, cache.stat().st_mtime_ns)
            self.assertEqual(metadata["splits"]["train"]["clips"], 2)

    def test_wrong_nested_cache_is_rejected_instead_of_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_repository(root, "isl")
            cache = root / "archives" / "INCLUDE-Pose_Signs.zip"
            cache.write_bytes(b"not the source cache")
            with self.assertRaisesRegex(ValueError, "differs"):
                with read_only_archive(root / "archives" / "INCLUDE.zip", root):
                    self.fail("Corrupt cache must not be read")
            self.assertEqual(cache.read_bytes(), b"not the source cache")

    def test_missing_nested_cache_uses_only_a_new_working_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_repository(root, "isl")
            cache = root / "archives" / "INCLUDE-Pose_Signs.zip"
            cache.unlink()
            with patch("prepare_graph_data.verify_archive", return_value={"synthetic": True}):
                prepare_language("isl", root, root / "graph")
            self.assertFalse(cache.exists())
            self.assertEqual(sorted(path.name for path in (root / "graph").iterdir()),
                             ["graph-contract-v1.json", "isl.metadata.json", "isl.npz"])

    def test_failed_clip_does_not_silently_change_splits_or_publish_arrays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_repository(root, invalid_source=True)
            with patch("prepare_graph_data.verify_archive", return_value={"synthetic": True}):
                with self.assertRaisesRegex(ValueError, "no split silently changed"):
                    prepare_language("asl", root, root / "graph")
            self.assertFalse((root / "graph").exists())

    def test_case_aliased_clip_leakage_is_rejected_before_raw_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            arrays = fixture_repository(root)
            arrays["clip_ids_test"] = np.asarray(["TRAIN-0", "test-1"])
            np.savez_compressed(root / "prepared" / "asl.npz", **arrays)
            with patch("prepare_graph_data.verify_archive", return_value={"synthetic": True}):
                with self.assertRaisesRegex(ValueError, "case-aliased"):
                    prepare_language("asl", root, root / "graph")
            self.assertFalse((root / "graph").exists())


if __name__ == "__main__":
    unittest.main()
