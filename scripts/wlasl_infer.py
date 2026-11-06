"""Local academic I3D bridge. Raw video only; filenames never choose a label.

The pinned official WLASL100 weights use the historical BGR video loader.
New signbridge-i3d-rgb-v1 checkpoints have a different contract and must not
silently replace these weights. All suggestions require review: rejection is
not calibrated on webcam, idle, or unknown signing.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

CHECKPOINT = "code/I3D/archived/asl100/FINAL_nslt_100_iters=896_top1=65.89_top5=84.11_top10=89.92.pt"
CHECKPOINT_HASH = "a61d7dda5f875ce5ebd9d407c56874f77d1cd2aeb4bc7cd0d98a6e1ca4669a0c"
FAST_CHECKPOINT = "code/I3D/checkpoints/wlasl100_fast/best.pt"
MODEL_NAME = "Official WLASL100 I3D · local research"
ENSEMBLE_MODEL_NAME = "WLASL100 I3D Ensemble (Official + Fast GPU)"
CONTRACT = "wlasl-ensemble-bgr-short256+square256-center224-v2"
MAX_BYTES = 40 * 1024 * 1024
MIN_MODEL_FRAMES = 16
MAX_MODEL_FRAMES = 160


def labels_for(root):
    lines = (root / "code/I3D/preprocess/wlasl_class_list.txt").read_text(encoding="utf-8").splitlines()
    labels = []
    for index, line in enumerate(lines[:100]):
        identifier, label = line.split(maxsplit=1)
        if int(identifier) != index or not label.strip() or len(label) > 80:
            raise ValueError("Invalid class map")
        labels.append(label.strip().upper())
    if len(labels) != 100 or len(set(labels)) != 100:
        raise ValueError("Expected 100 unique labels")
    return labels


def status_for(root):
    checkpoint = root / CHECKPOINT
    if not checkpoint.is_file():
        return {"available": False, "signLanguage": "asl", "error": "The official WLASL100 checkpoint is not installed on this laptop."}
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != CHECKPOINT_HASH:
        raise ValueError("The WLASL checkpoint identity changed. Review it before use.")
    has_fast = (root / FAST_CHECKPOINT).is_file()
    return {"available": True, "signLanguage": "asl", "engine": "wlasl-i3d",
            "modelName": ENSEMBLE_MODEL_NAME if has_fast else MODEL_NAME,
            "labels": labels_for(root), "calibrated": False, "checkpointSha256": CHECKPOINT_HASH,
            "preprocessing": CONTRACT}


def _to_tensor(frames, indices=None):
    import numpy as np
    import torch
    if indices is not None:
        selected = np.stack([frames[index] for index in indices]).astype(np.float32)
    else:
        selected = np.stack(frames).astype(np.float32)
    selected = selected / 127.5 - 1.0
    return torch.from_numpy(selected.transpose(3, 0, 1, 2).copy()).unsqueeze(0)


def decode_clip(video_path):
    """Bounded decode and deterministic preprocessing, without reading a label."""
    import cv2
    import numpy as np
    path = Path(video_path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("Choose a non-empty video up to 40 MiB.")
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise ValueError("The video could not be decoded.")
        fps = capture.get(cv2.CAP_PROP_FPS)
        count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        valid_fps = 1.0 <= fps <= 120.0
        if valid_fps and count > 0 and (count > 1440 or not .35 <= count / fps <= 12.1):
            raise ValueError("Choose one sign in a video between 0.35 and 12 seconds.")
        # Keep only small uint8 frames in memory even for full-HD camera input.
        short_frames = []
        square_frames = []
        last_msec = 0.0
        while len(short_frames) <= 1440:
            ok, frame = capture.read()
            if not ok:
                break
            msec = capture.get(cv2.CAP_PROP_POS_MSEC)
            if msec > 0:
                last_msec = msec
            height, width = frame.shape[:2]
            if width < 32 or height < 32 or width * height > 4096 * 2160:
                raise ValueError("Video dimensions are unsupported. Use a normal webcam recording.")
            # 1) Aspect-preserving short-side 256 -> center 224 crop for Official I3D
            scale = 256.0 / min(height, width)
            resized_w = max(224, int(round(width * scale)))
            resized_h = max(224, int(round(height * scale)))
            image_short = cv2.resize(frame, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
            top = int(round((resized_h - 224) / 2.0))
            left = int(round((resized_w - 224) / 2.0))
            short_frames.append(image_short[top:top + 224, left:left + 224].copy())
            # 2) Square 256x256 -> center 224 crop matching build_frame_cache.py / train_fast.py
            image_sq = cv2.resize(frame, (256, 256), interpolation=cv2.INTER_AREA)
            square_frames.append(image_sq[16:240, 16:240].copy())
        eff_fps = fps if valid_fps else (len(short_frames) / (last_msec / 1000.0) if last_msec > 0 else 30.0)
        duration_sec = len(short_frames) / eff_fps if eff_fps > 0 else 0.0
        if not 9 <= len(short_frames) <= 1440 or not .35 <= duration_sec <= 12.1:
            raise ValueError("Choose one sign in a video between 0.35 and 12 seconds.")
        indices = None
        if len(short_frames) < MIN_MODEL_FRAMES:
            indices = np.linspace(0, len(short_frames) - 1, MIN_MODEL_FRAMES).round().astype(np.int64)
        elif len(short_frames) > MAX_MODEL_FRAMES:
            indices = np.linspace(0, len(short_frames) - 1, MAX_MODEL_FRAMES).round().astype(np.int64)
        tensor_short = _to_tensor(short_frames, indices)
        tensor_square = _to_tensor(square_frames, indices)
        return (tensor_short, tensor_square), {"frames": len(short_frames), "durationMs": round(duration_sec * 1000), "sampledFrames": int(tensor_short.shape[2])}
    finally:
        capture.release()


def load_model(root, device="auto"):
    import torch
    sys.path.insert(0, str(root / "code/I3D"))
    from pytorch_i3d import InceptionI3d
    torch.set_num_threads(4)
    selected_device = "cuda" if device == "auto" and torch.cuda.is_available() else ("cpu" if device == "auto" else device)
    mem_format = torch.channels_last_3d if selected_device == "cuda" else torch.contiguous_format

    official = InceptionI3d(100, in_channels=3)
    official.load_state_dict(torch.load(root / CHECKPOINT, map_location="cpu", weights_only=True), strict=True)
    official.to(selected_device, memory_format=mem_format).eval()

    fast = None
    fast_path = root / FAST_CHECKPOINT
    if fast_path.is_file():
        try:
            candidate = InceptionI3d(100, in_channels=3)
            candidate.load_state_dict(torch.load(fast_path, map_location="cpu", weights_only=True), strict=True)
            candidate.to(selected_device, memory_format=mem_format).eval()
            fast = candidate
        except Exception:
            fast = None

    return {"official": official, "fast": fast}, selected_device


def _forward_logits(model, tensor, device):
    import torch
    x = tensor.to(device, non_blocking=(device == "cuda"))
    if device == "cuda":
        x = x.contiguous(memory_format=torch.channels_last_3d)
        with torch.autocast("cuda", dtype=torch.bfloat16):
            return model(x).float().amax(dim=2)[0]
    return model(x).float().amax(dim=2)[0]


def predict(models, device, labels, video_path):
    import torch
    started = time.perf_counter()
    tensors, measured = decode_clip(video_path)
    tensor_short, tensor_square = tensors if isinstance(tensors, tuple) else (tensors, tensors)
    official = models["official"] if isinstance(models, dict) else models
    fast = models.get("fast") if isinstance(models, dict) else None
    with torch.inference_mode():
        logits_off = _forward_logits(official, tensor_short, device)
        if fast is not None:
            logits_fast = _forward_logits(fast, tensor_square, device)
            logits = 0.5 * logits_off + 0.5 * logits_fast
        else:
            logits = logits_off
        probabilities = torch.softmax(logits, dim=0)
        scores, identifiers = probabilities.topk(5)
    candidates = [{"label": labels[int(index)], "score": round(float(score), 6)} for score, index in zip(scores.cpu(), identifiers.cpu())]
    model_name = ENSEMBLE_MODEL_NAME if fast is not None else MODEL_NAME
    return {"status": "review", "suggestion": candidates[0]["label"], "candidates": candidates,
            **measured, "modelName": model_name, "calibrated": False,
            "elapsedMs": round((time.perf_counter() - started) * 1000), "preprocessing": CONTRACT}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--video", type=Path)
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    args = parser.parse_args()
    try:
        available = status_for(args.root)
        if args.status or not available["available"]:
            result = available
        elif args.video is None:
            raise ValueError("Choose a video to analyze.")
        else:
            model, device = load_model(args.root, args.device)
            result = predict(model, device, available["labels"], args.video)
        print(json.dumps(result, ensure_ascii=True))
    except (ValueError, OSError) as error:
        # No private filenames, recordings, or stack traces in HTTP output.
        print(json.dumps({"available": False, "error": str(error) if isinstance(error, ValueError) else "The local WLASL files are unavailable."}))
        return 1
    except Exception:
        print(json.dumps({"available": False, "error": "The local video model could not run. Check the Python environment and GPU availability."}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
