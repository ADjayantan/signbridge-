"""Synthetic engineering checks; these fixtures are not sign-accuracy evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from export_graph_model import export_and_check
from graph_models import ARCHITECTURES, EXPERIMENTAL_ARCHITECTURES, SignGraphModel, load_checkpoint
from train_graph_models import TEMPORAL_EXPERIMENT_KIND, training_profile
from train_temporal_baseline import SEEDS, experiment_record, parse_args, run_experiment, validate_learning_signers


class TemporalModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def model(self, architecture="lstm75"):
        torch.manual_seed(17)
        return SignGraphModel(3, architecture, np.full((75, 2), 2.), np.full((75, 2), .5))

    def pose(self):
        pose = torch.zeros(2, 32, 75, 3)
        pose[0, :, :8] = torch.tensor([3., 1., .8])
        pose[1, :, :8] = torch.tensor([1., 3., .9])
        return pose

    def test_experimental_registry_does_not_change_frozen_controls(self):
        self.assertEqual(ARCHITECTURES, ("gru27", "gru75", "stgcn"))
        self.assertEqual(EXPERIMENTAL_ARCHITECTURES, ("lstm75",))
        with self.assertRaisesRegex(ValueError, "separate temporal"):
            training_profile("lstm75", "frozen-graph")
        self.assertEqual(training_profile("gru75", "frozen-graph"), {"format": "signbridge-graph-training-v1"})
        for architecture in ("gru75", "lstm75"):
            profile = training_profile(architecture, TEMPORAL_EXPERIMENT_KIND)
            self.assertTrue(profile["experimental"])
            self.assertFalse(profile["acceptanceEnabled"])
            self.assertFalse(profile["promoted"])
        with self.assertRaisesRegex(ValueError, "GRU75"):
            training_profile("stgcn", TEMPORAL_EXPERIMENT_KIND)

    def test_batched_logits_and_probability_normalization(self):
        model = self.model().eval()
        logits = model(self.pose())
        self.assertEqual(tuple(logits.shape), (2, 3))
        self.assertTrue(bool(torch.isfinite(logits).all()))
        torch.testing.assert_close(logits.softmax(-1).sum(-1), torch.ones(2))
        self.assertLess(sum(parameter.numel() for parameter in model.parameters()), 500000)
        self.assertIsInstance(model.lstm, torch.nn.LSTM)
        self.assertFalse(hasattr(model, "blocks"))

    def test_lstm_and_gru_share_identical_masked_normalization(self):
        pose = self.pose()
        pose[:, :, 10] = torch.tensor([999., -999., .49])
        actual, mask = self.model().preprocess(pose)
        control, control_mask = self.model("gru75").preprocess(pose)
        torch.testing.assert_close(actual, control)
        torch.testing.assert_close(mask, control_mask)
        self.assertEqual(int(torch.count_nonzero(actual[:, :, 10])), 0)
        torch.testing.assert_close(actual[0, :, 0], torch.tensor([2., -2., .8]).expand(32, 3))

    def test_absent_coordinates_cannot_change_predictions(self):
        model = self.model().eval()
        pose = self.pose()
        noisy = pose.clone()
        noisy[:, :, 20:, :2] = 4000.
        torch.testing.assert_close(model(pose), model(noisy), rtol=0, atol=0)
        self.assertTrue(bool(torch.isfinite(model(torch.zeros_like(pose))).all()))

    def test_eval_is_repeatable_and_batch_items_have_no_shared_state(self):
        model = self.model().eval()
        pose = self.pose()
        first = model(pose)
        torch.testing.assert_close(first, model(pose), rtol=0, atol=0)
        individual = torch.cat([model(pose[index:index + 1]) for index in range(2)])
        torch.testing.assert_close(first, individual, rtol=1e-5, atol=1e-6)

    def test_backward_has_finite_gradients_without_fitting_any_data(self):
        model = self.model()
        loss = torch.nn.functional.cross_entropy(model(self.pose()), torch.tensor([0, 2]))
        loss.backward()
        self.assertTrue(all(parameter.grad is not None and bool(torch.isfinite(parameter.grad).all())
                            for parameter in model.parameters()))

    def test_checkpoint_round_trip_retains_label_order(self):
        model = self.model().eval()
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "checkpoint.pt"
            torch.save(model.state_dict(), checkpoint)
            labels = ["SECOND", "FIRST", "THIRD"]
            report = {"architecture": "lstm75", "labels": labels,
                      "normalization": {"mean": model.mean.tolist(), "std": model.std.tolist()},
                      "weightsSha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest()}
            checkpoint.with_name("run.json").write_text(json.dumps(report), encoding="utf-8")
            actual, metadata = load_checkpoint(checkpoint)
            self.assertEqual(metadata["labels"], labels)
            self.assertEqual(actual.architecture, "lstm75")
            torch.testing.assert_close(actual(self.pose()), model(self.pose()), rtol=0, atol=0)

    def test_synthetic_native_onnx_export_parity_is_not_browser_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            report, scores = export_and_check(self.model().eval(), self.pose().numpy(), Path(directory) / "synthetic.onnx")
            self.assertLessEqual(report["maxProbabilityError"], 1e-4)
            self.assertTrue(report["top1Matches"])
            self.assertEqual(scores.shape, (2, 3))
            self.assertEqual(report["fixtures"], 2)
            self.assertLess(report["bytes"], 5 * 1024 * 1024)


class TemporalStudyTests(unittest.TestCase):
    def args(self, directory):
        root = Path(directory)
        return parse_args(["--language", "asl", "--data", str(root / "synthetic.npz"),
                           "--output", str(root / "new-study")])

    def arrays(self):
        return {split: {"ids": [f"{split}-a", f"{split}-b"]}
                for split in ("train", "val", "unknown_validation")}

    def source(self, args, **overrides):
        values = {"signer_ids_train": np.asarray([0, 1]), "signer_ids_val": np.asarray([2, 3]),
                  "signer_ids_unknown_validation": np.asarray([2, 4])}
        values.update(overrides)
        np.savez_compressed(args.data, **values)
        args.data.with_suffix(".metadata.json").write_text("{}", encoding="utf-8")

    def test_recorded_signer_validation_does_not_require_or_read_final_test(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.args(directory)
            self.source(args)
            # Archive deliberately has no final-test keys.
            report = validate_learning_signers(args.data, self.arrays())
            self.assertEqual(report["trainingValidationOverlap"], 0)
            self.assertFalse(report["physicalIdentitiesVerified"])
            self.assertFalse(report["finalTestSignerGroupsChecked"])

    def test_train_signers_cannot_leak_into_either_validation_set(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.args(directory)
            for key in ("signer_ids_val", "signer_ids_unknown_validation"):
                self.source(args, **{key: np.asarray([0, 5])})
                with self.assertRaisesRegex(ValueError, "overlap"):
                    validate_learning_signers(args.data, self.arrays())

    def test_missing_invalid_and_cross_type_signer_codes_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.args(directory)
            for value in (np.asarray([-1, 4]), np.asarray([" ", "four"]), np.asarray([4.1, 4.2]), np.asarray([2])):
                self.source(args, signer_ids_val=value)
                with self.assertRaises(ValueError):
                    validate_learning_signers(args.data, self.arrays())
            self.source(args, signer_ids_val=np.asarray(["0", "another"]))
            with self.assertRaisesRegex(ValueError, "overlap"):
                validate_learning_signers(args.data, self.arrays())
            np.savez_compressed(args.data, signer_ids_train=np.asarray([0, 1]))
            with self.assertRaisesRegex(ValueError, "required"):
                validate_learning_signers(args.data, self.arrays())

    def test_protocol_preserves_ordered_vocabulary_and_uses_a_distinct_format(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.args(directory)
            labels = ["Z", "A"]
            first = experiment_record(args, labels, "data", "metadata", {})
            second = experiment_record(args, list(reversed(labels)), "data", "metadata", {})
            self.assertEqual(first["labels"], labels)
            self.assertNotEqual(first["orderedLabelsSha256"], second["orderedLabelsSha256"])
            self.assertEqual(first["models"], ["gru75", "lstm75"])
            self.assertEqual(first["seeds"], list(SEEDS))
            self.assertEqual(first["format"], "signbridge-temporal-control-experiment-v1")
            self.assertFalse(first["finalTestEvaluated"])
            self.assertFalse(first["promoted"])
            self.assertFalse(first["acceptanceEnabled"])

    def test_dispatch_freezes_shared_protocol_before_any_trainer_call(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.args(directory)
            self.source(args)
            labels = ["B", "A"]
            loaded = (labels, {"labels": labels}, self.arrays(), {"mean": [], "std": []}, None)
            observed = []

            def record_call(_args, architecture, seed, _output, passed_labels, *_rest, **keywords):
                protocol = json.loads((args.output / "experiment.json").read_text(encoding="utf-8"))
                self.assertEqual(protocol["labels"], passed_labels)
                self.assertEqual(keywords["experiment_kind"], TEMPORAL_EXPERIMENT_KIND)
                observed.append((architecture, seed))

            with patch("train_temporal_baseline.load_data", return_value=loaded) as loader, \
                 patch("train_temporal_baseline.train_run", side_effect=record_call):
                run_experiment(args)
            loader.assert_called_once_with(args.data, "asl", None)
            self.assertEqual(observed, [(model, seed) for model in ("gru75", "lstm75") for seed in SEEDS])
            original = (args.output / "experiment.json").read_bytes()
            with self.assertRaisesRegex(ValueError, "fresh output"):
                run_experiment(args)
            self.assertEqual((args.output / "experiment.json").read_bytes(), original)

    def test_metadata_label_mismatch_fails_before_any_artifact_or_training(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.args(directory)
            self.source(args)
            loaded = (["B", "A"], {"labels": ["A", "B"]}, self.arrays(), {}, None)
            with patch("train_temporal_baseline.load_data", return_value=loaded), \
                 patch("train_temporal_baseline.train_run") as trainer:
                with self.assertRaisesRegex(ValueError, "exact vocabulary"):
                    run_experiment(args)
            trainer.assert_not_called()
            self.assertFalse(args.output.exists())


if __name__ == "__main__":
    unittest.main()
