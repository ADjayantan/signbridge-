import { describeGraphCapture, validateCameraTurn } from "./graphSignModel.js";
import { predictTrainedSign, validateTrainedModel } from "./trainedSignModel.js";
import { cameraFramesForModel, validateCameraInputContract } from "./cameraCoordinateContract.js";

/** Camera-only quality checks leave the archive preprocessing and GRU API unchanged. */
export function predictTrainedCameraSign(model, frames, { durationMs, framesAlreadyInModelSpace = false } = {}) {
  validateTrainedModel(model);
  validateCameraInputContract(model);
  if (typeof framesAlreadyInModelSpace !== "boolean") throw new Error("framesAlreadyInModelSpace must be a boolean diagnostic option.");
  const quality = Number.isFinite(durationMs)
    ? validateCameraTurn(frames, { durationMs })
    : { ok: false, code: "duration", feedback: "Capture timing is missing. Capture a new complete word.", metrics: {} };
  const measured = describeGraphCapture(frames);
  const timing = {
    ...(Number.isFinite(durationMs) ? { durationMs } : {}),
    ...(Number.isFinite(quality.metrics?.largestGapMs) ? { largestGapMs: quality.metrics.largestGapMs } : {}),
  };
  const cameraGate = { passed: quality.ok, code: quality.code };
  if (!quality.ok) return {
    status: "no_sign", meaning: "", glosses: [], feedback: quality.feedback,
    candidates: [], score: 0, margin: 0,
    diagnostics: {
      inferenceRan: false, reasonCodes: [quality.code],
      model: { signLanguage: model.signLanguage, engine: "legacy", labelsCount: model.labels.length,
        threshold: model.threshold, requiredMargin: model.margin, acceptanceEnabled: model.acceptanceEnabled !== false },
      capture: { ...measured, modelFrames: 0, ...timing }, posterior: null, cameraGate,
    },
  };
  const inferenceFrames = cameraFramesForModel(model, frames, { framesAlreadyInModelSpace });
  const result = predictTrainedSign(model, inferenceFrames);
  return { ...result, diagnostics: {
    ...result.diagnostics, capture: { ...result.diagnostics.capture, ...timing }, cameraGate,
  } };
}
