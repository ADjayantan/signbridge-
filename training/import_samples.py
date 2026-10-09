"""Validate consented webcam poses and prepare explicit signer-separated splits.

Usage (never trains or replaces deployed models):
  python training/import_samples.py --dataset batch1.json --dataset batch2.json \
      --splits splits.json \
      --output-dir .training-data/webcam-study

Split file: {"format":"signbridge-signer-splits-v1", "signers":
             {"signer-a":"train", "signer-b":"val", "signer-c":"test"}}
Each export remains limited to 250 samples/32 MB; combined collections are limited
to 10000 samples/256 MB. Repeated exports must contain disjoint sample IDs.
Signer codes apply across all exports, both languages and all sessions. Unknown samples can
only be assigned val/test. Known labels need examples in each split. Background
poses without sufficient simultaneous hand/shoulder visibility and explicitly
attested nonsigning examples remain in separate inventories; they do not
masquerade as unsupported-sign calibration inputs. Omitted negativeType metadata
remains unspecified, preserving the existing v1 unknown-sample policy. Incomplete collections
produce an inventory manifest explaining why training arrays are unavailable.
Optional captureDurationMs preserves the measured recording window separately
from the legacy pose-span durationMs; neither field changes model features.
Use a new output directory: existing outputs are never overwritten.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re

import numpy as np

from prepare_data import FRAMES, JOINTS, preprocess_pose

FORMAT = "signbridge-pose-dataset-v1"
MAX_BYTES = 32 * 1024 * 1024
MAX_SAMPLES = 250
MAX_COLLECTION_BYTES = 256 * 1024 * 1024
MAX_COLLECTION_SAMPLES = 10000
CODE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
SPLITS = ["train", "val", "test", "unknown_validation", "unknown_test"]
NEGATIVE_TYPES = ("nonsigning", "unsupported-sign", "unspecified")


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def short_text(value, maximum):
    if not isinstance(value, str):
        return False
    try:
        # Match the browser's UTF-16 string-length limits, rejecting lone surrogates.
        return len(value.encode("utf-16-le")) // 2 <= maximum
    except UnicodeEncodeError:
        return False


def code(value, name):
    if not isinstance(value, str) or not CODE.fullmatch(value):
        raise ValueError(f"Invalid {name}: use a 1-80 character anonymous code")
    return value


def eligible(frames):
    # This is the sample visibility rule, not the full timed live-camera gate.
    return sum((frame["confidences"][33] >= .5 or frame["confidences"][54] >= .5)
               and frame["confidences"][11] >= .2 and frame["confidences"][12] >= .2
               for frame in frames) >= 4


def negative_type_counts(samples):
    return {kind: sum(row["kind"] == "unknown" and row.get("negativeType", "unspecified") == kind
                      for row in samples) for kind in NEGATIVE_TYPES}


def validate_sample(sample):
    if not isinstance(sample, dict) or sample.get("consent") is not True:
        raise ValueError("Every sample needs explicit consent:true")
    sample_id = code(sample.get("id"), "sample ID")
    signer = code(sample.get("signerId"), "signer ID")
    session = code(sample.get("sessionId"), "session ID")
    language, kind = sample.get("signLanguage"), sample.get("kind")
    if language not in ("isl", "asl") or kind not in ("known", "unknown"):
        raise ValueError("Sample language/kind must be ISL/ASL and known/unknown")
    label = sample.get("label")
    if not short_text(label, 80) or not label or label != label.strip():
        raise ValueError("Sample label must be trimmed and 1-80 characters")
    if (kind == "unknown" and label != "__unknown__") or (kind == "known" and label == "__unknown__"):
        raise ValueError("The __unknown__ label is reserved for unknown samples")
    created = sample.get("createdAt")
    if type(created) is not int or not 0 <= created <= 9007199254740991:
        raise ValueError("Invalid sample creation time")
    frames = sample.get("frames")
    if not isinstance(frames, list) or not 4 <= len(frames) <= 100:
        raise ValueError("Each sample needs 4-100 pose frames")
    copied, previous = [], -1
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("Invalid pose frame")
        at = frame.get("atMs")
        if not finite(at) or not 0 <= at <= 12000 or at <= previous:
            raise ValueError("Timestamps must increase within one 12 second turn")
        previous = at
        points, scores = frame.get("keypoints"), frame.get("confidences")
        if not isinstance(points, list) or len(points) != 75 or not isinstance(scores, list) or len(scores) != 75:
            raise ValueError("Each frame needs 75 landmarks and confidences")
        if any(not isinstance(point, list) or len(point) != 3 or any(not finite(v) or abs(v) > 10 for v in point) for point in points):
            raise ValueError("Pose coordinates must be finite and bounded by +/-10")
        if any(not finite(v) or not 0 <= v <= 1 for v in scores):
            raise ValueError("Pose confidences must be in [0,1]")
        copied.append({"keypoints": [point[:] for point in points], "confidences": scores[:], "atMs": at})
    duration = copied[-1]["atMs"] - copied[0]["atMs"]
    if type(sample.get("frameCount")) is not int or sample["frameCount"] != len(copied) or not finite(sample.get("durationMs")) or sample["durationMs"] != duration:
        raise ValueError("Sample counts/duration do not match the raw poses")
    if kind == "known" and not eligible(copied):
        raise ValueError("Recapture this known sample: four frames need hands and both shoulders visible together in the signing interval")
    result = {"id": sample_id, "createdAt": created, "signLanguage": language,
              "kind": kind, "label": label, "signerId": signer, "sessionId": session,
              "consent": True, "frames": copied, "frameCount": len(copied), "durationMs": duration}
    # Preserve optional v1 metadata; absent metadata is never inferred from a prediction.
    if "negativeType" in sample:
        if kind != "unknown" or sample["negativeType"] not in NEGATIVE_TYPES:
            raise ValueError("Only unknown samples can declare nonsigning, unsupported-sign or unspecified negative type")
        result["negativeType"] = sample["negativeType"]
    # A measured capture window includes leading/trailing tracking gaps. Do not
    # reconstruct it from legacy last-minus-first duration or absent metadata.
    if "captureDurationMs" in sample:
        capture_duration = sample["captureDurationMs"]
        if not finite(capture_duration) or not 350 <= capture_duration <= 12000 or capture_duration < copied[-1]["atMs"]:
            raise ValueError("Capture duration must be a measured 350-12000 ms recording window covering every pose timestamp")
        result["captureDurationMs"] = capture_duration
    prediction = sample.get("prediction")
    if prediction is not None:
        if not isinstance(prediction, dict) or prediction.get("status") not in ("recognized", "unclear", "no_sign") or not short_text(prediction.get("meaning"), 120):
            raise ValueError("Invalid optional prediction")
        result["prediction"] = {"status": prediction["status"], "meaning": prediction["meaning"]}
    return result


def validate_dataset(dataset):
    if not isinstance(dataset, dict) or dataset.get("format") != FORMAT:
        raise ValueError("Unsupported pose dataset format")
    exported = dataset.get("exportedAt")
    if not isinstance(exported, str) or len(exported) > 40:
        raise ValueError("Dataset needs an ISO export time")
    try:
        when = datetime.fromisoformat(exported.replace("Z", "+00:00"))
        if when.tzinfo is None:
            raise ValueError("Missing timezone")
    except ValueError:
        raise ValueError("Dataset needs an ISO export time with a timezone") from None
    rows = dataset.get("samples")
    if not isinstance(rows, list) or len(rows) > MAX_SAMPLES:
        raise ValueError("A dataset can contain at most 250 samples")
    validated = [validate_sample(row) for row in rows]
    ids = [row["id"] for row in validated]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate sample IDs would leak between splits")
    return validated


def combine_datasets(datasets, source_hashes=None, source_bytes=None):
    """Validate bounded exports before combining; never deduplicate silently."""
    if not isinstance(datasets, list) or not datasets:
        raise ValueError("Provide at least one pose dataset export")
    if source_hashes is not None and len(source_hashes) != len(datasets):
        raise ValueError("Source hash count does not match the exports")
    if source_bytes is not None and (len(source_bytes) != len(datasets) or any(type(size) is not int or not 0 < size <= MAX_BYTES for size in source_bytes)):
        raise ValueError("Each source export must be nonempty and at most 32 MB")
    samples, sources, seen = [], [], set()
    total_bytes = 0
    for index, dataset in enumerate(datasets):
        # Individual serialization provides a bound for callers supplying objects.
        # CLI byte counts also include whitespace and any discarded source fields.
        encoded_bytes = len(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        if encoded_bytes > MAX_BYTES:
            raise ValueError("Each pose dataset export is limited to 32 MB")
        total_bytes += max(encoded_bytes, source_bytes[index] if source_bytes is not None else 0)
        if total_bytes > MAX_COLLECTION_BYTES:
            raise ValueError("Combined pose exports exceed the 256 MB collection limit")
        rows = validate_dataset(dataset)
        if len(samples) + len(rows) > MAX_COLLECTION_SAMPLES:
            raise ValueError("Combined pose exports exceed the 10000 sample collection limit")
        for row in rows:
            if row["id"] in seen:
                raise ValueError(f"Duplicate sample ID across exports: {row['id']}")
            seen.add(row["id"])
        samples.extend(rows)
        sources.append({"exportedAt": dataset["exportedAt"], "samples": len(rows),
                        "known": sum(row["kind"] == "known" for row in rows),
                        "unknown": sum(row["kind"] == "unknown" for row in rows),
                        "negative_type_counts": negative_type_counts(rows),
                        "source_bytes": source_bytes[index] if source_bytes is not None else encoded_bytes,
                        "sha256": source_hashes[index] if source_hashes is not None else None})
    exported_at = max((datetime.fromisoformat(dataset["exportedAt"].replace("Z", "+00:00")) for dataset in datasets)).isoformat()
    return {"format": "signbridge-pose-collection-v1", "source_format": FORMAT,
            "exportedAt": exported_at, "sourceExports": sources, "sourceBytes": total_bytes,
            "samples": samples}


def validate_splits(samples, assignment):
    if not isinstance(assignment, dict) or assignment.get("format") != "signbridge-signer-splits-v1" or not isinstance(assignment.get("signers"), dict):
        raise ValueError("Provide an explicit signbridge-signer-splits-v1 signer assignment")
    mapping = assignment["signers"]
    for signer, split in mapping.items():
        code(signer, "split signer ID")
        if split not in ("train", "val", "test"):
            raise ValueError("Assign each signer to exactly one of train, val, test")
    for sample in samples:
        if sample["signerId"] not in mapping:
            raise ValueError(f"No explicit split for signer {sample['signerId']}")
        if sample["kind"] == "unknown" and mapping[sample["signerId"]] == "train":
            raise ValueError("Unknown samples must be held out of training")
    return dict(mapping)


def prepare_language(samples, mapping, language):
    rows = [sample for sample in samples if sample["signLanguage"] == language]
    split_rows = {split: [] for split in SPLITS}
    background, nonsigning = [], []
    for row in rows:
        split = mapping[row["signerId"]]
        if row["kind"] == "unknown":
            split = "unknown_validation" if split == "val" else "unknown_test"
            if row.get("negativeType") == "nonsigning":
                nonsigning.append({"id": row["id"], "signerId": row["signerId"], "split": split,
                                   "negativeType": "nonsigning",
                                   **({"captureDurationMs": row["captureDurationMs"]} if "captureDurationMs" in row else {}),
                                   "reason": "Explicit nonsigning example; retained separately, excluded from model calibration"})
                continue
            if not eligible(row["frames"]):
                background.append({"id": row["id"], "signerId": row["signerId"], "split": split,
                                   "negativeType": row.get("negativeType", "unspecified"),
                                   **({"captureDurationMs": row["captureDurationMs"]} if "captureDurationMs" in row else {}),
                                   "reason": "Insufficient simultaneous hand/shoulder visibility; retained in inventory, excluded from model calibration"})
                continue
        split_rows[split].append(row)
    labels = sorted({row["label"] for row in rows if row["kind"] == "known"})
    problems = []
    if not 2 <= len(labels) <= 500:
        problems.append("At least two known labels are required")
    for split in ("train", "val", "test"):
        missing = sorted(set(labels) - {row["label"] for row in split_rows[split]})
        if missing:
            problems.append(f"Missing known labels in {split}: {', '.join(missing)}")
    for split in ("unknown_validation", "unknown_test"):
        if not split_rows[split]:
            problems.append(f"No inference-eligible unknown samples in {split}")
    metadata = {
        "language": language, "signLanguage": language, "labels": labels,
        "dataset_source": "Opt-in local SignBridge webcam pose samples; labels supplied by the user",
        "label_review": "Not independently verified; fluent-signer review required before accuracy claims",
        "split_policy": "Explicit signer assignment shared across all sessions and languages; no random clip split",
        "signer_assignment": mapping, "clip_overlap": False, "test_used_for_selection": False,
        "signer_evaluation": {"signer_ids_available": True, "overlap_count": 0,
                              "signer_independent_claim": False,
                              "limits": "Caller-supplied codes cannot prove that physical signer identities differ"},
        "preprocessing": {"contract": "signbridge-pose27-xyc-v1", "frames": FRAMES, "joints": JOINTS,
                          "channels": ["shoulder-normalized-x", "shoulder-normalized-y", "confidence"],
                          "mirroring": False, "resampling": "linear by frame index, matching existing trainer/browser",
                          "timestamp_policy": "Validated timestamps retained in inventory; existing v1 model does not use elapsed time"},
        "unknown_policy": "Unknown samples only enter validation/test; explicit nonsigning and insufficient-visibility samples are retained separately; omitted negative types remain unspecified",
        "negative_type_counts": negative_type_counts(rows),
        "background_samples": background,
        "nonsigning_samples": nonsigning,
        "splits": {split: {"clips": len(group), "class_counts": dict(Counter(row["label"] for row in group)),
                           "signers": sorted({row["signerId"] for row in group})} for split, group in split_rows.items()},
        "training_ready": not problems, "blocking_reasons": problems,
        "limits": ["Isolated-word inputs, not continuous sentence translation", "No model is trained by this importer",
                   "No recognition accuracy has been measured for this collection"],
    }
    if problems:
        return None, metadata
    indices = {label: i for i, label in enumerate(labels)}
    arrays = {"labels": np.asarray(labels, dtype=str), "raw_labels": np.asarray(labels, dtype=str)}
    for split, group in split_rows.items():
        features = []
        for row in group:
            points = np.asarray([frame["keypoints"] for frame in row["frames"]], dtype=np.float32)
            scores = np.asarray([frame["confidences"] for frame in row["frames"]], dtype=np.float32)
            features.append(preprocess_pose(points, scores))
        arrays[f"X_{split}"] = np.stack(features).astype(np.float32)
        arrays[f"y_{split}"] = np.asarray([indices[row["label"]] if row["kind"] == "known" else -1 for row in group], dtype=np.int64)
        arrays[f"clip_ids_{split}"] = np.asarray([row["id"] for row in group], dtype=str)
        arrays[f"source_labels_{split}"] = np.asarray([row["label"] for row in group], dtype=str)
        arrays[f"signer_ids_{split}"] = np.asarray([row["signerId"] for row in group], dtype=str)
        arrays[f"session_ids_{split}"] = np.asarray([row["sessionId"] for row in group], dtype=str)
    return arrays, metadata


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON property: {key}")
        result[key] = value
    return result


def load_bounded_json(path, maximum=MAX_BYTES, with_size=False):
    path = Path(path)
    if not 0 < path.stat().st_size <= maximum:
        raise ValueError(f"JSON file must be nonempty and at most {maximum} bytes")
    with path.open("rb") as source:
        data = source.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("JSON file grew beyond the byte limit")
    result = json.loads(data.decode("utf-8-sig"), object_pairs_hook=no_duplicate_keys,
                        parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Nonfinite JSON number: {value}")))
    parsed = result, hashlib.sha256(data).hexdigest()
    return (*parsed, len(data)) if with_size else parsed


def import_dataset(dataset, assignment, output_dir, source_hash=None, source_bytes=None):
    datasets = dataset if isinstance(dataset, list) else [dataset]
    hashes = source_hash if isinstance(source_hash, list) else [source_hash] if source_hash is not None else None
    sizes = source_bytes if isinstance(source_bytes, list) else [source_bytes] if source_bytes is not None else None
    collection = combine_datasets(datasets, hashes, sizes)
    samples = collection["samples"]
    mapping = validate_splits(samples, assignment)
    output_dir = Path(output_dir)
    if output_dir.exists():
        raise ValueError("Choose a new output directory; existing files will not be overwritten")
    prepared = {language: prepare_language(samples, mapping, language) for language in sorted({row["signLanguage"] for row in samples})}
    # Validate every language before creating any output files.
    output_dir.mkdir(parents=True, exist_ok=False)
    manifest = {"format": "signbridge-training-inventory-v1", "importedAt": datetime.now(timezone.utc).isoformat(),
                "source_format": FORMAT, "source_sha256": collection["sourceExports"][0]["sha256"] if len(datasets) == 1 else None,
                "source_exports": collection["sourceExports"], "source_bytes": collection["sourceBytes"], "sample_count": len(samples),
                "known_count": sum(row["kind"] == "known" for row in samples), "unknown_count": sum(row["kind"] == "unknown" for row in samples),
                "negative_type_counts": negative_type_counts(samples),
                "signer_assignment": mapping, "languages": {language: metadata for language, (_, metadata) in prepared.items()},
                "samples": [{key: row[key] for key in ("id", "signLanguage", "kind", "label", "signerId", "sessionId", "frameCount", "durationMs", "captureDurationMs", "negativeType") if key in row} for row in samples]}
    # Preserve the validated raw poses/timestamps, including background holdouts.
    (output_dir / "poses.json").write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
    for language, (arrays, metadata) in prepared.items():
        (output_dir / f"{language}.metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
        if arrays is not None:
            with (output_dir / f"{language}.npz").open("xb") as destination:
                np.savez_compressed(destination, **arrays)
    (output_dir / "dataset-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, action="append", required=True, help="A browser export; repeat for disjoint collection batches")
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        datasets, hashes, sizes = [], [], []
        for path in args.dataset:
            # Bound aggregate source bytes before accumulating parsed objects.
            if sum(sizes) + path.stat().st_size > MAX_COLLECTION_BYTES:
                raise ValueError("Combined pose exports exceed the 256 MB collection limit")
            dataset, source_hash, source_size = load_bounded_json(path, with_size=True)
            datasets.append(dataset); hashes.append(source_hash); sizes.append(source_size)
            if sum(len(item.get("samples", [])) for item in datasets if isinstance(item, dict) and isinstance(item.get("samples"), list)) > MAX_COLLECTION_SAMPLES:
                raise ValueError("Combined pose exports exceed the 10000 sample collection limit")
        assignment, _ = load_bounded_json(args.splits, 128 * 1024)
        report = import_dataset(datasets, assignment, args.output_dir, hashes, sizes)
    except (ValueError, OSError, UnicodeError, RecursionError) as error:
        parser.error(str(error))
    print(json.dumps({"samples": report["sample_count"], "output_dir": str(args.output_dir),
                      "languages": {language: {"training_ready": metadata["training_ready"], "blocking_reasons": metadata["blocking_reasons"]}
                                    for language, metadata in report["languages"].items()}}, indent=2))


if __name__ == "__main__":
    main()
