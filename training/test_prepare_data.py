"""Safety, split isolation and raw-pose browser parity regressions."""
import json
from pathlib import Path
import pickle
import shutil
import subprocess
import tempfile
import unittest
import zipfile

import numpy as np

from prepare_data import (JOINTS, PoseArchive, clip_disjoint, preprocess, safely_load_pose,
                          stratified_train_validation, valid_shoulder_frames)


def fixture():
    keypoints = np.zeros((6, 75, 3), dtype=np.float32)
    confidences = np.zeros((6, 75), dtype=np.float32)
    for index in range(6):
        keypoints[index, 11] = [.3, .5, 0]
        keypoints[index, 12] = [.7, .5, 0]
        confidences[index, [11, 12]] = 1
    for step in range(4):
        index = step + 1
        keypoints[index, 0] = [.7, .3, 0]
        confidences[index, 0] = .8
        keypoints[index, 33] = [.3 + step * .1, .6, 0]
        confidences[index, 33] = 1
        keypoints[index, 37] = [.35 + step * .1, .65, 0]
        confidences[index, 37] = .9
    confidences[2, 0] = .1
    confidences[3, [11, 12]] = 0
    return {"keypoints": keypoints, "confidences": confidences}


class PrepareDataTests(unittest.TestCase):
    def test_numeric_pose_pickle_loads_with_restricted_schema(self):
        original = fixture()
        loaded = safely_load_pose(pickle.dumps(original, protocol=4))
        np.testing.assert_array_equal(loaded["keypoints"], original["keypoints"])
        self.assertEqual(preprocess(loaded).shape, (32, 81))

    def test_official_include_optional_video_shape_is_validated(self):
        pose = fixture()
        pose["vid_shape"] = (480, 640, 3)
        self.assertEqual(safely_load_pose(pickle.dumps(pose, protocol=4))["keypoints"].shape, (6, 75, 3))
        pose["vid_shape"] = (0, 640, 3)
        with self.assertRaisesRegex(ValueError, "video shape"):
            safely_load_pose(pickle.dumps(pose, protocol=4))

    def test_arbitrary_pickle_globals_and_object_arrays_are_rejected(self):
        class Malicious:
            def __reduce__(self):
                return eval, ("42",)
        with self.assertRaisesRegex(pickle.UnpicklingError, "Disallowed"):
            safely_load_pose(pickle.dumps(Malicious(), protocol=4))
        bad = fixture()
        bad["keypoints"] = bad["keypoints"].astype(object)
        with self.assertRaisesRegex(ValueError, "nonnumeric"):
            safely_load_pose(pickle.dumps(bad, protocol=4))

    def test_malformed_nonfinite_and_trailing_payloads_are_rejected(self):
        bad = fixture()
        bad["confidences"][1, 33] = np.nan
        with self.assertRaisesRegex(ValueError, "nonfinite"):
            safely_load_pose(pickle.dumps(bad, protocol=4))
        with self.assertRaisesRegex(ValueError, "trailing"):
            safely_load_pose(pickle.dumps(fixture(), protocol=4) + b"extra")

    def test_no_sign_and_invalid_shoulders_do_not_become_valid_samples(self):
        pose = fixture()
        self.assertEqual(valid_shoulder_frames(pose), 3)
        pose["confidences"][:, [33, 54]] = 0
        with self.assertRaisesRegex(ValueError, "hand-visible"):
            preprocess(pose)

    def test_zip_reader_matches_suffixes_without_extracting_traversal_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "poses.zip"
            payload = pickle.dumps(fixture(), protocol=4)
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Pose_Signs/Animals/Bird/MVI_1.pkl", payload)
                archive.writestr("../escape.pkl", payload)
            archive = PoseArchive(path)
            try:
                self.assertEqual(archive.read("Animals/Bird/MVI_1.MOV")["keypoints"].shape, (6, 75, 3))
                with self.assertRaisesRegex(ValueError, "Missing"):
                    archive.read("escape.mp4")
            finally:
                archive.close()
            self.assertFalse((Path(directory) / "escape.pkl").exists())

    def test_original_test_overlap_is_rejected_and_train_validation_is_stratified(self):
        with self.assertRaisesRegex(ValueError, "Clip overlap"):
            clip_disjoint({"train": [{"clip": "A/ONE.mov"}], "test": [{"clip": "a/one.MOV"}]})
        rows = [{"clip": f"{label}-{index}", "label": label} for label in ["HELLO", "WATER"] for index in range(10)]
        train, validation = stratified_train_validation(rows)
        self.assertEqual({row["label"] for row in train}, {"HELLO", "WATER"})
        self.assertEqual({row["label"] for row in validation}, {"HELLO", "WATER"})
        self.assertEqual(len(train) + len(validation), len(rows))
        clip_disjoint({"train": train, "val": validation})
        self.assertEqual([[row["clip"] for row in group] for group in (train, validation)],
                         [[row["clip"] for row in group] for group in stratified_train_validation(rows)])

    def test_nested_include_member_is_read_into_a_fixed_cache_without_broad_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "INCLUDE.zip"
            inner_path = Path(directory) / "inner.zip"
            with zipfile.ZipFile(inner_path, "w") as inner:
                inner.writestr("Pose_Signs/Animals/Bird/MVI_1.pkl", pickle.dumps(fixture(), protocol=4))
                inner.writestr("../never-extract-this.txt", "unrelated archive data")
            with zipfile.ZipFile(path, "w") as outer:
                outer.writestr("INCLUDE/Pose_Signs.zip", inner_path.read_bytes())
                outer.writestr("../never-extract-outer.txt", "unrelated archive data")
            archive = PoseArchive(path)
            try:
                self.assertEqual(archive.read("Animals/Bird/MVI_1.MOV")["keypoints"].shape, (6, 75, 3))
            finally:
                archive.close()
            self.assertTrue((Path(directory) / "INCLUDE-Pose_Signs.zip").is_file())
            self.assertFalse((Path(directory) / "never-extract-this.txt").exists())
            self.assertFalse((Path(directory) / "never-extract-outer.txt").exists())

    @unittest.skipUnless(shutil.which("node"), "Node is required for browser preprocessing parity")
    def test_raw_pose_preprocessing_matches_browser_at_interpolated_and_missing_frames(self):
        pose = fixture()
        frames = [{"keypoints": keypoints.tolist(), "confidences": scores.tolist()}
                  for keypoints, scores in zip(pose["keypoints"], pose["confidences"])]
        repo = Path(__file__).resolve().parents[1]
        code = "import fs from 'node:fs'; import {preprocessPoseSequence} from './src/lib/trainedSignModel.js'; console.log(JSON.stringify(preprocessPoseSequence(JSON.parse(fs.readFileSync(0,'utf8')))));"
        result = subprocess.run(["node", "--input-type=module", "-e", code], input=json.dumps(frames),
                                capture_output=True, text=True, cwd=repo, check=True)
        browser = np.asarray(json.loads(result.stdout), dtype=np.float32)
        np.testing.assert_allclose(preprocess(pose), browser, atol=2e-6, rtol=2e-6)


if __name__ == "__main__":
    unittest.main()
