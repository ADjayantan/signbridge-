"""Prepare an optional ASL signer-disjoint study; never train or change old data.

Known clips from original train/val/test are assigned by signer. By default,
existing unknown holdouts are retained and their overlap is disclosed. The
optional strict protocol pools those holdouts, excludes training signers, and
assigns calibration/test negatives by signer before any new training. Both raw
graph and legacy-control features receive exactly matched clip IDs.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import tempfile

import numpy as np

from pose_graph import CONTRACT_ID, SPLITS, adjacency_hash, contract_hash, fit_normalization
from prepare_data import canonical_clip
from prepare_graph_data import sha256_file
from train_model import validate_prepared

KNOWN = ("train", "val", "test")
UNKNOWN = ("unknown_validation", "unknown_test")
FIELDS = ("X", "y", "clip_ids", "source_labels", "signer_ids")
MINIMUM_NEGATIVES = 20


def assign_signers(signers, seed=42):
    identities = np.asarray(sorted(set(int(s) for s in signers)), dtype=np.int64)
    if len(identities) < 7 or np.any(identities < 0):
        raise ValueError("Known study clips need at least seven available nonnegative signer IDs")
    np.random.default_rng(seed).shuffle(identities)
    train_end = int(len(identities) * .70)
    val_end = train_end + int(len(identities) * .15)
    return {"train": identities[:train_end].tolist(), "val": identities[train_end:val_end].tolist(), "test": identities[val_end:].tolist()}


def _source_paths(graph_path, legacy_path):
    return {"graph": graph_path, "legacy": legacy_path, "graphMetadata": graph_path.with_suffix(".metadata.json"),
            "legacyMetadata": legacy_path.with_suffix(".metadata.json")}


def strict_negative_protocol(graph_path, legacy_path, seed=42):
    """Aggregate preregistration: no private signer/clip identities or predictions."""
    paths = _source_paths(Path(graph_path).resolve(), Path(legacy_path).resolve())
    return {"format": "signbridge-strict-negative-protocol-v1", "signLanguage": "asl", "seed": seed,
            "sourceHashes": {name: sha256_file(path) for name, path in paths.items()},
            "knownAssignment": "unchanged: numeric-sorted signer IDs; PCG64 seed; first floor(N*.70) train, next floor(N*.15) validation, remainder test",
            "negativePool": "original unknown_validation followed by unknown_test; each existing clip used at most once",
            "knownSignerNegatives": "known validation signers -> unknown_validation; known test signers -> unknown_test; known training signers -> discard",
            "extraSignerNegatives": "unknown-only nonnegative signer IDs sorted numeric int64; separate PCG64 shuffle with the same seed; first floor(N/2) validation, remainder test",
            "missingSignerNegatives": "discard: cannot certify signer separation; no invented identity",
            "clipOrder": "stable filter of pooled unknown_validation, unknown_test order",
            "minimumNegativesPerHoldout": MINIMUM_NEGATIVES,
            "availabilityRule": "fewer than 20 real negatives in either holdout -> unavailable; no NPZ datasets or manufactured samples",
            "separationGate": "union known train, known validation, unknown validation signer IDs must be disjoint from union known test, unknown test signer IDs",
            "selectionRule": "fixed known vocab, signer seed and negative assignment; no model predictions, threshold selection or performance-driven regrouping",
            "uncertaintyRule": "report holdout size and binomial planning bounds separately; later evaluation must calculate intervals from actual accepts and disclose correlated clips",
            "vocabularyLimit": "calibration and test may share unknown words; signer separation does not establish unseen-word or live-camera generalization",
            "historicalExposure": "uses an already inspected historical corpus; never describe this as newly untouched recording-level test data",
            "trained": False, "accuracyMeasured": False, "distribution": "local research only"}


def record_strict_protocol(graph_path, legacy_path, destination, seed=42):
    protocol = strict_negative_protocol(graph_path, legacy_path, seed)
    protocol["recordedAt"] = datetime.now(timezone.utc).isoformat()
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("x", encoding="utf-8") as target:
        json.dump(protocol, target, indent=2, allow_nan=False)
        target.write("\n")
    return protocol


def assign_strict_negatives(signers, known_groups, seed=42):
    """Assign whole signer groups, never clips, without considering predictions."""
    signers = np.asarray(signers)
    if signers.ndim != 1 or signers.dtype.kind not in "iu":
        raise ValueError("Negative signer IDs must be a numeric integer vector")
    known = {name: set(int(value) for value in known_groups[name]) for name in KNOWN}
    if any(known[left] & known[right] for index, left in enumerate(KNOWN) for right in KNOWN[index + 1:]):
        raise ValueError("Known signer groups overlap")
    available = set(int(value) for value in signers if value >= 0)
    extra = np.asarray(sorted(available - set.union(*known.values())), dtype=np.int64)
    np.random.default_rng(seed).shuffle(extra)
    midpoint = len(extra) // 2
    extra_groups = {"val": extra[:midpoint].tolist(), "test": extra[midpoint:].tolist()}
    assignments = {}
    for split, group in (("unknown_validation", "val"), ("unknown_test", "test")):
        assignments[split] = np.isin(signers, list(known[group]) + extra_groups[group])
    discarded = {"knownTrainingSigner": np.isin(signers, list(known["train"])), "missingSignerIdentity": signers < 0}
    total = sum(mask.astype(np.int8) for mask in (*assignments.values(), *discarded.values()))
    if not np.all(total == 1):
        raise ValueError("Each negative clip must be assigned once or explicitly discarded")
    return assignments, discarded, extra_groups


def _negative_summary(labels, signers):
    counts = Counter(str(label).casefold() for label in labels)
    n = len(labels)
    return {"clips": n, "signers": len(set(int(signer) for signer in signers)), "words": len(counts),
            "perWordMinimum": min(counts.values(), default=0), "perWordMaximum": max(counts.values(), default=0),
            "oneFalseAcceptRate": 1 / n if n else None,
            "zeroAcceptsUpper95OneSidedPlanningBound": 1 - .05 ** (1 / n) if n else None,
            "planningBoundNotMeasuredResult": True,
            "intervalCaution": "one-sided exact binomial bound only if zero false accepts are later observed; clips sharing signer/word may be correlated; actual interval requires model results"}


def _load_sources(graph_path, legacy_path):
    graph_metadata = json.loads(graph_path.with_suffix(".metadata.json").read_text(encoding="utf-8"))
    legacy_metadata = json.loads(legacy_path.with_suffix(".metadata.json").read_text(encoding="utf-8"))
    if graph_metadata.get("signLanguage") != "asl" or graph_metadata.get("featureContract") != CONTRACT_ID or graph_metadata.get("contractHash") != contract_hash() or graph_metadata.get("adjacencyHash") != adjacency_hash() or graph_metadata.get("featuresStandardized") is not False:
        raise ValueError("ASL graph source contract is incompatible")
    if graph_metadata.get("preparedDataSha256") != sha256_file(graph_path):
        raise ValueError("Graph source hash changed")
    if graph_metadata.get("sources", {}).get("sha256", {}).get("legacyPrepared") != sha256_file(legacy_path):
        raise ValueError("Legacy source hash differs from graph preparation")
    with np.load(legacy_path, allow_pickle=False) as legacy:
        validate_prepared(legacy, legacy_metadata, "asl")
        old = {key: legacy[key].copy() for key in legacy.files}
    with np.load(graph_path, allow_pickle=False) as graph:
        full = {key: graph[key].copy() for key in graph.files}
    if not np.array_equal(full["labels"], old["labels"]):
        raise ValueError("Compared vocabularies differ")
    seen = set()
    for split in SPLITS:
        for field in FIELDS[1:]:
            if not np.array_equal(full[f"{field}_{split}"], old[f"{field}_{split}"]):
                raise ValueError("Graph and legacy source clip/target/signer order differs")
        raw, mask = full[f"X_{split}"], full[f"mask_{split}"]
        if raw.ndim != 4 or raw.shape[1:] != (32, 75, 3) or mask.shape != raw.shape[:3] or mask.dtype.kind != "b" or not np.isfinite(raw).all() or not np.array_equal(mask, raw[..., 2] >= .5) or np.any(raw[~mask] != 0) or np.any(np.abs(raw[..., :2]) > 5) or np.any(raw[..., 2] < 0) or np.any(raw[..., 2] > 1):
            raise ValueError("Invalid raw graph features/masks")
        for clip in full[f"clip_ids_{split}"].tolist():
            key = canonical_clip(clip)
            if key in seen:
                raise ValueError("Source clips overlap across learning/holdout splits")
            seen.add(key)
    return full, old, graph_metadata, legacy_metadata


def prepare_study(graph_path, legacy_path, output, seed=42, strict_negatives=False, protocol_path=None):
    graph_path, legacy_path, output = Path(graph_path).resolve(), Path(legacy_path).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError("Study output exists; old studies are never overwritten")
    source_paths = _source_paths(graph_path, legacy_path)
    before = {name: sha256_file(path) for name, path in source_paths.items()}
    protocol_hash = None
    if strict_negatives:
        if protocol_path is None:
            raise ValueError("Strict negatives require a recorded protocol before preparation")
        protocol = json.loads(Path(protocol_path).read_text(encoding="utf-8"))
        expected_protocol = strict_negative_protocol(graph_path, legacy_path, seed)
        if not isinstance(protocol.get("recordedAt"), str) or any(protocol.get(key) != value for key, value in expected_protocol.items()):
            raise ValueError("Recorded strict protocol or source hashes differ")
        protocol_hash = sha256_file(Path(protocol_path))
    full, old, graph_metadata, legacy_metadata = _load_sources(graph_path, legacy_path)
    graph_pool = {field: np.concatenate([full[f"{field}_{split}"] for split in KNOWN]) for field in (*FIELDS, "mask")}
    legacy_pool = {field: np.concatenate([old[f"{field}_{split}"] for split in KNOWN]) for field in FIELDS}
    signers = graph_pool["signer_ids"]
    if np.any(signers < 0):
        raise ValueError("Known signer identities are unavailable; no IDs were invented")
    groups = assign_signers(signers, seed)
    graph = {"labels": full["labels"], "raw_labels": full["raw_labels"]}
    legacy = {"labels": old["labels"], "raw_labels": old["raw_labels"]}
    expected_classes = set(range(len(graph["labels"])))
    summaries, split_ids = {}, {}
    for split in KNOWN:
        take = np.isin(signers, groups[split])
        if set(graph_pool["y"][take].tolist()) != expected_classes:
            raise ValueError(f"Signer assignment lacks full class coverage in {split}; no subset was silently selected")
        for field, values in graph_pool.items():
            graph[f"{field}_{split}"] = values[take]
        for field, values in legacy_pool.items():
            legacy[f"{field}_{split}"] = values[take]
        counts = Counter(graph[f"y_{split}"].tolist())
        summaries[split] = {"signers": len(groups[split]), "clips": int(take.sum()), "classes": len(counts),
                            "perClassMinimum": min(counts.values()), "perClassMaximum": max(counts.values())}
        split_ids[split] = graph[f"clip_ids_{split}"].tolist()
    strict_accounting, extra_groups = None, {}
    if strict_negatives:
        unknown_pool = {field: np.concatenate([full[f"{field}_{split}"] for split in UNKNOWN]) for field in (*FIELDS, "mask")}
        legacy_unknown_pool = {field: np.concatenate([old[f"{field}_{split}"] for split in UNKNOWN]) for field in FIELDS}
        assignments, discarded, extra_groups = assign_strict_negatives(unknown_pool["signer_ids"], groups, seed)
        for split, take in assignments.items():
            for field, values in unknown_pool.items():
                graph[f"{field}_{split}"] = values[take]
            for field, values in legacy_unknown_pool.items():
                legacy[f"{field}_{split}"] = values[take]
        strict_accounting = {"pooledClips": len(unknown_pool["y"]),
                             "originalClips": {split: len(full[f"y_{split}"]) for split in UNKNOWN},
                             "retainedClips": {split: int(take.sum()) for split, take in assignments.items()},
                             "discardedClips": {reason: int(take.sum()) for reason, take in discarded.items()},
                             "discardReasons": {"knownTrainingSigner": "not a held-out signer; excluded from calibration/test",
                                                "missingSignerIdentity": "unavailable identity cannot certify separation"},
                             "unknownOnlySignerGroups": {name: len(values) for name, values in extra_groups.items()},
                             "pooledClipIdsUnique": True}
    else:
        for split in UNKNOWN:
            for field in (*FIELDS, "mask"):
                graph[f"{field}_{split}"] = full[f"{field}_{split}"]
            for field in FIELDS:
                legacy[f"{field}_{split}"] = old[f"{field}_{split}"]

    known_groups = {name: set(values) for name, values in groups.items()}
    unknown_groups, unknown_overlap = {}, {}
    for split in UNKNOWN:
        values = graph[f"signer_ids_{split}"]
        unknown_groups[split] = {int(value) for value in values if value >= 0}
        unknown_overlap[split] = {"clips": len(values), "signersWithAvailableIds": len(unknown_groups[split]), "missingSignerIds": int((values < 0).sum()),
                                 "overlapWithKnownGroups": {name: len(unknown_groups[split] & values) for name, values in known_groups.items()}}
    cross_unknown_overlap = len(unknown_groups["unknown_validation"] & unknown_groups["unknown_test"])
    algorithm = {"seed": seed, "sort": "distinct known signer IDs sorted numeric ascending into int64 array",
                 "rng": "numpy.random.default_rng(seed): PCG64", "shuffle": "one in-place shuffle",
                 "assignment": "first floor(N*0.70) train; next floor(N*0.15) validation; remainder test",
                 "clipOrder": "original train, val, test concatenation, stable filter by assigned signer",
                 "numpyVersion": np.__version__, "unknownPolicy": "pooled negative signer regrouping under recorded strict protocol" if strict_negatives else "original unknown_validation and unknown_test unchanged"}
    private_manifest = {"format": "signbridge-signer-assignment-v1", "signLanguage": "asl", "algorithm": algorithm,
                        "sourceHashes": before, "signerGroups": groups, "knownClipIds": split_ids,
                        "unknownClipIds": {split: graph[f"clip_ids_{split}"].tolist() for split in UNKNOWN}}
    if strict_negatives:
        private_manifest.update({"strictProtocolHash": protocol_hash, "unknownOnlySignerGroups": extra_groups,
                                 "discardedUnknownClipIds": {reason: unknown_pool["clip_ids"][take].tolist() for reason, take in discarded.items()}})
    assignment_hash = hashlib.sha256(json.dumps(private_manifest, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    normalization = fit_normalization(graph["X_train"], graph["mask_train"])
    legacy_normalization = {"stage": "model", "fitSplit": "train", "contract": "signbridge-pose27-xyc-v1",
                            "mean": legacy["X_train"].mean(axis=(0, 1)).tolist(),
                            "std": np.maximum(legacy["X_train"].std(axis=(0, 1)), .05).tolist()}
    known_overlap = {"trainValidation": len(known_groups["train"] & known_groups["val"]),
                     "trainTest": len(known_groups["train"] & known_groups["test"]), "validationTest": len(known_groups["val"] & known_groups["test"])}
    report = {"format": "signbridge-signer-study-inventory-v1", "signLanguage": "asl", "preparedAt": datetime.now(timezone.utc).isoformat(),
              "knownClasses": len(graph["labels"]), "knownClips": len(signers), "knownSigners": len(set(signers.tolist())),
              "algorithm": algorithm, "groups": summaries, "knownSignerOverlap": known_overlap,
              "unknownSignerOverlap": unknown_overlap, "unknownValidationTestSignerOverlap": cross_unknown_overlap,
              "knownTestSignerOverlapThroughUnknownValidation": unknown_overlap["unknown_validation"]["overlapWithKnownGroups"]["test"],
              "fullySignerDisjointAcceptanceEvaluation": False,
              "unknownClipsUnchanged": not strict_negatives, "assignmentManifestHash": assignment_hash, "sourceHashes": before,
              "trained": False, "accuracyMeasured": False,
              "limits": ["Known signer groups are disjoint; unknown calibration/test retain original overlapping signer identities",
                         "Unknown validation exposes some held-out known signers to threshold calibration; fully signer-independent acceptance is not established",
                         "Same existing corpus, not newly collected signing or a newly untouched recording test",
                         "All architectures require fresh training on these groups; historical weights are not an unseen-signer control",
                         "No live-camera or fluent-user accuracy established; source dataset use remains local research"]}
    split_policy = f"ASL known signer-disjoint PCG64 seed{seed} 70/15/15; unknown holdouts unchanged"
    if strict_negatives:
        selection_signers = known_groups["train"] | known_groups["val"] | unknown_groups["unknown_validation"]
        test_signers = known_groups["test"] | unknown_groups["unknown_test"]
        leakage = len(selection_signers & test_signers)
        if leakage or cross_unknown_overlap or unknown_overlap["unknown_validation"]["missingSignerIds"] or unknown_overlap["unknown_test"]["missingSignerIds"]:
            raise ValueError("Strict signer separation gate failed")
        counts = strict_accounting["retainedClips"]
        available = all(counts[split] >= MINIMUM_NEGATIVES for split in UNKNOWN)
        reasons = [f"{split} has {counts[split]} genuine clips; minimum is {MINIMUM_NEGATIVES}" for split in UNKNOWN if counts[split] < MINIMUM_NEGATIVES]
        word_sets = {split: set(str(value).casefold() for value in graph[f"source_labels_{split}"]) for split in UNKNOWN}
        report.update({"strictNegatives": True, "strictProtocolHash": protocol_hash, "status": "prepared" if available else "unavailable",
                       "studyAvailable": available, "unavailableReasons": reasons,
                       "minimumNegativesPerHoldout": MINIMUM_NEGATIVES, "negativePoolAccounting": strict_accounting,
                       "negativeHoldoutSize": {split: _negative_summary(graph[f"source_labels_{split}"], graph[f"signer_ids_{split}"]) for split in UNKNOWN},
                       "sharedUnknownWords": len(word_sets["unknown_validation"] & word_sets["unknown_test"]),
                       "selectionAndTestSignerOverlap": leakage, "fullySignerDisjointAcceptanceEvaluation": available,
                       "signerDisjointPartitionVerified": True,
                       "limits": ["Strict signer identities separate classifier fitting/model selection/threshold calibration from final known and unknown test",
                                  "Calibration and test may share unknown words; signer-disjoint does not mean vocabulary-disjoint",
                                  "Negative clips are isolated out-of-vocabulary signs; idle movements and natural conversations are unmeasured",
                                  "Small negative holdouts have wide uncertainty; multiple clips from one signer/word are correlated",
                                  "Same already inspected historical corpus; not newly collected signing or a newly untouched recording test",
                                  "Fresh matched training is required; existing historical weights cannot serve as an unseen-signer control",
                                  "No model was trained/evaluated; no live-camera or fluent-user accuracy established; local research only"]})
        split_policy = f"ASL fixed known signer-disjoint PCG64 seed{seed} 70/15/15; strict pooled negative signer regrouping, train-signer negatives discarded"
        if not available:
            if before != {name: sha256_file(path) for name, path in source_paths.items()} or protocol_hash != sha256_file(Path(protocol_path)):
                raise ValueError("Source inputs or protocol changed; unavailable study was not recorded")
            report["sourceInputsUnchanged"] = True
            output.mkdir(parents=True, exist_ok=False)
            with (output / "study-unavailable.metadata.json").open("x", encoding="utf-8") as target:
                json.dump({**report, "signerAssignmentManifest": private_manifest}, target, indent=2, allow_nan=False)
                target.write("\n")
            return report
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".signer-study-", dir=output.parent) as temporary:
        staging = Path(temporary)
        with (staging / "asl.npz").open("xb") as target:
            np.savez_compressed(target, **graph)
        with (staging / "asl-legacy.npz").open("xb") as target:
            np.savez_compressed(target, **legacy)
        graph_meta = dict(graph_metadata)
        graph_meta.update({"normalization": normalization, "splitPolicy": split_policy,
                           "signerAssignmentManifest": private_manifest, "assignmentManifestHash": assignment_hash,
                           "splits": {**summaries, **{split: {"clips": len(graph[f"X_{split}"])} for split in UNKNOWN}},
                           "preparedDataSha256": sha256_file(staging / "asl.npz"), "sourceStudyHashes": before,
                           "signerEvaluation": {"knownGroupsDisjoint": True, "unknownGroupsDisjoint": strict_negatives, "accuracyMeasured": False,
                                                "knownTestSignerOverlapThroughUnknownValidation": report["knownTestSignerOverlapThroughUnknownValidation"],
                                                "fullySignerDisjointAcceptanceEvaluation": report["fullySignerDisjointAcceptanceEvaluation"]},
                           "exactLegacyClipOrder": False, "matchedLegacyStudyClipOrder": True,
                           "inventory": {split: [{"clipId": clip, "sourceLabel": label, "signerId": int(signer), "target": int(target)}
                                                  for clip, label, signer, target in zip(graph[f"clip_ids_{split}"], graph[f"source_labels_{split}"], graph[f"signer_ids_{split}"], graph[f"y_{split}"])] for split in SPLITS}})
        graph_meta["sources"] = {"sha256": before, "archive": graph_metadata.get("sources", {}).get("archive")}
        if strict_negatives:
            graph_meta.update({"strictProtocolHash": protocol_hash, "negativePoolAccounting": strict_accounting,
                               "negativeHoldoutSize": report["negativeHoldoutSize"], "sharedUnknownWords": report["sharedUnknownWords"],
                               "studyAvailable": True, "strictNegatives": True})
            graph_meta["signerEvaluation"]["selectionAndTestSignerOverlap"] = report["selectionAndTestSignerOverlap"]
        legacy_meta = dict(legacy_metadata)
        legacy_meta.update({"normalization": legacy_normalization, "split_policy": graph_meta["splitPolicy"],
                            "assignmentManifestHash": assignment_hash, "sourceStudyHashes": before,
                            "preparedDataSha256": sha256_file(staging / "asl-legacy.npz"),
                            "signer_evaluation": graph_meta["signerEvaluation"], "study": "optional ASL matched signer-disjoint control"})
        if strict_negatives:
            legacy_meta.update({"strictNegatives": True, "strictProtocolHash": protocol_hash,
                                "negativePoolAccounting": strict_accounting, "studyAvailable": True})
        if before != {name: sha256_file(path) for name, path in source_paths.items()} or (strict_negatives and protocol_hash != sha256_file(Path(protocol_path))):
            raise ValueError("Source inputs or protocol changed; study was not published")
        report["sourceInputsUnchanged"] = True
        report["dataHashes"] = {"graph": graph_meta["preparedDataSha256"], "legacy": legacy_meta["preparedDataSha256"]}
        (staging / "asl.metadata.json").write_text(json.dumps(graph_meta, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        (staging / "asl-legacy.metadata.json").write_text(json.dumps(legacy_meta, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        staging.rename(output)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    repository = Path(__file__).resolve().parents[1]
    parser.add_argument("--graph-data", type=Path, default=repository / ".training-data/graph-v1/asl/asl.npz")
    parser.add_argument("--legacy-data", type=Path, default=repository / ".training-data/prepared/asl.npz")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--strict-negatives", action="store_true", help="Regroup genuine negatives by frozen signer groups; preserve existing studies")
    parser.add_argument("--protocol", type=Path, help="New aggregate protocol file recorded before strict preparation; required with --strict-negatives")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("Aggregate report exists; select a new path")
    if args.strict_negatives and args.protocol is None:
        parser.error("--strict-negatives requires a new --protocol path")
    if not args.strict_negatives and args.protocol is not None:
        parser.error("--protocol is used only with --strict-negatives")
    if args.output is None:
        args.output = repository / (".training-data/graph-v1/asl-signer-disjoint-strict" if args.strict_negatives else ".training-data/graph-v1/asl-signer-disjoint")
    if args.output.exists():
        parser.error("Study output exists; old studies are never overwritten")
    if args.strict_negatives:
        if args.protocol.exists() or args.protocol.resolve() == args.report.resolve():
            parser.error("Protocol requires a new file distinct from the aggregate report")
        record_strict_protocol(args.graph_data, args.legacy_data, args.protocol)
    report = prepare_study(args.graph_data, args.legacy_data, args.output,
                           strict_negatives=args.strict_negatives, protocol_path=args.protocol)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with args.report.open("x", encoding="utf-8") as target:
        json.dump(report, target, indent=2, allow_nan=False)
        target.write("\n")
    print(json.dumps(report, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
