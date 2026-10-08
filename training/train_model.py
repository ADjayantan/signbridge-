"""Train a small isolated-word GRU on real, split-labelled pose recordings.

The held-out test set is never used for normalization, early stopping or rejection
calibration. This is an experimental word classifier, not sentence translation.
"""
import argparse
import copy
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

JOINTS = [0, 2, 5, 11, 12, 13, 14, 33, 37, 38, 41, 42, 45, 46, 49, 50, 53, 54, 58, 59, 62, 63, 66, 67, 70, 71, 74]


class SignGRU(nn.Module):
    def __init__(self, classes, hidden=64):
        super().__init__()
        self.gru = nn.GRU(81, hidden, batch_first=True)
        self.dropout = nn.Dropout(.15)
        self.head = nn.Linear(hidden, classes)

    def forward(self, x):
        _, h = self.gru(x)
        return self.head(self.dropout(h[-1]))


def probabilities(model, x, batch=128):
    model.eval()
    parts = []
    with torch.no_grad():
        for start in range(0, len(x), batch):
            parts.append(model(x[start:start + batch]).softmax(-1).cpu().numpy())
    return np.concatenate(parts) if parts else np.empty((0, model.head.out_features), dtype=np.float32)


def acceptance(scores, threshold, margin):
    if not len(scores):
        return np.zeros(0, dtype=bool)
    ordered = np.sort(scores, axis=1)
    return (ordered[:, -1] >= threshold) & (ordered[:, -1] - ordered[:, -2] >= margin)


def metrics(scores, targets, unknown_scores, threshold, margin, enabled=True):
    take = acceptance(scores, threshold, margin) if enabled else np.zeros(len(scores), dtype=bool)
    pred = scores.argmax(1)
    correct = pred == targets
    top5 = np.argsort(scores, axis=1)[:, -min(5, scores.shape[1]):]
    unknown_take = acceptance(unknown_scores, threshold, margin) if enabled else np.zeros(len(unknown_scores), dtype=bool)
    return {
        "clips": len(targets), "top1_correct": int(correct.sum()),
        "top1_accuracy": round(float(correct.mean()), 4) if len(targets) else None,
        "top5_accuracy": round(float((top5 == targets[:, None]).any(1).mean()), 4) if len(targets) else None,
        "accepted_correct": int((take & correct).sum()),
        "accepted_incorrect": int((take & ~correct).sum()), "rejected": int((~take).sum()),
        "unknown_clips": len(unknown_scores), "unknown_false_accepts": int(unknown_take.sum()),
        "unknown_false_accept_rate": round(float(unknown_take.mean()), 4) if len(unknown_scores) else None,
    }


def calibrate(scores, targets, unknown_scores):
    candidates = []
    for threshold in [.5, .55, .6, .65, .7, .75, .8, .85, .9, .95, .98]:
        for margin in [.05, .1, .15, .2, .3]:
            m = metrics(scores, targets, unknown_scores, threshold, margin)
            if m["unknown_clips"] and m["unknown_false_accepts"] <= .1 * m["unknown_clips"]:
                # Keep validation errors costly; calibrate only on validation recordings.
                utility = m["accepted_correct"] - 3 * m["accepted_incorrect"]
                candidates.append((utility, m["accepted_correct"], threshold, margin))
    if not candidates:
        return .98, .3, False
    _, _, threshold, margin = max(candidates)
    return threshold, margin, True


