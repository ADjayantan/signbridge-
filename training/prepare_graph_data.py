"""Rehydrate exact legacy split clip IDs into new local 75-joint graph arrays.

Never trains, changes source caches/old arrays, or writes models. All source poses
are bounded and read through the restricted original loader. Existing outputs
are refused; failures do not create a partial language dataset.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

import numpy as np

from prepare_data import MAX_POSE_BYTES, PoseArchive, canonical_clip, verify_archive
from pose_graph import CONTRACT, CONTRACT_ID, SPLITS, adjacency_hash, contract_hash, fit_normalization, preprocess_pose_graph
from train_model import validate_prepared


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _stream_hash(source, destination=None):
    digest, size = hashlib.sha256(), 0
    while chunk := source.read(1024 * 1024):
        size += len(chunk)
        if size > 800 * 1024 * 1024:
            raise ValueError("Nested pose archive exceeded its bounded size")
        digest.update(chunk)
        if destination is not None:
            destination.write(chunk)
    return digest.hexdigest(), size


@contextmanager
def read_only_archive(path, working_directory):
    """Avoid PoseArchive(INCLUDE.zip), which rewrites its legacy cache."""
    path = Path(path)
    resolved = path
    with zipfile.ZipFile(path) as outer:
        member = "INCLUDE/Pose_Signs.zip"
        if path.name == "INCLUDE.zip" and member in outer.namelist():
            entry = outer.getinfo(member)
            if entry.flag_bits & 1 or not 0 < entry.file_size <= 800 * 1024 * 1024:
                raise ValueError("Invalid nested pose archive")
            cache = path.with_name("INCLUDE-Pose_Signs.zip")
            if cache.exists():
                with outer.open(entry) as source:
                    expected, length = _stream_hash(source)
                if length != entry.file_size or cache.stat().st_size != length or sha256_file(cache) != expected:
                    raise ValueError("Existing INCLUDE pose cache differs from verified source; it was not overwritten")
                resolved = cache
            else:
                resolved = Path(working_directory) / "INCLUDE-graph-source.zip"
                with outer.open(entry) as source, resolved.open("xb") as destination:
                    _, length = _stream_hash(source, destination)
                if length != entry.file_size:
                    raise ValueError("Incomplete nested pose archive")
    archive = PoseArchive(resolved)
    try:
        yield archive
    finally:
        archive.close()


def _inventory(dataset, language):
    inventories, seen = {}, {}
    for split in SPLITS:
        clip_ids = dataset[f"clip_ids_{split}"].tolist()
        source_labels = dataset[f"source_labels_{split}"].tolist()
        signer_ids = dataset[f"signer_ids_{split}"].tolist()
        targets = dataset[f"y_{split}"].tolist()
        if not (len(clip_ids) == len(source_labels) == len(signer_ids) == len(targets)):
            raise ValueError(f"{language} {split}: malformed retained inventory")
        rows = []
        for clip, source_label, signer, target in zip(clip_ids, source_labels, signer_ids, targets):
            identity = canonical_clip(clip)
            if identity in seen:
                raise ValueError(f"Duplicate/case-aliased clip identity across {seen[identity]} and {split}")
            if not isinstance(source_label, str) or not source_label.strip() or type(signer) is not int or signer < -1:
                raise ValueError("Invalid source labels or signer codes")
            if split.startswith("unknown") and target != -1:
                raise ValueError("Unknown holdouts must not have a known-class target")
            seen[identity] = split
            rows.append({"clipId": clip, "sourceLabel": source_label, "signerId": signer, "target": target})
        inventories[split] = rows
    return inventories


def prepare_language(language, source_root, output_directory):
    source_root, output_directory = Path(source_root).resolve(), Path(output_directory).resolve()
    if language not in ("isl", "asl"):
        raise ValueError("Language must be ISL or ASL")
    if output_directory.exists():
        raise ValueError("Output directory already exists; no prepared files were overwritten")
    archive_path = source_root / "archives" / ("INCLUDE.zip" if language == "isl" else "WLASL.zip")
    legacy_path = source_root / "prepared" / f"{language}.npz"
    legacy_metadata_path = legacy_path.with_suffix(".metadata.json")
    paths = {"archive": archive_path, "legacyPrepared": legacy_path, "legacyMetadata": legacy_metadata_path}
    before = {name: sha256_file(path) for name, path in paths.items()}
    provenance = verify_archive(archive_path, language)
    legacy_metadata = json.loads(legacy_metadata_path.read_text(encoding="utf-8"))
    with np.load(legacy_path, allow_pickle=False) as dataset:
        validate_prepared(dataset, legacy_metadata, language)
        inventory = _inventory(dataset, language)
        labels = dataset["labels"].tolist()
        raw_labels = dataset["raw_labels"].tolist()
    if len(raw_labels) != len(labels) or legacy_metadata.get("labels") != labels:
        raise ValueError("Source label order differs from prepared metadata")
    known_source_labels = {row["sourceLabel"] for split in ("train", "val", "test") for row in inventory[split]}
    if any(row["sourceLabel"] in known_source_labels for split in ("unknown_validation", "unknown_test") for row in inventory[split]):
        raise ValueError("Unknown vocabulary overlaps selected known labels")

    output_directory.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".graph-prepare-", dir=output_directory.parent) as temporary:
        staging = Path(temporary)
        arrays, split_reports, exclusions = {"labels": np.asarray(labels), "raw_labels": np.asarray(raw_labels)}, {}, []
        with read_only_archive(archive_path, staging) as archive:
            for split in SPLITS:
                features, masks = [], []
                rows = inventory[split]
                for row in rows:
                    try:
                        pose = archive.read(row["clipId"])
                        values, valid = preprocess_pose_graph(pose["keypoints"], pose["confidences"])
                    except (ValueError, KeyError, EOFError, zipfile.BadZipFile) as error:
                        exclusions.append({"split": split, "clipId": row["clipId"], "reason": str(error)})
                        continue
                    features.append(values)
                    masks.append(valid)
                if len(features) != len(rows):
                    raise ValueError(f"{language} {split}: {len(exclusions)} rehydrated clips failed quality; no output written and no split silently changed")
                arrays[f"X_{split}"] = np.stack(features).astype(np.float32)
                arrays[f"mask_{split}"] = np.stack(masks).astype(np.bool_)
                arrays[f"y_{split}"] = np.asarray([row["target"] for row in rows], dtype=np.int64)
                arrays[f"clip_ids_{split}"] = np.asarray([row["clipId"] for row in rows], dtype=str)
                arrays[f"source_labels_{split}"] = np.asarray([row["sourceLabel"] for row in rows], dtype=str)
                arrays[f"signer_ids_{split}"] = np.asarray([row["signerId"] for row in rows], dtype=np.int64)
                split_reports[split] = {"clips": len(rows), "shape": list(arrays[f"X_{split}"].shape),
                    "classCounts": dict(Counter(row["sourceLabel"] for row in rows)),
                    "validNodeFraction": float(arrays[f"mask_{split}"].mean()),
                    "clipInventoryHash": hashlib.sha256(json.dumps([row["clipId"] for row in rows], separators=(",", ":")).encode()).hexdigest()}
        normalization = fit_normalization(arrays["X_train"], arrays["mask_train"])
        npz_path = staging / f"{language}.npz"
        with npz_path.open("xb") as target:
            np.savez_compressed(target, **arrays)
        metadata = {"format": "signbridge-pose-graph-prepared-v1", "language": language, "signLanguage": language,
            "featureContract": CONTRACT_ID, "contractHash": contract_hash(), "adjacencyHash": adjacency_hash(),
            "featureShape": [32, 75, 3], "featuresStandardized": False, "normalization": normalization,
            "labels": labels, "raw_labels": raw_labels, "sources": {"sha256": before, "archive": provenance},
            "splits": split_reports, "inventory": inventory, "exclusions": exclusions,
            "legacyExclusionCount": legacy_metadata.get("skipped_count"), "legacyExclusions": legacy_metadata.get("skipped_files", []),
            "splitPolicy": legacy_metadata["split_policy"], "clipOverlap": False, "exactLegacyClipOrder": True,
            "signerEvaluation": legacy_metadata["signer_evaluation"], "testPreviouslyInspected": True,
            "timing": "unknown source frame timing; nearest frame-index resampling without fabricated timestamps",
            "distribution": {"status": "local-only", "underlyingLicense": legacy_metadata.get("underlying_license")},
            "preparedDataSha256": sha256_file(npz_path), "preparedAt": datetime.now(timezone.utc).isoformat(),
            "limits": ["Dataset recording splits do not establish unfamiliar-signer or live-camera accuracy", "No facial mesh or validated common-coordinate depth"]}
        after = {name: sha256_file(path) for name, path in paths.items()}
        if before != after:
            raise ValueError("Source inputs changed during preparation; no output published")
        metadata["sourceInputsUnchanged"] = True
        (staging / f"{language}.metadata.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        (staging / "graph-contract-v1.json").write_bytes(Path(__file__).with_name("graph-contract-v1.json").read_bytes())
        # Only complete generated output is published. Source cache is never copied.
        output_directory.mkdir(exist_ok=False)
        for name in (f"{language}.npz", f"{language}.metadata.json", "graph-contract-v1.json"):
            shutil.move(str(staging / name), str(output_directory / name))
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=["isl", "asl", "both"], default="both")
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[1] / ".training-data")
    parser.add_argument("--output-root", type=Path)
    args = parser.parse_args()
    output_root = args.output_root or args.source_root / "graph-v1"
    languages = ("isl", "asl") if args.language == "both" else (args.language,)
    if any((output_root / language).exists() for language in languages):
        parser.error("A language output directory already exists; select a new output root")
    for language in languages:
        metadata = prepare_language(language, args.source_root, output_root / language)
        print(json.dumps({"signLanguage": language, "output": str((output_root / language).resolve()),
            "counts": {split: result["clips"] for split, result in metadata["splits"].items()},
            "sourceInputsUnchanged": metadata["sourceInputsUnchanged"], "contractHash": metadata["contractHash"],
            "adjacencyHash": metadata["adjacencyHash"]}), flush=True)


if __name__ == "__main__":
    main()
