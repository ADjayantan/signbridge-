export const CAPTURE_CONTEXT_FORMAT = "signbridge-capture-context-v1";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";
const PIPELINE = Object.freeze({
  format: CAPTURE_CONTEXT_FORMAT, tracker: "mediapipe-tasks-holistic",
  modelAsset: "holistic_landmarker/float16/1", delegate: "CPU", runningMode: "VIDEO",
  coordinateSpace: "normalized-image", sampleIntervalMs: 125, mirrorApplied: false,
});
const keys = [...Object.keys(PIPELINE), "width", "height"];
const dimension = (value) => Number.isInteger(value) && value > 0 && value <= 16384;

/** Preserve a declared capture pipeline; missing metadata must never be inferred. */
export function validateCaptureContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key)) ||
    Object.entries(PIPELINE).some(([key, value]) => input[key] !== value) ||
    !dimension(input.width) || !dimension(input.height)) {
    throw new Error("Capture context must describe the supported tracker and actual video dimensions.");
  }
  return { ...PIPELINE, width: input.width, height: input.height };
}

/** Dimensions come from the decoded source, never the requested camera constraints. */
export function captureContextForVideo(video, modelAssetUrl) {
  if (modelAssetUrl !== MODEL_URL) throw new Error("The tracker model needs a matching capture-context contract.");
  return validateCaptureContext({ ...PIPELINE, width: video?.videoWidth, height: video?.videoHeight });
}

export function copyFrameCaptureContext(frame) {
  return Object.hasOwn(frame, "captureContext") ? { captureContext: validateCaptureContext(frame.captureContext) } : {};
}
