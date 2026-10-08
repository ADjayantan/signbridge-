import { GRAPH_ADJACENCY_HASH, GRAPH_CONTRACT_HASH } from "../../src/lib/graphSignModel.js";
export function graphManifest(signLanguage = "isl") {
  // Synthetic metadata for validation tests only; never installed or offered in the app.
  return {
    format: "signbridge-graph-onnx-v1", modelId: `synthetic-${signLanguage}`, modelVersion: "1", signLanguage,
    featureContract: "signbridge-pose75-xyc-v1", contractHash: GRAPH_CONTRACT_HASH, adjacencyHash: GRAPH_ADJACENCY_HASH,
    labels: ["WATER", "HELP"], input: { name: "pose", shape: [1, 32, 75, 3], dtype: "float32" },
    output: { name: "probabilities", shape: [1, 2], dtype: "float32", kind: "probabilities" },
    normalization: { stage: "model", mean: Array.from({ length: 75 }, () => [0, 0]), std: Array.from({ length: 75 }, () => [1, 1]), confidence: "unstandardized", remask: true },
    threshold: .7, margin: .1, acceptanceEnabled: true, promotion: { status: "promoted", promoted: true }, distribution: { status: "local-only" },
    modelFile: { name: "model.onnx", bytes: 3, sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81" },
    provenance: { synthetic: true }, evaluation: { synthetic: true, runtimeDeviceReport: "in-memory-test-only", gates: { validationScreen: true, finalScreen: true, featureParity: true, runtimeParity: true, runtimePerformance: true } },
  };
}
export function graphFrames() {
  return Array.from({ length: 4 }, (_, index) => {
    const keypoints = Array.from({ length: 75 }, () => [.5, .5, 0]), confidences = Array(75).fill(1);
    keypoints[11] = [.3, .5, 0]; keypoints[12] = [.7, .5, 0]; keypoints[33] = [.4 + index * .01, .6, 0];
    return { keypoints, confidences, atMs: index * 150 };
  });
}
export function deferredGraph() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
