"""Versioned 75-joint features: raw XYC, explicit validity, model-stage normalization."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

CONTRACT_PATH = Path(__file__).with_name("graph-contract-v1.json")
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
CONTRACT_ID = CONTRACT["id"]
FRAMES, NODES = CONTRACT["frames"], CONTRACT["nodes"]
EDGES = tuple(tuple(edge) for edge in CONTRACT["edges"])
SPLITS = ("train", "val", "test", "unknown_validation", "unknown_test")


def contract_hash():
    return hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest()


def adjacency_hash():
    value = {"nodes": NODES, "edges": EDGES, "selfLoops": True, "undirected": True}
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode("utf-8")).hexdigest()


def adjacency_matrix():
    result = np.eye(NODES, dtype=np.float32)
    for source, destination in EDGES:
        result[source, destination] = result[destination, source] = 1
    return result


def validate_raw_pose(keypoints, confidences):
    for array in (keypoints, confidences):
        if not isinstance(array, np.ndarray) or array.dtype.kind not in "fiu" or not np.isfinite(array).all():
            raise ValueError("Graph poses must contain finite numeric arrays")
    if keypoints.ndim != 3 or keypoints.shape[1:] != (NODES, 3) or not 1 <= len(keypoints) <= CONTRACT["maximumFrames"] or confidences.shape != keypoints.shape[:2]:
        raise ValueError("Expected bounded graph poses [T,75,3] and confidences [T,75]")
    if np.abs(keypoints).max() > CONTRACT["rawCoordinateLimit"]:
        raise ValueError("Raw graph coordinates exceed the contract limit")
    return keypoints.astype(np.float64), np.clip(confidences.astype(np.float64), 0, 1)


def preprocess_pose_graph(keypoints, confidences):
    """Return raw shoulder-normalized [32,75,3] and boolean [32,75] mask.

    Nearest frame-index half-up selects a measured observation, never blends
    missing/valid observations. Timestamps are not synthesized for source clips.
    """
    keypoints, confidences = validate_raw_pose(keypoints, confidences)
    visible = np.maximum(confidences[:, 33], confidences[:, 54]) >= CONTRACT["nodeConfidenceThreshold"]
    indices = np.flatnonzero(visible)
    if len(indices) < CONTRACT["minimumHandFrames"]:
        raise ValueError("Fewer than four hand-visible frames")
    first, last = int(indices[0]), int(indices[-1])
    shoulders = (confidences[:, 11] >= CONTRACT["shoulderConfidenceThreshold"]) & (confidences[:, 12] >= CONTRACT["shoulderConfidenceThreshold"])
    if int(shoulders[first:last + 1].sum()) < CONTRACT["minimumShoulderFrames"]:
        raise ValueError("Fewer than four valid-shoulder frames inside the hand interval")
    nearest = first + np.floor(np.arange(FRAMES, dtype=np.float64) * (last - first) / (FRAMES - 1) + .5).astype(np.int64)
    points, confidence = keypoints[nearest], confidences[nearest]
    valid = (confidence >= CONTRACT["nodeConfidenceThreshold"]) & shoulders[nearest, None]
    if not valid.any():
        raise ValueError("No valid graph joints remain after nearest-frame sampling")
    center = (points[:, 11, :2] + points[:, 12, :2]) / 2
    width = np.maximum(np.linalg.norm(points[:, 11, :2] - points[:, 12, :2], axis=1), CONTRACT["minimumShoulderWidth"])
    xy = np.clip((points[:, :, :2] - center[:, None, :]) / width[:, None, None], *CONTRACT["coordinateClip"])
    features = np.zeros((FRAMES, NODES, 3), dtype=np.float32)
    features[:, :, :2] = np.where(valid[:, :, None], xy, 0)
    features[:, :, 2] = np.where(valid, confidence, 0)
    return features, valid.astype(np.bool_)


def _validate_features(features, mask):
    features, mask = np.asarray(features), np.asarray(mask)
    if features.ndim not in (3, 4) or features.shape[-3:] != (FRAMES, NODES, 3) or features.dtype.kind not in "fiu" or not np.isfinite(features).all():
        raise ValueError("Expected finite raw graph features [...,32,75,3]")
    if mask.shape != features.shape[:-1] or mask.dtype.kind != "b":
        raise ValueError("Expected a boolean validity mask [...,32,75]")
    confidence = features[..., 2]
    if np.any(confidence < 0) or np.any(confidence > 1) or not np.array_equal(mask, confidence >= CONTRACT["nodeConfidenceThreshold"]):
        raise ValueError("Graph mask differs from measured confidence")
    if np.any(features[~mask] != 0) or np.any(np.abs(features[..., :2]) > 5):
        raise ValueError("Missing graph nodes must be zero; raw XY must be clipped")
    return features, mask


def fit_normalization(features, mask):
    """Caller must pass training only; invalid values never affect statistics."""
    features, mask = _validate_features(features, mask)
    if features.ndim != 4 or not len(features):
        raise ValueError("Normalization needs a nonempty training batch")
    counts = mask.sum(axis=(0, 1)).astype(np.int64)
    xy = features[..., :2].astype(np.float64)
    denominator = np.maximum(counts, 1)[:, None]
    mean = np.where(mask[..., None], xy, 0).sum(axis=(0, 1)) / denominator
    variance = np.where(mask[..., None], (xy - mean) ** 2, 0).sum(axis=(0, 1)) / denominator
    std = np.maximum(np.sqrt(variance), CONTRACT["normalization"]["stdFloor"])
    mean[counts == 0] = 0
    std[counts == 0] = 1
    return {"stage": "model", "fitSplit": "train", "mean": mean.tolist(), "std": std.tolist(),
            "validCounts": counts.tolist(), "stdFloor": CONTRACT["normalization"]["stdFloor"],
            "confidence": "unstandardized", "remask": True}


def normalize_features(features, mask, normalization):
    """Training/reference utility; runtime ONNX embeds this operation exactly once."""
    features, mask = _validate_features(features, mask)
    if not isinstance(normalization, dict) or normalization.get("stage") != "model" or normalization.get("confidence") != "unstandardized" or normalization.get("remask") is not True:
        raise ValueError("Normalization must declare model stage and remasking")
    mean, std = np.asarray(normalization.get("mean"), dtype=np.float64), np.asarray(normalization.get("std"), dtype=np.float64)
    if mean.shape != (NODES, 2) or std.shape != (NODES, 2) or not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std < CONTRACT["normalization"]["stdFloor"]):
        raise ValueError("Invalid coordinate normalization statistics")
    result = features.astype(np.float32).copy()
    result[..., :2] = np.where(mask[..., None], (features[..., :2] - mean) / std, 0)
    result[..., 2] = features[..., 2]
    return result
