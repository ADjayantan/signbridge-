"""Prepare official OpenHands temporal poses without extracting or executing archives.

Only allowlisted NumPy pickle constructors are accepted. Training/validation/test
clip identities stay disjoint, and held-out vocabulary remains outside training.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import pickle
import re
import zipfile

import numpy as np

JOINTS = [0, 2, 5, 11, 12, 13, 14, 33, 37, 38, 41, 42, 45, 46, 49, 50, 53,
          54, 58, 59, 62, 63, 66, 67, 70, 71, 74]
FRAMES = 32
MAX_POSE_BYTES = 16 * 1024 * 1024
MAX_POSE_FRAMES = 4096
EXPECTED_ARCHIVES = {
    "isl": ("INCLUDE.zip", 662887244, "f99f6f3ea50d5d94e0ffae44130a6672"),
    "asl": ("WLASL.zip", 1036098375, "c45b690a5340da71d9a75db19e0cc572"),
}


class RestrictedUnpickler(pickle.Unpickler):
    """Deny arbitrary globals; permit only the original numeric NumPy schema."""
    _safe = {
        ("numpy", "ndarray"): np.ndarray,
        ("numpy", "dtype"): np.dtype,
        ("numpy.core.multiarray", "_reconstruct"): np._core.multiarray._reconstruct,
        ("numpy._core.multiarray", "_reconstruct"): np._core.multiarray._reconstruct,
        ("numpy.core.multiarray", "scalar"): np._core.multiarray.scalar,
        ("numpy._core.multiarray", "scalar"): np._core.multiarray.scalar,
        ("builtins", "set"): set,
        ("builtins", "frozenset"): frozenset,
        ("builtins", "slice"): slice,
        ("builtins", "complex"): complex,
    }

    def find_class(self, module, name):
        try:
            return self._safe[(module, name)]
        except KeyError:
            raise pickle.UnpicklingError(f"Disallowed pickle global: {module}.{name}") from None

    def persistent_load(self, pid):
        raise pickle.UnpicklingError("Persistent pickle references are not supported")


def validate_pose(keypoints, confidences):
    if not isinstance(keypoints, np.ndarray) or not isinstance(confidences, np.ndarray):
        raise ValueError("Pose arrays must be numeric NumPy arrays")
    if keypoints.dtype.kind not in "fiub" or confidences.dtype.kind not in "fiub":
        raise ValueError("Object and nonnumeric pose arrays are forbidden")
    if keypoints.ndim != 3 or keypoints.shape[1:] != (75, 3):
        raise ValueError("Expected keypoints shaped [T,75,3]")
    if not 1 <= len(keypoints) <= MAX_POSE_FRAMES or confidences.shape != keypoints.shape[:2]:
        raise ValueError("Invalid pose length or confidence dimensions")
    if not np.isfinite(keypoints).all() or not np.isfinite(confidences).all():
        raise ValueError("Pose contains nonfinite values")
    return keypoints.astype(np.float32), confidences.astype(np.float32)


def safely_load_pose(data: bytes):
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_POSE_BYTES:
        raise ValueError("Pose entry is empty or exceeds the byte limit")
    source = io.BytesIO(data)
    pose = RestrictedUnpickler(source).load()
    if source.read(1):
        raise ValueError("Unexpected trailing pickle data")
    if not isinstance(pose, dict) or not {"keypoints", "confidences"}.issubset(pose) or not set(pose).issubset({"keypoints", "confidences", "vid_shape"}):
        raise ValueError("Expected keypoints/confidences and optional video shape in a pose")
    if "vid_shape" in pose and (not isinstance(pose["vid_shape"], tuple) or not 2 <= len(pose["vid_shape"]) <= 4 or not all(isinstance(value, int) and 0 < value <= 16384 for value in pose["vid_shape"])):
        raise ValueError("Invalid optional video shape")
    keypoints, confidences = validate_pose(pose["keypoints"], pose["confidences"])
    return {"keypoints": keypoints, "confidences": confidences}


def trim_bounds(confidences):
    visible = np.maximum(confidences[:, 33], confidences[:, 54]) >= .5
    indices = np.flatnonzero(visible)
    if len(indices) < 4:
        raise ValueError("Fewer than four hand-visible frames")
    return int(indices[0]), int(indices[-1]) + 1


def preprocess_pose(keypoints, confidences):
    """Match the browser contract exactly: 32 frames × 27 joints × (x,y,score)."""
    keypoints, confidences = validate_pose(keypoints, confidences)
    first, end = trim_bounds(confidences)
    keypoints, confidences = keypoints[first:end], confidences[first:end]
    shoulders_valid = (confidences[:, 11] >= .2) & (confidences[:, 12] >= .2)
    center = (keypoints[:, 11, :2] + keypoints[:, 12, :2]) / 2
    width = np.linalg.norm(keypoints[:, 11, :2] - keypoints[:, 12, :2], axis=1)
    width = np.maximum(width, .05)
    selected_xy = (keypoints[:, JOINTS, :2] - center[:, None, :]) / width[:, None, None]
    selected_conf = np.clip(confidences[:, JOINTS], 0, 1)
    valid = (confidences[:, JOINTS] >= .2) & shoulders_valid[:, None]
    normalized = np.zeros((len(keypoints), len(JOINTS), 3), dtype=np.float32)
    normalized[:, :, :2] = np.where(valid[:, :, None], np.clip(selected_xy, -5, 5), 0)
    normalized[:, :, 2] = np.where(valid, selected_conf, 0)
    positions = np.linspace(0, len(normalized) - 1, FRAMES)
    lower, upper = np.floor(positions).astype(int), np.ceil(positions).astype(int)
    fraction = (positions - lower).astype(np.float32)
    result = normalized[lower] * (1 - fraction[:, None, None]) + normalized[upper] * fraction[:, None, None]
    return result.reshape(FRAMES, len(JOINTS) * 3).astype(np.float32)


def preprocess(pose):
    return preprocess_pose(pose["keypoints"], pose["confidences"])


def valid_shoulder_frames(pose):
    first, end = trim_bounds(pose["confidences"])
    scores = pose["confidences"][first:end]
    return int(np.count_nonzero((scores[:, 11] >= .2) & (scores[:, 12] >= .2)))


def canonical_clip(path):
    return str(PurePosixPath(str(path).replace("\\", "/"))).casefold()


class PoseArchive:
    """Read bounded matching .pkl entries directly; never extract ZIP paths."""
    def __init__(self, path):
        path = Path(path)
        self.zip = zipfile.ZipFile(path)
        # Official INCLUDE packaging contains a second ZIP. Copy only that exact,
        # bounded member to a fixed local cache; never use archive-provided paths.
        if path.name == "INCLUDE.zip" and "INCLUDE/Pose_Signs.zip" in self.zip.namelist():
            entry = self.zip.getinfo("INCLUDE/Pose_Signs.zip")
            if entry.flag_bits & 1 or not 0 < entry.file_size <= 800 * 1024 * 1024:
                self.zip.close()
                raise ValueError("Invalid nested INCLUDE pose archive")
            cache = path.with_name("INCLUDE-Pose_Signs.zip")
            temporary = cache.with_suffix(".zip.part")
            copied = 0
            with self.zip.open(entry) as source, temporary.open("wb") as output:
                while block := source.read(8 * 1024 * 1024):
                    copied += len(block)
                    if copied > entry.file_size:
                        raise ValueError("Nested archive exceeded its declared limit")
                    output.write(block)
            if copied != entry.file_size:
                raise ValueError("Incomplete nested INCLUDE archive")
            self.zip.close()
            temporary.replace(cache)
            self.zip = zipfile.ZipFile(cache)
        self.index = {}
        for entry in self.zip.infolist():
            normalized = canonical_clip(entry.filename)
            parts = PurePosixPath(normalized).parts
            if not normalized.endswith(".pkl") or ".." in parts or normalized.startswith("/"):
                continue
            for length in range(1, len(parts) + 1):
                suffix = "/".join(parts[-length:])
                self.index.setdefault(suffix, []).append(entry)

    def close(self):
        self.zip.close()

    def read(self, source_path):
        expected = canonical_clip(str(PurePosixPath(str(source_path).replace("\\", "/")).with_suffix(".pkl")))
        matches = self.index.get(expected, [])
        if len(matches) != 1:
            raise ValueError("Missing pose entry" if not matches else "Ambiguous pose entry")
        entry = matches[0]
        if entry.is_dir() or entry.flag_bits & 1 or not 0 < entry.file_size <= MAX_POSE_BYTES:
            raise ValueError("Pose ZIP entry is encrypted, empty or oversized")
        with self.zip.open(entry) as source:
            data = source.read(MAX_POSE_BYTES + 1)
        return safely_load_pose(data)


def read_csv(path):
    with Path(path).open(newline="", encoding="utf-8-sig") as source:
        return list(csv.DictReader(source))


def clip_disjoint(groups):
    seen = {}
    for split, rows in groups.items():
        for row in rows:
            clip = canonical_clip(row["clip"])
            if clip in seen and seen[clip] != split:
                raise ValueError(f"Clip overlap between {seen[clip]} and {split}: {clip}")
            seen[clip] = split


def stratified_train_validation(rows, fraction=.15, seed=42):
    rng = np.random.default_rng(seed)
    labels = sorted({row["label"] for row in rows})
    train, validation = [], []
    for label in labels:
        group = [row for row in rows if row["label"] == label]
        rng.shuffle(group)
        count = min(len(group) - 1, max(1, round(len(group) * fraction))) if len(group) > 1 else 0
        validation.extend(group[:count])
        train.extend(group[count:])
    return train, validation


def include_rows(metadata):
    known = {}
    for split, filename in [("train", "train_include50.csv"), ("test", "test_include50.csv")]:
        known[split] = [{"clip": row["FilePath"], "path": row["FilePath"], "label": row["Word"]}
                        for row in read_csv(metadata / filename)]
    labels = sorted({row["label"] for row in known["train"]})
    unknown = {}
    for split, filename in [("unknown_validation", "train_include.csv"), ("unknown_test", "test_include.csv")]:
        unknown[split] = [{"clip": row["FilePath"], "path": row["FilePath"], "label": row["Word"]}
                          for row in read_csv(metadata / filename) if row["Word"] not in labels]
    return known, unknown, labels


def wlasl_rows(metadata):
    with (metadata / "WLASL_v0.3.json").open(encoding="utf-8") as source:
        content = json.load(source)
    labels = sorted(item["gloss"] for item in content[:100])
    known = {"train": [], "val": [], "test": []}
    unknown = {"unknown_validation": [], "unknown_test": []}
    for class_index, entry in enumerate(content):
        for instance in entry["instances"]:
            split = instance["split"]
            row = {"clip": str(instance["video_id"]), "path": str(instance["video_id"]) + ".mp4",
                   "label": entry["gloss"], "signer_id": instance.get("signer_id")}
            if class_index < 100 and split in known:
                known[split].append(row)
            elif class_index >= 100 and split in {"val", "test"}:
                unknown["unknown_validation" if split == "val" else "unknown_test"].append(row)
    return known, unknown, labels


def load_rows(archive, rows, label_to_id, skipped, limit=None, seed=42):
    rows = list(rows)
    if limit is not None:
        np.random.default_rng(seed).shuffle(rows)
    loaded, seen = [], set()
    for row in rows:
        clip = canonical_clip(row["clip"])
        if clip in seen:
            skipped.append({"clip": row["clip"], "reason": "Duplicate clip in split"})
            continue
        seen.add(clip)
        try:
            pose = archive.read(row["path"])
            if valid_shoulder_frames(pose) < 4:
                raise ValueError("Fewer than four valid-shoulder frames")
            sequence = preprocess(pose)
            loaded.append({**row, "X": sequence, "y": label_to_id.get(row["label"], -1)})
        except (ValueError, pickle.UnpicklingError, EOFError, zipfile.BadZipFile, KeyError, TypeError) as error:
            skipped.append({"clip": row["clip"], "reason": str(error)})
        if limit is not None and len(loaded) >= limit:
            break
    return loaded


def verify_archive(path, language):
    filename, expected_size, expected_md5 = EXPECTED_ARCHIVES[language]
    if path.stat().st_size != expected_size:
        raise ValueError(f"Wrong archive byte length for {filename}")
    digest = hashlib.md5()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected_md5:
        raise ValueError(f"Archive checksum mismatch for {filename}")
    return {"file": filename, "bytes": expected_size, "md5": expected_md5,
            "url": f"https://zenodo.org/api/records/6674324/files/{filename}/content"}


def prepare_language(language, root):
    archive_path = root / "archives" / EXPECTED_ARCHIVES[language][0]
    provenance = verify_archive(archive_path, language)
    metadata_dir = root / "metadata"
    known, unknown, labels = include_rows(metadata_dir) if language == "isl" else wlasl_rows(metadata_dir)
    clip_disjoint({**known, **unknown})
    label_to_id = {label: index for index, label in enumerate(labels)}
    skipped, loaded = [], {}
    archive = PoseArchive(archive_path)
    try:
        for split, rows in known.items():
            loaded[split] = load_rows(archive, rows, label_to_id, skipped)
            print(f"{language} {split}: {len(loaded[split])}/{len(rows)} clips", flush=True)
        if language == "isl":
            loaded["train"], loaded["val"] = stratified_train_validation(loaded["train"])
        intended_labels = labels[:]
        class_counts = {split: Counter(row["label"] for row in loaded[split]) for split in ["train", "val", "test"]}
        dropped_classes = [{"label": label, "missing_splits": [split for split in ["train", "val", "test"] if not class_counts[split][label]]}
                           for label in labels if any(not class_counts[split][label] for split in ["train", "val", "test"])]
        labels = [label for label in labels if all(class_counts[split][label] for split in ["train", "val", "test"])]
        label_to_id = {label: index for index, label in enumerate(labels)}
        for split in ["train", "val", "test"]:
            loaded[split] = [{**row, "y": label_to_id[row["label"]]} for row in loaded[split] if row["label"] in label_to_id]
        for split, rows in unknown.items():
            limit = 100 if split == "unknown_validation" else 200
            loaded[split] = load_rows(archive, rows, label_to_id, skipped, limit=limit)
            print(f"{language} {split}: {len(loaded[split])} clips", flush=True)
    finally:
        archive.close()
    clip_disjoint(loaded)
    if not loaded["train"] or not loaded["val"] or not loaded["test"]:
        raise ValueError("A required known-data split is empty")
    arrays = {"labels": np.asarray([re.sub(r"^\d+\.\s*", "", label).strip().upper() for label in labels]),
              "raw_labels": np.asarray(labels)}
    split_metadata = {}
    for split, rows in loaded.items():
        arrays[f"X_{split}"] = np.stack([row["X"] for row in rows]) if rows else np.empty((0, FRAMES, 81), dtype=np.float32)
        arrays[f"y_{split}"] = np.asarray([row["y"] for row in rows], dtype=np.int64)
        arrays[f"clip_ids_{split}"] = np.asarray([row["clip"] for row in rows], dtype=str)
        arrays[f"source_labels_{split}"] = np.asarray([row["label"] for row in rows], dtype=str)
        arrays[f"signer_ids_{split}"] = np.asarray([row.get("signer_id", -1) for row in rows], dtype=np.int64)
        split_metadata[split] = {"clips": len(rows), "class_counts": dict(Counter(row["label"] for row in rows))}
    train_signers = {row["signer_id"] for row in loaded["train"] if row.get("signer_id") is not None}
    test_signers = {row["signer_id"] for row in loaded["test"] if row.get("signer_id") is not None}
    metadata = {
        "language": language, "signLanguage": language, "archive": provenance, "pose_record": "https://zenodo.org/records/6674324",
        "pose_record_license": "CC-BY-4.0", "underlying_license": "CC-BY-4.0" if language == "isl" else "C-UDA-1.0; academic/computational use only, noncommercial",
        "dataset_source": "https://zenodo.org/records/4010759" if language == "isl" else "https://github.com/dxli94/WLASL",
        "license_file": None if language == "isl" else str(metadata_dir / "WLASL-C-UDA-1.0.pdf"),
        "labels": arrays["labels"].tolist(), "raw_labels": labels, "intended_raw_labels": intended_labels,
        "dropped_classes": dropped_classes, "splits": split_metadata,
        "split_policy": "Original INCLUDE50 test; seeded stratified 15% of remaining training clips for validation" if language == "isl" else "Original WLASL100 train/val/test by video_id",
        "validation_seed": 42, "test_used_for_selection": False, "clip_overlap": False,
        "signer_evaluation": {"signer_ids_available": language == "asl", "train_signers": len(train_signers), "test_signers": len(test_signers),
                              "overlap_count": len(train_signers & test_signers), "overlapping_signer_ids": sorted(train_signers & test_signers), "signer_independent_claim": False},
        "preprocessing": {"contract": "signbridge-pose27-xyc-v1", "joints": JOINTS, "frames": FRAMES,
                          "channels": ["shoulder-normalized-x", "shoulder-normalized-y", "confidence"],
                          "wrist_visibility_threshold": .5, "joint_visibility_threshold": .2, "minimum_hand_visible_frames": 4,
                          "minimum_valid_shoulder_frames": 4, "minimum_shoulder_width": .05, "coordinate_clip": [-5, 5],
                          "normalization": "per-frame shoulder midpoint/width", "resampling": "linear", "mirroring": False},
        "unknown_policy": "Unselected vocabulary only; original separate source splits; no unknown clip enters known training",
        "skipped_count": len(skipped), "skipped_reasons": dict(Counter(row["reason"] for row in skipped)), "skipped_files": skipped,
        "limits": "Isolated closed-vocabulary word recognition; official recording splits do not establish unseen-signer or live-webcam performance",
    }
    output = root / "prepared"
    output.mkdir(parents=True, exist_ok=True)
    temporary = output / f"{language}.npz.part"
    with temporary.open("wb") as destination:
        np.savez_compressed(destination, **arrays)
    temporary.replace(output / f"{language}.npz")
    (output / f"{language}.metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    parity_row = loaded["test"][0]
    archive = PoseArchive(archive_path)
    try:
        parity_pose = archive.read(parity_row["path"])
    finally:
        archive.close()
    parity = {"clipId": parity_row["clip"], "signLanguage": language, "label": parity_row["label"],
              "contract": "signbridge-pose27-xyc-v1", "split": "test",
              "frames": [{"keypoints": points.tolist(), "confidences": scores.tolist()}
                         for points, scores in zip(parity_pose["keypoints"], parity_pose["confidences"])],
              "features": parity_row["X"].tolist()}
    (output / f"{language}-raw-parity.json").write_text(json.dumps(parity, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"language": language, "path": str(output / f"{language}.npz"), "counts": {key: len(value) for key, value in loaded.items()}, "skipped": len(skipped)}), flush=True)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / ".training-data")
    parser.add_argument("--language", choices=["isl", "asl", "both"], default="both")
    args = parser.parse_args()
    for language in ["isl", "asl"] if args.language == "both" else [args.language]:
        prepare_language(language, args.root.resolve())


if __name__ == "__main__":
    main()
