"""Experimental GRU75/LSTM75 training controls, separate from frozen studies.

Requires explicitly supplied prepared pose75 data and recorded signer groups.
Reads train/validation features only, writes local research artifacts, and never
exports, promotes, calibrates, or enables a model in the application.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from graph_models import LSTM75_CONFIG, TEMPORAL_CONTROL_ARCHITECTURES
from train_graph_models import TEMPORAL_EXPERIMENT_KIND, load_data, sha256, train_run, write_json

SEEDS = (42, 43, 44)
LEARNING_SPLITS = ("train", "val", "unknown_validation")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=("isl", "asl"), required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--minimum-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=.002)
    parser.add_argument("--max-seconds", type=float, default=1200)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args(argv)
    if not 1 <= args.epochs <= 1000 or not 1 <= args.minimum_epochs <= args.epochs or not 1 <= args.patience <= 1000:
        parser.error("Invalid epoch/patience bounds")
    if not 1 <= args.batch_size <= 512 or not 1 <= args.threads <= 16 or not 1 <= args.max_seconds <= 86400 or not 0 < args.learning_rate <= .1:
        parser.error("Invalid batch/thread/time/learning-rate bounds")
    return args


def validate_learning_signers(data_path, arrays):
    """Verify recorded groups, without reading final-test features or identities.

    Codes attest grouping, not independently verified physical identities.
    Known and unknown validation may share people; neither may share training.
    """
    groups = {}
    with np.load(data_path, allow_pickle=False) as prepared:
        for split in LEARNING_SPLITS:
            key = f"signer_ids_{split}"
            if key not in prepared:
                raise ValueError(f"Recorded signer IDs are required for {split}")
            raw = prepared[key]
            if raw.ndim != 1 or len(raw) != len(arrays[split]["ids"]) or raw.dtype.kind not in "iuU":
                raise ValueError(f"Invalid recorded signer IDs for {split}")
            if raw.dtype.kind in "iu":
                if np.any(raw < 0):
                    raise ValueError("Missing signer identities cannot support this comparison")
                codes = [str(int(value)) for value in raw]
            else:
                codes = raw.tolist()
                if any(not value or len(value) > 64 or value != value.strip() for value in codes):
                    raise ValueError("Signer codes must be trimmed and 1-64 characters")
            groups[split] = set(codes)
    if groups["train"] & (groups["val"] | groups["unknown_validation"]):
        raise ValueError("Training signer codes overlap known or unknown validation")
    return {"recordedCodesAvailable": True, "trainingValidationOverlap": 0,
            "signerCounts": {split: len(group) for split, group in groups.items()},
            "physicalIdentitiesVerified": False, "finalTestSignerGroupsChecked": False,
            "limits": "Recorded codes do not prove independent people; no unseen-signer claim"}


def experiment_record(args, labels, data_hash, metadata_hash, signer_groups):
    """Freeze ordered labels, shared budgets and provenance before any fitting."""
    label_hash = hashlib.sha256(json.dumps(labels, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"format": "signbridge-temporal-control-experiment-v1",
            "experimentKind": TEMPORAL_EXPERIMENT_KIND, "signLanguage": args.language,
            "models": list(TEMPORAL_CONTROL_ARCHITECTURES), "seeds": list(SEEDS),
            "labels": list(labels), "orderedLabelsSha256": label_hash,
            "featureContract": "signbridge-pose75-xyc-v1", "inputShape": [1, 32, 75, 3],
            "lstmConfig": LSTM75_CONFIG.copy(), "dataSha256": data_hash,
            "metadataSha256": metadata_hash, "recordedSignerGroups": signer_groups,
            "epochs": args.epochs, "minimumEpochs": args.minimum_epochs,
            "patience": args.patience, "batchSize": args.batch_size,
            "learningRate": args.learning_rate, "maxSecondsPerRun": args.max_seconds,
            "threads": args.threads, "weightDecay": .0001, "augmentation": "none",
            "checkpointMetric": "validation macro recall; tie lower validation loss",
            "normalizationFit": "training-only; same masking and preprocessing for both controls",
            "finalTestEvaluated": False, "promoted": False, "acceptanceEnabled": False,
            "distributionStatus": "local-research-only",
            "limits": ["Training and validation comparison only; not a frozen graph-study amendment",
                       "No dataset, webcam or fluent-signer accuracy measured by this command's existence",
                       "No sentence translation, sign synthesis, browser/device verification or release approval",
                       "Labels require independent fluent-signer review; supplied names are not ground truth",
                       "Feature timing is frame-index resampling; no facial mesh or depth features"]}


def run_experiment(args):
    if args.output.exists() and (not args.output.is_dir() or any(args.output.iterdir())):
        raise ValueError("Use a fresh output directory; never overwrite an experiment")
    metadata_path = args.data.with_suffix(".metadata.json")
    data_hash, metadata_hash = sha256(args.data), sha256(metadata_path)
    labels, metadata, arrays, normalization, _legacy = load_data(args.data, args.language, None)
    if metadata.get("labels") != labels:
        raise ValueError("Prepared metadata must preserve the exact vocabulary label order")
    signers = validate_learning_signers(args.data, arrays)
    if sha256(args.data) != data_hash or sha256(metadata_path) != metadata_hash:
        raise ValueError("Prepared sources changed while validating the comparison")
    experiment = experiment_record(args, labels, data_hash, metadata_hash, signers)
    args.output.mkdir(parents=True, exist_ok=True)
    experiment_path = args.output / "experiment.json"
    write_json(experiment_path, experiment)
    experiment_hash = sha256(experiment_path)
    for architecture in TEMPORAL_CONTROL_ARCHITECTURES:
        for seed in SEEDS:
            train_run(args, architecture, seed, args.output / f"{architecture}-seed{seed}", labels,
                      metadata, arrays, normalization, None, data_hash, experiment_hash,
                      experiment_kind=TEMPORAL_EXPERIMENT_KIND)
    return experiment


if __name__ == "__main__":
    run_experiment(parse_args())
