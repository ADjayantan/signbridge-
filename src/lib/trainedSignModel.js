// Browser inference for the small, exported, single-layer PyTorch GRU sign model.
// No gesture shortcuts, mirroring or network calls: only the artifact's learned vocabulary.
import { HAND_JOINT_COUNT, isCompleteHandLandmarks } from "./handJoints.js";
export const POSE_JOINTS = Object.freeze([0, 2, 5, 11, 12, 13, 14, 33, 37, 38, 41, 42, 45, 46, 49, 50, 53, 54, 58, 59, 62, 63, 66, 67, 70, 71, 74]);
export const POSE_FRAMES = 32;
export const POSE_INPUT_SIZE = POSE_JOINTS.length * 3;
const LANDMARK_COUNT = 75;
const MAX_SEQUENCE_FRAMES = 2048;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const validLandmark = (point) => point && finite(point.x) && finite(point.y) && (point.z == null || finite(point.z));
const hasHand = (frame) => frame.confidences[33] >= 0.5 || frame.confidences[54] >= 0.5;
const hasShoulders = (frame) => frame.confidences[11] >= 0.2 && frame.confidences[12] >= 0.2;

function validateFrames(frames) {
  if (!Array.isArray(frames) || frames.length > MAX_SEQUENCE_FRAMES) throw new Error("Choose a short pose sequence with at most 2048 frames.");
  for (const frame of frames) {
    if (!frame || !Array.isArray(frame.keypoints) || frame.keypoints.length !== LANDMARK_COUNT ||
      !Array.isArray(frame.confidences) || frame.confidences.length !== LANDMARK_COUNT ||
      !frame.confidences.every(finite) ||
      !frame.keypoints.every((point) => Array.isArray(point) && point.length === 3 && point.every(finite))) {
      throw new Error("Each pose frame needs 75 finite x/y/z landmarks and 75 confidence values.");
    }
  }
}

/** Legacy MediaPipe Holistic result (or its nested Tasks landmarks) → training pose format. */
export function poseFrameFromHolistic(result) {
  const keypoints = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
  const confidences = Array(LANDMARK_COUNT).fill(0);
  for (const [name, offset, count] of [["poseLandmarks", 0, 33], ["leftHandLandmarks", 33, HAND_JOINT_COUNT], ["rightHandLandmarks", 54, HAND_JOINT_COUNT]]) {
    let points = result?.[name];
    if (Array.isArray(points?.[0])) points = points[0];
    if (!Array.isArray(points) || points.length !== count) continue;
    const isHand = offset !== 0;
    if (isHand && !isCompleteHandLandmarks(points)) continue;
    points.forEach((point, i) => {
      if (!validLandmark(point)) return;
      // Tasks fills absent hand-visibility fields with zero. OpenHands instead used
      // confidence1 for every landmark in a detected hand; only the body uses visibility.
      const confidence = isHand ? 1 : point.visibility ?? point.presence ?? 1;
      if (!finite(confidence)) return;
      keypoints[offset + i] = [point.x, point.y, point.z ?? 0];
      confidences[offset + i] = clamp(confidence, 0, 1);
    });
  }
  return { keypoints, confidences };
}

/**
 * Training/browser shared preprocessing: body33 + left21 + right21, no mirroring.
 * Returns 32×81 unstandardized features, or [] when fewer than four visible-hand frames exist.
 */
export function preprocessPoseSequence(frames) {
  validateFrames(frames);
  if (frames.length < 4 || frames.filter(hasHand).length < 4) return [];
  const first = frames.findIndex(hasHand);
  let last = frames.length - 1;
  while (!hasHand(frames[last])) last -= 1;
  const sequence = frames.slice(first, last + 1).map((frame) => {
    if (!hasShoulders(frame)) return Array(POSE_INPUT_SIZE).fill(0);
    const left = frame.keypoints[11];
    const right = frame.keypoints[12];
    const centerX = (left[0] + right[0]) / 2;
    const centerY = (left[1] + right[1]) / 2;
    const scale = Math.max(0.05, Math.hypot(left[0] - right[0], left[1] - right[1]));
    return POSE_JOINTS.flatMap((joint) => {
      const confidence = frame.confidences[joint];
      if (confidence < 0.2) return [0, 0, 0];
      const [x, y] = frame.keypoints[joint];
      return [clamp((x - centerX) / scale, -5, 5), clamp((y - centerY) / scale, -5, 5), clamp(confidence, 0, 1)];
    });
  });
  return Array.from({ length: POSE_FRAMES }, (_, step) => {
    const position = step * (sequence.length - 1) / (POSE_FRAMES - 1);
    const start = Math.floor(position);
    const end = Math.min(start + 1, sequence.length - 1);
    const fraction = position - start;
    return sequence[start].map((value, dimension) => value + (sequence[end][dimension] - value) * fraction);
  });
}

