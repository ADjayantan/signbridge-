"""Trainer regressions use artificial arrays only; they are not accuracy results."""
import copy
import unittest

import numpy as np

from train_model import JOINTS, calibrate, metrics, validate_prepared


def prepared_fixture():
    data = {"labels": np.asarray(["WATER", "HELP"])}
    for split in ["train", "val", "test", "unknown_validation", "unknown_test"]:
        data[f"X_{split}"] = np.zeros((2, 32, 81), dtype=np.float32)
        data[f"clip_ids_{split}"] = np.asarray([f"{split}/clip-0", f"{split}/clip-1"], dtype="<U80")
        data[f"y_{split}"] = np.asarray([-1, -1] if split.startswith("unknown") else [0, 1], dtype=np.int64)
    metadata = {"language": "isl", "preprocessing": {
        "contract": "signbridge-pose27-xyc-v1", "frames": 32, "joints": list(JOINTS),
        "channels": ["shoulder-normalized-x", "shoulder-normalized-y", "confidence"],
        "mirroring": False,
    }}
    return data, metadata


class PreparedDataValidationTests(unittest.TestCase):
    def setUp(self):
        self.data, self.metadata = prepared_fixture()

    def validate(self):
        return validate_prepared(self.data, self.metadata, "isl")

    def test_accepts_disjoint_complete_real_preparer_schema(self):
        self.validate()

    def test_rejects_wrong_language_before_mislabelling_weights(self):
        self.metadata["language"] = "asl"
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_incompatible_feature_frames_and_joint_order(self):
        for field, value in [("frames", 16), ("joints", list(reversed(JOINTS)))]:
            with self.subTest(field=field):
                metadata = copy.deepcopy(self.metadata)
                metadata["preprocessing"][field] = value
                with self.assertRaises(ValueError):
                    validate_prepared(self.data, metadata, "isl")

    def test_rejects_nonfinite_or_wrong_shaped_pose_arrays(self):
        for raw in [np.full((2, 32, 81), np.nan), np.zeros((2, 31, 81)), np.zeros((2, 32, 80))]:
            with self.subTest(shape=raw.shape):
                self.data["X_val"] = raw
                with self.assertRaises(ValueError):
                    self.validate()

    def test_all_classes_need_integer_labels_in_each_known_split(self):
        invalid = [np.asarray([0., 1.]), np.asarray([-1, 1]), np.asarray([0, 2]), np.asarray([0, 0]), np.asarray([[0], [1]])]
        for y in invalid:
            with self.subTest(labels=y.tolist()):
                self.data["y_val"] = y
                with self.assertRaises(ValueError):
                    self.validate()

    def test_rejects_missing_row_identifiers_or_duplicates_within_a_split(self):
        for ids in [np.asarray(["one"]), np.asarray(["same", "same"])]:
            with self.subTest(ids=ids.tolist()):
                self.data["clip_ids_train"] = ids
                with self.assertRaises(ValueError):
                    self.validate()

    def test_rejects_known_train_test_clip_leakage(self):
        self.data["clip_ids_test"][0] = self.data["clip_ids_train"][0]
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_unknown_clip_leaking_into_training_or_test(self):
        for unknown in ["unknown_validation", "unknown_test"]:
            with self.subTest(unknown=unknown):
                data, metadata = prepared_fixture()
                data[f"clip_ids_{unknown}"][0] = data["clip_ids_train"][0]
                with self.assertRaises(ValueError):
                    validate_prepared(data, metadata, "isl")

    def test_rejects_overlap_between_unknown_validation_and_unknown_test(self):
        self.data["clip_ids_unknown_test"][0] = self.data["clip_ids_unknown_validation"][0]
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_absent_unknown_calibration_recordings(self):
        self.data["X_unknown_validation"] = np.empty((0, 32, 81), dtype=np.float32)
        self.data["clip_ids_unknown_validation"] = np.asarray([], dtype=str)
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_labels_that_browser_cannot_load(self):
        for labels in [["WATER", "WATER"], ["WATER", " HELP "], ["WATER", "X" * 81], ["WATER", ""]]:
            with self.subTest(labels=labels):
                self.data["labels"] = np.asarray(labels)
                with self.assertRaises(ValueError):
                    self.validate()

    def test_rejects_empty_or_nonstring_clip_identifiers(self):
        for ids in [np.asarray(["", "clip"]), np.asarray([1, 2])]:
            with self.subTest(ids=ids.tolist()):
                self.data["clip_ids_train"] = ids
                with self.assertRaises(ValueError):
                    self.validate()


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.known = np.asarray([[.99, .01], [.01, .99]], dtype=np.float32)
        self.targets = np.asarray([0, 1], dtype=np.int64)

    def test_confident_unknowns_fail_closed_when_no_candidate_meets_constraint(self):
        unknown = np.asarray([[.999, .001]], dtype=np.float32)
        threshold, margin, enabled = calibrate(self.known, self.targets, unknown)
        self.assertFalse(enabled)
        result = metrics(self.known, self.targets, unknown, threshold, margin, enabled)
        self.assertEqual(result["accepted_correct"], 0)
        self.assertEqual(result["unknown_false_accepts"], 0)
        self.assertEqual(result["rejected"], 2)
        self.assertEqual(result["top1_accuracy"], 1.0)

    def test_no_unknown_validation_cannot_enable_unmeasured_rejection(self):
        _, _, enabled = calibrate(self.known, self.targets, np.empty((0, 2), dtype=np.float32))
        self.assertFalse(enabled)

    def test_exact_false_accept_count_does_not_use_rounded_report_rate(self):
        unknown = np.tile(np.asarray([[.5, .5]], dtype=np.float32), (20001, 1))
        unknown[:2001] = [.999, .001]
        # The report displays 0.1 after rounding, but 2001/20001 is above 10%.
        self.assertEqual(metrics(self.known, self.targets, unknown, .98, .3)["unknown_false_accept_rate"], .1)
        _, _, enabled = calibrate(self.known, self.targets, unknown)
        self.assertFalse(enabled)

    def test_valid_calibration_accepts_known_words_and_rejects_ambiguous_unknowns(self):
        unknown = np.asarray([[.5, .5], [.55, .45]], dtype=np.float32)
        threshold, margin, enabled = calibrate(self.known, self.targets, unknown)
        self.assertTrue(enabled)
        result = metrics(self.known, self.targets, unknown, threshold, margin, enabled)
        self.assertEqual(result["accepted_correct"], 2)
        self.assertEqual(result["accepted_incorrect"], 0)
        self.assertEqual(result["unknown_false_accepts"], 0)


if __name__ == "__main__":
    unittest.main()
