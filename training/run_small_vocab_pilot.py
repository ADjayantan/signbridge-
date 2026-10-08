"""One bounded ASL vocabulary pilot, using training and reused validation only.

This experiment never reads final test features/targets, changes source splits,
exports or promotes weights. Vocabulary selection uses training support only.
All generated files require a new directory and are immutable after writing.
"""
from __future__ import annotations

import argparse
import copy
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import random
import time

import numpy as np
import torch
from torch import nn

from evaluate_graph_models import accepted, metrics, validate_scores, wilson
from graph_models import SignGraphModel
from pose_graph import CONTRACT_ID, adjacency_hash, contract_hash, fit_normalization
from prepare_data import canonical_clip
from train_graph_models import check_features, predict, validation_score

SEEDS = (42, 43, 44)
VARIANTS = ("none", "mild-spatial")
CLASSES = 12
LEARNING_SPLITS = ("train", "val", "unknown_validation")
BUDGET = {"epochs": 80, "minimumEpochs": 20, "patience": 20,
          "batchSize": 64, "learningRate": .002, "weightDecay": .0001,
          "maxSecondsPerRun": 300, "threads": 4}
GATES = {"minimumKnownPrecision": .95, "minimumCorrectKnownCoverage": .60,
         "maximumGenuineOovFalseAcceptRate": .05,
         "maximumExcludedKnownFalseAcceptRate": .05}
AUGMENTATION = {"rotationDegrees": 5., "xyNoiseStdShoulderWidths": .005,
                "application": "training batches only; independent rigid XY rotation per clip, per-observed-node XY Gaussian jitter",
                "confidenceChanged": False, "missingNodesChanged": False,
                "mirroring": False, "temporalReversal": False,
                "coordinateClip": [-5., 5.],
                "linguisticallyValidated": False}