function checkVector(value, size, name, predicate = (n) => finite(n) && Math.abs(n) <= 10000) {
  if (!Array.isArray(value) || value.length !== size || !value.every(predicate)) throw new Error(`Invalid trained-model ${name}.`);
}

function checkMatrix(value, rows, columns, name) {
  if (!Array.isArray(value) || value.length !== rows) throw new Error(`Invalid trained-model ${name}.`);
  value.forEach((row) => checkVector(row, columns, name));
}

/** Reject incompatible, oversized or nonfinite artifacts before running any learned weights. */
export function validateTrainedModel(model, expectedLanguage) {
  if (!model || model.format !== "signbridge-gru-v1") throw new Error("This is not a supported SignBridge trained model.");
  if (!["isl", "asl"].includes(model.signLanguage)) throw new Error("The trained model must specify ISL or ASL.");
  if (expectedLanguage != null && expectedLanguage !== model.signLanguage) throw new Error(`This model belongs to ${model.signLanguage.toUpperCase()}. Choose that sign language before using it.`);
  if (model.frames !== POSE_FRAMES || model.inputSize !== POSE_INPUT_SIZE ||
    !Array.isArray(model.joints) || model.joints.length !== POSE_JOINTS.length ||
    !model.joints.every((joint, index) => joint === POSE_JOINTS[index])) throw new Error("The trained model uses incompatible pose features.");
  const hidden = model.hiddenSize;
  if (!Number.isInteger(hidden) || hidden < 1 || hidden > 128) throw new Error("The trained model needs 1–128 hidden units.");
  if (!Array.isArray(model.labels) || model.labels.length < 2 || model.labels.length > 500 ||
    !model.labels.every((label) => typeof label === "string" && label.trim() === label && label.length > 0 && label.length <= 80) ||
    new Set(model.labels).size !== model.labels.length) throw new Error("The trained model needs 2–500 unique sign labels.");
  if (!finite(model.threshold) || model.threshold < 0 || model.threshold > 1 ||
    !finite(model.margin) || model.margin < 0 || model.margin > 1) throw new Error("Invalid trained-model rejection thresholds.");
  if (model.acceptanceEnabled !== undefined && typeof model.acceptanceEnabled !== "boolean") throw new Error("Invalid trained-model acceptance setting.");
  checkVector(model.mean, POSE_INPUT_SIZE, "mean", (n) => finite(n) && Math.abs(n) <= 1e6);
  checkVector(model.std, POSE_INPUT_SIZE, "standard deviation", (n) => finite(n) && n >= 1e-6 && n <= 1e6);
  const weights = model.weights;
  if (!weights || typeof weights !== "object") throw new Error("The trained model is missing learned weights.");
  checkMatrix(weights.weight_ih_l0, 3 * hidden, POSE_INPUT_SIZE, "input weights");
  checkMatrix(weights.weight_hh_l0, 3 * hidden, hidden, "recurrent weights");
  checkVector(weights.bias_ih_l0, 3 * hidden, "input bias");
  checkVector(weights.bias_hh_l0, 3 * hidden, "recurrent bias");
  checkMatrix(weights.head_weight, model.labels.length, hidden, "output weights");
  checkVector(weights.head_bias, model.labels.length, "output bias");
  return model;
}

const dot = (a, b) => {
  let value = 0;
  for (let i = 0; i < a.length; i++) value += a[i] * b[i];
  return value;
};
const sigmoid = (value) => 1 / (1 + Math.exp(-value));
const rejected = (status, feedback, score = 0, margin = 0, candidates = [], diagnostics = null) => ({ status, meaning: "", glosses: [], feedback, score, margin, candidates, diagnostics });

// These counts use the predictor's actual wrist/shoulder gates. They describe
// measured samples, not the correctness of the person's sign or all 21 hand joints.
function captureDiagnostics(frames) {
  const first = frames.findIndex(hasHand);
  let last = first < 0 ? -1 : frames.length - 1;
  while (last >= 0 && !hasHand(frames[last])) last -= 1;
  const trimmed = first < 0 ? [] : frames.slice(first, last + 1);
  return {
    inputFrames: frames.length, handFrames: frames.filter(hasHand).length,
    shoulderFrames: frames.filter(hasShoulders).length,
    qualifiedFrames: frames.filter((frame) => hasHand(frame) && hasShoulders(frame)).length,
    trimmedFrames: trimmed.length, trimmedShoulderFrames: trimmed.filter(hasShoulders).length,
    modelFrames: 0,
  };
}

