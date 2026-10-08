"""Freeze six validation-only ASL runs, then record one immutable final comparison.

The strict graph/legacy study and both protocols are mandatory inputs. Never
trains, retunes after test, exports, or promotes a model. Final corpus recordings
were inspected historically; isolated signer identities are not new live data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from compare_graph_experiment import write_new
from evaluate_graph_models import calibrate, metrics, per_word, validate_scores
from freeze_graph_experiment import sha256
from graph_models import load_checkpoint
from pose_graph import CONTRACT_ID, SPLITS, adjacency_hash, contract_hash
from prepare_data import canonical_clip
from train_graph_models import check_features, load_data, predict, validation_score

ARCHITECTURES = ("gru27", "gru75")
SEEDS = (42, 43, 44)
BUDGET = {"epochs": 80, "minimumEpochs": 20, "patience": 20, "batchSize": 64,
          "learningRate": .002, "weightDecay": .0001, "maxSeconds": 1200, "threads": 4}
GATES = {"minimumKnownPrecision": .95, "minimumCorrectKnownCoverage": .6, "maximumUnknownFalseAcceptRate": .05}
IMPROVEMENT = .05


def json_hash(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode("utf-8")).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _assert(condition, message):
    if not condition:
        raise ValueError(message)


def _ref(path):
    return {"path": str(Path(path).resolve()), "sha256": sha256(path)}


def _verify_inputs(graph_path, legacy_path, protocol_path, preregistration_path):
    """Read learning arrays and final identity metadata, never final X/y arrays."""
    graph_path, legacy_path, protocol_path, preregistration_path = map(lambda p: Path(p).resolve(), (graph_path, legacy_path, protocol_path, preregistration_path))
    registration = read_json(preregistration_path)
    _assert(registration.get("format") == "signbridge-asl-signer-comparison-protocol-v1" and registration.get("signLanguage") == "asl", "Wrong signer comparison preregistration")
    _assert(registration.get("models") == list(ARCHITECTURES) and registration.get("seeds") == list(SEEDS), "Only the two preregistered architectures and three seeds are allowed")
    _assert(registration.get("training") == BUDGET and registration.get("acceptance") == GATES and registration.get("minimumCoverageImprovement") == IMPROVEMENT and registration.get("representativeSeed") == 42, "Preregistered budget or selection gates differ")
    inventory_path = Path(registration["inventoryPath"]).resolve()
    inputs = {"graph": _ref(graph_path), "legacy": _ref(legacy_path),
              "graphMetadata": _ref(graph_path.with_suffix(".metadata.json")), "legacyMetadata": _ref(legacy_path.with_suffix(".metadata.json")),
              "strictProtocol": _ref(protocol_path), "preregistration": _ref(preregistration_path), "inventory": _ref(inventory_path)}
    for name, key in (("graph", "dataSha256"), ("legacy", "legacyDataSha256"), ("graphMetadata", "metadataSha256"), ("legacyMetadata", "legacyMetadataSha256"), ("strictProtocol", "strictProtocolSha256"), ("inventory", "inventorySha256")):
        _assert(inputs[name]["sha256"] == registration.get(key), f"Preregistered {name} hash changed")
    for name, expected in registration.get("paths", {}).items():
        _assert(name in inputs and Path(expected).resolve() == Path(inputs[name]["path"]), f"Preregistered {name} path changed")
    metadata = read_json(graph_path.with_suffix(".metadata.json"))
    legacy_metadata = read_json(legacy_path.with_suffix(".metadata.json"))
    protocol, inventory = read_json(protocol_path), read_json(inventory_path)
    _assert(protocol.get("format") == "signbridge-strict-negative-protocol-v1" and protocol.get("signLanguage") == "asl" and protocol.get("minimumNegativesPerHoldout") == 20, "Strict negative protocol is incompatible")
    _assert(metadata.get("featureContract") == CONTRACT_ID and metadata.get("contractHash") == contract_hash() and metadata.get("adjacencyHash") == adjacency_hash() and metadata.get("featuresStandardized") is False, "Graph feature contract changed")
    for meta, key in ((metadata, "graph"), (legacy_metadata, "legacy")):
        _assert(meta.get("strictNegatives") is True and meta.get("studyAvailable") is True and meta.get("strictProtocolHash") == inputs["strictProtocol"]["sha256"], "Strict dataset metadata/protocol mismatch")
        _assert(meta.get("preparedDataSha256") == inputs[key]["sha256"], "Strict dataset bytes changed")
        _assert(meta.get("sourceStudyHashes") == protocol.get("sourceHashes"), "Strict source provenance differs from recorded protocol")
    _assert(inventory.get("studyAvailable") is True and inventory.get("strictNegatives") is True and inventory.get("strictProtocolHash") == inputs["strictProtocol"]["sha256"] and inventory.get("dataHashes") == {"graph": inputs["graph"]["sha256"], "legacy": inputs["legacy"]["sha256"]}, "Strict inventory differs from dataset/protocol")
    manifest = metadata["signerAssignmentManifest"]
    manifest_hash = hashlib.sha256(json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    _assert(manifest_hash == metadata.get("assignmentManifestHash") == legacy_metadata.get("assignmentManifestHash") == inventory.get("assignmentManifestHash"), "Signer assignment manifest changed")
    _assert(manifest.get("strictProtocolHash") == inputs["strictProtocol"]["sha256"] and manifest.get("sourceHashes") == protocol.get("sourceHashes"), "Signer manifest strict protocol/provenance mismatch")
    split_summary, signer_sets, seen = {}, {}, set()
    with np.load(graph_path, allow_pickle=False) as graph, np.load(legacy_path, allow_pickle=False) as legacy:
        labels = graph["labels"].tolist()
        _assert(labels == legacy["labels"].tolist() and json_hash(labels) == registration.get("labelsSha256") and len(labels) == registration.get("classes"), "Compared vocabulary order changed")
        for split in SPLITS:
            ids = graph[f"clip_ids_{split}"].tolist()
            signer_ids = graph[f"signer_ids_{split}"]
            _assert(signer_ids.dtype.kind in "iu" and signer_ids.shape == (len(ids),) and np.all(signer_ids >= 0), "Signer identities are missing or invalid")
            signer_sets[split] = set(int(value) for value in signer_ids)
            keys = {canonical_clip(value) for value in ids}
            _assert(len(keys) == len(ids) and not seen.intersection(keys), "Duplicate or overlapping study clip IDs")
            seen.update(keys)
            for field in ("clip_ids", "source_labels", "signer_ids"):
                _assert(np.array_equal(graph[f"{field}_{split}"], legacy[f"{field}_{split}"]), "Graph and legacy clip/signer/source order differs")
            if split in ("train", "val", "unknown_validation"):
                _assert(np.array_equal(graph[f"y_{split}"], legacy[f"y_{split}"]), "Graph and legacy learning targets differ")
            expected_ids = manifest["knownClipIds" if split in ("train", "val", "test") else "unknownClipIds"][split]
            _assert(ids == expected_ids, "Signer manifest clip order differs from actual data")
            expected_signers = set(manifest["signerGroups"][split]) if split in ("train", "val", "test") else (set(manifest["signerGroups"]["val" if split == "unknown_validation" else "test"]) | set(manifest["unknownOnlySignerGroups"]["val" if split == "unknown_validation" else "test"]))
            _assert(signer_sets[split] == expected_signers if split in ("train", "val", "test") else signer_sets[split] <= expected_signers, "Clip signers disagree with frozen assignment")
            declared = registration["splits"][split]
            split_summary[split] = {"count": len(ids), "signers": len(signer_sets[split]), "orderedClipIdsSha256": json_hash(ids)}
            _assert(all(declared.get(key) == value for key, value in split_summary[split].items()), "Preregistered split identities/order changed")
            if split in ("unknown_validation", "unknown_test"):
                _assert(len(ids) >= 20, "Strict negative holdout is too small")
    _assert(not signer_sets["train"] & signer_sets["val"], "Known fitting and validation signers overlap")
    selection_signers = signer_sets["train"] | signer_sets["val"] | signer_sets["unknown_validation"]
    final_signers = signer_sets["test"] | signer_sets["unknown_test"]
    _assert(not selection_signers & final_signers and not signer_sets["unknown_validation"] & signer_sets["unknown_test"], "Training/selection/calibration signers overlap final test signers")
    _assert(not signer_sets["train"] & signer_sets["unknown_validation"], "Calibration negatives contain a training signer")
    labels_loaded, _, arrays, normalization, legacy_normalization = load_data(graph_path, "asl", legacy_path)
    _assert(labels_loaded == labels, "Learning vocabulary mismatch")
    _assert(legacy_normalization == legacy_metadata.get("normalization"), "Legacy normalization is not reproduced from this study's training clips")
    return {"inputs": inputs, "registration": registration, "metadata": metadata, "labels": labels,
            "splits": split_summary, "arrays": arrays, "normalization": normalization, "legacy_normalization": legacy_normalization}


def _screen(calibration):
    m = calibration["metrics"]
    return bool(calibration["acceptanceEnabled"] and m["known_accepted_precision"] is not None and m["known_accepted_precision"] >= .95 and m["correct_known_coverage"] >= .6 and m["unknown_false_accept_rate"] <= .05)


def _summarize(rows):
    summaries = {}
    for architecture in ARCHITECTURES:
        group = [row for row in rows if row["architecture"] == architecture]
        coverages = [row["calibration"]["metrics"]["correct_known_coverage"] for row in group]
        summaries[architecture] = {"mean_correct_coverage": float(np.mean(coverages)), "coverage_range": [min(coverages), max(coverages)],
                                    "all_seeds_screen_passed": all(_screen(row["calibration"]) for row in group),
                                    "mean_macro_recall": float(np.mean([row["validation_macro_recall"] for row in group]))}
    chosen = "gru75" if summaries["gru75"]["all_seeds_screen_passed"] and summaries["gru75"]["mean_correct_coverage"] - summaries["gru27"]["mean_correct_coverage"] >= IMPROVEMENT - 1e-12 else None
    return summaries, chosen


def _validate_runs(run_root, study, create_calibrations=False):
    """Verify every run before final features or inference; saved calibration is recomputed."""
    run_root = Path(run_root).resolve()
    training_experiment = run_root / "experiment.json"
    experiment_hash = sha256(training_experiment)
    experiment = read_json(training_experiment)
    inputs = study["inputs"]
    _assert(experiment.get("format") == "signbridge-graph-experiment-v1" and experiment.get("signLanguage") == "asl" and experiment.get("models") == list(ARCHITECTURES) and experiment.get("seeds") == list(SEEDS), "Training experiment architecture/seed identity differs")
    _assert(experiment.get("dataSha256") == inputs["graph"]["sha256"] and experiment.get("legacyDataSha256") == inputs["legacy"]["sha256"], "Training experiment uses different graph or legacy study data")
    for key in ("epochs", "minimumEpochs", "patience", "batchSize", "learningRate"):
        _assert(experiment.get(key) == BUDGET[key], "Training experiment budget differs")
    _assert(experiment.get("maxSecondsPerRun") == BUDGET["maxSeconds"] and experiment.get("augmentation") == "none" and experiment.get("normalizationFit") == "training-only" and experiment.get("finalTestEvaluated") is False and experiment.get("checkpointMetric") == "validation macro recall; tie lower validation loss", "Training experiment policy differs")
    rows, pending, versions = [], [], None
    for architecture in ARCHITECTURES:
        for seed in SEEDS:
            folder = run_root / f"{architecture}-seed{seed}"
            run = read_json(folder / "run.json")
            _assert(run.get("format") == "signbridge-graph-training-v1" and run.get("signLanguage") == "asl" and run.get("architecture") == architecture and run.get("seed") == seed, "Run identity mismatch")
            _assert(run.get("labels") == study["labels"] and run.get("dataSha256") == inputs["graph"]["sha256"] and run.get("prepared_data_sha256") == inputs["graph"]["sha256"], "Run labels or graph dataset hash differs")
            _assert(Path(run["prepared_data"]).resolve() == Path(inputs["graph"]["path"]) and Path(run["checkpoint"]).resolve() == (folder / "checkpoint.pt").resolve(), "Run paths differ from explicit study inputs")
            _assert(run.get("experimentSha256") == experiment_hash and run.get("budget") == BUDGET, "Run experiment hash or optimization budget differs")
            _assert(run.get("finalTestEvaluated") is False and run.get("source") == study["metadata"], "Run source metadata changed or final test was previously evaluated")
            expected_norm = study["legacy_normalization"] if architecture == "gru27" else study["normalization"]
            _assert(run.get("normalization") == expected_norm, "Run normalization differs from training-only matched study statistics")
            _assert(run.get("featureContract") == ("signbridge-pose27-xyc-v1" if architecture == "gru27" else CONTRACT_ID) and run.get("inputShape") == ([1, 32, 81] if architecture == "gru27" else [1, 32, 75, 3]), "Run feature contract/shape differs")
            _assert(run.get("counts") == {name: len(value["ids"]) for name, value in study["arrays"].items()}, "Run learning split counts differ")
            _assert(isinstance(run.get("epochsRun"), int) and 20 <= run["epochsRun"] <= 80 and isinstance(run.get("bestEpoch"), int) and 1 <= run["bestEpoch"] <= run["epochsRun"], "Run did not complete the bounded minimum training budget")
            _assert(0 < run.get("parameters", 0) < 500000 and np.isfinite(run.get("trainingSeconds", float("nan"))), "Invalid run parameter count or timing")
            if versions is not None:
                _assert(run.get("versions") == versions, "Compared runs have different runtime versions")
            versions = run.get("versions")
            checkpoint_hash = sha256(folder / "checkpoint.pt")
            _assert(checkpoint_hash == run.get("weightsSha256") == run.get("checkpoint_sha256"), "Checkpoint changed before selection")
            with np.load(folder / "validation-predictions.npz", allow_pickle=False) as predictions:
                _assert(predictions["clip_ids"].tolist() == study["arrays"]["val"]["ids"] and predictions["unknown_clip_ids"].tolist() == study["arrays"]["unknown_validation"]["ids"], "Validation prediction clip order differs from frozen study")
                targets = predictions["targets"]
                _assert(np.array_equal(targets, study["arrays"]["val"]["targets"]), "Validation prediction targets differ")
                scores, unknown = validate_scores(predictions["scores"], len(study["labels"])), validate_scores(predictions["unknown_scores"], len(study["labels"]))
                _assert(len(scores) == len(targets) and len(unknown) == len(study["arrays"]["unknown_validation"]["ids"]), "Validation probability counts differ")
                recall, loss = validation_score(scores, targets, len(study["labels"]))
                _assert(np.isclose(recall, run.get("bestValidationMacroRecall", float("nan")), atol=1e-12, rtol=0) and np.isclose(loss, run.get("bestValidationLoss", float("nan")), atol=1e-6, rtol=0), "Run validation metrics disagree with saved probabilities")
                calibration = calibrate(scores, targets, unknown)
            calibration_path = folder / "calibration.json"
            if calibration_path.exists():
                _assert(read_json(calibration_path) == calibration, "Saved calibration differs from deterministic validation-only calibration")
            else:
                _assert(create_calibrations, "Frozen calibration file is missing")
                pending.append((calibration_path, calibration))
            rows.append({"architecture": architecture, "seed": seed, "weights_sha256": checkpoint_hash,
                         "run_json_sha256": sha256(folder / "run.json"), "validation_predictions_sha256": sha256(folder / "validation-predictions.npz"),
                         "calibration": calibration, "validation_macro_recall": recall, "epochs": run["epochsRun"],
                         "training_seconds": run["trainingSeconds"], "parameters": run["parameters"], "stop_reason": run["stopReason"]})
    for path, calibration in pending:
        write_new(path, calibration)
    for row in rows:
        row["calibration_sha256"] = sha256(run_root / f"{row['architecture']}-seed{row['seed']}" / "calibration.json")
    return rows, _ref(training_experiment)


def freeze_selection(run_root, output, graph_path, legacy_path, protocol_path, preregistration_path):
    output = Path(output).resolve()
    digest_file = output.with_name(output.name + ".sha256")
    if output.exists() or digest_file.exists():
        raise FileExistsError("Selection already frozen; never overwrite it")
    study = _verify_inputs(graph_path, legacy_path, protocol_path, preregistration_path)
    rows, experiment = _validate_runs(run_root, study, create_calibrations=True)
    summaries, chosen = _summarize(rows)
    result = {"format": "signbridge-signer-frozen-selection-v1", "language": "asl", "run_root": str(Path(run_root).resolve()),
              "stage": "validation-only selection; no final X/y arrays or predictions used", "inputs": study["inputs"],
              "training_experiment": experiment, "labels_sha256": json_hash(study["labels"]), "splits": study["splits"],
              "budget": BUDGET, "selected_architecture": chosen, "representative_seed": 42,
              "selection_rule": "GRU75 requires all three validation precision>=95%, correct coverage>=60%, unknown FAR<=5% gates and >=5pp mean coverage gain over matched GRU27; representative seed42 fixed",
              "summaries": summaries, "runs": rows, "promotion": False, "final_test_evaluated": False,
              "reason": "No eligible candidate; both fixed architectures remain descriptive final comparisons" if chosen is None else "Eligible by validation only; final/device/distribution evidence remains required",
              "historical_corpus_previously_inspected": True}
    # Recheck all immutable provenance before writing the selection; cal files
    # may be created, but weights/source arrays/protocols are never rewritten.
    _verify_snapshot(study["inputs"])
    _verify_snapshot({"training_experiment": experiment})
    _verify_run_snapshot(run_root, rows)
    write_new(output, result)
    with digest_file.open("x", encoding="utf-8") as target:
        target.write(sha256(output) + "\n")
    return result


def _verify_snapshot(inputs):
    for name, ref in inputs.items():
        _assert(sha256(Path(ref["path"])) == ref["sha256"], f"Frozen {name} file changed")


def _verify_run_snapshot(run_root, rows):
    for row in rows:
        folder = Path(run_root) / f"{row['architecture']}-seed{row['seed']}"
        for filename, key in (("checkpoint.pt", "weights_sha256"), ("run.json", "run_json_sha256"),
                              ("validation-predictions.npz", "validation_predictions_sha256"), ("calibration.json", "calibration_sha256")):
            _assert(sha256(folder / filename) == row[key], f"Frozen run file changed: {filename}")


def final_benchmark(selection_file, output):
    selection_file, output = Path(selection_file).resolve(), Path(output).resolve()
    marker = selection_file.with_name(selection_file.name + ".final-record.json")
    if output.exists() or marker.exists():
        raise FileExistsError("Final comparison already started or recorded; do not repeat test selection")
    selection_hash = sha256(selection_file)
    _assert(selection_file.with_name(selection_file.name + ".sha256").read_text().strip() == selection_hash, "Frozen selection bytes changed")
    selection = read_json(selection_file)
    _assert(selection.get("format") == "signbridge-signer-frozen-selection-v1" and selection.get("language") == "asl" and selection.get("representative_seed") == 42 and selection.get("promotion") is False and selection.get("final_test_evaluated") is False, "Invalid frozen signer selection")
    _verify_snapshot(selection["inputs"])
    _verify_snapshot({"training_experiment": selection["training_experiment"]})
    refs = selection["inputs"]
    study = _verify_inputs(refs["graph"]["path"], refs["legacy"]["path"], refs["strictProtocol"]["path"], refs["preregistration"]["path"])
    rows, experiment = _validate_runs(selection["run_root"], study)
    summaries, chosen = _summarize(rows)
    _assert(rows == selection["runs"] and summaries == selection["summaries"] and chosen == selection["selected_architecture"] and experiment == selection["training_experiment"] and selection["budget"] == BUDGET and selection["splits"] == study["splits"] and selection["labels_sha256"] == json_hash(study["labels"]), "Frozen selection differs from validation-only recomputation")
    loaded_models = []
    # Tensor structure and embedded normalization of every checkpoint also pass
    # before any final arrays/predictions, rather than failing after earlier runs.
    for frozen in rows:
        model, run = load_checkpoint(Path(selection["run_root"]) / f"{frozen['architecture']}-seed{frozen['seed']}" / "checkpoint.pt")
        _assert(sum(parameter.numel() for parameter in model.parameters()) == run["parameters"], "Checkpoint parameter count differs from run")
        for key in ("mean", "std"):
            actual = getattr(model, key).detach().cpu().numpy()
            _assert(np.array_equal(actual, np.asarray(run["normalization"][key], dtype=np.float32)), "Checkpoint embedded normalization differs from matched training statistics")
        loaded_models.append(model)
    # All six run/protocol/calibration hashes have passed before final arrays are
    # opened. Graph and legacy test order must be identical, including targets.
    with np.load(refs["graph"]["path"], allow_pickle=False) as graph, np.load(refs["legacy"]["path"], allow_pickle=False) as legacy:
        final_arrays = {}
        targets = graph["y_test"].copy()
        _assert(targets.dtype.kind in "iu" and targets.shape == (study["splits"]["test"]["count"],) and set(targets.tolist()) == set(range(len(study["labels"]))), "Invalid or incomplete final known targets")
        for split in ("test", "unknown_test"):
            _assert(np.array_equal(graph[f"y_{split}"], legacy[f"y_{split}"]), "Final graph/legacy targets differ")
            if split == "unknown_test":
                _assert(np.all(graph[f"y_{split}"] == -1), "Unknown final targets must remain outside the vocabulary")
            raw, mask = graph[f"X_{split}"].astype(np.float32), graph[f"mask_{split}"]
            _assert(mask.dtype.kind == "b", "Final graph masks must be boolean")
            check_features(raw, mask)
            old = legacy[f"X_{split}"].astype(np.float32)
            _assert(old.shape == (len(raw), 32, 81) and np.isfinite(old).all(), "Invalid matched legacy final features")
            final_arrays[split] = {"gru27": old, "gru75": raw}
    _verify_snapshot(selection["inputs"])
    _verify_snapshot({"training_experiment": experiment})
    _verify_run_snapshot(selection["run_root"], rows)
    _assert(sha256(selection_file) == selection_hash, "Selection changed before final inference")
    # An exclusive record makes this one final comparison across output names.
    # A failed inference leaves the started record for explicit investigation;
    # silently starting another benchmark could contaminate the frozen study.
    write_new(marker, {"format": "signbridge-signer-final-record-v1", "selection_sha256": selection_hash,
                       "final_report": str(output), "status": "started", "promoted": False})
    torch.set_num_threads(BUDGET["threads"])
    results = []
    for frozen, model in zip(rows, loaded_models):
        architecture, seed = frozen["architecture"], frozen["seed"]
        scores = predict(model, torch.from_numpy(final_arrays["test"][architecture]))
        unknown = predict(model, torch.from_numpy(final_arrays["unknown_test"][architecture]))
        point = frozen["calibration"]
        measured = metrics(scores, targets, unknown, point["threshold"], point["margin"], point["acceptanceEnabled"])
        screen = _screen({"acceptanceEnabled": point["acceptanceEnabled"], "metrics": measured})
        results.append({"architecture": architecture, "seed": seed, "threshold": point["threshold"], "margin": point["margin"],
                        "acceptance_enabled": point["acceptanceEnabled"], "test_screen_passed": screen, "metrics": measured,
                        "per_word": per_word(scores, targets, point["threshold"], point["margin"], study["labels"], point["acceptanceEnabled"])})
    means = {architecture: float(np.mean([row["metrics"]["correct_known_coverage"] for row in results if row["architecture"] == architecture])) for architecture in ARCHITECTURES}
    passed = bool(chosen and all(row["test_screen_passed"] for row in results if row["architecture"] == chosen) and means[chosen] - means["gru27"] >= IMPROVEMENT - 1e-12)
    # Also check provenance after inference, before recording a result.
    _verify_snapshot(selection["inputs"])
    _verify_snapshot({"training_experiment": experiment})
    _verify_run_snapshot(selection["run_root"], rows)
    _assert(sha256(selection_file) == selection_hash, "Frozen selection changed during final comparison")
    result = {"format": "signbridge-signer-final-benchmark-v1", "language": "asl", "frozen_selection_sha256": selection_hash,
              "selected_architecture": chosen, "representative_seed": 42, "candidate_dataset_gate_passed": passed,
              "test_mean_correct_coverage": means, "mean_coverage_improvement": means["gru75"] - means["gru27"],
              "runs": results, "promoted": False, "signer_isolation_verified": True, "historical_corpus_previously_inspected": True,
              "limits": ["Signer identities isolated within previously inspected historical corpus; not newly collected or untouched recordings",
                         f"Only {study['splits']['unknown_validation']['count']}/{study['splits']['unknown_test']['count']} real calibration/test negatives; small correlated signer/word groups widen uncertainty",
                         "Known-precision, coverage and unknown FAR gates are point estimates; Wilson95 intervals are reported, not guaranteed performance",
                         "Calibration/test can share unknown vocabulary; unknown isolated signs do not measure idle-camera or conversational false positives",
                         "Seeds reuse the same clips; never pool them as independent test samples",
                         "No sentence, live-camera, fluent-signer or device accuracy; no model promotion or distribution approval"]}
    write_new(output, result)
    write_new(marker.with_name(marker.name + ".completed.json"), {"selection_sha256": selection_hash, "final_report_sha256": sha256(output), "status": "completed", "promoted": False})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path)
    parser.add_argument("--graph-data", type=Path)
    parser.add_argument("--legacy-data", type=Path)
    parser.add_argument("--protocol", type=Path, help="Frozen strict-negative preparation protocol")
    parser.add_argument("--preregistration", type=Path, help="Frozen six-run comparison preregistration")
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--final-report", type=Path)
    args = parser.parse_args()
    if args.final_report:
        report = final_benchmark(args.selection, args.final_report)
    else:
        if any(value is None for value in (args.run_root, args.graph_data, args.legacy_data, args.protocol, args.preregistration)):
            parser.error("Freeze requires --run-root, --graph-data, --legacy-data, --protocol and --preregistration")
        report = freeze_selection(args.run_root, args.selection, args.graph_data, args.legacy_data, args.protocol, args.preregistration)
    print(json.dumps({key: value for key, value in report.items() if key not in ("runs", "inputs")}, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
