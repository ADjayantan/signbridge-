"""Bounded preregistered CPU model comparison, using validation only.

This command never predicts on final test arrays. Checkpoints and validation
probabilities are local research files; promotion/evaluation is a separate step.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from graph_models import ARCHITECTURES, GRAPH_CONFIG, SignGraphModel


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def predict(model, x, batch=64):
    model.eval()
    parts = []
    with torch.no_grad():
        for start in range(0, len(x), batch):
            parts.append(model(x[start:start + batch]).softmax(-1).numpy())
    return np.concatenate(parts) if parts else np.empty((0, model.classes), dtype=np.float32)


def validation_score(scores, targets, classes):
    predicted = scores.argmax(1)
    present = [i for i in range(classes) if np.any(targets == i)]
    recall = float(np.mean([np.mean(predicted[targets == i] == i) for i in present]))
    loss = float(-np.log(np.maximum(scores[np.arange(len(targets)), targets], 1e-12)).mean())
    return recall, loss


def check_features(raw, mask):
    if raw.ndim != 4 or raw.shape[1:] != (32, 75, 3) or mask.shape != raw.shape[:3]:
        raise ValueError("Graph features or mask shape mismatch")
    if not np.isfinite(raw).all() or not np.array_equal(mask, raw[..., 2] >= .5):
        raise ValueError("Nonfinite graph features or invalid confidence mask")
    if np.any(raw[~mask] != 0) or np.any(raw[..., 2] < 0) or np.any(raw[..., 2] > 1):
        raise ValueError("Missing observations must be zero and confidence bounded")
    if not len(raw) or np.any(mask.sum(axis=(1, 2)) == 0):
        raise ValueError("Empty or completely invalid learning split")


def load_data(data_path, language, legacy_path):
    from pose_graph import CONTRACT_ID, adjacency_hash, contract_hash, fit_normalization
    metadata = json.loads(data_path.with_suffix(".metadata.json").read_text(encoding="utf-8"))
    if metadata.get("language", metadata.get("signLanguage")) != language:
        raise ValueError("Graph dataset language mismatch")
    if metadata.get("featureContract") != CONTRACT_ID or metadata.get("contractHash") != contract_hash() or metadata.get("adjacencyHash") != adjacency_hash() or metadata.get("featuresStandardized") is not False:
        raise ValueError("Prepared graph contract/hash/normalization stage mismatch")
    arrays = {}
    with np.load(data_path, allow_pickle=False) as data:
        labels = data["labels"].tolist()
        if not 2 <= len(labels) <= 500 or len(set(labels)) != len(labels) or any(not isinstance(label, str) or not 1 <= len(label) <= 80 or label != label.strip() for label in labels):
            raise ValueError("Invalid labels")
        for split in ("train", "val", "unknown_validation"):
            raw = data[f"X_{split}"].astype(np.float32)
            mask = data[f"mask_{split}"]
            if mask.dtype.kind != "b":
                raise ValueError("Graph masks must be stored as boolean observations")
            check_features(raw, mask)
            ids = data[f"clip_ids_{split}"].tolist()
            if len(set(ids)) != len(ids) or len(ids) != len(raw):
                raise ValueError("Invalid clip identity array")
            arrays[split] = {"features": raw, "mask": mask, "ids": ids}
            if split != "unknown_validation":
                y = data[f"y_{split}"].astype(np.int64)
                if y.shape != (len(raw),) or set(y.tolist()) != set(range(len(labels))):
                    raise ValueError("Every known class needs valid split targets")
                arrays[split]["targets"] = y
    sets = [set(value["ids"]) for value in arrays.values()]
    if any(a & b for i, a in enumerate(sets) for b in sets[i + 1:]):
        raise ValueError("Training/validation clip leakage")
    norm = fit_normalization(arrays["train"]["features"], arrays["train"]["mask"])
    recorded = metadata.get("normalization", {})
    if recorded.get("fitSplit") != "train" or recorded.get("stage") != "model" or any(not np.array_equal(np.asarray(norm[key]), np.asarray(recorded.get(key))) for key in ("mean", "std", "validCounts")):
        raise ValueError("Recorded normalization does not reproduce from training only")
    legacy_norm = None
    if legacy_path is not None:
        with np.load(legacy_path, allow_pickle=False) as legacy:
            if legacy["labels"].tolist() != labels:
                raise ValueError("Legacy and graph vocabularies differ")
            for split, value in arrays.items():
                index = {identity: i for i, identity in enumerate(legacy[f"clip_ids_{split}"].tolist())}
                if any(identity not in index for identity in value["ids"]):
                    raise ValueError("A compared graph clip is absent from the legacy control")
                selected = np.asarray([index[identity] for identity in value["ids"]])
                raw = legacy[f"X_{split}"][selected].astype(np.float32)
                if raw.shape != (len(value["ids"]), 32, 81) or not np.isfinite(raw).all():
                    raise ValueError("Invalid legacy control features")
                if split != "unknown_validation" and not np.array_equal(legacy[f"y_{split}"][selected], value["targets"]):
                    raise ValueError("Legacy targets do not match the comparison")
                value["legacy"] = raw
        legacy_norm = {
            "mean": arrays["train"]["legacy"].mean(axis=(0, 1)).tolist(),
            "std": np.maximum(arrays["train"]["legacy"].std(axis=(0, 1)), .05).tolist(),
            "stage": "model", "fitSplit": "train", "contract": "signbridge-pose27-xyc-v1",
        }
    return labels, metadata, arrays, norm, legacy_norm


def train_run(args, architecture, seed, output, labels, metadata, arrays, norm, legacy_norm, data_hash, experiment_hash):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    normalization = legacy_norm if architecture == "gru27" else norm
    model = SignGraphModel(len(labels), architecture, normalization["mean"], normalization["std"])
    parameters = sum(p.numel() for p in model.parameters())
    if parameters >= 500000:
        raise ValueError("Candidate exceeds preregistered parameter budget")
    feature_key = "legacy" if architecture == "gru27" else "features"
    x = {split: torch.from_numpy(value[feature_key]) for split, value in arrays.items()}
    y = torch.from_numpy(arrays["train"]["targets"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=.0001)
    criterion = nn.CrossEntropyLoss()
    best = None; best_recall = -1.; best_loss = float("inf"); best_epoch = 0; stale = 0
    history = []; started = time.perf_counter(); stop = "epoch-ceiling"
    output.mkdir(parents=True, exist_ok=False)
    print(json.dumps({"event": "start", "language": args.language, "architecture": architecture, "seed": seed,
        "train": len(y), "validation": len(x["val"]), "parameters": parameters}), flush=True)
    for epoch in range(1, args.epochs + 1):
        epoch_started = time.perf_counter(); model.train(); order = torch.randperm(len(y)); total = 0.
        for indices in order.split(args.batch_size):
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(x["train"][indices]), y[indices])
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 5); optimizer.step()
            total += float(loss.detach()) * len(indices)
        scores = predict(model, x["val"], args.batch_size)
        recall, loss = validation_score(scores, arrays["val"]["targets"], len(labels))
        if recall > best_recall or (recall == best_recall and loss < best_loss):
            best_recall, best_loss, best_epoch, stale = recall, loss, epoch, 0
            best = copy.deepcopy(model.state_dict())
        else:
            stale += 1
        row = {"epoch": epoch, "trainingLoss": total / len(y), "validationMacroRecall": recall,
            "validationLoss": loss, "seconds": time.perf_counter() - epoch_started, "bestEpoch": best_epoch}
        history.append(row)
        if epoch == 1 or epoch % 10 == 0:
            print(json.dumps({"event": "epoch", "architecture": architecture, "seed": seed, **row}), flush=True)
        if epoch >= args.minimum_epochs and stale >= args.patience:
            stop = "validation-early-stop"; break
        if time.perf_counter() - started >= args.max_seconds:
            stop = "wall-clock-budget"; break
    training_seconds = time.perf_counter() - started
    model.load_state_dict(best)
    scores_val = predict(model, x["val"], args.batch_size)
    scores_unknown = predict(model, x["unknown_validation"], args.batch_size)
    weights_path = output / "checkpoint.pt"
    torch.save(model.state_dict(), weights_path)
    np.savez_compressed(output / "validation-predictions.npz", scores=scores_val,
        targets=arrays["val"]["targets"], unknown_scores=scores_unknown,
        clip_ids=np.asarray(arrays["val"]["ids"]), unknown_clip_ids=np.asarray(arrays["unknown_validation"]["ids"]))
    report = {
        "format": "signbridge-graph-training-v1", "task": "experimental isolated-word recognition",
        "signLanguage": args.language, "language": args.language, "architecture": architecture, "seed": seed,
        "graphConfig": GRAPH_CONFIG if architecture == "stgcn" else None,
        "labels": labels, "parameters": parameters, "normalization": normalization,
        "inputShape": [1, 32, 81] if architecture == "gru27" else [1, 32, 75, 3],
        "featureContract": "signbridge-pose27-xyc-v1" if architecture == "gru27" else "signbridge-pose75-xyc-v1",
        "dataSha256": data_hash, "experimentSha256": experiment_hash,
        "weightsSha256": sha256(weights_path), "epochsRun": epoch, "bestEpoch": best_epoch,
        "checkpoint": str(weights_path.resolve()), "checkpoint_path": str(weights_path.resolve()),
        "checkpoint_sha256": sha256(weights_path), "prepared_data": str((args.data or Path(__file__).resolve().parents[1] / ".training-data" / "graph-v1" / args.language / f"{args.language}.npz").resolve()),
        "prepared_data_sha256": data_hash, "best_epoch": best_epoch, "epochs": epoch,
        "training_seconds": training_seconds, "parameter_count": parameters,
        "bestValidationMacroRecall": best_recall, "bestValidationLoss": best_loss,
        "trainingSeconds": training_seconds, "stopReason": stop,
        "counts": {name: len(value["ids"]) for name, value in arrays.items()},
        "budget": {"epochs": args.epochs, "minimumEpochs": args.minimum_epochs, "patience": args.patience,
            "batchSize": args.batch_size, "learningRate": args.learning_rate, "weightDecay": .0001,
            "maxSeconds": args.max_seconds, "threads": args.threads},
        "versions": {"torch": torch.__version__, "numpy": np.__version__}, "device": "cpu",
        "history": history, "source": metadata,
        "finalTestEvaluated": False, "distributionStatus": "local-research-only",
        "limits": ["No sentence translation", "No live or fluent-user accuracy established",
            "No face or depth features", "Previously inspected benchmark is not a newly untouched test"],
    }
    write_json(output / "run.json", report)
    print(json.dumps({"event": "complete", "run": str(output), "architecture": architecture, "seed": seed,
        "bestEpoch": best_epoch, "validationMacroRecall": best_recall, "seconds": training_seconds}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=("isl", "asl"), required=True)
    parser.add_argument("--data", type=Path)
    parser.add_argument("--legacy-data", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", nargs="+", choices=ARCHITECTURES, default=list(ARCHITECTURES))
    parser.add_argument("--seeds", nargs="+", type=int, default=[42, 43, 44])
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--minimum-epochs", type=int, default=20)
    parser.add_argument("--patience", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=.002)
    parser.add_argument("--max-seconds", type=float, default=1200)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.epochs <= 1000 or not 1 <= args.minimum_epochs <= args.epochs or not 1 <= args.patience <= 1000:
        parser.error("Invalid epoch/patience bounds")
    if not 1 <= args.batch_size <= 512 or not 1 <= args.threads <= 16 or not 1 <= args.max_seconds <= 86400 or not 0 < args.learning_rate <= .1:
        parser.error("Invalid batch/thread/time/learning-rate bounds")
    if len(set(args.models)) != len(args.models) or len(set(args.seeds)) != len(args.seeds):
        parser.error("Duplicate architectures or seeds")
    root = Path(__file__).resolve().parents[1]
    data = args.data or root / ".training-data" / "graph-v1" / args.language / f"{args.language}.npz"
    legacy = args.legacy_data or root / ".training-data" / "prepared" / f"{args.language}.npz"
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("Use a fresh output directory; never overwrite a frozen experiment")
    labels, metadata, arrays, normalization, legacy_normalization = load_data(data, args.language, legacy if "gru27" in args.models else None)
    args.output.mkdir(parents=True, exist_ok=True)
    experiment = {"format": "signbridge-graph-experiment-v1", "signLanguage": args.language,
        "models": args.models, "seeds": args.seeds, "epochs": args.epochs,
        "minimumEpochs": args.minimum_epochs, "patience": args.patience,
        "batchSize": args.batch_size, "learningRate": args.learning_rate,
        "maxSecondsPerRun": args.max_seconds, "dataSha256": sha256(data),
        "legacyDataSha256": sha256(legacy) if "gru27" in args.models else None,
        "augmentation": "none", "checkpointMetric": "validation macro recall; tie lower validation loss",
        "graphConfig": GRAPH_CONFIG if "stgcn" in args.models else None,
        "normalizationFit": "training-only", "finalTestEvaluated": False}
    experiment_path = args.output / "experiment.json"; write_json(experiment_path, experiment)
    digest = sha256(experiment_path)
    for architecture in args.models:
        for seed in args.seeds:
            train_run(args, architecture, seed, args.output / f"{architecture}-seed{seed}", labels, metadata,
                arrays, normalization, legacy_normalization, experiment["dataSha256"], digest)


if __name__ == "__main__":
    main()
