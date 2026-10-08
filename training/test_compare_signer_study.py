"""Synthetic validation/final lifecycle tests; never evaluate real study models."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch

from compare_signer_study import BUDGET, GATES, _verify_inputs, final_benchmark, freeze_selection, json_hash
from freeze_graph_experiment import sha256
from pose_graph import SPLITS
from prepare_signer_study import prepare_study, record_strict_protocol
from test_prepare_signer_study import sources
from train_graph_models import load_data, validation_score


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def make_fixture(root, fail_seed=None, reference_perfect=False):
    source = root / "source"
    source.mkdir()
    graph_source, legacy_source, _, _ = sources(source, strict_pool=True)
    strict_protocol = root / "strict-protocol.json"
    record_strict_protocol(graph_source, legacy_source, strict_protocol)
    study_folder = root / "strict-study"
    inventory = prepare_study(graph_source, legacy_source, study_folder, strict_negatives=True, protocol_path=strict_protocol)
    inventory_path = root / "inventory.json"
    write_json(inventory_path, inventory)
    graph_path, legacy_path = study_folder / "asl.npz", study_folder / "asl-legacy.npz"
    labels, metadata, arrays, normalization, legacy_normalization = load_data(graph_path, "asl", legacy_path)
    split_summary = {}
    with np.load(graph_path, allow_pickle=False) as graph:
        for split in SPLITS:
            ids = graph[f"clip_ids_{split}"].tolist()
            split_summary[split] = {"count": len(ids), "signers": len(set(graph[f"signer_ids_{split}"].tolist())), "orderedClipIdsSha256": json_hash(ids)}
    registration = {"format": "signbridge-asl-signer-comparison-protocol-v1", "signLanguage": "asl", "models": ["gru27", "gru75"], "seeds": [42, 43, 44],
                    "dataSha256": sha256(graph_path), "legacyDataSha256": sha256(legacy_path),
                    "metadataSha256": sha256(graph_path.with_suffix(".metadata.json")), "legacyMetadataSha256": sha256(legacy_path.with_suffix(".metadata.json")),
                    "strictProtocolSha256": sha256(strict_protocol), "inventorySha256": sha256(inventory_path), "inventoryPath": str(inventory_path),
                    "labelsSha256": json_hash(labels), "classes": len(labels), "splits": split_summary,
                    "training": BUDGET, "acceptance": GATES, "minimumCoverageImprovement": .05, "representativeSeed": 42}
    preregistration = root / "preregistration.json"
    write_json(preregistration, registration)
    run_root = root / "runs"
    run_root.mkdir()
    experiment = {"format": "signbridge-graph-experiment-v1", "signLanguage": "asl", "models": ["gru27", "gru75"], "seeds": [42, 43, 44],
                  "dataSha256": sha256(graph_path), "legacyDataSha256": sha256(legacy_path),
                  **{key: BUDGET[key] for key in ("epochs", "minimumEpochs", "patience", "batchSize", "learningRate")},
                  "maxSecondsPerRun": BUDGET["maxSeconds"], "augmentation": "none", "normalizationFit": "training-only", "finalTestEvaluated": False,
                  "checkpointMetric": "validation macro recall; tie lower validation loss"}
    write_json(run_root / "experiment.json", experiment)
    targets = arrays["val"]["targets"]
    perfect = np.asarray([[.999, .001] if target == 0 else [.001, .999] for target in targets], dtype=np.float32)
    for architecture in ("gru27", "gru75"):
        for seed in (42, 43, 44):
            folder = run_root / f"{architecture}-seed{seed}"
            folder.mkdir()
            checkpoint = folder / "checkpoint.pt"
            checkpoint.write_bytes(f"synthetic provenance {architecture} {seed}".encode())
            scores = perfect.copy()
            if architecture == "gru27" and not reference_perfect:
                scores[-1:] = [.5, .5]
            if architecture == "gru75" and seed == fail_seed:
                scores[:] = [.5, .5]
            unknown = np.tile(np.asarray([.5, .5], dtype=np.float32), (len(arrays["unknown_validation"]["ids"]), 1))
            np.savez_compressed(folder / "validation-predictions.npz", scores=scores, targets=targets, unknown_scores=unknown,
                                clip_ids=np.asarray(arrays["val"]["ids"]), unknown_clip_ids=np.asarray(arrays["unknown_validation"]["ids"]))
            recall, loss = validation_score(scores, targets, len(labels))
            run = {"format": "signbridge-graph-training-v1", "signLanguage": "asl", "architecture": architecture, "seed": seed,
                   "labels": labels, "weightsSha256": sha256(checkpoint), "checkpoint_sha256": sha256(checkpoint), "checkpoint": str(checkpoint.resolve()),
                   "dataSha256": sha256(graph_path), "prepared_data_sha256": sha256(graph_path), "prepared_data": str(graph_path.resolve()),
                   "experimentSha256": sha256(run_root / "experiment.json"), "budget": BUDGET, "finalTestEvaluated": False, "source": metadata,
                   "normalization": legacy_normalization if architecture == "gru27" else normalization,
                   "featureContract": "signbridge-pose27-xyc-v1" if architecture == "gru27" else "signbridge-pose75-xyc-v1",
                   "inputShape": [1, 32, 81] if architecture == "gru27" else [1, 32, 75, 3],
                   "counts": {name: len(value["ids"]) for name, value in arrays.items()}, "epochsRun": 80, "bestEpoch": 1,
                   "parameters": 5000, "trainingSeconds": .1, "bestValidationMacroRecall": recall, "bestValidationLoss": loss,
                   "stopReason": "epoch-ceiling", "versions": {"torch": "synthetic", "numpy": "synthetic"}}
            write_json(folder / "run.json", run)
    return {"root": root, "graph": graph_path, "legacy": legacy_path, "protocol": strict_protocol,
            "registration": preregistration, "inventory": inventory_path, "runs": run_root, "selection": root / "selection.json"}


def freeze(context):
    return freeze_selection(context["runs"], context["selection"], context["graph"], context["legacy"], context["protocol"], context["registration"])


def edit_npz(path, change):
    with np.load(path, allow_pickle=False) as original:
        arrays = {key: original[key].copy() for key in original.files}
    change(arrays)
    np.savez_compressed(path, **arrays)


def fake_checkpoint(path):
    run = json.loads(path.with_name("run.json").read_text())
    model = SimpleNamespace(architecture=run["architecture"], seed=run["seed"], parameters=lambda: [torch.zeros(run["parameters"])],
                            mean=torch.as_tensor(run["normalization"]["mean"], dtype=torch.float32),
                            std=torch.as_tensor(run["normalization"]["std"], dtype=torch.float32))
    return model, run


def fake_predict(model, features):
    n = len(features)
    if n > 4:  # Synthetic unknown holdout: ambiguous, never accepted.
        return np.tile([.5, .5], (n, 1))
    scores = np.asarray([[.999, .001] if index % 2 == 0 else [.001, .999] for index in range(n)])
    if model.architecture == "gru27":
        scores[-2:] = [.5, .5]
    return scores


class GuardedNpz:
    def __init__(self, wrapped):
        self.wrapped = wrapped

    def __enter__(self):
        self.wrapped.__enter__()
        return self

    def __exit__(self, *args):
        return self.wrapped.__exit__(*args)

    def __getitem__(self, key):
        if key in ("X_test", "y_test", "X_unknown_test", "y_unknown_test", "mask_test", "mask_unknown_test"):
            raise AssertionError(f"Validation-only freeze accessed {key}")
        return self.wrapped[key]


class SignerComparisonTests(unittest.TestCase):
    def test_freeze_uses_validation_only_and_fixed_seed_without_promotion(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            original_load = np.load
            with patch("compare_signer_study.np.load", side_effect=lambda *args, **kwargs: GuardedNpz(original_load(*args, **kwargs))), patch("compare_signer_study.predict") as inference:
                result = freeze(context)
            inference.assert_not_called()
            self.assertEqual(result["selected_architecture"], "gru75")
            self.assertEqual(result["representative_seed"], 42)
            self.assertEqual(len(result["runs"]), 6)
            self.assertFalse(result["promotion"])
            self.assertFalse(result["final_test_evaluated"])
            self.assertTrue(context["selection"].with_name("selection.json.sha256").is_file())
            with self.assertRaises(FileExistsError):
                freeze(context)

    def test_one_failing_validation_seed_disqualifies_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary), fail_seed=44)
            self.assertIsNone(freeze(context)["selected_architecture"])

    def test_five_point_improvement_required_over_matched_control(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary), reference_perfect=True)
            result = freeze(context)
            self.assertTrue(result["summaries"]["gru75"]["all_seeds_screen_passed"])
            self.assertIsNone(result["selected_architecture"])

    def test_late_checkpoint_tamper_is_detected_before_any_final_prediction(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            freeze(context)
            (context["runs"] / "gru75-seed44/checkpoint.pt").write_bytes(b"late changed checkpoint")
            with patch("compare_signer_study.predict") as inference, patch("compare_signer_study.load_checkpoint") as loader:
                with self.assertRaisesRegex(ValueError, "Checkpoint changed"):
                    final_benchmark(context["selection"], context["root"] / "final.json")
            inference.assert_not_called()
            loader.assert_not_called()
            self.assertFalse((context["root"] / "final.json").exists())
            self.assertFalse(context["selection"].with_name("selection.json.final-record.json").exists())

    def test_stale_or_edited_calibration_is_not_trusted(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            freeze(context)
            path = context["runs"] / "gru75-seed44/calibration.json"
            point = json.loads(path.read_text())
            point["threshold"] = .51
            write_json(path, point)
            with patch("compare_signer_study.predict") as inference:
                with self.assertRaisesRegex(ValueError, "Saved calibration differs"):
                    final_benchmark(context["selection"], context["root"] / "final.json")
            inference.assert_not_called()

    def test_late_checkpoint_embedded_normalization_is_checked_before_any_prediction(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            freeze(context)

            def incompatible_checkpoint(path):
                model, run = fake_checkpoint(path)
                if model.architecture == "gru75" and model.seed == 44:
                    model.mean = model.mean + 1
                return model, run

            with patch("compare_signer_study.load_checkpoint", side_effect=incompatible_checkpoint), patch("compare_signer_study.predict") as inference:
                with self.assertRaisesRegex(ValueError, "embedded normalization"):
                    final_benchmark(context["selection"], context["root"] / "final.json")
            inference.assert_not_called()
            self.assertFalse(context["selection"].with_name("selection.json.final-record.json").exists())

    def test_mixed_budget_is_rejected_before_freeze(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            path = context["runs"] / "gru75-seed44/run.json"
            run = json.loads(path.read_text())
            run["budget"]["maxSeconds"] = 2400
            write_json(path, run)
            with self.assertRaisesRegex(ValueError, "optimization budget"):
                freeze(context)
            self.assertFalse(context["selection"].exists())

    def test_historical_legacy_default_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            path = context["runs"] / "experiment.json"
            experiment = json.loads(path.read_text())
            experiment["legacyDataSha256"] = sha256(context["root"] / "source/legacy.npz")
            write_json(path, experiment)
            with self.assertRaisesRegex(ValueError, "different graph or legacy study data"):
                freeze(context)

    def test_validation_prediction_identity_order_is_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            path = context["runs"] / "gru75-seed44/validation-predictions.npz"
            edit_npz(path, lambda arrays: arrays.update(clip_ids=arrays["clip_ids"][::-1]))
            with self.assertRaisesRegex(ValueError, "prediction clip order"):
                freeze(context)

    def test_final_fake_models_use_both_matched_feature_shapes_and_are_once_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            freeze(context)
            shapes = []

            def recorded_predict(model, features):
                shapes.append((model.architecture, tuple(features.shape)))
                return fake_predict(model, features)

            with patch("compare_signer_study.load_checkpoint", side_effect=fake_checkpoint), patch("compare_signer_study.predict", side_effect=recorded_predict):
                result = final_benchmark(context["selection"], context["root"] / "final.json")
            self.assertEqual(len(result["runs"]), 6)
            self.assertTrue(result["candidate_dataset_gate_passed"])
            self.assertFalse(result["promoted"])
            self.assertEqual(result["representative_seed"], 42)
            self.assertEqual(shapes.count(("gru27", (4, 32, 81))), 3)
            self.assertEqual(shapes.count(("gru75", (4, 32, 75, 3))), 3)
            for path in ("final.json", "different-report.json"):
                with self.assertRaises(FileExistsError):
                    final_benchmark(context["selection"], context["root"] / path)

    def test_final_cannot_select_candidate_rejected_by_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary), fail_seed=44)
            self.assertIsNone(freeze(context)["selected_architecture"])
            with patch("compare_signer_study.load_checkpoint", side_effect=fake_checkpoint), patch("compare_signer_study.predict", side_effect=fake_predict):
                result = final_benchmark(context["selection"], context["root"] / "final.json")
            self.assertIsNone(result["selected_architecture"])
            self.assertFalse(result["candidate_dataset_gate_passed"])

    def test_frozen_selection_edit_is_detected_without_final_inference(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            freeze(context)
            selection = json.loads(context["selection"].read_text())
            selection["representative_seed"] = 44
            write_json(context["selection"], selection)
            with patch("compare_signer_study.predict") as inference:
                with self.assertRaisesRegex(ValueError, "selection bytes changed"):
                    final_benchmark(context["selection"], context["root"] / "final.json")
            inference.assert_not_called()

    def test_actual_signer_leakage_is_rejected_even_after_rehashing_claimed_zero_overlap(self):
        with tempfile.TemporaryDirectory() as temporary:
            context = make_fixture(Path(temporary))
            graph_meta = json.loads(context["graph"].with_suffix(".metadata.json").read_text())
            legacy_meta = json.loads(context["legacy"].with_suffix(".metadata.json").read_text())
            manifest = graph_meta["signerAssignmentManifest"]
            leaked_signer = manifest["signerGroups"]["train"][0]
            original_signer = manifest["signerGroups"]["test"][0]
            manifest["signerGroups"]["test"][0] = leaked_signer
            for path in (context["graph"], context["legacy"]):
                def leak(values):
                    for split in ("test", "unknown_test"):
                        name = f"signer_ids_{split}"
                        values[name] = np.where(values[name] == original_signer, leaked_signer, values[name])
                edit_npz(path, leak)
            import hashlib
            assignment_hash = hashlib.sha256(json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
            graph_meta.update(preparedDataSha256=sha256(context["graph"]), assignmentManifestHash=assignment_hash)
            legacy_meta.update(preparedDataSha256=sha256(context["legacy"]), assignmentManifestHash=assignment_hash)
            write_json(context["graph"].with_suffix(".metadata.json"), graph_meta)
            write_json(context["legacy"].with_suffix(".metadata.json"), legacy_meta)
            inventory = json.loads(context["inventory"].read_text())
            inventory.update(dataHashes={"graph": sha256(context["graph"]), "legacy": sha256(context["legacy"])}, assignmentManifestHash=assignment_hash)
            write_json(context["inventory"], inventory)
            registration = json.loads(context["registration"].read_text())
            registration.update(dataSha256=sha256(context["graph"]), legacyDataSha256=sha256(context["legacy"]), metadataSha256=sha256(context["graph"].with_suffix(".metadata.json")), legacyMetadataSha256=sha256(context["legacy"].with_suffix(".metadata.json")), inventorySha256=sha256(context["inventory"]))
            write_json(context["registration"], registration)
            with self.assertRaisesRegex(ValueError, "overlap final test signers"):
                _verify_inputs(context["graph"], context["legacy"], context["protocol"], context["registration"])


if __name__ == "__main__":
    unittest.main()
