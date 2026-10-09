"""Evaluate existing local weights on every prepared held-out recording.

Runs the actual JavaScript inference implementation and verifies its output against
the same exported weights in PyTorch. Never trains, downloads, or changes models.
Only aggregate reports are written; raw pose data/model weights stay local.
"""
import argparse
import csv
import hashlib
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

from train_model import SignGRU, acceptance, probabilities, validate_prepared


NODE_EVALUATOR = r"""
import { readFileSync } from 'node:fs';
import { predictFeatureProbabilities, validateTrainedModel } from './src/lib/trainedSignModel.js';
const input = JSON.parse(readFileSync(0, 'utf8'));
validateTrainedModel(input.model, input.language);
const scores = input.features.map(features => predictFeatureProbabilities(input.model, features));
process.stdout.write(JSON.stringify(scores));
"""


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rate(numerator, denominator):
    return numerator / denominator if denominator else None


def most_common(counter):
    return counter.most_common(1)[0] if counter else ("", 0)


def evaluate(root, language):
    paths = {
        "model": root / "public" / "models" / f"{language}.json",
        "prepared_data": root / ".training-data" / "prepared" / f"{language}.npz",
        "prepared_metadata": root / ".training-data" / "prepared" / f"{language}.metadata.json",
    }
    before = {name: file_hash(path) for name, path in paths.items()}
    artifact = json.loads(paths["model"].read_text(encoding="utf-8"))
    metadata = json.loads(paths["prepared_metadata"].read_text(encoding="utf-8"))
    with np.load(paths["prepared_data"], allow_pickle=False) as dataset:
        validate_prepared(dataset, metadata, language)
        labels = dataset["labels"].tolist()
        if artifact["labels"] != labels:
            raise ValueError(f"{language}: artifact label order differs from prepared targets")
        known = dataset["X_test"].astype(np.float32)
        unknown = dataset["X_unknown_test"].astype(np.float32)
        targets = dataset["y_test"].astype(np.int64)
        unknown_labels = dataset["source_labels_unknown_test"].tolist()
        train_counts = Counter(dataset["y_train"].tolist())
        val_counts = Counter(dataset["y_val"].tolist())
        train_signers = {int(s) for s in dataset["signer_ids_train"] if int(s) >= 0}
        test_signers = {int(s) for s in dataset["signer_ids_test"] if int(s) >= 0}
    features = np.concatenate([known, unknown])
    payload = {"language": language, "model": artifact, "features": features.tolist()}
    result = subprocess.run(
        ["node", "--input-type=module", "-e", NODE_EVALUATOR], cwd=root,
        input=json.dumps(payload, allow_nan=False, separators=(",", ":")),
        text=True, capture_output=True, check=True, timeout=120,
    )
    browser = np.asarray(json.loads(result.stdout), dtype=np.float64)
    if browser.shape != (len(features), len(labels)) or not np.isfinite(browser).all():
        raise ValueError("Browser inference returned invalid probabilities")
    if not np.allclose(browser.sum(axis=1), 1, atol=1e-10, rtol=0):
        raise ValueError("Browser probabilities do not sum to one")

    # Load numeric exported weights only. No checkpoints/pickles or training loop.
    # JavaScript evaluates JSON numbers in float64. Matching that arithmetic
    # isolates implementation correctness from ordinary float32 rounding drift.
    model = SignGRU(len(labels), artifact["hiddenSize"]).double()
    state = {
        f"gru.{name}": torch.tensor(artifact["weights"][name], dtype=torch.float64)
        for name in ["weight_ih_l0", "weight_hh_l0", "bias_ih_l0", "bias_hh_l0"]
    }
    state.update({
        "head.weight": torch.tensor(artifact["weights"]["head_weight"], dtype=torch.float64),
        "head.bias": torch.tensor(artifact["weights"]["head_bias"], dtype=torch.float64),
    })
    model.load_state_dict(state)
    normalized = (features.astype(np.float64) - np.asarray(artifact["mean"], dtype=np.float64)) / np.asarray(artifact["std"], dtype=np.float64)
    torch_scores = probabilities(model, torch.from_numpy(normalized))
    maximum_error = float(np.max(np.abs(browser - torch_scores)))
    if maximum_error > 1e-10 or not np.array_equal(browser.argmax(1), torch_scores.argmax(1)):
        raise ValueError(f"Full-held-out browser/PyTorch parity failed: maximum error {maximum_error}")
    enabled = artifact.get("acceptanceEnabled", True)
    takes = acceptance(browser, artifact["threshold"], artifact["margin"]) if enabled else np.zeros(len(features), dtype=bool)
    torch_takes = acceptance(torch_scores, artifact["threshold"], artifact["margin"]) if enabled else np.zeros(len(features), dtype=bool)
    if not np.array_equal(takes, torch_takes):
        raise ValueError("Full-held-out browser/PyTorch acceptance decisions differ")
    float32_normalized = (features - np.asarray(artifact["mean"], dtype=np.float32)) / np.asarray(artifact["std"], dtype=np.float32)
    float32_scores = probabilities(model.float(), torch.from_numpy(float32_normalized))
    float32_error = float(np.max(np.abs(browser - float32_scores)))
    float32_takes = acceptance(float32_scores, artifact["threshold"], artifact["margin"]) if enabled else np.zeros(len(features), dtype=bool)
    if not np.array_equal(browser.argmax(1), float32_scores.argmax(1)) or not np.array_equal(takes, float32_takes):
        raise ValueError("Browser/float32 decisions differ; inspect boundary predictions")
    scores, unknown_scores = browser[:len(known)], browser[len(known):]
    take, unknown_take = takes[:len(known)], takes[len(known):]
    predicted = scores.argmax(1)
    unknown_predicted = unknown_scores.argmax(1)
    correct = predicted == targets
    top5 = (np.argsort(scores, axis=1)[:, -min(5, len(labels)):] == targets[:, None]).any(1)
    words = []
    for index, label in enumerate(labels):
        selected = targets == index
        count = int(selected.sum())
        accepted_correct = int((selected & take & correct).sum())
        accepted_wrong = int((selected & take & ~correct).sum())
        confusion, confusion_count = most_common(Counter(labels[int(p)] for p in predicted[selected & ~correct]))
        words.append({
            "language": language, "label": label, "train_samples": train_counts[index],
            "validation_samples": val_counts[index], "test_samples": count,
            "top1_correct": int((selected & correct).sum()), "top1_wrong": int((selected & ~correct).sum()),
            "top1_accuracy": rate(int((selected & correct).sum()), count),
            "top5_correct": int((selected & top5).sum()),
            "accepted_correct": accepted_correct, "accepted_wrong": accepted_wrong,
            "rejected": int((selected & ~take).sum()),
            "acceptance_rate": rate(accepted_correct + accepted_wrong, count),
            "accepted_precision": rate(accepted_correct, accepted_correct + accepted_wrong),
            "accepted_correct_coverage": rate(accepted_correct, count),
            "most_common_wrong_prediction": confusion, "most_common_wrong_count": confusion_count,
        })
    unknown_rows = []
    for label in sorted(set(unknown_labels)):
        selected = np.asarray([source == label for source in unknown_labels])
        count = int(selected.sum())
        false_accepts = int((selected & unknown_take).sum())
        wrong_label, wrong_count = most_common(Counter(labels[int(p)] for p in unknown_predicted[selected & unknown_take]))
        unknown_rows.append({
            "language": language, "source_label": label, "test_samples": count,
            "false_accepts": false_accepts, "false_accept_rate": rate(false_accepts, count),
            "most_common_false_accept_label": wrong_label, "most_common_false_accept_count": wrong_count,
        })
    summary = {
        "language": language, "labels": len(labels), "labels_with_test_samples": sum(w["test_samples"] > 0 for w in words),
        "test_samples_per_word_min": min(w["test_samples"] for w in words),
        "test_samples_per_word_max": max(w["test_samples"] for w in words),
        "known_test_samples": len(known), "top1_correct": int(correct.sum()),
        "top1_accuracy": rate(int(correct.sum()), len(known)), "top5_accuracy": rate(int(top5.sum()), len(known)),
        "accepted_correct": int((take & correct).sum()), "accepted_wrong": int((take & ~correct).sum()),
        "rejected": int((~take).sum()), "acceptance_rate": rate(int(take.sum()), len(known)),
        "accepted_precision": rate(int((take & correct).sum()), int(take.sum())),
        "accepted_correct_coverage": rate(int((take & correct).sum()), len(known)),
        "labels_with_correct_top1": sum(w["top1_correct"] > 0 for w in words),
        "labels_with_correct_acceptance": sum(w["accepted_correct"] > 0 for w in words),
        "distinct_accepted_known_predictions": sorted({labels[int(p)] for p in predicted[take]}),
        "labels_with_no_correct_top1": [w["label"] for w in words if not w["top1_correct"]],
        "labels_with_no_correct_acceptance": [w["label"] for w in words if not w["accepted_correct"]],
        "accepted_wrong_words": [{"label": w["label"], "accepted_wrong": w["accepted_wrong"]} for w in words if w["accepted_wrong"]],
        "unknown_test_samples": len(unknown), "unknown_false_accepts": int(unknown_take.sum()),
        "unknown_false_accept_rate": rate(int(unknown_take.sum()), len(unknown)),
        "threshold": artifact["threshold"], "margin": artifact["margin"], "acceptanceEnabled": enabled,
        "browser_pytorch_parity": {"samples": len(features), "arithmetic": "float64 matching JavaScript numbers", "max_probability_error": maximum_error, "tolerance": 1e-10, "float32_max_probability_error": float32_error, "top1_and_acceptance_identical_in_float32_and_float64": True},
        "signers": {"train_count": len(train_signers), "test_count": len(test_signers), "overlap_count": len(train_signers & test_signers), "unseen_signer_accuracy_established": False},
        "sha256": before,
    }
    after = {name: file_hash(path) for name, path in paths.items()}
    if before != after:
        raise ValueError("An input artifact changed during evaluation")
    summary["inputs_unchanged"] = True
    return summary, words, unknown_rows


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=["both", "isl", "asl"], default="both")
    parser.add_argument("--report-dir", type=Path, required=True, help="New directory; existing reports are never overwritten")
    args = parser.parse_args()
    if args.report_dir.exists():
        parser.error("report-dir already exists; use a new directory")
    root = Path(__file__).resolve().parents[1]
    torch.set_num_threads(4)
    summaries, words, unknown = [], [], []
    for language in (["isl", "asl"] if args.language == "both" else [args.language]):
        summary, word_rows, unknown_rows = evaluate(root, language)
        summaries.append(summary)
        words.extend(word_rows)
        unknown.extend(unknown_rows)
        print(json.dumps(summary, allow_nan=False), flush=True)
    report = {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "All prepared held-out recording features; actual browser inference and unchanged exported weights",
        "limits": ["Not a live-webcam signing test", "Not continuous-sign sentence recognition", "Recording-level splits do not establish unseen-signer accuracy", "Prepared test poses already passed dataset quality gates; raw camera capture is not exercised", "Small per-word test counts are not stable per-word accuracy estimates"],
        "languages": summaries,
    }
    args.report_dir.mkdir(parents=True, exist_ok=False)
    (args.report_dir / "summary.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    write_csv(args.report_dir / "known-words.csv", words)
    write_csv(args.report_dir / "unknown-words.csv", unknown)


if __name__ == "__main__":
    main()
