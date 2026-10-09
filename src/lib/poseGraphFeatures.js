// New graph features are deliberately separate from the legacy GRU27 contract.
export const GRAPH_FEATURE_CONTRACT = "signbridge-pose75-xyc-v1";
export const GRAPH_FRAMES = 32;
export const GRAPH_NODES = 75;
export const GRAPH_CHANNELS = 3;
export const GRAPH_INPUT_SHAPE = Object.freeze([1, GRAPH_FRAMES, GRAPH_NODES, GRAPH_CHANNELS]);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const handVisible = (frame) => frame.confidences[33] >= .5 || frame.confidences[54] >= .5;
const shouldersVisible = (frame) => frame.confidences[11] >= .2 && frame.confidences[12] >= .2;

export function validatePoseGraphFrames(frames) {
  if (!Array.isArray(frames) || frames.length > 4096) throw new Error("Graph recognition needs at most 4096 pose frames.");
  for (const frame of frames) {
    if (!Array.isArray(frame?.keypoints) || frame.keypoints.length !== GRAPH_NODES ||
      !Array.isArray(frame.confidences) || frame.confidences.length !== GRAPH_NODES ||
      !Array.from(frame.confidences).every(finite) ||
      !Array.from(frame.keypoints).every((point) => Array.isArray(point) && point.length === 3 && Array.from(point).every((value) => finite(value) && Math.abs(value) <= 1e6))) {
      throw new Error("Graph frames need 75 finite x/y/z joints and confidence values.");
    }
  }
  return frames;
}

/** Raw TVC: shoulder x/y + confidence. ONNX owns learned normalization. */
export function preprocessPoseGraph(frames) {
  validatePoseGraphFrames(frames);
  if (frames.length < 4 || frames.filter(handVisible).length < 4) return [];
  const first = frames.findIndex(handVisible);
  let last = frames.length - 1;
  while (!handVisible(frames[last])) last--;
  const trimmed = frames.slice(first, last + 1);
  if (trimmed.filter(shouldersVisible).length < 4) return [];
  const raw = trimmed.map((frame) => {
    if (!shouldersVisible(frame)) return Array.from({ length: GRAPH_NODES }, () => [0, 0, 0]);
    const left = frame.keypoints[11], right = frame.keypoints[12];
    const centerX = (left[0] + right[0]) / 2, centerY = (left[1] + right[1]) / 2;
    const width = Math.max(.05, Math.hypot(left[0] - right[0], left[1] - right[1]));
    return frame.keypoints.map(([x, y], joint) => frame.confidences[joint] < .5 ? [0, 0, 0] :
      [Math.fround(clamp((x - centerX) / width, -5, 5)), Math.fround(clamp((y - centerY) / width, -5, 5)), Math.fround(clamp(frame.confidences[joint], 0, 1))]);
  });
  // Half-up nearest resampling keeps a missing sample missing; no interpolated masks.
  const result = Array.from({ length: GRAPH_FRAMES }, (_, step) => raw[Math.floor(step * (raw.length - 1) / (GRAPH_FRAMES - 1) + .5)].map((point) => [...point]));
  return result.some((sample) => sample.some((point) => point[2] >= .5)) ? result : [];
}

export function validateGraphNormalization(normalization) {
  if (!normalization || normalization.stage !== "model" || normalization.remask !== true || normalization.confidence !== "unstandardized") throw new Error("Graph coordinate normalization must occur once inside the model with remasking.");
  for (const [name, values] of [["mean", normalization.mean], ["std", normalization.std]]) {
    if (!Array.isArray(values) || values.length !== GRAPH_NODES || !Array.from(values).every((row) => Array.isArray(row) && row.length === 2 && Array.from(row).every((value) => finite(value) && (name === "std" ? value >= .05 && value <= 1e6 : Math.abs(value) <= 1e6)))) {
      throw new Error(`Invalid graph per-node coordinate ${name}.`);
    }
  }
  return normalization;
}

/** Parity utility only. Never feed these standardized values to the exported model. */
export function normalizePoseGraphForParity(features, normalization) {
  validateGraphNormalization(normalization);
  validateGraphFeatureArray(features);
  return features.map((frame) => frame.map(([x, y, confidence], joint) => confidence < .5 ? [0, 0, 0] :
    [Math.fround((x - normalization.mean[joint][0]) / normalization.std[joint][0]), Math.fround((y - normalization.mean[joint][1]) / normalization.std[joint][1]), confidence]));
}

export function validateGraphFeatureArray(features) {
  if (!Array.isArray(features) || features.length !== GRAPH_FRAMES || !Array.from(features).every((frame) => Array.isArray(frame) && frame.length === GRAPH_NODES && Array.from(frame).every((point) => Array.isArray(point) && point.length === 3 && Array.from(point).every(finite) && Math.abs(point[0]) <= 5 && Math.abs(point[1]) <= 5 && point[2] >= 0 && point[2] <= 1 && (point[2] >= .5 || point.every((value) => value === 0))))) {
    throw new Error("Graph input needs raw 32×75×3 shoulder coordinates, not standardized features.");
  }
  return features;
}

export function poseGraphTensorData(features) {
  validateGraphFeatureArray(features);
  return new Float32Array(features.flat(2));
}
