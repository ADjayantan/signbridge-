"""Validation-only calibration and aggregate reports for the frozen graph study."""
import argparse
import json
import math
from pathlib import Path

import numpy as np


def rate(n, total):
    return float(n / total) if total else None


def wilson(n, total):
    if not total:
        return None
    z = 1.959963984540054
    p = n / total
    d = 1 + z * z / total
    center = (p + z * z / (2 * total)) / d
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return [max(0., center - half), min(1., center + half)]


def validate_scores(scores, classes=None):
    scores = np.asarray(scores)
    if scores.ndim != 2 or scores.shape[1] < 2 or (classes is not None and scores.shape[1] != classes):
        raise ValueError('Probability matrix dimensions do not match the vocabulary')
    if not np.isfinite(scores).all() or np.any(scores < 0) or np.any(scores > 1) or not np.allclose(scores.sum(1), 1, atol=1e-4, rtol=0):
        raise ValueError('Invalid probabilities')
    return scores


def accepted(scores, threshold, margin, enabled=True):
    if not enabled:
        return np.zeros(len(scores), dtype=bool)
    ordered = np.sort(scores, axis=1)
    return (ordered[:, -1] >= threshold) & (ordered[:, -1] - ordered[:, -2] >= margin)


def metrics(scores, targets, unknown, threshold, margin, enabled=True):
    scores = validate_scores(scores)
    unknown = validate_scores(unknown, scores.shape[1])
    targets = np.asarray(targets)
    if targets.ndim != 1 or len(targets) != len(scores) or targets.dtype.kind not in 'iu' or np.any(targets < 0) or np.any(targets >= scores.shape[1]):
        raise ValueError('Invalid labelled targets')
    predictions = scores.argmax(1)
    correct = predictions == targets
    take = accepted(scores, threshold, margin, enabled)
    unknown_take = accepted(unknown, threshold, margin, enabled)
    ac, aw, uf = int((take & correct).sum()), int((take & ~correct).sum()), int(unknown_take.sum())
    recalls = [float(correct[targets == i].mean()) for i in range(scores.shape[1]) if np.any(targets == i)]
    return {
        'known_count': len(scores), 'unknown_count': len(unknown), 'top1_correct': int(correct.sum()),
        'top1_accuracy': rate(int(correct.sum()), len(scores)), 'macro_recall': float(np.mean(recalls)) if recalls else None,
        'accepted_correct': ac, 'accepted_wrong': aw, 'known_rejected': int((~take).sum()), 'unknown_false_accepts': uf,
        'known_accepted_precision': rate(ac, ac + aw), 'correct_known_coverage': rate(ac, len(scores)), 'unknown_false_accept_rate': rate(uf, len(unknown)),
        'mixture_precision': rate(ac, ac + aw + uf), 'mixture': 'All supplied known examples plus all supplied unknown-sign examples; nonsigning camera negatives not yet collected',
        'wilson95': {'known_precision': wilson(ac, ac + aw), 'correct_coverage': wilson(ac, len(scores)), 'unknown_false_accept_rate': wilson(uf, len(unknown)), 'mixture_precision': wilson(ac, ac + aw + uf)},
    }


def calibrate(scores, targets, unknown):
    candidates = []
    for threshold_i in range(50, 100):
        for margin_i in range(5, 51, 5):
            threshold, margin = threshold_i / 100, margin_i / 100
            m = metrics(scores, targets, unknown, threshold, margin)
            precision, far = m['known_accepted_precision'], m['unknown_false_accept_rate']
            if precision is not None and far is not None and precision >= .95 and far <= .05:
                candidates.append((m['accepted_correct'], -m['accepted_wrong'], -m['unknown_false_accepts'], threshold, margin))
    if not candidates:
        threshold, margin, enabled = .99, .5, False
    else:
        _, _, _, threshold, margin = max(candidates)
        enabled = True
    m = metrics(scores, targets, unknown, threshold, margin, enabled)
    return {'threshold': threshold, 'margin': margin, 'acceptanceEnabled': enabled, 'screen_passed': bool(enabled and m['correct_known_coverage'] is not None and m['correct_known_coverage'] >= .6), 'metrics': m}


def per_word(scores, targets, threshold, margin, labels, enabled=True):
    predictions = scores.argmax(1)
    take = accepted(scores, threshold, margin, enabled)
    rows = []
    for i, label in enumerate(labels):
        mask = targets == i
        confusion = np.bincount(predictions[mask & (predictions != i)], minlength=len(labels))
        rows.append({'label': label, 'count': int(mask.sum()), 'top1_correct': int((mask & (predictions == i)).sum()), 'accepted_correct': int((mask & take & (predictions == i)).sum()), 'accepted_wrong': int((mask & take & (predictions != i)).sum()), 'most_common_wrong': labels[int(confusion.argmax())] if confusion.max(initial=0) else None})
    return rows


def calibrate_run(run_dir):
    output = run_dir / 'calibration.json'
    if output.exists():
        return json.loads(output.read_text(encoding='utf-8'))
    with np.load(run_dir / 'validation-predictions.npz', allow_pickle=False) as data:
        result = calibrate(data['scores'], data['targets'], data['unknown_scores'])
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-dir', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(calibrate_run(args.run_dir), allow_nan=False))
