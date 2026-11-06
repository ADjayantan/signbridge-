"""Separate, bounded ISL49 normalized-camera GRU experiment.

Rehydrates original cached poses, divides archive XY before preprocessing,
preserves all legacy clip partitions, and fits on training only. The existing
model, contracts and frozen studies are never changed. Frame-index sparsity
augmentation is not a measured 8 Hz conversion: source timestamps are absent.
Final benchmark access requires a separate invocation after candidate freezing.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import random
import time
import zipfile

import numpy as np

from prepare_data import (JOINTS, MAX_POSE_BYTES, RestrictedUnpickler, canonical_clip,
                          preprocess_pose, safely_load_pose, verify_archive)

THRESHOLD, MARGIN = .95, .30
LEARNING = ("train", "val", "unknown_validation")
FINAL = ("test", "unknown_test")
PROFILES = (
    {"name": "original", "stride": 1, "phase": 0, "verticalFactor": 1.},
    {"name": "sparse2", "stride": 2, "phase": 0, "verticalFactor": 1.},
    {"name": "sparse3-four-three", "stride": 3, "phase": 0, "verticalFactor": .75},
    {"name": "sparse4-aspect", "stride": 4, "phase": 1, "verticalFactor": 1.125},
)
STRESS = (
    {"name": "four-three", "stride": 1, "phase": 0, "verticalFactor": .75},
    *({"name": f"stride3-phase{phase}", "stride": 3, "phase": phase, "verticalFactor": 1.} for phase in range(3)),
)
LIMITS = [
    "Research candidate only; no app promotion, webcam or fluent-user accuracy established.",
    "All 49 labels retained, including confusable words; no expected-word shortcut.",
    "ISL signer identities are unavailable; recording-disjoint does not mean signer-independent.",
    "Historical validation and benchmark have been examined before; neither is a new untouched test.",
    "Source poses have no verified per-frame timestamps; frame-index decimation is not measured 8 Hz sampling.",
    "Aspect/sparsity augmentation is an unverified robustness hypothesis, not new independently recorded signing.",
    "No genuine live idle-camera negatives or facial grammar; not continuous sentence translation.",
]


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_new(path, value):
    with Path(path).open("x", encoding="utf-8") as destination:
        json.dump(value, destination, indent=2, allow_nan=False)
        destination.write("\n")


def study_sources(root):
    root = Path(root).resolve()
    paths = {
        "prepared": root / ".training-data/prepared/isl.npz",
        "metadata": root / ".training-data/prepared/isl.metadata.json",
        "archive": root / ".training-data/archives/INCLUDE-Pose_Signs.zip",
        "outerArchive": root / ".training-data/archives/INCLUDE.zip",
        "coordinateAudit": root / ".training-data/replay/isl-train-val-coordinate-audit.json",
        "pairedCoordinateAudit": root / ".training-data/replay/hello-first-frame-coordinate-contract.json",
        "baseline": root / "public/models/isl.json",
        "studyRunner": root / "training/camera_aligned_study.py",
        "sharedPreprocessor": root / "training/prepare_data.py",
        "decisionProtocol": root / "docs/camera-training-protocol-2026-10-11.md",
    }
    if any(not path.is_file() for path in paths.values()):
        raise ValueError("Required verified local ISL sources are missing")
    return paths


def verify_archive_binding(paths):
    """Bind the cache to the checksum-verified official outer ZIP without writes."""
    official = verify_archive(paths["outerArchive"], "isl")
    digest, total = hashlib.sha256(), 0
    with zipfile.ZipFile(paths["outerArchive"]) as outer:
        matching = [entry for entry in outer.infolist() if entry.filename == "INCLUDE/Pose_Signs.zip"]
        if len(matching) != 1:
            raise ValueError("Official nested pose archive is missing or ambiguous")
        entry = matching[0]
        if entry.flag_bits & 1 or not 0 < entry.file_size <= 800 * 1024 * 1024:
            raise ValueError("Invalid official nested pose archive")
        with outer.open(entry) as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                total += len(block)
                if total > entry.file_size:
                    raise ValueError("Nested pose archive exceeded its declared size")
                digest.update(block)
    if total != entry.file_size or paths["archive"].stat().st_size != total or sha256(paths["archive"]) != digest.hexdigest():
        raise ValueError("Cached pose archive differs from the verified official source")
    return {"official": official, "nestedMember": "INCLUDE/Pose_Signs.zip", "nestedSha256": digest.hexdigest(),
            "nestedBytes": total, "cachedArchiveMatchesOfficial": True}


def validate_audits(paths):
    audit = json.loads(paths["coordinateAudit"].read_text(encoding="utf-8"))
    paired = json.loads(paths["pairedCoordinateAudit"].read_text(encoding="utf-8"))
    if (audit.get("format") != "signbridge-isl-training-coordinate-audit-v1" or audit.get("errors") != []
            or audit.get("auditedClipCount") != 745 or audit.get("shapeCounts") != {"1080x1920": 745}
            or audit.get("coordinateClassCounts") != {"pixel-like": 745}
            or paired.get("format") != "signbridge-archive-coordinate-contract-diagnostic-v1"
            or paired.get("archiveVidShape") != [1080, 1920]
            or paired.get("summary", {}).get("all", {}).get("comparedJoints") != 7
            or not 0 <= paired.get("summary", {}).get("all", {}).get("heightWidthXYRMSE", 1) < .05):
        raise ValueError("Pinned archive XY coordinate audit does not support this experiment")
    return {"source": {"space": "axis-scaled-image", "scaleX": 1080, "scaleY": 1920},
            "canonicalSpace": "normalized-image", "conversion": "divide-xy-before-shoulder-normalization",
            "axes": "x-right-y-down", "firstFramePairedJoints": 7,
            "scope": "Paired first-frame axis evidence and known train/validation metadata; not exact detector parity for every clip"}


def inventory_from_dataset(data, metadata, include_final=False):
    """No X_* access: only labels, targets and identities from retained partitions."""
    labels = data["labels"].tolist()
    if (len(labels) != 49 or len(set(labels)) != 49 or metadata.get("language") != "isl"
            or metadata.get("labels") != labels
            or metadata.get("preprocessing", {}).get("contract") != "signbridge-pose27-xyc-v1"
            or any(not isinstance(label, str) or not label or label != label.strip() for label in labels)):
        raise ValueError("The exact original ISL49 vocabulary and feature inventory are required")
    inventory, seen = {}, set()
    # Final identifiers establish nonoverlap without reading final features or labels.
    for split in LEARNING + FINAL:
        ids = data[f"clip_ids_{split}"].tolist()
        if not ids or any(not isinstance(clip, str) or not clip.strip() for clip in ids):
            raise ValueError("Every original partition needs recorded clip identities")
        canonical = [canonical_clip(clip) for clip in ids]
        if len(set(canonical)) != len(ids) or seen.intersection(canonical):
            raise ValueError("Original clip identities overlap or alias across partitions")
        seen.update(canonical)
        if split in LEARNING or include_final:
            y = data[f"y_{split}"]
            if y.dtype.kind not in "iu" or y.shape != (len(ids),):
                raise ValueError("Invalid original target vector")
            if split.startswith("unknown"):
                if np.any(y != -1):
                    raise ValueError("Unknown vocabulary must remain outside known training")
            elif set(y.tolist()) != set(range(49)):
                raise ValueError("Every known partition must retain all 49 labels")
            inventory[split] = [{"clipId": clip, "target": int(target)} for clip, target in zip(ids, y)]
    return labels, inventory


def read_original_pose(archive, clip):
    expected = canonical_clip(str(PurePosixPath(clip.replace("\\", "/")).with_suffix(".pkl")))
    matches = archive.index.get(expected, [])
    if len(matches) != 1:
        raise ValueError("Original pose is missing or ambiguous")
    entry = matches[0]
    if entry.is_dir() or entry.flag_bits & 1 or not 0 < entry.file_size <= MAX_POSE_BYTES:
        raise ValueError("Original pose member is empty, encrypted or oversized")
    with archive.zip.open(entry) as source:
        content = source.read(MAX_POSE_BYTES + 1)
    validated = safely_load_pose(content)
    original = RestrictedUnpickler(io.BytesIO(content)).load()
    if original.get("vid_shape") != (1080, 1920):
        raise ValueError("Original pose has a different or missing declared axis scale")
    return validated


def canonical_pose(pose):
    points, confidence = np.asarray(pose["keypoints"]), np.asarray(pose["confidences"])
    if (points.ndim != 3 or points.shape[1:] != (75, 3) or confidence.shape != points.shape[:2]
            or not np.isfinite(points).all() or not np.isfinite(confidence).all()
            or np.any(confidence < 0) or np.any(confidence > 1)):
        raise ValueError("Invalid original numeric pose")
    converted = points.astype(np.float32, copy=True)
    converted[:, :, 0] /= 1080
    converted[:, :, 1] /= 1920
    if np.any(np.abs(converted[:, :, :2]) > 10):
        raise ValueError("Canonical pose exceeds normalized-camera bounds")
    return {"keypoints": converted, "confidences": confidence.astype(np.float32, copy=True)}


def augmented_pose(pose, profile):
    """Only measured observations are selected; no timestamps or new signs created."""
    points = pose["keypoints"][profile["phase"]::profile["stride"]].copy()
    confidence = pose["confidences"][profile["phase"]::profile["stride"]].copy()
    if not len(points):
        raise ValueError("Temporal profile retained no observations")
    observed = confidence > 0
    points[:, :, 1] = np.where(observed, .5 + (points[:, :, 1] - .5) * profile["verticalFactor"], points[:, :, 1])
    return {"keypoints": points, "confidences": confidence}


def features(pose, require_camera_quality=True):
    if require_camera_quality:
        confidence = pose["confidences"]
        simultaneous = ((confidence[:, 33] >= .5) | (confidence[:, 54] >= .5)) & (confidence[:, 11] >= .2) & (confidence[:, 12] >= .2)
        if int(np.count_nonzero(simultaneous)) < 4:
            raise ValueError("Candidate needs four simultaneous measured hand-and-shoulder frames")
    return preprocess_pose(pose["keypoints"], pose["confidences"])


def prepare_learning(paths, inventory):
    from prepare_data import PoseArchive
    archive = PoseArchive(paths["archive"])
    arrays, parity, report = {}, [], {"profileCounts": {profile["name"]: 0 for profile in PROFILES}, "skippedTrainingVariants": 0, "stress": {}}
    try:
        for split in LEARNING:
            base, normalized, targets, clips = [], [], [], []
            stress = {profile["name"]: {"features": [], "targets": [], "rejected": 0} for profile in STRESS}
            for row in inventory[split]:
                raw = read_original_pose(archive, row["clipId"])
                canonical = canonical_pose(raw)
                base.append(features(raw, require_camera_quality=False))
                if split == "train":
                    for profile in PROFILES:
                        try:
                            converted = features(augmented_pose(canonical, profile))
                        except ValueError:
                            if profile["name"] == "original":
                                raise
                            report["skippedTrainingVariants"] += 1
                            continue
                        normalized.append(converted); targets.append(row["target"]); clips.append(row["clipId"])
                        report["profileCounts"][profile["name"]] += 1
                else:
                    converted = features(canonical)
                    normalized.append(converted); targets.append(row["target"]); clips.append(row["clipId"])
                    for profile in STRESS:
                        group = stress[profile["name"]]
                        try:
                            group["features"].append(features(augmented_pose(canonical, profile)))
                            group["targets"].append(row["target"])
                        except ValueError:
                            group["rejected"] += 1
                    if split == "val" and len(parity) < 3:
                        parity.append({"clipId": row["clipId"], "target": row["target"], "split": "val",
                                       "frames": [{"keypoints": points.tolist(), "confidences": scores.tolist()}
                                                  for points, scores in zip(canonical["keypoints"], canonical["confidences"])],
                                       "features": converted.tolist()})
            arrays[split] = {"X": np.stack(normalized).astype(np.float32), "y": np.asarray(targets, dtype=np.int64), "ids": clips}
            if split != "train":
                arrays[split]["baseline"] = np.stack(base).astype(np.float32)
                arrays[split]["stress"] = {name: {"X": np.stack(group["features"]).astype(np.float32) if group["features"] else np.empty((0, 32, 81), dtype=np.float32),
                                                  "y": np.asarray(group["targets"], dtype=np.int64), "rejected": group["rejected"]}
                                             for name, group in stress.items()}
        report["counts"] = {split: {"sourceClips": len(inventory[split]), "featureRows": len(arrays[split]["X"])} for split in LEARNING}
        return arrays, parity, report
    finally:
        archive.close()


def model_from_artifact(artifact):
    import torch
    from train_model import SignGRU
    if (artifact.get("signLanguage") != "isl" or artifact.get("format") not in ("signbridge-gru-v1", "signbridge-gru-v2")
            or artifact.get("frames") != 32 or artifact.get("inputSize") != 81 or artifact.get("joints") != JOINTS
            or artifact.get("threshold") != THRESHOLD or artifact.get("margin") != MARGIN):
        raise ValueError("Artifact is incompatible with the fixed ISL27 study")
    model = SignGRU(len(artifact["labels"]), artifact["hiddenSize"]).double()
    state = {f"gru.{name}": torch.tensor(artifact["weights"][name], dtype=torch.float64)
             for name in ("weight_ih_l0", "weight_hh_l0", "bias_ih_l0", "bias_hh_l0")}
    state["head.weight"] = torch.tensor(artifact["weights"]["head_weight"], dtype=torch.float64)
    state["head.bias"] = torch.tensor(artifact["weights"]["head_bias"], dtype=torch.float64)
    model.load_state_dict(state, strict=True); model.eval()
    return model


def artifact_scores(artifact, raw):
    import torch
    from train_model import probabilities
    normalized = (raw.astype(np.float64) - np.asarray(artifact["mean"])) / np.asarray(artifact["std"])
    return probabilities(model_from_artifact(artifact), torch.from_numpy(normalized))


def fixed_metrics(scores, targets, unknown, labels, source_known=None, source_unknown=None):
    from train_model import acceptance, metrics
    if len(scores):
        result = metrics(scores, targets, unknown, THRESHOLD, MARGIN)
    else:
        unknown_take = acceptance(unknown, THRESHOLD, MARGIN)
        result = {"clips": 0, "top1_correct": 0, "top1_accuracy": None, "top5_accuracy": None,
                  "accepted_correct": 0, "accepted_incorrect": 0, "rejected": 0,
                  "unknown_clips": len(unknown), "unknown_false_accepts": int(unknown_take.sum()),
                  "unknown_false_accept_rate": float(unknown_take.mean()) if len(unknown) else None}
    source_known = len(targets) if source_known is None else source_known
    source_unknown = len(unknown) if source_unknown is None else source_unknown
    total_accepted = result["accepted_correct"] + result["accepted_incorrect"]
    result.update({"knownSourceClips": source_known, "unknownSourceClips": source_unknown,
                   "knownPrecision": result["accepted_correct"] / total_accepted if total_accepted else None,
                   "correctKnownCoverage": result["accepted_correct"] / source_known if source_known else None,
                   "unknownFalseAcceptRateAllSource": result["unknown_false_accepts"] / source_unknown if source_unknown else None})
    predictions = scores.argmax(1) if len(scores) else np.empty(0, dtype=np.int64)
    taken = acceptance(scores, THRESHOLD, MARGIN)
    result["perClass"] = {label: {"clips": int(np.count_nonzero(targets == index)),
                                   "top1Correct": int(np.count_nonzero((targets == index) & (predictions == index))),
                                   "acceptedCorrect": int(np.count_nonzero((targets == index) & (predictions == index) & taken)),
                                   "acceptedIncorrect": int(np.count_nonzero((targets == index) & (predictions != index) & taken))}
                          for index, label in enumerate(labels)}
    return result


def validation_reports(candidate, baseline, arrays, labels):
    known, unknown = arrays["val"], arrays["unknown_validation"]
    result = {"candidate": fixed_metrics(artifact_scores(candidate, known["X"]), known["y"], artifact_scores(candidate, unknown["X"]), labels),
              "baselineSameOriginalClips": fixed_metrics(artifact_scores(baseline, known["baseline"]), known["y"], artifact_scores(baseline, unknown["baseline"]), labels),
              "stress": {}}
    for profile in STRESS:
        name = profile["name"]; k, u = known["stress"][name], unknown["stress"][name]
        result["stress"][name] = fixed_metrics(artifact_scores(candidate, k["X"]), k["y"], artifact_scores(candidate, u["X"]), labels,
                                               len(known["y"]), len(unknown["y"]))
        result["stress"][name].update({"qualityRejectedKnown": k["rejected"], "qualityRejectedUnknown": u["rejected"],
                                         "independentClips": False, "source": "Same reused validation recordings transformed for stress comparison"})
    return result


def export_candidate(model, labels, mean, std):
    def values(tensor):
        return np.round(tensor.detach().cpu().numpy().astype(np.float64), 7).tolist()
    state = model.state_dict()
    weights = {name: values(state[f"gru.{name}"]) for name in ("weight_ih_l0", "weight_hh_l0", "bias_ih_l0", "bias_hh_l0")}
    weights.update({"head_weight": values(state["head.weight"]), "head_bias": values(state["head.bias"])})
    return {"format": "signbridge-gru-v2", "signLanguage": "isl", "labels": labels,
            "cameraInput": {"format": "signbridge-camera-coordinates-v1", "space": "normalized-image", "scaleX": 1, "scaleY": 1},
            "frames": 32, "inputSize": 81, "hiddenSize": 64, "joints": JOINTS,
            "mean": np.round(mean.astype(np.float64), 7).tolist(), "std": np.round(std.astype(np.float64), 7).tolist(),
            "threshold": THRESHOLD, "margin": MARGIN, "acceptanceEnabled": True, "weights": weights,
            "research": {"promoted": False, "distribution": "local-research-only", "limits": LIMITS}}


def fit_candidate(args, arrays, labels):
    import torch
    from torch import nn
    from train_model import SignGRU, probabilities
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads); torch.use_deterministic_algorithms(True)
    train = arrays["train"]["X"]
    mean, std = train.mean(axis=(0, 1)), np.maximum(train.std(axis=(0, 1)), .05)
    x = torch.from_numpy((train - mean) / std); y = torch.from_numpy(arrays["train"]["y"])
    validation = torch.from_numpy((arrays["val"]["X"] - mean) / std)
    model = SignGRU(len(labels), 64)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.002, weight_decay=.0001)
    loss_fn = nn.CrossEntropyLoss()
    best, best_recall, best_loss, best_epoch, stale, history = None, -1., float("inf"), 0, 0, []
    start, stop_reason = time.perf_counter(), "epochs"
    for epoch in range(1, args.epochs + 1):
        model.train(); order = torch.randperm(len(x)); partial = False
        for indices in order.split(64):
            optimizer.zero_grad(); loss = loss_fn(model(x[indices]), y[indices]); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5); optimizer.step()
            if time.perf_counter() - start >= args.max_seconds:
                partial = True; break
        scores = probabilities(model, validation)
        target = arrays["val"]["y"]; pred = scores.argmax(1)
        recall = float(np.mean([np.mean(pred[target == i] == i) for i in range(len(labels))]))
        val_loss = float(-np.log(np.maximum(scores[np.arange(len(target)), target], 1e-12)).mean())
        if recall > best_recall or (recall == best_recall and val_loss < best_loss):
            best, best_recall, best_loss, best_epoch, stale = copy.deepcopy(model.state_dict()), recall, val_loss, epoch, 0
        else:
            stale += 1
        history.append({"epoch": epoch, "macroRecall": recall, "validationLoss": val_loss, "partialEpoch": partial})
        if epoch == 1 or epoch % 10 == 0:
            print(json.dumps({"event": "epoch", **history[-1]}), flush=True)
        if partial or time.perf_counter() - start >= args.max_seconds:
            stop_reason = "wall-clock-budget"; break
        if epoch >= 20 and stale >= 20:
            stop_reason = "early-stopping"; break
    model.load_state_dict(best); model.eval()
    return export_candidate(model, labels, mean, std), {"epochs": epoch, "bestEpoch": best_epoch,
        "validationMacroRecall": best_recall, "validationLoss": best_loss, "trainingSeconds": time.perf_counter() - start,
        "stopReason": stop_reason, "history": history, "parameterCount": sum(p.numel() for p in model.parameters())}


def run_study(args):
    paths = study_sources(args.root)
    coordinates = validate_audits(paths)
    archive_verification = verify_archive_binding(paths)
    metadata = json.loads(paths["metadata"].read_text(encoding="utf-8"))
    with np.load(paths["prepared"], allow_pickle=False) as source:
        labels, inventory = inventory_from_dataset(source, metadata)
    hashes = {name: sha256(path) for name, path in paths.items()}
    baseline = json.loads(paths["baseline"].read_text(encoding="utf-8"))
    if baseline.get("labels") != labels or baseline.get("threshold") != THRESHOLD or baseline.get("margin") != MARGIN:
        raise ValueError("Baseline vocabulary or fixed gates differ from the declared experiment")
    protocol = {"format": "signbridge-camera-aligned-isl-study-v1", "labels": labels, "seed": args.seed,
        "sourceHashes": hashes, "archiveVerification": archive_verification, "coordinateProvenance": coordinates, "trainingProfiles": list(PROFILES), "validationStress": list(STRESS),
        "threshold": THRESHOLD, "margin": MARGIN, "checkpointMetric": "Validation macro recall; tie lower validation loss",
        "budget": {"epochs": args.epochs, "maxSeconds": args.max_seconds, "threads": args.threads},
        "learningPartitions": list(LEARNING), "finalTestReadDuringFitting": False, "promoted": False,
        "knownOriginalClips": {name: len(rows) for name, rows in inventory.items()}, "limits": LIMITS}
    if args.check_only:
        return {"format": protocol["format"], "preflightPassed": True, "counts": protocol["knownOriginalClips"],
                "featureArraysRead": False, "trainingPerformed": False, "outputsWritten": False}
    if args.output is None or args.output.exists():
        raise ValueError("Choose a fresh local research output directory; no overwrite or implicit model installation")
    # No path under public/ or the immutable sources may receive study output.
    output = args.output.resolve(); root = Path(args.root).resolve()
    if not output.is_relative_to(root / "training/artifacts"):
        raise ValueError("Study output must be a fresh directory under training/artifacts")
    arrays, parity, preparation = prepare_learning(paths, inventory)
    if {name: sha256(path) for name, path in paths.items()} != hashes:
        raise ValueError("Study source files changed during preparation")
    output.mkdir(parents=True, exist_ok=False)
    write_new(output / "protocol.json", protocol)
    write_new(output / "preparation.json", preparation)
    if args.prepare_only:
        with (output / "prepared-learning.npz").open("xb") as destination:
            np.savez_compressed(destination, **{f"{split}_{kind}": arrays[split][kind] for split in LEARNING for kind in ("X", "y")})
        write_new(output / "canonical-validation-parity.json", {"format": "signbridge-camera-aligned-parity-v1", "fixtures": parity, "nativeProbabilities": None})
        return {"prepared": True, "trainingPerformed": False, "output": str(output)}
    candidate, fitting = fit_candidate(args, arrays, labels)
    write_new(output / "candidate.json", candidate)
    reports = validation_reports(candidate, baseline, arrays, labels)
    write_new(output / "validation.json", reports)
    native = artifact_scores(candidate, np.asarray([fixture["features"] for fixture in parity], dtype=np.float64))
    write_new(output / "canonical-validation-parity.json", {"format": "signbridge-camera-aligned-parity-v1", "fixtures": parity,
        "nativeProbabilities": native.tolist(), "candidateSha256": sha256(output / "candidate.json"),
        "scope": "Validation numerical parity fixture; no source timing or webcam accuracy implied"})
    write_new(output / "run.json", {**fitting, "limits": LIMITS, "finalTestEvaluated": False, "promoted": False})
    freeze = {"format": "signbridge-camera-aligned-candidate-freeze-v1", "candidateSha256": sha256(output / "candidate.json"),
              "protocolSha256": sha256(output / "protocol.json"), "sourceHashes": hashes, "finalTestEvaluated": False, "promoted": False}
    write_new(output / "frozen-candidate.json", freeze)
    return {"candidateFrozen": True, "trainingSeconds": fitting["trainingSeconds"], "bestEpoch": fitting["bestEpoch"],
            "validation": {name: {key: value for key, value in metrics.items() if key != "perClass"} for name, metrics in reports.items() if name != "stress"},
            "finalTestEvaluated": False, "promoted": False, "output": str(output)}


def evaluate_frozen(args):
    """Explicit later benchmark invocation; never retrains or replaces a model."""
    output = args.evaluate_study.resolve()
    if (output / "benchmark.json").exists():
        raise ValueError("Benchmark was already recorded; no rerun or overwrite")
    freeze = json.loads((output / "frozen-candidate.json").read_text(encoding="utf-8"))
    if (freeze.get("format") != "signbridge-camera-aligned-candidate-freeze-v1"
            or freeze.get("candidateSha256") != sha256(output / "candidate.json")
            or freeze.get("protocolSha256") != sha256(output / "protocol.json")):
        raise ValueError("Candidate or protocol changed after freezing")
    paths = study_sources(args.root)
    if {name: sha256(path) for name, path in paths.items()} != freeze.get("sourceHashes"):
        raise ValueError("Frozen benchmark source files changed")
    metadata = json.loads(paths["metadata"].read_text(encoding="utf-8"))
    with np.load(paths["prepared"], allow_pickle=False) as source:
        labels, inventory = inventory_from_dataset(source, metadata, include_final=True)
    from prepare_data import PoseArchive
    archive = PoseArchive(paths["archive"])
    arrays = {}
    try:
        for split in FINAL:
            raw, canonical, y = [], [], []
            for row in inventory[split]:
                pose = read_original_pose(archive, row["clipId"])
                raw.append(features(pose, require_camera_quality=False)); canonical.append(features(canonical_pose(pose))); y.append(row["target"])
            arrays[split] = {"raw": np.stack(raw), "canonical": np.stack(canonical), "y": np.asarray(y, dtype=np.int64)}
    finally:
        archive.close()
    candidate = json.loads((output / "candidate.json").read_text(encoding="utf-8"))
    baseline = json.loads(paths["baseline"].read_text(encoding="utf-8"))
    k, u = arrays["test"], arrays["unknown_test"]
    report = {"format": "signbridge-camera-aligned-benchmark-v1", "candidateSha256": freeze["candidateSha256"],
              "candidate": fixed_metrics(artifact_scores(candidate, k["canonical"]), k["y"], artifact_scores(candidate, u["canonical"]), labels),
              "baselineSameOriginalClips": fixed_metrics(artifact_scores(baseline, k["raw"]), k["y"], artifact_scores(baseline, u["raw"]), labels),
              "historicallyExaminedBenchmark": True, "usedForThisFitting": False, "promoted": False, "limits": LIMITS}
    if freeze["candidateSha256"] != sha256(output / "candidate.json"):
        raise ValueError("Candidate changed during benchmark evaluation")
    write_new(output / "benchmark.json", report)
    return {key: value for key, value in report.items() if key not in ("candidate", "baselineSameOriginalClips")}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--evaluate-study", type=Path)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--max-seconds", type=float, default=600)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args(argv)
    if not 1 <= args.epochs <= 120 or not 1 <= args.max_seconds <= 600 or not 1 <= args.threads <= 4 or not 0 <= args.seed <= 2147483647:
        parser.error("Study bounds: 1-120 epochs, 1-600 seconds, 1-4 CPU threads, bounded seed")
    if sum(bool(value) for value in (args.check_only, args.prepare_only, args.evaluate_study)) > 1:
        parser.error("Choose one study mode")
    if not (args.check_only or args.evaluate_study) and args.output is None:
        parser.error("A fresh research --output is required")
    return args


if __name__ == "__main__":
    try:
        arguments = parse_args()
        print(json.dumps(evaluate_frozen(arguments) if arguments.evaluate_study else run_study(arguments), indent=2, allow_nan=False))
    except (ValueError, OSError) as error:
        print(f"Camera-aligned study blocked: {error}")
        raise SystemExit(2)