function predictionDiagnostics(model, capture, reasonCodes, ranked = null) {
  const inferenceRan = ranked !== null;
  const top = ranked?.[0], runnerUp = ranked?.[1];
  return {
    inferenceRan, reasonCodes,
    model: { signLanguage: model.signLanguage, engine: "legacy", labelsCount: model.labels.length,
      threshold: model.threshold, requiredMargin: model.margin, acceptanceEnabled: model.acceptanceEnabled !== false },
    capture: { ...capture, modelFrames: inferenceRan ? POSE_FRAMES : 0 },
    // Keep the top-level historical score 0 contract for unrun gates, while
    // exposing no measured posterior until the learned weights actually run.
    posterior: inferenceRan ? {
      topLabel: model.labels[top.index], topScore: top.score,
      runnerUpLabel: model.labels[runnerUp.index], runnerUpScore: runnerUp.score,
      margin: top.score - runnerUp.score,
      scorePassed: top.score >= model.threshold, marginPassed: top.score - runnerUp.score >= model.margin,
    } : null,
  };
}

/** Complete isolated sign → learned label, or a reviewable rejection. Scores are not accuracy. */
export function predictTrainedSign(model, frames) {
  validateTrainedModel(model);
  validateFrames(frames);
  const capture = captureDiagnostics(frames);
  const early = (status, feedback, reasons) => rejected(status, feedback, 0, 0, [], predictionDiagnostics(model, capture, reasons));
  const visible = frames.filter(hasHand);
  if (!visible.length) return early("no_sign", "No visible hands were captured. Show your hands and try again.", ["no-hands"]);
  if (model.acceptanceEnabled === false) return early("unclear", "The model could not calibrate reliable rejection. Please review or enter meaning.", ["acceptance-disabled"]);
  if (visible.length < 4 || frames.filter(hasShoulders).length < 4) return early("unclear", "Keep both shoulders and your signing hands visible for a longer turn.", [...(visible.length < 4 ? ["hand-samples"] : []), ...(capture.shoulderFrames < 4 ? ["shoulder-samples"] : [])]);
  const sequence = preprocessPoseSequence(frames);
  if (!sequence.length) return early("unclear", "The sign turn is too short. Record the complete sign and try again.", ["hand-samples"]);
  const first = frames.findIndex(hasHand);
  let last = frames.length - 1;
  while (!hasHand(frames[last])) last -= 1;
  if (frames.slice(first, last + 1).filter(hasShoulders).length < 4) return early("unclear", "Keep both shoulders visible throughout the sign turn.", ["shoulders-during-sign"]);
  const probabilities = predictFeatureProbabilities(model, sequence).map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  const best = probabilities[0];
  const margin = best.score - probabilities[1].score;
  // Alternatives are suggestions for explicit review, never accepted words.
  // Earlier quality/calibration gates intentionally return no suggestions.
  const candidates = probabilities.slice(0, 3).map(({ index, score }) => ({ label: model.labels[index], score }));
  const reasonCodes = [...(best.score < model.threshold ? ["low-score"] : []), ...(margin < model.margin ? ["small-margin"] : [])];
  const diagnostics = predictionDiagnostics(model, capture, reasonCodes.length ? reasonCodes : ["recognized"], probabilities);
  if (best.score < model.threshold || margin < model.margin) return rejected("unclear", "This turn does not match a trained sign confidently. Try again or correct the meaning manually.", best.score, margin, candidates, diagnostics);
  const meaning = model.labels[best.index];
  return { status: "recognized", meaning, glosses: [meaning], feedback: "Check this isolated-sign prediction before speaking or sending it.", score: best.score, margin, candidates, diagnostics };
}

/** Low-level output in label order for exact exported PyTorch/browser parity verification. */
export function predictFeatureProbabilities(model, sequence) {
  validateTrainedModel(model);
  if (!Array.isArray(sequence) || sequence.length !== POSE_FRAMES) throw new Error("The trained model needs exactly 32 pose feature frames.");
  sequence.forEach((row) => checkVector(row, POSE_INPUT_SIZE, "pose feature frame", (n) => finite(n) && Math.abs(n) <= 1e6));
  const hidden = model.hiddenSize;
  const weights = model.weights;
  let state = Array(hidden).fill(0);
  for (const features of sequence) {
    const input = features.map((value, i) => (value - model.mean[i]) / model.std[i]);
    const inputGates = weights.weight_ih_l0.map((row, i) => dot(row, input) + weights.bias_ih_l0[i]);
    const recurrentGates = weights.weight_hh_l0.map((row, i) => dot(row, state) + weights.bias_hh_l0[i]);
    // PyTorch gate order r,z,n. Its reset gate multiplies the recurrent new-gate bias too.
    state = state.map((old, i) => {
      const reset = sigmoid(inputGates[i] + recurrentGates[i]);
      const update = sigmoid(inputGates[hidden + i] + recurrentGates[hidden + i]);
      const next = Math.tanh(inputGates[2 * hidden + i] + reset * recurrentGates[2 * hidden + i]);
      return (1 - update) * next + update * old;
    });
  }
  const logits = weights.head_weight.map((row, i) => dot(row, state) + weights.head_bias[i]);
  const max = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}
