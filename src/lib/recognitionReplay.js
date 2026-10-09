import { describeGraphCapture, validateCameraTurn } from "./graphSignModel.js";
import { createSignRecognitionReport } from "./signRecognitionReport.js";
import { validatePoseGraphFrames } from "./poseGraphFeatures.js";
import { validateCameraInputContract } from "./cameraCoordinateContract.js";

export const MAX_REPLAY_VIDEO_BYTES = 100 * 1024 * 1024;
export const MIN_REPLAY_DURATION_SECONDS = .35;
export const MAX_REPLAY_DURATION_SECONDS = 12;
const BASELINE_FORMAT = "signbridge-recognition-baseline-v1";
const statuses = new Set(["recognized", "unclear", "no_sign"]);
const languages = new Set(["isl", "asl"]);
const extensions = /\.(mp4|webm|mov|m4v|ogv|ogg|avi|mkv)$/i;
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
const label = (value) => typeof value === "string" && value.trim() && value.length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value.trim() : null;
const probability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const duration = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 12000 ? value : null;
const fail = (code, error) => ({ ok: false, code, error });

/** Diagnostic A/B transform only; camera features and learned weights stay unchanged. */
export function prepareReplayFrames(frames, coordinateContract = "normalized-image", signLanguage) {
  if (signLanguage !== undefined && !languages.has(signLanguage)) throw new Error("Choose ISL or ASL for replay coordinates.");
  if (coordinateContract === "normalized-image") return frames;
  if (coordinateContract !== "archive-isl-hw-1080x1920-experiment") throw new Error("Choose a supported replay coordinate contract.");
  if (signLanguage !== "isl") throw new Error("The archive coordinate experiment is available for ISL only.");
  validatePoseGraphFrames(frames);
  return frames.map((frame) => ({ ...frame,
    keypoints: frame.keypoints.map(([x, y, z]) => [x * 1080, y * 1920, z]),
    confidences: [...frame.confidences],
  }));
}

/** Validate locally before decoding; the browser still decides whether it can play the codec. */
export function validateReplayVideo(file, durationSeconds) {
  if (!file || typeof file !== "object") return fail("file", "Choose a local sign video.");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_REPLAY_VIDEO_BYTES) return fail("size", "Choose a non-empty video no larger than 100 MiB.");
  const type = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (type ? !/^video\/[^\s/]+$/.test(type) : !extensions.test(typeof file.name === "string" ? file.name : "")) return fail("type", "Choose a video file. This browser may not support every video codec.");
  if (durationSeconds !== undefined && (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < MIN_REPLAY_DURATION_SECONDS || durationSeconds > MAX_REPLAY_DURATION_SECONDS)) return fail("duration", "Choose one complete sign between 0.35 and 12 seconds.");
  return { ok: true };
}

/** Parse only the baseline contract; extra fields, including file identities, are never retained. */
export function validateReplayBaseline(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.format !== BASELINE_FORMAT) return fail("format", "Use a signbridge-recognition-baseline-v1 baseline.");
  if (!languages.has(value.signLanguage)) return fail("language", "The baseline must specify ISL or ASL.");
  const expectedLabel = label(value.expectedLabel), modelSha256 = hash(value.modelSha256), videoSha256 = hash(value.videoSha256);
  if (!expectedLabel) return fail("label", "The baseline needs a sign label of 1 to 80 characters.");
  if (!modelSha256) return fail("hash", "The baseline needs the exact model SHA-256 hash.");
  if (!videoSha256) return fail("video-hash", "The baseline needs the exact source video SHA-256 hash.");
  const prediction = value.prediction;
  if (!prediction || typeof prediction !== "object" || Array.isArray(prediction) || !statuses.has(prediction.status)) return fail("prediction", "The baseline needs a valid offline prediction status.");
  const topLabel = label(prediction.topLabel), topScore = probability(prediction.topScore);
  if ((prediction.topLabel !== null && !topLabel) || (prediction.topScore !== null && topScore === null) || (topLabel === null) !== (topScore === null) || (prediction.status === "recognized" && topLabel === null)) return fail("prediction", "The baseline prediction needs a label and score together, or both null when no word was accepted.");
  return { ok: true, baseline: { format: BASELINE_FORMAT, signLanguage: value.signLanguage, expectedLabel, modelSha256, videoSha256,
    prediction: { status: prediction.status, topLabel, topScore } } };
}