LIMITS = [
    "Reused validation is model-selection data, not fresh test or release evidence.",
    "The underlying historical corpus has already been inspected; no new final test is claimed.",
    "Original strict signer groups and final test identity commitments are retained.",
    "No final test features, targets or predictions are read by this pilot.",
    "No idle-camera negatives, live devices, fluent-user review, facial features or continuous sentences.",
    "Small correlated validation samples do not establish a population false-accept bound.",
    "Mild spatial augmentation is a research hypothesis, not linguistically validated sign generation.",
    "No threshold tuning after these fixed runs, promotion, export or public-build changes.",
]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def value_hash(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def write_new(path, value):
    with Path(path).open("x", encoding="utf-8") as destination:
        json.dump(value, destination, indent=2, allow_nan=False)
        destination.write("\n")


def select_vocabulary(labels, targets, signers):
    """Fixed ranking cannot inspect validation support or model predictions."""
    if (targets.ndim != 1 or signers.shape != targets.shape
            or targets.dtype.kind not in "iu" or signers.dtype.kind not in "iu"
            or np.any(signers < 0) or np.any(targets < 0) or np.any(targets >= len(labels))):
        raise ValueError("Invalid training target/signer vectors")
    rows = []
    for index, label in enumerate(labels):
        take = targets == index
        rows.append({"word": label, "originalTarget": index, "clips": int(take.sum()),
                     "signers": len(set(signers[take].tolist()))})
    eligible = [row for row in rows if row["signers"] >= 10 and row["clips"] >= 10]
    eligible.sort(key=lambda row: (-row["signers"], -row["clips"], row["word"]))
    if len(eligible) < CLASSES:
        raise ValueError("Fewer than twelve training-supported labels; no fallback vocabulary")
    return eligible[:CLASSES]


def load_learning_arrays(data):
    """The only NPZ member access point; final feature/target members are absent."""
    labels = data["labels"].tolist()
    if (not 12 <= len(labels) <= 500 or len(set(labels)) != len(labels)
            or any(not isinstance(label, str) or not 1 <= len(label) <= 80
                   or label != label.strip() for label in labels)):
        raise ValueError("Invalid source vocabulary")
    arrays, seen, signer_groups = {}, set(), {}
    for split in LEARNING_SPLITS:
        raw, mask = data[f"X_{split}"], data[f"mask_{split}"]
        if raw.dtype.kind != "f" or mask.dtype.kind != "b":
            raise ValueError("Features/masks must be stored numeric/boolean")
        check_features(raw, mask)
        if np.any(np.abs(raw[..., :2]) > 5):
            raise ValueError("Raw feature contract coordinate bound exceeded")
        ids = data[f"clip_ids_{split}"].tolist()
        signers, targets = data[f"signer_ids_{split}"], data[f"y_{split}"]
        if (len(ids) != len(raw) or signers.shape != (len(raw),)
                or targets.shape != (len(raw),) or signers.dtype.kind not in "iu"
                or targets.dtype.kind not in "iu" or np.any(signers < 0)
                or any(not isinstance(identity, str) or not identity.strip() for identity in ids)):
            raise ValueError("Invalid learning identities/targets/signers")
        keys = {canonical_clip(identity) for identity in ids}
        if len(keys) != len(ids) or seen & keys:
            raise ValueError("Learning clip identities overlap or alias")
        seen.update(keys)
        if split == "unknown_validation":
            if np.any(targets != -1) or len(raw) < 20:
                raise ValueError("At least twenty genuine unknown-validation clips are required")
        elif set(targets.tolist()) != set(range(len(labels))):
            raise ValueError("Source known learning split lacks complete vocabulary coverage")
        signer_groups[split] = set(signers.tolist())
        arrays[split] = {"features": raw.astype(np.float32), "mask": mask.copy(),
                         "ids": ids, "signers": signers.copy(), "targets": targets.copy()}
    if signer_groups["train"] & (signer_groups["val"] | signer_groups["unknown_validation"]):
        raise ValueError("Fitting signers overlap validation/calibration signers")
    return labels, arrays


def prepare_pilot(labels, source):
    ranking = select_vocabulary(labels, source["train"]["targets"], source["train"]["signers"])
    selected = [row["originalTarget"] for row in ranking]
    remap = {old: new for new, old in enumerate(selected)}
    arrays = {}
    for split in ("train", "val"):
        take = np.isin(source[split]["targets"], selected)
        arrays[split] = {key: (np.asarray(value)[take].tolist() if key == "ids" else value[take].copy())
                         for key, value in source[split].items()}
        arrays[split]["targets"] = np.asarray([remap[int(y)] for y in arrays[split]["targets"]], dtype=np.int64)
        if set(arrays[split]["targets"].tolist()) != set(range(CLASSES)):
            raise ValueError("A train-selected label lacks validation coverage; no replacement is selected")
    take = ~np.isin(source["val"]["targets"], selected)
    arrays["excluded_known_validation"] = {
        key: (np.asarray(value)[take].tolist() if key == "ids" else value[take].copy())
        for key, value in source["val"].items()}
    arrays["unknown_validation"] = source["unknown_validation"]
    if len(arrays["excluded_known_validation"]["ids"]) < 20:
        raise ValueError("Insufficient excluded-known validation negatives")
    normalization = fit_normalization(arrays["train"]["features"], arrays["train"]["mask"])
    return [row["word"] for row in ranking], ranking, arrays, normalization


def verify_sources(data_path, registration_path, strict_protocol_path):
    metadata_path = data_path.with_suffix(".metadata.json")
    paths = {"data": data_path, "metadata": metadata_path,
             "sourceRegistration": registration_path, "strictProtocol": strict_protocol_path}
    hashes = {name: sha256(path) for name, path in paths.items()}
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    registration = json.loads(registration_path.read_text(encoding="utf-8"))
    strict = json.loads(strict_protocol_path.read_text(encoding="utf-8"))
    if (metadata.get("signLanguage") != "asl" or metadata.get("featureContract") != CONTRACT_ID
            or metadata.get("contractHash") != contract_hash() or metadata.get("adjacencyHash") != adjacency_hash()
            or metadata.get("featuresStandardized") is not False or metadata.get("strictNegatives") is not True
            or metadata.get("studyAvailable") is not True or metadata.get("preparedDataSha256") != hashes["data"]
            or metadata.get("strictProtocolHash") != hashes["strictProtocol"]
            or value_hash(metadata.get("signerAssignmentManifest")) != metadata.get("assignmentManifestHash")):
        raise ValueError("Verified strict ASL source/contract/hash is required")
    if (registration.get("format") != "signbridge-asl-signer-comparison-protocol-v1"
            or registration.get("signLanguage") != "asl" or registration.get("dataSha256") != hashes["data"]
            or registration.get("metadataSha256") != hashes["metadata"]
            or registration.get("strictProtocolSha256") != hashes["strictProtocol"]
            or strict.get("format") != "signbridge-strict-negative-protocol-v1"
            or strict.get("sourceHashes") != metadata.get("sourceStudyHashes")):
        raise ValueError("Source registration/provenance changed")
    with np.load(data_path, allow_pickle=False) as data:
        labels, source = load_learning_arrays(data)
    # The prior registration seals all final identities. Only learning identities
    # are reopened here; final NPZ members are never accessed or materialized.
    if metadata.get("labels") != labels:
        raise ValueError("Metadata vocabulary differs")
    for split in LEARNING_SPLITS:
        commitment = registration["splits"][split]
        ids = source[split]["ids"]
        ordered_hash = hashlib.sha256(json.dumps(ids, separators=(",", ":")).encode()).hexdigest()
        if len(ids) != commitment["count"] or ordered_hash != commitment["orderedClipIdsSha256"]:
            raise ValueError("Learning identity commitment differs")
        manifest_key = "unknownClipIds" if split == "unknown_validation" else "knownClipIds"
        if ids != metadata["signerAssignmentManifest"][manifest_key][split]:
            raise ValueError("Learning identity order differs from signer manifest")
    original_norm = fit_normalization(source["train"]["features"], source["train"]["mask"])
    if original_norm != metadata.get("normalization"):
        raise ValueError("Source normalization does not reproduce from training only")
    return paths, hashes, metadata, registration, labels, source


def augment_training(pose, generator):
    """CPU tensor perturbation preserves confidence/missing observations exactly."""
    if pose.ndim != 4 or tuple(pose.shape[1:]) != (32, 75, 3):
        raise ValueError("Augmentation expects raw graph batches")
    result = pose.clone()
    angle = (torch.rand((len(pose), 1, 1), generator=generator) * 2 - 1) * (5 * np.pi / 180)
    cosine, sine = torch.cos(angle), torch.sin(angle)
    x, y = pose[..., 0], pose[..., 1]
    result[..., 0] = x * cosine - y * sine
    result[..., 1] = x * sine + y * cosine
    noise = torch.randn(result[..., :2].shape, generator=generator) * .005
    valid = pose[..., 2] >= .5
    result[..., :2] = torch.where(valid.unsqueeze(-1), (result[..., :2] + noise).clamp(-5, 5), 0)
    result[..., 2] = pose[..., 2]
    return result


def calibrate_separate(scores, targets, genuine_oov, excluded_known):
    """Fixed grid, with each negative group independently constrained."""
    scores = validate_scores(scores)
    genuine_oov = validate_scores(genuine_oov, scores.shape[1])
    excluded_known = validate_scores(excluded_known, scores.shape[1])
    if min(len(genuine_oov), len(excluded_known)) < 20:
        raise ValueError("Both real negative validation groups need at least twenty clips")
    choices = []
    for threshold_i in range(50, 100):
        for margin_i in range(5, 51, 5):
            threshold, margin = threshold_i / 100, margin_i / 100
            value = metrics(scores, targets, genuine_oov, threshold, margin)
            excluded = int(accepted(excluded_known, threshold, margin).sum())
            if (value["known_accepted_precision"] is not None
                    and value["known_accepted_precision"] >= .95
                    and value["unknown_false_accept_rate"] <= .05
                    and excluded / len(excluded_known) <= .05):
                choices.append((value["accepted_correct"], -value["accepted_wrong"],
                                -value["unknown_false_accepts"], -excluded, threshold, margin))
    enabled = bool(choices)
    threshold, margin = max(choices)[-2:] if choices else (.99, .50)
    value = metrics(scores, targets, genuine_oov, threshold, margin, enabled)
    excluded = int(accepted(excluded_known, threshold, margin, enabled).sum())
    coverage = value["correct_known_coverage"]
    return {"threshold": threshold, "margin": margin, "acceptanceEnabled": enabled,
            "screenPassed": bool(enabled and coverage is not None and coverage >= .60),
            "known": value,
            "excludedKnown": {"count": len(excluded_known), "falseAccepts": excluded,
                              "falseAcceptRate": excluded / len(excluded_known),
                              "wilson95": wilson(excluded, len(excluded_known))}}


def train_run(variant, seed, output, labels, arrays, normalization, protocol_hash):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    torch.set_num_threads(BUDGET["threads"])
    torch.use_deterministic_algorithms(True)
    model = SignGraphModel(CLASSES, "gru75", normalization["mean"], normalization["std"])
    parameter_count = sum(parameter.numel() for parameter in model.parameters())
    if parameter_count >= 500000:
        raise ValueError("Parameter budget exceeded")
    x = {split: torch.from_numpy(value["features"]) for split, value in arrays.items()}
    y = torch.from_numpy(arrays["train"]["targets"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=BUDGET["learningRate"], weight_decay=BUDGET["weightDecay"])
    criterion = nn.CrossEntropyLoss()
    augmentation_rng = torch.Generator().manual_seed(seed + 10000)
    best, best_recall, best_loss, best_epoch, stale = None, -1., float("inf"), 0, 0
    history, stop = [], "epoch-ceiling"
    output.mkdir(parents=False, exist_ok=False)
    started = time.perf_counter()
    print(json.dumps({"event": "start", "variant": variant, "seed": seed,
                      "trainingClips": len(y), "validationClips": len(x["val"])}), flush=True)
    for epoch in range(1, BUDGET["epochs"] + 1):
        model.train(); total = 0.
        for indices in torch.randperm(len(y)).split(BUDGET["batchSize"]):
            batch = x["train"][indices]
            if variant == "mild-spatial":
                batch = augment_training(batch, augmentation_rng)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(batch), y[indices])
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 5); optimizer.step()
            total += float(loss.detach()) * len(indices)
        scores = predict(model, x["val"], BUDGET["batchSize"])
        recall, loss = validation_score(scores, arrays["val"]["targets"], CLASSES)
        if recall > best_recall or (recall == best_recall and loss < best_loss):
            best = copy.deepcopy(model.state_dict())
            best_recall, best_loss, best_epoch, stale = recall, loss, epoch, 0
        else:
            stale += 1
        history.append({"epoch": epoch, "trainingLoss": total / len(y),
                        "validationMacroRecall": recall, "validationLoss": loss})
        if epoch == 1 or epoch % 20 == 0:
            print(json.dumps({"event": "epoch", "variant": variant, "seed": seed,
                              "epoch": epoch, "validationMacroRecall": recall}), flush=True)
        if epoch >= BUDGET["minimumEpochs"] and stale >= BUDGET["patience"]:
            stop = "validation-early-stop"; break
        if time.perf_counter() - started >= BUDGET["maxSecondsPerRun"]:
            stop = "wall-clock-budget"; break
    model.load_state_dict(best)
    validation = predict(model, x["val"], BUDGET["batchSize"])
    genuine = predict(model, x["unknown_validation"], BUDGET["batchSize"])
    excluded = predict(model, x["excluded_known_validation"], BUDGET["batchSize"])
    calibration = calibrate_separate(validation, arrays["val"]["targets"], genuine, excluded)
    if epoch < BUDGET["minimumEpochs"]:
        calibration["screenPassed"] = False
    with (output / "checkpoint.pt").open("xb") as target:
        torch.save(model.state_dict(), target)
    with (output / "validation-predictions.npz").open("xb") as target:
        np.savez_compressed(target, scores=validation, targets=arrays["val"]["targets"],
                            genuine_oov_scores=genuine, excluded_known_scores=excluded,
                            clip_ids=np.asarray(arrays["val"]["ids"]),
                            genuine_oov_clip_ids=np.asarray(arrays["unknown_validation"]["ids"]),
                            excluded_known_clip_ids=np.asarray(arrays["excluded_known_validation"]["ids"]))
    report = {"format": "signbridge-small-vocab-pilot-run-v1", "signLanguage": "asl",
              "architecture": "gru75", "variant": variant, "seed": seed, "labels": labels,
              "normalization": normalization, "inputShape": [1, 32, 75, 3],
              "featureContract": CONTRACT_ID, "protocolSha256": protocol_hash,
              "weightsSha256": sha256(output / "checkpoint.pt"),
              "validationPredictionsSha256": sha256(output / "validation-predictions.npz"),
              "parameters": parameter_count, "epochsRun": epoch, "bestEpoch": best_epoch,
              "bestValidationMacroRecall": best_recall, "bestValidationLoss": best_loss,
              "trainingSeconds": time.perf_counter() - started, "stopReason": stop,
              "budget": BUDGET, "augmentation": AUGMENTATION if variant == "mild-spatial" else "none",
              "calibration": calibration, "history": history,
              "versions": {"numpy": np.__version__, "torch": torch.__version__},
              "finalTestEvaluated": False, "promoted": False, "validationReused": True,
              "distributionStatus": "local-research-only", "limits": LIMITS}
    write_new(output / "run.json", report)
    print(json.dumps({"event": "complete", "variant": variant, "seed": seed,
                      "coverage": calibration["known"]["correct_known_coverage"],
                      "screenPassed": calibration["screenPassed"],
                      "seconds": report["trainingSeconds"]}), flush=True)
    return report, validation


