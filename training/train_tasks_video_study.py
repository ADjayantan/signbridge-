"""Bounded local ISL49 Tasks-video adaptation, with fresh training-only outliers.

Learning and final video pose exports must be separate. No active model is
installed, no existing study is overwritten, and confidence gates stay .95/.30.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import copy
import json
from pathlib import Path, PurePosixPath
import random
import re
import time

import numpy as np

from camera_aligned_study import (MARGIN, THRESHOLD, artifact_scores, canonical_pose,
    export_candidate, features, fixed_metrics, inventory_from_dataset,
    model_from_artifact, read_original_pose, sha256, study_sources,
    verify_archive_binding, write_new)
from prepare_data import PoseArchive, canonical_clip, read_csv

FORMAT = "signbridge-tasks-video-poses-v1"
MANIFEST_FORMAT = "signbridge-tasks-video-study-manifest-v1"
CONFIG = {"trackerBackend": "tasks-holistic", "delegate": "CPU", "runningMode": "VIDEO",
          "sampleIntervalMs": 125, "width": 1280, "height": 720,
          "fit": "contain", "background": "black"}
LEARNING = ("train", "val", "unknown_train", "unknown_val")
FINAL = ("test", "unknown_test")
OE_WEIGHT, TASKS_WEIGHT, LEARNING_RATE = .25, 4, .0005
INITIAL_SHA256 = "a77f33b3f0d2ca7570b041e4cf93fa1ee3374efc6e974cb975ae80f587041004"
HASH = re.compile(r"^[0-9a-f]{64}$")
LIMITS = ["Local research candidate only; no active installation or public promotion.",
          "All 49 known outputs and fixed .95 confidence/.30 margin are retained.",
          "Repeated training-row weighting does not create independent recordings.",
          "Archived benchmark recordings have been examined before; not a new blind test.",
          "Warm-start checkpoint previously used historical validation for selection.",
          "Source signer IDs are unavailable; no signer-independent or webcam accuracy claim.",
          "Out-of-vocabulary signs are not a genuine idle-camera negative corpus."]


def read_json(path, maximum=96 * 1024 * 1024):
    path = Path(path)
    if not 0 < path.stat().st_size <= maximum:
        raise ValueError("JSON source is empty or exceeds its byte limit")
    with path.open(encoding="utf-8-sig") as stream:
        return json.load(stream, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))


def valid_hash(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None


def validate_manifest(manifest, labels):
    if not isinstance(manifest, dict) or manifest.get("format") != MANIFEST_FORMAT:
        raise ValueError("Unsupported frozen Tasks study manifest")
    rows = manifest.get("clips")
    if not valid_hash(manifest.get("frozenPlanSha256")):
        raise ValueError("Manifest must bind its frozen acquisition plan")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 100:
        raise ValueError("Manifest needs 1-100 explicitly selected recordings")
    seen, digests, names, unknown_words, result = set(), set(), set(), {}, []
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("clipId"), str) or not row["clipId"].strip()
                or row.get("split") not in LEARNING + FINAL or not valid_hash(row.get("sha256"))
                or not isinstance(row.get("localFile"), str) or not row["localFile"].strip()
                or not isinstance(row.get("label"), str) or not row["label"].strip()):
            raise ValueError("Invalid frozen source recording identity")
        if (len(row["localFile"]) > 255 or re.search(r"[\\/:\x00-\x1f]", row["localFile"])
                or row["localFile"] != row["localFile"].strip() or row["localFile"] in (".", "..")
                or any(part in ("", ".", "..") for part in row["clipId"].split("/"))
                or re.search(r"[\\:\x00-\x1f]", row["clipId"])):
            raise ValueError("Frozen clip IDs must be safe relative identities and files must be basenames")
        key = canonical_clip(row["clipId"])
        if key in seen or row["sha256"] in digests or row["localFile"].casefold() in names:
            raise ValueError("Source recording IDs or video bytes overlap across study partitions")
        if row["split"].startswith("unknown"):
            if (row["label"].strip().upper() in labels
                    or plain_word(row.get("rawLabel", row["label"])) in {plain_word(label) for label in labels}):
                raise ValueError("Unknown source label is in the known vocabulary")
            word = plain_word(row.get("rawLabel", row["label"]))
            if word in unknown_words and unknown_words[word] != row["split"]:
                raise ValueError("Fresh unsupported source words overlap across study partitions")
            unknown_words[word] = row["split"]
        elif row["label"] not in labels:
            raise ValueError("Known manifest label is outside retained ISL49")
        seen.add(key); digests.add(row["sha256"]); names.add(row["localFile"].casefold()); result.append(dict(row))
    required = {"train", "val", "unknown_val", "test", "unknown_test"}
    if not required.issubset({row["split"] for row in result}):
        raise ValueError("Manifest needs segregated known/unknown validation and test recordings")
    return result


def plain_word(value):
    return re.sub(r"^\d+\.\s*", "", str(value).strip()).casefold()


def validate_plan_binding(manifest, plan):
    """Bind every downloaded member to pre-acquisition identity, split and CRC/size."""
    if not isinstance(plan, dict) or plan.get("format") != "signbridge-tasks-video-study-v1" or not isinstance(plan.get("clips"), list):
        raise ValueError("Invalid frozen acquisition plan")
    if len(plan["clips"]) != len(manifest["clips"]):
        raise ValueError("Frozen manifest differs from acquisition selection count")
    for saved, selected in zip(manifest["clips"], plan["clips"]):
        keys = {"clipId": "clip_id", "label": "label", "rawLabel": "raw_label", "split": "split", "localFile": "local_file",
                "bytes": "uncompressed_bytes", "crc32": "crc32", "archive": "archive"}
        if (any(saved.get(left) != selected.get(right) for left, right in keys.items())
                or saved.get("crc32Verified") is not True or saved.get("savedHashVerified") is not True
                or saved.get("archiveFullMd5Verified") is not False):
            raise ValueError("Frozen manifest member identity or integrity differs from acquisition plan")


def camera_quality(frames, duration_ms):
    """Mirror current JS camera gate on measured normalized XY/confidence frames."""
    if not isinstance(frames, list) or not 4 <= len(frames) <= 100:
        return False, "sample-count"
    times = [frame.get("atMs") if isinstance(frame, dict) else None for frame in frames]
    if any(isinstance(t, bool) or not isinstance(t, (int, float)) or not np.isfinite(t)
           or not 0 <= t <= 12000 or (i and t <= times[i-1]) for i, t in enumerate(times)):
        return False, "timing"
    if (isinstance(duration_ms, bool) or not isinstance(duration_ms, (int, float))
            or not np.isfinite(duration_ms) or not 350 <= duration_ms <= 12000 or duration_ms < times[-1]):
        return False, "duration"
    try:
        pose = np.asarray([frame["pose"] for frame in frames], dtype=np.float64)
    except (KeyError, TypeError, ValueError):
        return False, "invalid-pose"
    if (pose.shape != (len(frames), 75, 3) or not np.isfinite(pose).all()
            or np.any(np.abs(pose[:, :, :2]) > 10) or np.any(pose[:, :, 2] < 0) or np.any(pose[:, :, 2] > 1)):
        return False, "invalid-pose"
    c = pose[:, :, 2]
    qualified = ((c[:, 33] >= .5) | (c[:, 54] >= .5)) & (c[:, 11] >= .2) & (c[:, 12] >= .2)
    if int(qualified.sum()) < 4:
        return False, "framing"
    if max(times[0], duration_ms - times[-1], *np.diff(times).tolist()) > 1000:
        return False, "tracking-gap"
    return True, ""


def camera_frames(record):
    return [{"atMs": frame["atMs"], "keypoints": [[x, y, 0] for x, y, _ in frame["pose"]],
             "confidences": [confidence for _, _, confidence in frame["pose"]]} for frame in record["frames"]]


def tasks_features(record, camera_input=None):
    pose = np.asarray([frame["pose"] for frame in record["frames"]], dtype=np.float32)
    points = np.zeros_like(pose); points[:, :, :2] = pose[:, :, :2]
    if camera_input is not None:
        if (camera_input.get("format") != "signbridge-camera-coordinates-v1"
                or camera_input.get("space") not in ("normalized-image", "axis-scaled-image")
                or not all(isinstance(camera_input.get(k), (int, float)) and np.isfinite(camera_input[k])
                           and camera_input[k] > 0 for k in ("scaleX", "scaleY"))):
            raise ValueError("Unsupported active baseline camera coordinate contract")
        points[:, :, 0] *= camera_input["scaleX"]
        points[:, :, 1] *= camera_input["scaleY"]
    return features({"keypoints": points, "confidences": pose[:, :, 2]})


def learning_inventory(source, metadata, rows):
    labels, original = inventory_from_dataset(source, metadata)
    partition = {canonical_clip(str(clip)): split for split in ("train", "val", "test", "unknown_validation", "unknown_test")
                 for clip in source[f"clip_ids_{split}"].tolist()}
    for row in rows:
        old = partition.get(canonical_clip(row["clipId"]))
        allowed = {"train": {"train"}, "val": {"val"}, "test": {"test"},
                   "unknown_train": set(), "unknown_val": {"unknown_validation"}, "unknown_test": {"unknown_test"}}[row["split"]]
        if old is not None and old not in allowed:
            raise ValueError("New study would move a historical source across fitting/holdout partitions")
    return labels, original


def prepare_tasks(payload, rows, labels, manifest_hash, extractor_hash, group):
    if (not isinstance(payload, dict) or payload.get("format") != FORMAT or payload.get("manifestHash") != manifest_hash
            or payload.get("extractorModuleHash") != extractor_hash or payload.get("config") != CONFIG
            or payload.get("partitionGroup") != group or not isinstance(payload.get("records"), list)):
        raise ValueError("Tasks extraction header differs from frozen source, extractor or config")
    if group not in ("learning", "test"):
        raise ValueError("Choose learning or test extraction explicitly")
    selected = {canonical_clip(row["clipId"]): row for row in rows if row["split"] in (LEARNING if group == "learning" else FINAL)}
    records, seen = [], set()
    for record in payload["records"]:
        if not isinstance(record, dict) or not isinstance(record.get("clipId"), str):
            raise ValueError("Invalid Tasks extraction record identity")
        key = canonical_clip(record["clipId"])
        if key not in selected or key in seen:
            raise ValueError("Extraction contains duplicate, wrong-partition or unselected recording")
        row = selected[key]; seen.add(key)
        if record.get("videoSha256") != row["sha256"]:
            raise ValueError("Extracted video differs from frozen recording bytes")
        status = record.get("status")
        if status not in ("ok", "quality-rejected", "error", "cancelled"):
            raise ValueError("Unrecognized explicit extraction outcome")
        if status in ("error", "cancelled"):
            expected = "extraction-error" if status == "error" else "cancelled"
            if record.get("frames") != [] or record.get("cameraGate") != {"passed": False, "code": expected}:
                raise ValueError("Failed extraction must explicitly contain no pose frames")
            converted, code = None, expected
        else:
            source, geometry = record.get("source"), record.get("geometry")
            if (not isinstance(source, dict) or geometry != {"width": CONFIG["width"], "height": CONFIG["height"]}
                    or any(isinstance(source.get(k), bool) or not isinstance(source.get(k), int) or not 1 <= source[k] <= 16384 for k in ("width", "height"))):
                raise ValueError("Invalid source or declared extraction geometry")
            frames, duration = record.get("frames"), source.get("durationMs")
            passed, code = camera_quality(frames, duration)
            if record.get("cameraGate") != {"passed": passed, "code": code} or (status == "ok") != passed:
                raise ValueError("Declared camera gate does not match measured extraction")
            if not isinstance(frames, list) or not isinstance(duration, (int, float)) or not np.isfinite(duration):
                raise ValueError("Missing measured extraction timing")
            if len(frames) != int(np.ceil(duration / 125)) or any(frame.get("atMs") != i * 125 for i, frame in enumerate(frames)):
                raise ValueError("Tasks frames must be actual sequential 125ms source samples")
            converted = tasks_features(record) if passed else None
        records.append({"clipId": row["clipId"], "split": row["split"], "label": row["label"],
                        "target": -1 if row["split"].startswith("unknown") else labels.index(row["label"]),
                        "status": status, "qualityCode": code, "features": converted,
                        "cameraFrames": camera_frames(record) if converted is not None else None,
                        "rawRecord": record if converted is not None else None})
    if seen != set(selected):
        raise ValueError("Every frozen recording needs an explicit extraction outcome; no silent omissions")
    if group == "learning":
        if any(row["status"] == "cancelled" for row in records):
            raise ValueError("Incomplete cancelled learning extraction cannot be fitted")
        for split in ("train", "val", "unknown_val"):
            if not any(row["split"] == split and row["features"] is not None for row in records):
                raise ValueError("Learning needs eligible known train/validation and unknown validation recordings")
    return records


def choose_archive_outliers(metadata_dir, source, rows, archive, limit=200):
    known = set(source["raw_labels"].tolist())
    known_plain = {plain_word(word) for word in known}
    excluded_ids = {canonical_clip(str(c)) for k in source.files if k.startswith("clip_ids_") for c in source[k]}
    excluded_ids.update(canonical_clip(row["clipId"]) for row in rows)
    excluded_words = {str(w).strip().casefold() for k in source.files if k.startswith("source_labels_unknown") for w in source[k]}
    excluded_words.update(str(row.get("rawLabel", row["label"])).strip().casefold()
                          for row in rows if row["split"] in ("unknown_val", "unknown_test"))
    # Both original raw labels ('123. Word') and new manifest names ('WORD') exclude a word.
    normalized_words = {re.sub(r"^\d+\.\s*", "", word).strip().casefold() for word in excluded_words}
    groups, seen = defaultdict(list), set()
    for row in read_csv(Path(metadata_dir) / "train_include.csv"):
        key, word = canonical_clip(row["FilePath"]), row["Word"]
        plain = re.sub(r"^\d+\.\s*", "", word).strip().casefold()
        member = canonical_clip(str(PurePosixPath(row["FilePath"].replace("\\", "/")).with_suffix(".pkl")))
        if word in known or plain in known_plain or key in excluded_ids or key in seen or word.strip().casefold() in excluded_words or plain in normalized_words:
            continue
        seen.add(key)
        if len(archive.index.get(member, [])) == 1:
            groups[word].append({"clipId": row["FilePath"], "sourceLabel": word})
    for group in groups.values():
        group.sort(key=lambda row: canonical_clip(row["clipId"]))
    ordered, position = [], 0
    while len(ordered) < limit:
        additions = [groups[word][position] for word in sorted(groups) if position < len(groups[word])]
        if not additions:
            break
        ordered.extend(additions[:limit-len(ordered)]); position += 1
    return ordered


def arrays_for_fit(original, archive, selected_outliers, tasks):
    base = [features(canonical_pose(read_original_pose(archive, row["clipId"]))) for row in original["train"]]
    targets = [row["target"] for row in original["train"]]
    task_train = [row for row in tasks if row["split"] == "train" and row["features"] is not None]
    for row in task_train:
        base.extend([row["features"]] * TASKS_WEIGHT); targets.extend([row["target"]] * TASKS_WEIGHT)
    negatives = [row["features"] for row in tasks if row["split"] == "unknown_train" and row["features"] is not None]
    failures = []
    for row in selected_outliers:
        try:
            negatives.append(features(canonical_pose(read_original_pose(archive, row["clipId"]))))
        except (ValueError, KeyError) as error:
            failures.append({**row, "reason": str(error)})
    if not negatives:
        raise ValueError("No eligible fresh training outliers; cannot run declared outlier exposure")
    return {"X": np.asarray(base, dtype=np.float32), "y": np.asarray(targets, dtype=np.int64),
            "unknown": np.asarray(negatives, dtype=np.float32)}, {"originalKnownClips": len(original["train"]),
            "tasksKnownClips": len(task_train), "tasksRowWeight": TASKS_WEIGHT,
            "knownWeightedTrainingRows": len(base), "negativeTrainingRows": len(negatives),
            "selectedArchiveOutliers": selected_outliers, "archiveOutlierFailures": failures,
            "taskOutcomes": [source_outcome(row) for row in tasks]}


def source_outcome(row):
    return {key: row[key] for key in ("clipId", "split", "label", "target", "status", "qualityCode")}


def task_report(artifact, tasks, known_split, unknown_split, baseline_camera=False):
    known = [row for row in tasks if row["split"] == known_split]
    unknown = [row for row in tasks if row["split"] == unknown_split]
    valid, oov = [r for r in known if r["features"] is not None], [r for r in unknown if r["features"] is not None]
    def score(rows):
        values = [tasks_features(r["rawRecord"], artifact["cameraInput"]) if baseline_camera else r["features"] for r in rows]
        return artifact_scores(artifact, np.asarray(values)) if rows else np.empty((0, len(artifact["labels"])))
    scores, unknown_scores = score(valid), score(oov)
    y = np.asarray([r["target"] for r in valid], dtype=np.int64)
    report = fixed_metrics(scores, y, unknown_scores, artifact["labels"], len(known), len(unknown))
    recalls = []
    for label in sorted({r["label"] for r in known}):
        count = sum(r["label"] == label for r in known)
        row = report["perClass"][label]
        row["eligibleClips"] = row["clips"]; row["clips"] = count
        row["qualityRejected"] = count - row["eligibleClips"]
        recalls.append(row["top1Correct"] / count)
    report.update({"macroRecallAllSource": float(np.mean(recalls)) if recalls else None,
                   "qualityRejectedKnown": len(known)-len(valid), "qualityRejectedUnknown": len(unknown)-len(oov),
                   "sourceOutcomes": [source_outcome(r) for r in known + unknown],
                   "labelsPresent": sorted({r["label"] for r in known}), "independentRecordings": len(known)+len(unknown)})
    return report


def outlier_loss(logits):
    return -logits.log_softmax(dim=-1).mean()


def training_loss(known_logits, targets, unknown_logits):
    import torch
    return torch.nn.functional.cross_entropy(known_logits, targets) + OE_WEIGHT * outlier_loss(unknown_logits)


def warm_start_parity(initial, tasks):
    """Actual learning observations verify float training reconstruction before gradients."""
    import torch
    from train_model import probabilities
    valid = [row for row in tasks if row["split"] == "val" and row["features"] is not None][:3]
    raw = np.asarray([row["features"] for row in valid])
    expected = artifact_scores(initial, raw)
    model = model_from_artifact(initial).float().eval()
    values = torch.from_numpy(((raw-np.asarray(initial["mean"])) / np.asarray(initial["std"])).astype(np.float32))
    actual = probabilities(model, values)
    error = float(np.max(np.abs(expected-actual)))
    if not np.isfinite(error) or error >= 1e-5 or not np.array_equal(expected.argmax(1), actual.argmax(1)):
        raise ValueError("Warm-start float reconstruction differs from pinned exported predictor")
    return {"passed": True, "maxProbabilityError": error, "tolerance": 1e-5,
            "learningClipIds": [row["clipId"] for row in valid], "scope": "Native float64 exported artifact versus float32 training reconstruction before gradients"}


def fit(args, initial, arrays, tasks):
    import torch
    from torch import nn
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads); torch.use_deterministic_algorithms(True)
    model = model_from_artifact(initial).float()
    mean, std = np.asarray(initial["mean"], dtype=np.float32), np.asarray(initial["std"], dtype=np.float32)
    x = torch.from_numpy((arrays["X"]-mean)/std); y = torch.from_numpy(arrays["y"])
    unknown = torch.from_numpy((arrays["unknown"]-mean)/std)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=.0001)
    best, objective, best_loss, best_epoch, stale = None, -float("inf"), float("inf"), 0, 0
    start, history, reason = time.perf_counter(), [], "epochs"
    for epoch in range(1, args.epochs+1):
        model.train(); partial = False
        for indices in torch.randperm(len(x)).split(64):
            negative_indices = torch.randint(len(unknown), (min(16, len(unknown)),))
            optimizer.zero_grad()
            loss = training_loss(model(x[indices]), y[indices], model(unknown[negative_indices]))
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 5); optimizer.step()
            if time.perf_counter()-start >= args.max_seconds:
                partial = True; break
        candidate = export_candidate(model, initial["labels"], mean, std)
        report = task_report(candidate, tasks, "val", "unknown_val")
        current = report["macroRecallAllSource"] - report["unknownFalseAcceptRateAllSource"]
        valid = [r for r in tasks if r["split"] == "val" and r["features"] is not None]
        scores = artifact_scores(candidate, np.asarray([r["features"] for r in valid]))
        val_loss = float(-np.log(np.maximum(scores[np.arange(len(valid)), [r["target"] for r in valid]], 1e-12)).mean())
        if current > objective or (current == objective and val_loss < best_loss):
            best, objective, best_loss, best_epoch, stale = copy.deepcopy(model.state_dict()), current, val_loss, epoch, 0
        else:
            stale += 1
        history.append({"epoch": epoch, "objective": current, "macroRecallAllSource": report["macroRecallAllSource"],
                        "unknownFalseAcceptRateAllSource": report["unknownFalseAcceptRateAllSource"], "validationLoss": val_loss, "partialEpoch": partial})
        if epoch == 1 or epoch % 10 == 0:
            print(json.dumps({"event": "epoch", **history[-1]}), flush=True)
        if partial or time.perf_counter()-start >= args.max_seconds:
            reason = "wall-clock-budget"; break
        if epoch >= 20 and stale >= 20:
            reason = "early-stopping"; break
    model.load_state_dict(best); model.eval()
    candidate = export_candidate(model, initial["labels"], mean, std)
    candidate["research"] = {"promoted": False, "distribution": "local-research-only", "limits": LIMITS,
                              "study": "current-Tasks-video-outlier-exposure", "outlierWeight": OE_WEIGHT}
    return candidate, {"epochs": epoch, "bestEpoch": best_epoch, "bestObjective": objective,
                       "trainingSeconds": time.perf_counter()-start, "stopReason": reason, "history": history,
                       "normalization": "Pinned prior-candidate mean/std unchanged; no validation/test fitting"}


def validate_initial(initial, labels):
    if (initial.get("labels") != labels or initial.get("format") != "signbridge-gru-v2"
            or initial.get("cameraInput") != {"format": "signbridge-camera-coordinates-v1", "space": "normalized-image", "scaleX": 1, "scaleY": 1}
            or initial.get("hiddenSize") != 64 or initial.get("acceptanceEnabled") is not True):
        raise ValueError("Warm start must be the pinned normalized-camera ISL49 GRU64")
    for key in ("mean", "std"):
        values = np.asarray(initial.get(key), dtype=np.float64)
        if values.shape != (81,) or not np.isfinite(values).all() or (key == "std" and np.any(values < 1e-6)):
            raise ValueError("Invalid pinned normalization")
    model = model_from_artifact(initial)
    if any(not np.isfinite(value.detach().numpy()).all() for value in model.state_dict().values()):
        raise ValueError("Nonfinite warm-start parameters")


def verify_sources(paths, expected=None):
    actual = {name: sha256(path) for name, path in paths.items()}
    if expected is not None and actual != expected:
        raise ValueError("Frozen study source, code or protocol changed")
    return actual


def run(args):
    root = args.root.resolve(); paths = study_sources(root)
    paths.update({"manifest": args.manifest.resolve(), "learningPoses": args.poses.resolve(),
                  "initial": args.initial.resolve(), "tasksProtocol": args.protocol.resolve(),
                  "tasksRunner": Path(__file__).resolve(), "extractor": args.extractor.resolve(),
                  "officialTrainCsv": root/".training-data/metadata/train_include.csv",
                  "runtimeQualityGate": root/"src/lib/graphSignModel.js",
                  "runtimePredictor": root/"src/lib/trainedSignModel.js",
                  "runtimeCameraAdapter": root/"src/lib/cameraCoordinateContract.js",
                  "runtimeFrameValidator": root/"src/lib/poseGraphFeatures.js",
                  "trackerLoader": root/"src/lib/poseTracker.js",
                  "dependencyLock": root/"package-lock.json",
                  "selectionPlan": args.manifest.resolve().parent/"plan.json",
                  "nativeModel": root/"training/train_model.py"})
    hashes = verify_sources(paths)
    if hashes["initial"] != INITIAL_SHA256:
        raise ValueError("Warm start bytes differ from the protocol's pinned camera candidate")
    manifest = read_json(paths["manifest"])
    if manifest.get("frozenPlanSha256") != hashes["selectionPlan"]:
        raise ValueError("Frozen manifest no longer matches its acquisition plan")
    validate_plan_binding(manifest, read_json(paths["selectionPlan"]))
    metadata = read_json(paths["metadata"])
    with np.load(paths["prepared"], allow_pickle=False) as source:
        labels = source["labels"].tolist()
        rows = validate_manifest(manifest, labels)
        labels, original = learning_inventory(source, metadata, rows)
        if len(original["train"]) != 628:
            raise ValueError("Protocol requires all 628 original canonical known training recordings")
        archive_verification = verify_archive_binding(paths)
        archive = PoseArchive(paths["archive"])
        try:
            selected = choose_archive_outliers(root/".training-data/metadata", source, rows, archive)
        finally:
            archive.close()
    initial = read_json(paths["initial"]); validate_initial(initial, labels)
    tasks = prepare_tasks(read_json(paths["learningPoses"]), rows, labels, hashes["manifest"], hashes["extractor"], "learning")
    parity = warm_start_parity(initial, tasks)
    output = args.output.resolve()
    if output.exists() or not output.is_relative_to(root/"training/artifacts"):
        raise ValueError("Choose a fresh research output under training/artifacts; never overwrite or install")
    protocol = {"format": "signbridge-tasks-video-study-v1", "sourceHashes": hashes,
                "sources": {name: str(path) for name, path in paths.items()}, "labels": labels, "config": CONFIG,
                "manifest": [{k: row[k] for k in ("clipId", "label", "split", "sha256")} for row in rows],
                "seed": args.seed, "budget": {"epochs": args.epochs, "seconds": args.max_seconds, "threads": args.threads},
                "optimizer": {"name": "AdamW", "learningRate": LEARNING_RATE, "weightDecay": .0001, "gradientClip": 5,
                              "knownBatch": 64, "unknownBatch": 16, "outlierLossWeight": OE_WEIGHT, "tasksRowWeight": TASKS_WEIGHT},
                "checkpoint": "Tasks validation all-source known macro recall minus all-source unknown false accept rate; tie lower known CE",
                "fixedThreshold": THRESHOLD, "fixedMargin": MARGIN, "finalTestReadDuringFitting": False,
                "finalTestFramesReadDuringFitting": False, "finalBenchmarkUsedForSelection": False,
                "selectedArchiveOutliers": selected, "archiveVerification": archive_verification, "limits": LIMITS}
    verify_sources(paths, hashes); output.mkdir(parents=True, exist_ok=False)
    write_new(output/"protocol.json", protocol)
    write_new(output/"warm-start-parity.json", parity)
    if args.check_only:
        write_new(output/"preflight.json", {"passed": True, "trainingPerformed": False,
                  "selectedArchiveOutliers": len(selected), "tasksSourceCounts": dict(Counter(r["split"] for r in tasks))})
        return {"preflightPassed": True, "trainingPerformed": False, "output": str(output)}
    archive = PoseArchive(paths["archive"])
    try:
        arrays, preparation = arrays_for_fit(original, archive, selected, tasks)
    finally:
        archive.close()
    verify_sources(paths, hashes); write_new(output/"preparation.json", preparation)
    candidate, fitting = fit(args, initial, arrays, tasks)
    verify_sources(paths, hashes); write_new(output/"candidate.json", candidate)
    write_new(output/"run.json", fitting)
    write_new(output/"validation.json", {"candidate": task_report(candidate, tasks, "val", "unknown_val"),
              "initial": task_report(initial, tasks, "val", "unknown_val"), "limits": LIMITS})
    valid = [r for r in tasks if r["split"] == "val" and r["features"] is not None][:3]
    write_new(output/"canonical-validation-parity.json", {"format": "signbridge-camera-aligned-parity-v1",
              "candidateSha256": sha256(output/"candidate.json"), "source": "Actual current Tasks learning-only validation poses",
              "fixtures": [{"clipId": r["clipId"], "split": "val", "frames": r["cameraFrames"],
                            "features": r["features"].tolist()} for r in valid],
              "nativeProbabilities": artifact_scores(candidate, np.asarray([r["features"] for r in valid])).tolist()})
    write_new(output/"frozen-candidate.json", {"format": "signbridge-tasks-study-freeze-v1",
              "candidateSha256": sha256(output/"candidate.json"), "protocolSha256": sha256(output/"protocol.json"),
              "sourceHashes": hashes, "promoted": False, "finalTestEvaluated": False})
    return {"candidateFrozen": True, "output": str(output), "trainingSeconds": fitting["trainingSeconds"], "promoted": False}


def evaluate(args):
    output = args.evaluate_study.resolve()
    if (output/"benchmark.json").exists():
        raise ValueError("Frozen study was already benchmarked; no overwrite")
    frozen, protocol = read_json(output/"frozen-candidate.json"), read_json(output/"protocol.json")
    if frozen.get("candidateSha256") != sha256(output/"candidate.json") or frozen.get("protocolSha256") != sha256(output/"protocol.json"):
        raise ValueError("Frozen candidate or protocol changed")
    paths = {name: Path(path) for name, path in protocol["sources"].items()}
    verify_sources(paths, frozen["sourceHashes"])
    candidate, initial = read_json(output/"candidate.json"), read_json(paths["initial"])
    rows = validate_manifest(read_json(paths["manifest"]), candidate["labels"])
    # Only this post-freeze mode opens the final test pose file.
    tasks = prepare_tasks(read_json(args.test_poses), rows, candidate["labels"], frozen["sourceHashes"]["manifest"], frozen["sourceHashes"]["extractor"], "test")
    report = {"format": "signbridge-tasks-study-final-benchmark-v1", "candidateSha256": frozen["candidateSha256"],
              "testPoseSha256": sha256(args.test_poses), "newExtractorTest": task_report(candidate, tasks, "test", "unknown_test"),
              "initialNewExtractorTest": task_report(initial, tasks, "test", "unknown_test"), "limits": LIMITS,
              "activeBaselineNewExtractorTest": task_report(read_json(paths["baseline"]), tasks, "test", "unknown_test", baseline_camera=True),
              "testExtractionComplete": not any(row["status"] == "cancelled" for row in tasks),
              "promoted": False, "historicalBenchmark": {}}
    metadata = read_json(paths["metadata"])
    with np.load(paths["prepared"], allow_pickle=False) as source:
        labels, inventory = inventory_from_dataset(source, metadata, include_final=True)
    archive = PoseArchive(paths["archive"])
    try:
        for name, known_split, unknown_split in (("validation", "val", "unknown_validation"), ("test", "test", "unknown_test")):
            known, unknown, baseline_known, baseline_unknown, targets = [], [], [], [], []
            for split in (known_split, unknown_split):
                for row in inventory[split]:
                    raw = read_original_pose(archive, row["clipId"])
                    normalized = features(canonical_pose(raw))
                    if split == known_split:
                        known.append(normalized); baseline_known.append(features(raw, require_camera_quality=False)); targets.append(row["target"])
                    else:
                        unknown.append(normalized); baseline_unknown.append(features(raw, require_camera_quality=False))
            y = np.asarray(targets, dtype=np.int64)
            report["historicalBenchmark"][name] = {}
            for model_name, artifact, x, u in (("candidate", candidate, known, unknown), ("initial", initial, known, unknown),
                                        ("activeBaseline", read_json(paths["baseline"]), baseline_known, baseline_unknown)):
                report["historicalBenchmark"][name][model_name] = fixed_metrics(artifact_scores(artifact, np.asarray(x)), y,
                                                                            artifact_scores(artifact, np.asarray(u)), labels)
    finally:
        archive.close()
    verify_sources(paths, frozen["sourceHashes"])
    if sha256(output/"candidate.json") != frozen["candidateSha256"]:
        raise ValueError("Candidate changed during benchmark")
    write_new(output/"benchmark.json", report)
    return {"benchmarkWritten": True, "promoted": False, "output": str(output)}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    for name in ("manifest", "poses", "initial", "protocol", "extractor", "output", "evaluate-study", "test-poses"):
        parser.add_argument("--"+name, type=Path)
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--max-seconds", type=float, default=600)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args(argv)
    if not 1 <= args.epochs <= 120 or not np.isfinite(args.max_seconds) or not 0 < args.max_seconds <= 600 or args.threads != 4 or args.seed != 42:
        parser.error("Use 1-120 epochs, up to 600 seconds, exactly four threads and seed 42 from the frozen protocol")
    if args.evaluate_study:
        if args.test_poses is None or args.check_only or any(getattr(args, key) for key in ("manifest", "poses", "initial", "protocol", "extractor", "output")):
            parser.error("Final evaluation requires only --evaluate-study and --test-poses")
    elif args.test_poses or not all(getattr(args, key) for key in ("manifest", "poses", "initial", "protocol", "extractor", "output")):
        parser.error("Fitting needs manifest, learning poses, initial model, protocol, extractor and fresh output; no test poses")
    return args


if __name__ == "__main__":
    try:
        options = parse_args()
        print(json.dumps(evaluate(options) if options.evaluate_study else run(options), allow_nan=False))
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(f"Tasks-video study stopped: {error}") from None
