"""Synthetic safety/protocol regressions; these tests are not accuracy evidence."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from graph_models import SignGraphModel
from pose_graph import fit_normalization, normalize_features
from run_small_vocab_pilot import (
    CLASSES, LEARNING_SPLITS, augment_training, calibrate_separate,
    load_learning_arrays, per_class_rows, prepare_pilot, run_pilot,
    select_vocabulary, sha256, summarize, write_new,
)


def fixture():
    labels = np.asarray([f"WORD-{index:02}" for index in range(16)])
    data = {"labels": labels}
    for split, count, base in (("train", 160, 0), ("val", 160, 100), ("unknown_validation", 20, 200)):
        features = np.zeros((count, 32, 75, 3), dtype=np.float32)
        features[:, :, :20, :2] = np.arange(count, dtype=np.float32)[:, None, None, None] / 100
        features[:, :, :20, 2] = .8
        data[f"X_{split}"] = features
        data[f"mask_{split}"] = features[..., 2] >= .5
        data[f"clip_ids_{split}"] = np.asarray([f"{split}/clip-{index}" for index in range(count)])
        data[f"signer_ids_{split}"] = base + (np.arange(count) % 10)
        data[f"y_{split}"] = np.full(count, -1, dtype=np.int64) if split.startswith("unknown") else np.arange(count) // 10
    return data


class GuardedArrays:
    def __init__(self, values):
        self.values = values
        self.accessed = []

    def __getitem__(self, name):
        if name.endswith("_test"):
            raise AssertionError("Final test member was accessed")
        self.accessed.append(name)
        return self.values[name]


class VocabularyAndIsolationTests(unittest.TestCase):
    def test_loader_only_opens_declared_learning_members(self):
        guard = GuardedArrays(fixture())
        labels, arrays = load_learning_arrays(guard)
        allowed = {"labels"} | {f"{field}_{split}" for field in ("X", "mask", "clip_ids", "signer_ids", "y") for split in LEARNING_SPLITS}
        self.assertEqual(set(guard.accessed), allowed)
        self.assertEqual(set(arrays), set(LEARNING_SPLITS))
        self.assertEqual(len(labels), 16)

    def test_vocab_ranking_uses_training_support_then_alphabetical_tie(self):
        data = fixture()
        labels = data["labels"].tolist()
        ranked = select_vocabulary(labels, data["y_train"], data["signer_ids_train"])
        self.assertEqual([row["word"] for row in ranked], labels[:CLASSES])
        changed = data["signer_ids_train"].copy()
        changed[:10] = 0
        ranked = select_vocabulary(labels, data["y_train"], changed)
        self.assertNotIn("WORD-00", [row["word"] for row in ranked])

    def test_too_few_training_signers_fails_without_fallback_words(self):
        data = fixture()
        with self.assertRaisesRegex(ValueError, "twelve"):
            select_vocabulary(data["labels"].tolist(), data["y_train"], np.zeros(160, dtype=np.int64))

    def test_fixed_selection_is_not_replaced_for_bad_validation_coverage(self):
        labels, source = load_learning_arrays(fixture())
        source["val"]["targets"][:10] = 15
        with self.assertRaisesRegex(ValueError, "no replacement"):
            prepare_pilot(labels, source)

    def test_subset_keeps_original_signers_and_separates_omitted_words(self):
        labels, source = load_learning_arrays(fixture())
        words, ranking, arrays, norm = prepare_pilot(labels, source)
        self.assertEqual(words, labels[:12])
        self.assertEqual(len(ranking), 12)
        self.assertEqual(len(arrays["train"]["ids"]), 120)
        self.assertEqual(len(arrays["excluded_known_validation"]["ids"]), 40)
        self.assertEqual(arrays["train"]["ids"], source["train"]["ids"][:120])
        np.testing.assert_array_equal(arrays["train"]["signers"], source["train"]["signers"][:120])
        self.assertEqual(norm, fit_normalization(arrays["train"]["features"], arrays["train"]["mask"]))
        self.assertIs(arrays["unknown_validation"], source["unknown_validation"])

    def test_training_signer_cannot_leak_into_genuine_oov_validation(self):
        data = fixture(); data["signer_ids_unknown_validation"][0] = 0
        with self.assertRaisesRegex(ValueError, "signers overlap"):
            load_learning_arrays(data)

    def test_case_aliased_clip_id_is_rejected(self):
        data = fixture(); data["clip_ids_val"][0] = data["clip_ids_train"][0].upper()
        with self.assertRaisesRegex(ValueError, "overlap or alias"):
            load_learning_arrays(data)

    def test_invalid_missing_node_and_stored_float_target_rejected(self):
        data = fixture(); data["X_val"][0, 0, 70, 0] = 1
        with self.assertRaisesRegex(ValueError, "Missing observations"):
            load_learning_arrays(data)
        data = fixture(); data["y_train"] = data["y_train"].astype(float)
        with self.assertRaisesRegex(ValueError, "identities/targets"):
            load_learning_arrays(data)


class AugmentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def test_training_augmentation_is_deterministic_without_mutating_source(self):
        source = torch.from_numpy(fixture()["X_train"][:2])
        original = source.clone()
        first = augment_training(source, torch.Generator().manual_seed(42))
        second = augment_training(source, torch.Generator().manual_seed(42))
        torch.testing.assert_close(first, second, atol=0, rtol=0)
        torch.testing.assert_close(source, original, atol=0, rtol=0)
        self.assertFalse(torch.equal(first[..., :2], source[..., :2]))

    def test_confidence_and_missing_observations_stay_exactly_unchanged(self):
        source = torch.from_numpy(fixture()["X_train"][:2])
        actual = augment_training(source, torch.Generator().manual_seed(43))
        torch.testing.assert_close(actual[..., 2], source[..., 2], atol=0, rtol=0)
        self.assertEqual(int(torch.count_nonzero(actual[source[..., 2] < .5])), 0)
        self.assertTrue(bool((actual[..., :2].abs() <= 5).all()))

    def test_subset_model_reuses_shared_training_normalization_contract(self):
        labels, source = load_learning_arrays(fixture())
        _, _, arrays, norm = prepare_pilot(labels, source)
        model = SignGraphModel(12, "gru75", norm["mean"], norm["std"])
        raw, mask = arrays["val"]["features"][:2], arrays["val"]["mask"][:2]
        actual, _ = model.preprocess(torch.from_numpy(raw))
        np.testing.assert_allclose(actual.numpy(), normalize_features(raw, mask, norm), atol=1e-5, rtol=0)


class SeparateCalibrationTests(unittest.TestCase):
    def setUp(self):
        self.scores = np.tile(np.asarray([[.995, .005]]), (20, 1))
        self.targets = np.zeros(20, dtype=np.int64)
        self.ambiguous = np.tile(np.asarray([[.5, .5]]), (20, 1))

    def test_genuine_oov_errors_cannot_be_diluted_by_excluded_words(self):
        genuine = self.ambiguous.copy(); genuine[:2] = [.999, .001]
        excluded = np.tile([[.5, .5]], (500, 1))
        result = calibrate_separate(self.scores, self.targets, genuine, excluded)
        self.assertFalse(result["acceptanceEnabled"])
        self.assertFalse(result["screenPassed"])

    def test_excluded_known_errors_cannot_be_diluted_by_genuine_oov(self):
        excluded = self.ambiguous.copy(); excluded[:2] = [.999, .001]
        genuine = np.tile([[.5, .5]], (500, 1))
        result = calibrate_separate(self.scores, self.targets, genuine, excluded)
        self.assertFalse(result["acceptanceEnabled"])

    def test_exact_five_percent_boundary_is_allowed_but_not_rounded(self):
        genuine = self.ambiguous.copy(); genuine[0] = [.999, .001]
        result = calibrate_separate(self.scores, self.targets, genuine, self.ambiguous)
        self.assertTrue(result["screenPassed"])
        self.assertEqual(result["known"]["unknown_false_accepts"], 1)
        self.assertEqual(result["known"]["unknown_false_accept_rate"], .05)

    def test_high_precision_with_low_correct_coverage_still_fails(self):
        scores = self.scores.copy(); scores[5:] = [.5, .5]
        result = calibrate_separate(scores, self.targets, self.ambiguous, self.ambiguous)
        self.assertTrue(result["acceptanceEnabled"])
        self.assertEqual(result["known"]["known_accepted_precision"], 1.)
        self.assertEqual(result["known"]["correct_known_coverage"], .25)
        self.assertFalse(result["screenPassed"])

    def test_missing_negative_group_cannot_enable_acceptance(self):
        with self.assertRaisesRegex(ValueError, "twenty"):
            calibrate_separate(self.scores, self.targets, self.ambiguous[:1], self.ambiguous)


class ImmutableReportTests(unittest.TestCase):
    def test_existing_output_refused_before_sources_or_training_are_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "artifacts"; output.mkdir()
            with patch("run_small_vocab_pilot.verify_sources") as loader:
                with self.assertRaises(FileExistsError):
                    run_pilot(root / "source", root / "registration", root / "strict", output, root / "report")
                loader.assert_not_called()

    def test_write_new_never_overwrites_existing_frozen_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "protocol.json"
            write_new(path, {"frozen": True})
            digest = sha256(path)
            with self.assertRaises(FileExistsError):
                write_new(path, {"frozen": False})
            self.assertEqual(sha256(path), digest)

    def test_per_class_report_accounts_for_rejected_and_wrong_predictions(self):
        run = {"labels": ["A", "B"], "variant": "none", "seed": 42,
               "calibration": {"threshold": .8, "margin": .1, "acceptanceEnabled": True}}
        rows, confusions = per_class_rows(run, np.asarray([[.99, .01], [.9, .1], [.5, .5]]), np.asarray([0, 1, 1]))
        self.assertEqual(rows[1]["validationCount"], 2)
        self.assertEqual(rows[1]["acceptedWrong"], 1)
        self.assertEqual(rows[1]["rejected"], 1)
        self.assertEqual(rows[1]["correctCoverage"], 0.)
        self.assertEqual(sum(row["count"] for row in confusions), 3)

    def test_one_good_seed_cannot_enable_research_follow_up_or_promotion(self):
        known = {"correct_known_coverage": .8}
        runs = []
        for variant in ("none", "mild-spatial"):
            for seed in (42, 43, 44):
                runs.append({"variant": variant, "seed": seed, "epochsRun": 20,
                             "bestEpoch": 20, "trainingSeconds": 1., "bestValidationMacroRecall": .8,
                             "calibration": {"screenPassed": seed == 42, "known": known},
                             "weightsSha256": "fixture", "validationPredictionsSha256": "fixture"})
        summary = summarize(runs, {"labels": ["synthetic"]})
        self.assertIsNone(summary["researchFollowUpCandidate"])
        self.assertFalse(summary["promoted"])
        self.assertFalse(summary["finalTestEvaluated"])
        self.assertTrue(summary["validationReused"])


if __name__ == "__main__":
    unittest.main()