def per_class_rows(run, scores, targets):
    labels, calibration = run["labels"], run["calibration"]
    predicted = scores.argmax(1)
    take = accepted(scores, calibration["threshold"], calibration["margin"], calibration["acceptanceEnabled"])
    rows, confusions = [], []
    for index, word in enumerate(labels):
        chosen = targets == index
        total = int(chosen.sum())
        correct = predicted == index
        rows.append({"variant": run["variant"], "seed": run["seed"], "word": word,
                     "validationCount": total, "top1Correct": int((chosen & correct).sum()),
                     "acceptedCorrect": int((chosen & take & correct).sum()),
                     "acceptedWrong": int((chosen & take & ~correct).sum()),
                     "rejected": int((chosen & ~take).sum()),
                     "correctCoverage": float((chosen & take & correct).sum() / total)})
        for other, predicted_word in enumerate(labels):
            count = int((chosen & (predicted == other)).sum())
            if count:
                confusions.append({"variant": run["variant"], "seed": run["seed"],
                                   "actual": word, "predicted": predicted_word, "count": count,
                                   "acceptedCount": int((chosen & (predicted == other) & take).sum())})
    return rows, confusions


def summarize(runs, protocol):
    summaries = {}
    for variant in VARIANTS:
        group = [run for run in runs if run["variant"] == variant]
        coverage = [run["calibration"]["known"]["correct_known_coverage"] for run in group]
        summaries[variant] = {"allThreeSeedsPassed": all(run["calibration"]["screenPassed"] for run in group),
                              "meanCorrectCoverage": float(np.mean(coverage)),
                              "correctCoverageRange": [min(coverage), max(coverage)],
                              "meanMacroRecall": float(np.mean([run["bestValidationMacroRecall"] for run in group]))}
    improvement = summaries["mild-spatial"]["meanCorrectCoverage"] - summaries["none"]["meanCorrectCoverage"]
    augmented_eligible = summaries["mild-spatial"]["allThreeSeedsPassed"] and improvement >= .05 - 1e-12
    eligible = "mild-spatial" if augmented_eligible else ("none" if summaries["none"]["allThreeSeedsPassed"] else None)
    return {"format": "signbridge-small-vocab-validation-summary-v1", "signLanguage": "asl",
            "labels": protocol["labels"], "gates": GATES, "variants": summaries,
            "augmentationCoverageDifference": improvement, "researchFollowUpCandidate": eligible,
            "runs": [{key: run[key] for key in ("variant", "seed", "epochsRun", "bestEpoch",
                       "trainingSeconds", "bestValidationMacroRecall", "calibration", "weightsSha256",
                       "validationPredictionsSha256")} for run in runs],
            "finalTestEvaluated": False, "promoted": False, "validationReused": True,
            "decision": "research follow-up only" if eligible else "no variant passes all fixed validation gates",
            "limits": LIMITS}


