"""Export local research ONNX artifacts and check native numerical parity.

An untrained spike tests operators only. Neither this export command nor an
untrained spike promotes a model or establishes sign-language recognition.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import torch

from graph_models import ProbabilityModel, SignGraphModel, load_checkpoint

MAX_MODEL_BYTES = 5 * 1024 * 1024


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def export_and_check(model, features, destination):
    import onnx
    import onnxruntime as ort
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ValueError("Never overwrite a frozen ONNX artifact")
    wrapper = ProbabilityModel(model).eval()
    sample = torch.from_numpy(features[:1].astype(np.float32))
    torch.onnx.export(wrapper, (sample,), str(destination), input_names=["pose"],
        output_names=["probabilities"], opset_version=17, dynamo=False)
    onnx.checker.check_model(onnx.load(str(destination)))
    size = destination.stat().st_size
    if size >= MAX_MODEL_BYTES:
        raise ValueError("ONNX artifact exceeds the 5 MiB engineering budget")
    options = ort.SessionOptions(); options.intra_op_num_threads = 1; options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(destination), sess_options=options, providers=["CPUExecutionProvider"])
    actual, expected, timings = [], [], []
    with torch.no_grad():
        for feature in features:
            batch = feature[None].astype(np.float32)
            expected.append(wrapper(torch.from_numpy(batch)).numpy()[0])
            start = time.perf_counter()
            actual.append(session.run(["probabilities"], {"pose": batch})[0][0])
            timings.append((time.perf_counter() - start) * 1000)
    actual, expected = np.asarray(actual), np.asarray(expected)
    error = float(np.max(np.abs(actual - expected)))
    labels_match = bool(np.array_equal(actual.argmax(1), expected.argmax(1)))
    if error > 1e-4 or not labels_match or not np.isfinite(actual).all():
        raise ValueError(f"PyTorch/ONNX parity failed: {error=}, {labels_match=}")
    return {
        "torch": torch.__version__, "onnx": onnx.__version__, "onnxruntime": ort.__version__,
        "opset": 17, "inputName": "pose", "outputName": "probabilities", "bytes": size,
        "sha256": digest(destination), "fixtures": len(features), "maxProbabilityError": error,
        "top1Matches": labels_match, "nativeInferenceMs": timings,
    }, expected


def manifest_for_run(run, model_file, parity, contract_file, calibration=None):
    from pose_graph import adjacency_hash
    calibration = calibration or {}
    norm = {**run["normalization"], "stage": "model", "remask": True, "confidence": "unstandardized"}
    return {
        "format": "signbridge-graph-onnx-v1", "modelId": f"{run['signLanguage']}-{run['architecture']}-seed{run['seed']}",
        "modelVersion": "graph-v1", "signLanguage": run["signLanguage"],
        "featureContract": run["featureContract"], "contractHash": digest(contract_file),
        "adjacencyHash": adjacency_hash(), "labels": run["labels"],
        "input": {"name": "pose", "shape": run["inputShape"], "dtype": "float32"},
        "output": {"name": "probabilities", "shape": [1, len(run["labels"])], "dtype": "float32", "kind": "probabilities"},
        "normalization": norm, "threshold": calibration.get("threshold", .99),
        "margin": calibration.get("margin", .5), "acceptanceEnabled": False,
        "promotion": {"status": "candidate", "promoted": False, "reason": "Export is not release approval; final evaluation/runtime gates required"},
        "distribution": {"status": "local-only"}, "distributionStatus": "local-research-only",
        "modelFile": {"name": Path(model_file).name, "sha256": parity["sha256"], "bytes": parity["bytes"]},
        "provenance": {"dataSha256": run["dataSha256"], "experimentSha256": run["experimentSha256"],
            "checkpointSha256": run["weightsSha256"], "architecture": run["architecture"],
            "graphConfig": run.get("graphConfig"), "seed": run["seed"]},
        "evaluation": {"nativeParity": parity, "validationMacroRecall": run["bestValidationMacroRecall"],
            "calibration": calibration, "finalTestEvaluated": False, "browserParityVerified": False,
            "liveAccuracyEstablished": False, "runtimeDeviceReport": "",
            "gates": {"validationScreen": False, "finalScreen": False, "featureParity": False,
                "runtimeParity": False, "runtimePerformance": False}},
    }


def spike(output):
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a fresh spike output directory")
    output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4); torch.manual_seed(42)
    rng = np.random.default_rng(42)
    features = rng.normal(0, .4, (3, 32, 75, 3)).astype(np.float32)
    features[..., 2] = rng.uniform(.5, 1, features.shape[:-1])
    features[:, :, ::4] = 0
    features[2] = 0  # Completely unobserved: finite output, runtime must reject.
    reports = []
    for architecture in ("gru75", "stgcn"):
        model = SignGraphModel(4, architecture, np.zeros((75, 2)), np.ones((75, 2)))
        result, expected = export_and_check(model, features, output / f"{architecture}-untrained.onnx")
        write_json(output / f"{architecture}-parity.json", {"kind": "artificial operator compatibility only",
            "featureContract": "signbridge-pose75-xyc-v1", "features": features.tolist(), "probabilities": expected.tolist()})
        reports.append({"architecture": architecture, "parameters": sum(p.numel() for p in model.parameters()), **result})
    write_json(output / "spike-report.json", {"recognitionAccuracyMeasured": False, "reports": reports})
    print(json.dumps({"spike": str(output), "recognitionAccuracyMeasured": False, "reports": reports}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spike", action="store_true")
    parser.add_argument("--run", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--data", type=Path)
    parser.add_argument("--contract", type=Path)
    parser.add_argument("--calibration", type=Path)
    args = parser.parse_args()
    if args.spike:
        spike(args.output); return
    if args.run is None:
        parser.error("--run is required for trained export")
    run_dir = args.run if args.run.is_dir() else args.run.parent
    model, run = load_checkpoint(run_dir / "checkpoint.pt")
    if run["architecture"] == "gru27":
        parser.error("Legacy control remains offline; graph runtime requires the 75-node contract")
    root = Path(__file__).resolve().parents[1]
    data_path = args.data or Path(run["prepared_data"])
    if digest(data_path) != run["dataSha256"]:
        raise ValueError("Export dataset hash mismatch")
    with np.load(data_path, allow_pickle=False) as data:
        fixtures = data["X_val"][:3].astype(np.float32)
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("Use a fresh export output directory")
    args.output.mkdir(parents=True, exist_ok=True)
    model_file = args.output / "model.onnx"
    parity, probabilities = export_and_check(model, fixtures, model_file)
    contract_file = args.contract or root / "training" / "graph-contract-v1.json"
    calibration = json.loads(args.calibration.read_text(encoding="utf-8")) if args.calibration else None
    manifest = manifest_for_run(run, model_file, parity, contract_file, calibration)
    write_json(args.output / "manifest.json", manifest)
    write_json(args.output / "parity.json", {"kind": "validation pose runtime parity; not final test",
        "featureContract": run["featureContract"], "features": fixtures.tolist(), "probabilities": probabilities.tolist()})
    print(json.dumps({"export": str(args.output), "promotion": False, "parity": parity}), flush=True)


if __name__ == "__main__":
    main()