function compareBaseline(value, signLanguage, modelSha256, videoSha256, prediction) {
  const comparison = { status: "missing-baseline", baselineExpectedLabel: null, baselineStatus: null,
    baselineTopLabel: null, baselineTopScore: null, topLabelMatches: null, acceptedMeaningMatches: null };
  if (value === undefined || value === null) return comparison;
  const validated = validateReplayBaseline(value);
  if (!validated.ok) return { ...comparison, status: "invalid-baseline" };
  const baseline = validated.baseline;
  Object.assign(comparison, { baselineExpectedLabel: baseline.expectedLabel, baselineStatus: baseline.prediction.status,
    baselineTopLabel: baseline.prediction.topLabel, baselineTopScore: baseline.prediction.topScore });
  if (baseline.signLanguage !== signLanguage) return { ...comparison, status: "language-mismatch" };
  if (!modelSha256) return { ...comparison, status: "model-unavailable" };
  if (baseline.modelSha256 !== modelSha256) return { ...comparison, status: "model-mismatch" };
  if (!videoSha256) return { ...comparison, status: "video-unavailable" };
  if (baseline.videoSha256 !== videoSha256) return { ...comparison, status: "video-mismatch" };
  const baselineAccepted = baseline.prediction.status === "recognized";
  const replayAccepted = prediction.status === "recognized";
  return { ...comparison, status: "matched-model",
    topLabelMatches: prediction.topLabel && baseline.prediction.topLabel ? prediction.topLabel === baseline.prediction.topLabel : null,
    // Two rejections agree about withholding a word; they do not establish sign accuracy.
    acceptedMeaningMatches: replayAccepted === baselineAccepted && (!replayAccepted || Boolean(prediction.meaning && prediction.meaning === baseline.prediction.topLabel)),
  };
}

/** Snapshot diagnostics only. No predictor, raw pose, filename, storage, or network access. */
export function summarizeReplay(frames, durationMs, result, { signLanguage, modelSha256 = null, videoSha256 = null, baseline = null, samplingMode = "realtime-8hz", trackerBackend = "tasks-holistic", coordinateContract = "normalized-image", modelCameraInput = null } = {}) {
  if (!languages.has(signLanguage)) throw new Error("Choose ISL or ASL for the replay report.");
  const safe = createSignRecognitionReport(result, null, "1970-01-01T00:00:00.000Z").result;
  if (safe.model?.signLanguage && safe.model.signLanguage !== signLanguage) throw new Error("The replay result belongs to a different sign language.");
  const measured = describeGraphCapture(frames);
  const quality = validateCameraTurn(frames, { durationMs });
  const topLabel = label(safe.posterior?.topLabel), topScore = probability(safe.posterior?.topScore);
  const prediction = { status: safe.status, inferenceRan: safe.inferenceRan, topLabel, topScore,
    // An arbitrary reviewed message is not a model prediction. Only the accepted posterior label is reported.
    meaning: safe.status === "recognized" && topLabel && topScore !== null && result.meaning === topLabel ? topLabel : "",
    reasonCodes: [...safe.reasonCodes], threshold: safe.model?.threshold ?? null, requiredMargin: safe.model?.requiredMargin ?? null,
    scorePassed: safe.posterior?.scorePassed ?? null, marginPassed: safe.posterior?.marginPassed ?? null,
    modelFrames: safe.capture?.modelFrames ?? null };
  const actualHash = hash(modelSha256), actualVideoHash = hash(videoSha256);
  const safeSamplingMode = samplingMode === "sequential-25fps" ? "sequential-25fps" : "realtime-8hz";
  let safeCameraInput = null;
  try { if (modelCameraInput) safeCameraInput = validateCameraInputContract({ format: "signbridge-gru-v2", cameraInput: modelCameraInput }); } catch { /* Do not retain invalid or private metadata. */ }
  return { format: "signbridge-recognition-replay-v1",
    purpose: "One local video replay for engineering comparison; no live-camera or sign-language accuracy is established.",
    samplingMode: safeSamplingMode, captureClock: safeSamplingMode === "sequential-25fps" ? "source" : "wall",
    trackerBackend: safeSamplingMode === "sequential-25fps" && trackerBackend === "solutions-holistic-experiment" ? trackerBackend : "tasks-holistic",
    coordinateContract: signLanguage === "isl" && coordinateContract === "archive-isl-hw-1080x1920-experiment" ? coordinateContract : "normalized-image",
    modelCameraInput: safeCameraInput,
    signLanguage, modelSha256: actualHash, videoSha256: actualVideoHash, frameCount: Array.isArray(frames) ? count(frames.length) : null, durationMs: duration(durationMs),
    quality: { passed: quality.ok, code: quality.code,
      handFrames: count(measured.handFrames), shoulderFrames: count(measured.shoulderFrames), qualifiedFrames: count(measured.qualifiedFrames),
      largestGapMs: duration(quality.metrics?.largestGapMs) },
    prediction, comparison: compareBaseline(baseline, signLanguage, actualHash, actualVideoHash, prediction) };
}
