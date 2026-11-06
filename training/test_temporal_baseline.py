"""Synthetic engineering checks; these fixtures are not sign-accuracy evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from unittest.mock import patch

import numpy as np
import torch

from export_graph_model import export_and_check
from graph_models import ARCHITECTURES, EXPERIMENTAL_ARCHITECTURES, SignGraphModel, load_checkpoint
from train_graph_models import TEMPORAL_EXPERIMENT_KIND, training_profile
from train_temporal_baseline import SEEDS, experiment_record, parse_args, run_experiment, validate_learning_signers
from temporal_coordinates import (FORMAT, MAX_DATA_BYTES, MAX_METADATA_BYTES, coordinate_preflight,
                                  file_sha256, validate_coordinate_provenance)


def coordinate_declaration(data_hash):
    return {"format": FORMAT, "canonicalSpace": "normalized-image", "axes": "x-right-y-down",
            "cameraSpace": "normalized-image", "conversionStage": "before-shoulder-normalization",
            "source": {"space": "normalized-image", "scaleX": 1, "scaleY": 1}, "conversion": "identity",
            "preparedDataSha256": data_hash, "auditReportSha256": "a" * 64}


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
        metadata = {"language": "asl", "featureContract": "signbridge-pose75-xyc-v1",
                    "coordinateProvenance": coordinate_declaration(hashlib.sha256(args.data.read_bytes()).hexdigest())}
        args.data.with_suffix(".metadata.json").write_text(json.dumps(metadata), encoding="utf-8")

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
            coordinates = coordinate_declaration("b" * 64)
            first = experiment_record(args, labels, "data", "metadata", {}, coordinates)
            second = experiment_record(args, list(reversed(labels)), "data", "metadata", {}, coordinates)
            self.assertEqual(first["labels"], labels)
            self.assertNotEqual(first["orderedLabelsSha256"], second["orderedLabelsSha256"])
            self.assertEqual(first["models"], ["gru75", "lstm75"])
            self.assertEqual(first["seeds"], list(SEEDS))
            self.assertEqual(first["format"], "signbridge-temporal-control-experiment-v1")
            self.assertFalse(first["finalTestEvaluated"])
            self.assertFalse(first["promoted"])
            self.assertFalse(first["acceptanceEnabled"])
            self.assertEqual(first["coordinateProvenance"], coordinates)
            self.assertFalse(first["coordinateConversionIndependentlyVerified"])

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
                self.assertEqual(protocol["coordinateProvenance"]["preparedDataSha256"], protocol["dataSha256"])
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


class TemporalCoordinateTests(unittest.TestCase):
    def source(self, directory, declaration=True):
        path = Path(directory) / "synthetic.npz"
        # Only a placeholder training array: preflight must not decode any arrays.
        np.savez_compressed(path, X_train=np.zeros((1, 1)))
        metadata = {"language": "isl", "featureContract": "signbridge-pose75-xyc-v1"}
        if declaration:
            metadata["coordinateProvenance"] = coordinate_declaration(hashlib.sha256(path.read_bytes()).hexdigest())
        path.with_suffix(".metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        return path, metadata

    def test_legacy_source_rejected_before_data_hash_load_or_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.source(directory, declaration=False)
            args = parse_args(["--language", "isl", "--data", str(path), "--output", str(Path(directory) / "out")])
            with patch("temporal_coordinates.file_sha256") as hasher, \
                 patch("train_temporal_baseline.load_data") as loader, patch("train_temporal_baseline.train_run") as trainer:
                with self.assertRaisesRegex(ValueError, "Prepare a new explicitly canonicalized"):
                    run_experiment(args)
            hasher.assert_not_called(); loader.assert_not_called(); trainer.assert_not_called()
            self.assertFalse(args.output.exists())

    def test_check_only_is_read_only_narrow_and_does_not_load_arrays_or_train(self):
        with tempfile.TemporaryDirectory() as directory:
            path, metadata = self.source(directory)
            before = {p.name: p.read_bytes() for p in Path(directory).iterdir()}
            args = parse_args(["--language", "isl", "--data", str(path), "--check-only"])
            with patch("numpy.load", side_effect=AssertionError("No array decoding")), \
                 patch("train_temporal_baseline.load_data") as loader, patch("train_temporal_baseline.train_run") as trainer:
                report = run_experiment(args)
            loader.assert_not_called(); trainer.assert_not_called()
            self.assertEqual({p.name: p.read_bytes() for p in Path(directory).iterdir()}, before)
            self.assertEqual(report["coordinateProvenance"], metadata["coordinateProvenance"])
            for key in ("conversionIndependentlyVerified", "featureArraysRead", "signerGroupsChecked", "trainingPerformed"):
                self.assertFalse(report[key])
            self.assertIn("audit-report contents", report["limits"])

    def test_declared_conversion_requires_exact_schema_and_consistent_divisors(self):
        value = coordinate_declaration("b" * 64)
        self.assertEqual(validate_coordinate_provenance(value, "b" * 64), value)
        scaled = {**value, "source": {"space": "axis-scaled-image", "scaleX": 1080, "scaleY": 1920}, "conversion": "divide-xy"}
        self.assertEqual(validate_coordinate_provenance(scaled, "b" * 64), scaled)
        variants = [{**value, "format": "future"}, {**value, "extra": "PRIVATE"},
                    {**value, "canonicalSpace": "pixels"}, {**value, "axes": "inferred"},
                    {**value, "cameraSpace": "archive"}, {**value, "conversionStage": "after-shoulder-normalization"},
                    {**value, "source": [value["source"]]}, {**value, "conversion": "divide-xy"},
                    {**scaled, "conversion": "identity"}, {**value, "auditReportSha256": "PRIVATE"}]
        for key in ("scaleX", "scaleY"):
            for invalid in (True, 0, -1, 1.5, 16385, "1080"):
                variants.append({**scaled, "source": {**scaled["source"], key: invalid}})
        for invalid in variants:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError) as caught:
                validate_coordinate_provenance(invalid, "b" * 64)
            self.assertNotIn("PRIVATE", str(caught.exception))

    def test_changed_data_cannot_reuse_a_declaration_for_another_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.source(directory)
            path.write_bytes(path.read_bytes() + b"changed")
            with self.assertRaisesRegex(ValueError, "bound to different prepared data"):
                coordinate_preflight(path, "isl")

    def test_metadata_language_contract_size_and_json_are_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path, original = self.source(directory)
            metadata_path = path.with_suffix(".metadata.json")
            variants = [[], {**original, "language": "asl"}, {**original, "featureContract": "other"}]
            for invalid in variants:
                metadata_path.write_text(json.dumps(invalid), encoding="utf-8")
                with self.assertRaises(ValueError): coordinate_preflight(path, "isl")
            metadata_path.write_text('{"PRIVATE":', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "valid JSON"): coordinate_preflight(path, "isl")
            metadata_path.write_bytes(b" " * (MAX_METADATA_BYTES + 1))
            with self.assertRaisesRegex(ValueError, "1 MiB"): coordinate_preflight(path, "isl")
            metadata_path.write_text(json.dumps(original), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "bounded file size"):
                file_sha256(path, maximum=1)

    def test_cli_check_only_never_imports_torch_and_returns_actionable_nonzero_for_legacy(self):
        script = Path(__file__).with_name("train_temporal_baseline.py")
        code = ("import builtins,runpy,sys; original=builtins.__import__; "
                "builtins.__import__=lambda name,*a,**k: (_ for _ in ()).throw(AssertionError('torch imported')) "
                "if name.split('.')[0]=='torch' else original(name,*a,**k); "
                "sys.path.insert(0,sys.argv[1]); sys.argv=sys.argv[2:]; runpy.run_path(sys.argv[0],run_name='__main__')")
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.source(directory)
            command = [sys.executable, "-c", code, str(script.parent), str(script), "--language", "isl", "--data", str(path), "--check-only"]
            success = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(success.returncode, 0, success.stderr)
            self.assertFalse(json.loads(success.stdout)["trainingPerformed"])
            self.source(directory, declaration=False)
            failure = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(failure.returncode, 2)
            self.assertIn("coordinateProvenance", failure.stderr)
            self.assertNotIn("Traceback", failure.stderr)
            self.assertNotIn(str(path), failure.stderr)

    def test_plain_cli_check_only_creates_no_bytecode_or_other_module_input_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            modules = root / "modules"
            inputs = root / "inputs"
            modules.mkdir(); inputs.mkdir()
            for name in ("train_temporal_baseline.py", "temporal_coordinates.py"):
                (modules / name).write_bytes(Path(__file__).with_name(name).read_bytes())
            path, _ = self.source(inputs)
            def snapshot():
                return {str(p.relative_to(root)): None if p.is_dir() else p.read_bytes() for p in root.rglob("*")}
            before = snapshot()
            command = [sys.executable, str(modules / "train_temporal_baseline.py"), "--language", "isl",
                       "--data", str(path), "--check-only"]
            success = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(success.returncode, 0, success.stderr)
            self.assertEqual(snapshot(), before)
            self.assertFalse(any(p.name == "__pycache__" for p in root.rglob("*")))
            self.source(inputs, declaration=False)
            before_failure = snapshot()
            failure = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(failure.returncode, 2)
            self.assertEqual(snapshot(), before_failure)
            self.assertFalse(any(p.name == "__pycache__" for p in root.rglob("*")))


if __name__ == "__main__":
    unittest.main()
