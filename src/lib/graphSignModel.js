import { GRAPH_FEATURE_CONTRACT, GRAPH_INPUT_SHAPE, validateGraphNormalization, validatePoseGraphFrames } from "./poseGraphFeatures.js";
export const GRAPH_MODEL_FORMAT = "signbridge-graph-onnx-v1";
export const MAX_GRAPH_MODEL_BYTES = 5 * 1024 * 1024;
export const MAX_GRAPH_MANIFEST_BYTES = 128 * 1024;
// Filled from the frozen contract, never trusted from a downloaded manifest.
export const GRAPH_CONTRACT_HASH = "3c9a4c8e6417ff200493238b73ba53e9615df56c979d424ac57821e707ddb95c";
export const GRAPH_ADJACENCY_HASH = "3680035c591590b36fb0d6a6a2ee8092beda2601640950e9fdc9d8135972ddf3";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
const sameShape = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
export class GraphUnavailableError extends Error {
  constructor(message) { super(message); this.name = "GraphUnavailableError"; this.code = "unavailable"; }
}

/** Fail closed: research candidates cannot become selectable app models. */
export function validateGraphManifest(manifest, expectedLanguage) {
  if (!manifest || manifest.format !== GRAPH_MODEL_FORMAT) throw new Error("Unsupported graph-model manifest.");
  if (!["isl", "asl"].includes(manifest.signLanguage) || manifest.signLanguage !== expectedLanguage) throw new Error("This graph model belongs to a different sign language.");
  if (!identifier(manifest.modelId) || !identifier(manifest.modelVersion)) throw new Error("Invalid graph model identity.");
  if (manifest.featureContract !== GRAPH_FEATURE_CONTRACT || manifest.contractHash !== GRAPH_CONTRACT_HASH || manifest.adjacencyHash !== GRAPH_ADJACENCY_HASH) throw new Error("The graph model uses an incompatible feature or joint contract.");
  if (!Array.isArray(manifest.labels) || manifest.labels.length < 2 || manifest.labels.length > 500 || new Set(manifest.labels).size !== manifest.labels.length || !manifest.labels.every((label) => typeof label === "string" && label.trim() === label && label.length > 0 && label.length <= 80)) throw new Error("Invalid graph vocabulary.");
  if (!identifier(manifest.input?.name) || manifest.input.dtype !== "float32" || !sameShape(manifest.input.shape, GRAPH_INPUT_SHAPE) ||
    !identifier(manifest.output?.name) || manifest.output.dtype !== "float32" || manifest.output.kind !== "probabilities" || !sameShape(manifest.output.shape, [1, manifest.labels.length])) throw new Error("Invalid graph input/output contract.");
  validateGraphNormalization(manifest.normalization);
  if (!finite(manifest.threshold) || manifest.threshold < 0 || manifest.threshold > 1 || !finite(manifest.margin) || manifest.margin < 0 || manifest.margin > 1 || typeof manifest.acceptanceEnabled !== "boolean") throw new Error("Invalid graph rejection settings.");
  const file = manifest.modelFile;
  if (!file || !identifier(file.name) || !file.name.endsWith(".onnx") || !hash(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_GRAPH_MODEL_BYTES) throw new Error("Invalid graph model file, size or integrity hash.");
  if (!manifest.provenance || typeof manifest.provenance !== "object" || !Object.keys(manifest.provenance).length || !manifest.evaluation || typeof manifest.evaluation !== "object" || !Object.keys(manifest.evaluation).length) throw new Error("Graph artifact provenance and evaluation are required.");
  const gates = manifest.evaluation.gates;
  if (manifest.promotion?.status !== "promoted" || manifest.promotion.promoted !== true || manifest.acceptanceEnabled !== true ||
    !["validationScreen", "finalScreen", "featureParity", "runtimeParity", "runtimePerformance"].every((gate) => gates?.[gate] === true) ||
    typeof manifest.evaluation.runtimeDeviceReport !== "string" || !manifest.evaluation.runtimeDeviceReport.trim()) throw new GraphUnavailableError("No graph model has passed the promotion and device-runtime gates for this sign language.");
  if (!["local-only", "public-approved"].includes(manifest.distribution?.status)) throw new GraphUnavailableError("This graph artifact is not approved for use here.");
  return manifest;
}

export function graphNoSign(feedback) {
  return { status: "no_sign", meaning: "", glosses: [], feedback, candidates: [], score: 0, margin: 0,
    diagnostics: { inferenceRan: false, reasonCodes: ["recapture"], model: null, capture: null, posterior: null } };
}

const graphModelDiagnostics = (manifest) => manifest ? {
  signLanguage: manifest.signLanguage, engine: "graph", labelsCount: manifest.labels.length,
  threshold: manifest.threshold, requiredMargin: manifest.margin, acceptanceEnabled: manifest.acceptanceEnabled,
} : null;

/** Snapshot scalar measurements only; malformed poses remain the camera gate's decision. */
export function describeGraphCapture(frames) {
  const inputFrames = Array.isArray(frames) ? frames.length : null;
  try { validatePoseGraphFrames(frames); } catch {
    return { inputFrames, handFrames: null, shoulderFrames: null, qualifiedFrames: null,
      trimmedFrames: null, trimmedShoulderFrames: null, modelFrames: 0 };
  }
  const hand = (frame) => frame.confidences[33] >= .5 || frame.confidences[54] >= .5;
  const shoulders = (frame) => frame.confidences[11] >= .2 && frame.confidences[12] >= .2;
  const first = frames.findIndex(hand);
  let last = first < 0 ? -1 : frames.length - 1;
  while (last >= 0 && !hand(frames[last])) last -= 1;
  const trimmed = first < 0 ? [] : frames.slice(first, last + 1);
  return { inputFrames, handFrames: frames.filter(hand).length, shoulderFrames: frames.filter(shoulders).length,
    qualifiedFrames: frames.filter((frame) => hand(frame) && shoulders(frame)).length,
    trimmedFrames: trimmed.length, trimmedShoulderFrames: trimmed.filter(shoulders).length, modelFrames: 0 };
}

/** Attach the worker's camera gate to its result without changing its decision. */
export function withGraphCaptureDiagnostics(result, { manifest, capture, quality } = {}) {
  const original = result.diagnostics ?? { inferenceRan: false, reasonCodes: ["recapture"], posterior: null };
  const inferenceRan = original.inferenceRan === true;
  const metrics = quality?.metrics;
  const measured = capture ?? original.capture;
  const combinedCapture = measured || metrics ? {
    ...measured,
    inputFrames: measured?.inputFrames ?? metrics?.count ?? null,
    qualifiedFrames: measured?.qualifiedFrames ?? metrics?.qualified ?? null,
    modelFrames: inferenceRan ? GRAPH_INPUT_SHAPE[1] : 0,
    ...(finite(metrics?.durationMs) ? { durationMs: metrics.durationMs } : {}),
    ...(finite(metrics?.largestGapMs) ? { largestGapMs: metrics.largestGapMs } : {}),
  } : null;
  return { ...result, diagnostics: {
    ...original, inferenceRan,
    reasonCodes: quality?.ok === false ? [quality.code || "recapture"] : [...original.reasonCodes],
    model: graphModelDiagnostics(manifest) ?? original.model ?? null,
    capture: combinedCapture,
    posterior: inferenceRan ? original.posterior : null,
    ...(quality ? { cameraGate: { passed: quality.ok === true, code: quality.code || "" } } : {}),
  } };
}

/** Camera timing is separate from archive preprocessing; missing timing is never invented. */
export function validateCameraTurn(frames, { durationMs } = {}) {
  const fail = (code, feedback, metrics = {}) => ({ ok: false, code, feedback, metrics });
  try { validatePoseGraphFrames(frames); } catch { return fail("invalid-pose", "Tracking data could not be read. Capture a new complete word."); }
  if (frames.length < 4 || frames.length > 100) return fail("sample-count", "Capture a complete word with four to one hundred fresh pose samples.");
  const times = frames.map((frame) => frame.atMs);
  if (!times.every((value, index) => finite(value) && value >= 0 && value <= 12000 && (index === 0 || value > times[index - 1]))) return fail("timing", "Pose timing is missing or paused. Capture a new word from the camera.");
  const duration = durationMs ?? times.at(-1);
  if (!finite(duration) || duration < 350 || duration > 12000 || duration < times.at(-1)) return fail("duration", "Capture one complete word between 0.35 and 12 seconds.");
  const qualified = frames.filter((frame) => (frame.confidences[33] >= .5 || frame.confidences[54] >= .5) && frame.confidences[11] >= .2 && frame.confidences[12] >= .2).length;
  const largestGapMs = Math.max(times[0], duration - times.at(-1), ...times.slice(1).map((value, index) => value - times[index]));
  const metrics = { count: frames.length, qualified, durationMs: duration, largestGapMs };
  if (qualified < 4) return fail("framing", "Keep both shoulders and your signing hand visible for at least four samples.", metrics);
  if (largestGapMs > 1000) return fail("tracking-gap", "Tracking paused for over one second. Capture the word again without a gap.", metrics);
  return { ok: true, code: "", feedback: "", metrics };
}

export function graphPredictionFromProbabilities(manifest, probabilities) {
  if ((!Array.isArray(probabilities) && !(probabilities instanceof Float32Array)) || probabilities.length !== manifest.labels.length || !Array.from(probabilities).every((value) => finite(value) && value >= 0 && value <= 1) || Math.abs(Array.from(probabilities).reduce((sum, value) => sum + value, 0) - 1) > 1e-3) throw new Error("The graph runtime returned invalid probabilities.");
  const ranked = Array.from(probabilities, (score, index) => ({ label: manifest.labels[index], score })).sort((a, b) => b.score - a.score);
  const score = ranked[0].score, margin = score - ranked[1].score, candidates = ranked.slice(0, 3);
  const reasonCodes = [...(score < manifest.threshold ? ["low-score"] : []), ...(margin < manifest.margin ? ["small-margin"] : [])];
  const diagnostics = { inferenceRan: true, reasonCodes: reasonCodes.length ? reasonCodes : ["recognized"],
    model: graphModelDiagnostics(manifest), capture: null,
    posterior: { topLabel: ranked[0].label, topScore: score, runnerUpLabel: ranked[1].label, runnerUpScore: ranked[1].score,
      margin, scorePassed: score >= manifest.threshold, marginPassed: margin >= manifest.margin } };
  if (score < manifest.threshold || margin < manifest.margin) return { status: "unclear", meaning: "", glosses: [], feedback: "This turn has no reliable graph-word match. Review a suggestion or enter the meaning.", candidates, score, margin, diagnostics };
  return { status: "recognized", meaning: ranked[0].label, glosses: [ranked[0].label], feedback: "Check this isolated graph-word prediction before speaking or sending it.", candidates, score, margin, diagnostics };
}

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Secure model-integrity checks are unavailable in this browser.");
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Bound real streamed downloads; also works with simple test Response doubles. */
export async function readGraphResponseBytes(response, maximum) {
  const declared = Number(response.headers?.get("content-length"));
  if (declared > maximum) throw new Error("The graph artifact exceeds its size limit.");
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error("The graph artifact exceeds its size limit.");
    return bytes;
  }
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw new Error("The graph artifact exceeds its size limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