def validate_prepared(dataset, metadata, language):
    if metadata.get("language") != language or metadata.get("signLanguage", language) != language:
        raise ValueError("Prepared data language does not match the requested model")
    config = metadata.get("preprocessing", {})
    if config.get("contract") != "signbridge-pose27-xyc-v1" or config.get("frames") != 32 or config.get("joints") != JOINTS or config.get("mirroring") is not False:
        raise ValueError("Prepared feature configuration does not match inference")
    labels = dataset["labels"].tolist()
    if len(labels) < 2 or len(labels) > 500 or len(labels) != len(set(labels)) or any(not isinstance(s, str) or not 1 <= len(s) <= 80 or s != s.strip() for s in labels):
        raise ValueError("Invalid sign labels")
    ids = {}
    for split in ["train", "val", "test", "unknown_validation", "unknown_test"]:
        raw = dataset[f"X_{split}"]
        clip_array = dataset[f"clip_ids_{split}"]
        if clip_array.ndim != 1:
            raise ValueError(f"Invalid clip IDs: {split}")
        clip_ids = clip_array.tolist()
        if raw.ndim != 3 or raw.shape[1:] != (32, 81) or not np.isfinite(raw).all():
            raise ValueError(f"Invalid pose array: {split}")
        if not len(raw) or len(clip_ids) != len(raw) or any(not isinstance(i, str) or not i.strip() for i in clip_ids) or len(set(clip_ids)) != len(clip_ids):
            raise ValueError(f"Missing or duplicate clip IDs: {split}")
        ids[split] = set(clip_ids)
        if split in ["train", "val", "test"]:
            y = dataset[f"y_{split}"]
            if y.ndim != 1 or len(y) != len(raw) or not np.issubdtype(y.dtype, np.integer) or set(y.tolist()) != set(range(len(labels))):
                raise ValueError(f"Every class needs valid labelled recordings in {split}")
    names = list(ids)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if ids[a] & ids[b]:
                raise ValueError(f"Clip leakage between {a} and {b}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--language", choices=["isl", "asl"], required=True)
    p.add_argument("--data", type=Path)
    p.add_argument("--epochs", type=int, default=160)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    if not 1 <= args.epochs <= 1000 or not 8 <= args.hidden <= 128:
        p.error("epochs must be 1..1000 and hidden size 8..128")
    root = Path(__file__).resolve().parents[1]
    data_path = args.data or root / ".training-data" / "prepared" / f"{args.language}.npz"
    out = args.output or root / "public" / "models" / f"{args.language}.json"
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    dataset = np.load(data_path, allow_pickle=False)
    meta_path = data_path.with_suffix(".metadata.json")
    source = json.loads(meta_path.read_text(encoding="utf-8"))
    validate_prepared(dataset, source, args.language)
    labels = dataset["labels"].tolist()
    if len(labels) < 2:
        raise ValueError("At least two real sign classes are required")
    train_raw = dataset["X_train"].astype(np.float32)
    mean = train_raw.mean(axis=(0, 1))
    std = np.maximum(train_raw.std(axis=(0, 1)), .05)
    def normalized(key):
        raw = dataset[key].astype(np.float32)
        if raw.ndim != 3 or raw.shape[1:] != (32, 81) or not np.isfinite(raw).all():
            raise ValueError(f"Invalid pose array: {key}")
        return torch.from_numpy((raw - mean) / std)
    X = {split: normalized(f"X_{split}") for split in ["train", "val", "test"]}
    Y = {split: dataset[f"y_{split}"].astype(np.int64) for split in X}
    for split in X:
        if not len(X[split]) or len(X[split]) != len(Y[split]):
            raise ValueError(f"Missing or invalid {split} recordings")
    # Clip identifiers must not overlap between any learning/evaluation split.
    ids = {split: set(dataset[f"clip_ids_{split}"].tolist()) for split in X}
    if ids["train"] & ids["val"] or ids["train"] & ids["test"] or ids["val"] & ids["test"]:
        raise ValueError("Clip leakage between splits")
    unknown = {"val": normalized("X_unknown_validation"), "test": normalized("X_unknown_test")}
    model = SignGRU(len(labels), args.hidden)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.002, weight_decay=.0001)
    loss_fn = nn.CrossEntropyLoss()
    y_train = torch.from_numpy(Y["train"])
    best, best_score, best_epoch, stale = None, -1, 0, 0
    started = time.perf_counter()
    print(json.dumps({"language": args.language, "classes": len(labels), "train": len(X["train"]), "val": len(X["val"]), "test": len(X["test"]), "device": "cpu", "seed": args.seed}), flush=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = torch.randperm(len(X["train"]))
        total = 0.
        for indices in order.split(64):
            optimizer.zero_grad()
            logits = model(X["train"][indices])
            loss = loss_fn(logits, y_train[indices])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5)
            optimizer.step()
            total += loss.item() * len(indices)
        scores = probabilities(model, X["val"])
        predicted = scores.argmax(1)
        # Macro recall avoids rewarding only common classes.
        recall = np.mean([np.mean(predicted[Y["val"] == i] == i) for i in range(len(labels)) if np.any(Y["val"] == i)])
        if recall > best_score:
            best_score, best_epoch, stale = float(recall), epoch, 0
            best = copy.deepcopy(model.state_dict())
        else:
            stale += 1
        if epoch == 1 or epoch % 10 == 0:
            print(json.dumps({"epoch": epoch, "loss": round(total / len(order), 4), "val_macro_recall": round(float(recall), 4), "best_epoch": best_epoch}), flush=True)
        if epoch >= 40 and stale >= 35:
            break
    model.load_state_dict(best)
    val = probabilities(model, X["val"])
    unknown_val = probabilities(model, unknown["val"])
    threshold, margin, enabled = calibrate(val, Y["val"], unknown_val)
    test = probabilities(model, X["test"])
    unknown_test = probabilities(model, unknown["test"])
    report = {
        "task": "experimental isolated-word recognition", "signLanguage": args.language,
        "seed": args.seed, "architecture": "one-layer GRU64 + linear head" if args.hidden == 64 else f"one-layer GRU{args.hidden} + linear head",
        "device": "cpu", "torch": torch.__version__, "epochs_run": epoch, "best_epoch": best_epoch,
        "training_seconds": round(time.perf_counter() - started, 2),
        "classes": len(labels), "labels": labels,
        "train_clips": len(X["train"]), "validation": metrics(val, Y["val"], unknown_val, threshold, margin, enabled),
        "test": metrics(test, Y["test"], unknown_test, threshold, margin, enabled),
        "threshold": threshold, "margin": margin, "acceptanceEnabled": enabled, "source": source,
        "limits": ["Not continuous sentence translation", "No live laptop signing accuracy measured", "Body/hand landmarks only; no facial grammar", "Dataset splits do not establish signer-independent generalization"],
    }
    # JSON avoids executing serialized Python model objects in the web app.
    def values(tensor):
        return np.round(tensor.detach().cpu().numpy().astype(np.float64), 7).tolist()
    state = model.state_dict()
    weights = {key: values(state[f"gru.{key}"]) for key in ["weight_ih_l0", "weight_hh_l0", "bias_ih_l0", "bias_hh_l0"]}
    weights["head_weight"] = values(state["head.weight"])
    weights["head_bias"] = values(state["head.bias"])
    artifact = {"format": "signbridge-gru-v1", "signLanguage": args.language, "labels": labels, "frames": 32,
        "inputSize": 81, "hiddenSize": args.hidden, "joints": JOINTS,
        "mean": values(torch.from_numpy(mean)), "std": values(torch.from_numpy(std)),
        "threshold": threshold, "margin": margin, "acceptanceEnabled": enabled, "weights": weights, "metrics": report}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(artifact, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    report_dir = root / "training" / "artifacts"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"{args.language}-metrics.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    # Genuine held-out fixture checks PyTorch ↔ browser GRU/standardization parity.
    raw_fixture = dataset["X_test"][:3].tolist()
    parity = {"signLanguage": args.language, "features": raw_fixture, "probabilities": test[:3].tolist()}
    (report_dir / f"{args.language}-parity.json").write_text(json.dumps(parity), encoding="utf-8")
    print(json.dumps({"artifact": str(out), "best_epoch": best_epoch, "test": report["test"], "threshold": threshold, "margin": margin}), flush=True)


if __name__ == "__main__":
    main()