def write_csv(path, rows):
    with Path(path).open("x", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)


def run_pilot(data_path, registration_path, strict_protocol_path, output, report_directory):
    paths = [Path(path).resolve() for path in (data_path, registration_path, strict_protocol_path)]
    output, report_directory = Path(output).resolve(), Path(report_directory).resolve()
    if output.exists() or report_directory.exists():
        raise FileExistsError("Use new artifact and report directories; no pilot is overwritten or resumed")
    source_paths, source_hashes, metadata, registration, labels, source = verify_sources(*paths)
    words, ranking, arrays, normalization = prepare_pilot(labels, source)
    counts = {split: {"clips": len(value["ids"]), "signers": len(set(value["signers"].tolist()))}
              for split, value in arrays.items()}
    class_counts = [{"word": word, "trainingClips": int((arrays["train"]["targets"] == index).sum()),
                     "trainingSigners": ranking[index]["signers"],
                     "validationClips": int((arrays["val"]["targets"] == index).sum())}
                    for index, word in enumerate(words)]
    scripts = [Path(__file__), Path(__file__).with_name("graph_models.py"),
               Path(__file__).with_name("pose_graph.py"), Path(__file__).with_name("train_graph_models.py"),
               Path(__file__).with_name("evaluate_graph_models.py")]
    protocol = {"format": "signbridge-small-vocab-pilot-protocol-v1", "recordedAt": datetime.now(timezone.utc).isoformat(),
                "signLanguage": "asl", "architecture": "gru75", "labels": words,
                "selection": "training only: >=10 training clips and >=10 distinct training signer codes; top12 sorted signer-count descending, clip-count descending, alphabetical label tie",
                "trainingRanking": ranking, "counts": counts, "perClassCounts": class_counts,
                "sourceHashes": source_hashes, "sourcePaths": {key: str(path) for key, path in source_paths.items()},
                "sourceAssignmentManifestSha256": metadata["assignmentManifestHash"],
                "finalIdentityCommitmentsUnchanged": {split: registration["splits"][split] for split in ("test", "unknown_test")},
                "scriptHashes": {path.name: sha256(path) for path in scripts},
                "featureContract": CONTRACT_ID, "contractHash": contract_hash(), "adjacencyHash": adjacency_hash(),
                "normalization": normalization, "normalizationFit": "selected training clips only; shared graph contract embedded in SignGraphModel",
                "seeds": list(SEEDS), "variants": list(VARIANTS), "budget": BUDGET, "augmentation": AUGMENTATION,
                "gates": GATES, "calibrationGrid": {"confidence": [.50, .99, .01], "margin": [.05, .50, .05]},
                "calibrationSelection": "Maximize accepted-correct count subject to >=95% known precision and <=5% FAR separately for genuine OOV and excluded-known validation; ties fewer known/OOV/excluded errors, higher threshold/margin",
                "checkpoint": "Validation macro recall; tie lower validation loss",
                "comparison": "All3 seeds must pass; augmented arm research follow-up requires mean correct coverage >=5pp above none. No release or test step.",
                "finalTestEvaluated": False, "promoted": False, "validationReused": True, "limits": LIMITS}
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "protocol.json", protocol)
    protocol_hash = sha256(output / "protocol.json")
    with (output / "protocol.json.sha256").open("x", encoding="utf-8") as destination:
        destination.write(protocol_hash + "\n")
    write_new(output / "private-learning-identities.json", {split: value["ids"] for split, value in arrays.items()})
    print(json.dumps({"event": "protocol-frozen", "labels": words, "counts": counts,
                      "perClassCounts": class_counts, "finalTestEvaluated": False}), flush=True)
    runs, per_class, confusions = [], [], []
    for variant in VARIANTS:
        for seed in SEEDS:
            if sha256(output / "protocol.json") != protocol_hash:
                raise ValueError("Protocol changed after freezing")
            if source_hashes != {key: sha256(path) for key, path in source_paths.items()}:
                raise ValueError("Source inputs changed; no further training")
            run, scores = train_run(variant, seed, output / f"{variant}-seed{seed}", words, arrays, normalization, protocol_hash)
            rows, wrong = per_class_rows(run, scores, arrays["val"]["targets"])
            per_class.extend(rows); confusions.extend(wrong); runs.append(run)
    if source_hashes != {key: sha256(path) for key, path in source_paths.items()}:
        raise ValueError("Source inputs changed during pilot")
    summary = summarize(runs, protocol)
    summary.update({"sourceInputsUnchanged": True, "protocolSha256": protocol_hash,
                    "counts": counts, "perClassCounts": class_counts})
    write_new(output / "summary.json", summary)
    report_directory.mkdir(parents=True, exist_ok=False)
    write_new(report_directory / "summary.json", summary)
    # Public research report contains aggregates, no clip IDs, signer identities,
    # camera content, checkpoint files, poses or private absolute source paths.
    public_protocol = {key: value for key, value in protocol.items() if key != "sourcePaths"}
    write_new(report_directory / "protocol.json", public_protocol)
    write_csv(report_directory / "per-class.csv", per_class)
    write_csv(report_directory / "confusions.csv", confusions)
    lines = ["# Twelve-word ASL validation pilot — 5 October 2026", "",
             "This is **reused validation/model-selection evidence only**. Final test arrays were not read, no model was promoted or exported, and live-camera correctness remains unmeasured.", "",
             f"Training-only vocabulary: {', '.join(words)}.", "",
             f"Selected training: {counts['train']['clips']} clips from {counts['train']['signers']} signer codes; selected validation: {counts['val']['clips']} clips. Genuine OOV validation: {counts['unknown_validation']['clips']} clips. Excluded known words: {counts['excluded_known_validation']['clips']} validation clips, treated separately as unsupported signs.", "",
             "| Arm | Seed | Macro recall | Accepted-known precision | Correct-known coverage | Genuine OOV FAR | Excluded-known FAR | Fixed gates |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    def percentage(value):
        return "unavailable (none accepted)" if value is None else f"{value:.1%}"
    for run in runs:
        value = run["calibration"]; known = value["known"]
        lines.append(f"| {run['variant']} | {run['seed']} | {percentage(run['bestValidationMacroRecall'])} | {percentage(known['known_accepted_precision'])} | {percentage(known['correct_known_coverage'])} | {percentage(known['unknown_false_accept_rate'])} | {percentage(value['excludedKnown']['falseAcceptRate'])} | {'pass' if value['screenPassed'] else 'fail'} |")
    lines.extend(["", f"Decision: **{summary['decision']}**. Research follow-up candidate: {summary['researchFollowUpCandidate'] or 'none'}.", "",
                  "The confidence/margin grid and four gates were frozen before training; no per-word thresholds, vocabulary replacement, iterative tuning or seed cherry-picking were used. Rejection can improve apparent precision while making correct coverage too low. Review exact counts and Wilson intervals in summary.json, and per-word counts/confusions in the CSV files.", "",
                  "## Limits", ""])
    lines.extend(f"- {limit}" for limit in LIMITS)
    with (report_directory / "README.md").open("x", encoding="utf-8") as destination:
        destination.write("\n".join(lines) + "\n")
    print(json.dumps({"event": "pilot-complete", "decision": summary["decision"],
                      "researchFollowUpCandidate": summary["researchFollowUpCandidate"],
                      "finalTestEvaluated": False, "promoted": False}), flush=True)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--source-registration", type=Path, required=True)
    parser.add_argument("--strict-protocol", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    arguments = parser.parse_args()
    run_pilot(arguments.data, arguments.source_registration, arguments.strict_protocol,
              arguments.output, arguments.report_directory)
