export const CAMERA_COORDINATE_FORMAT = "signbridge-camera-coordinates-v1";
const keys = ["format", "space", "scaleX", "scaleY"];
const scale = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 16384;

/** v1 keeps its historical unspecified identity; only v2 declares an adapter. */
export function validateCameraInputContract(model) {
  if (!model || (model.format !== "signbridge-gru-v1" && model.format !== "signbridge-gru-v2")) throw new Error("Unsupported model camera-coordinate contract.");
  if (model.format === "signbridge-gru-v1") {
    if ("cameraInput" in model) throw new Error("Camera-coordinate metadata requires a signbridge-gru-v2 artifact.");
    return null;
  }
  const input = model.cameraInput;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(input, key)) || input.format !== CAMERA_COORDINATE_FORMAT ||
    !["normalized-image", "axis-scaled-image"].includes(input.space) || !scale(input.scaleX) || !scale(input.scaleY) ||
    (input.space === "normalized-image" && (input.scaleX !== 1 || input.scaleY !== 1))) throw new Error("Invalid model camera-coordinate metadata.");
  return Object.freeze({ format: CAMERA_COORDINATE_FORMAT, space: input.space, scaleX: input.scaleX, scaleY: input.scaleY });
}

/** Apply a declared model-domain conversion once, after camera quality checks. */
export function cameraFramesForModel(model, frames, { framesAlreadyInModelSpace = false } = {}) {
  const contract = validateCameraInputContract(model);
  if (typeof framesAlreadyInModelSpace !== "boolean") throw new Error("framesAlreadyInModelSpace must be a boolean diagnostic option.");
  if (!contract || framesAlreadyInModelSpace || contract.space === "normalized-image") return frames;
  if (!Array.isArray(frames)) throw new Error("Camera-coordinate conversion requires pose frames.");
  return frames.map((frame) => {
    if (!frame || !Array.isArray(frame.keypoints)) throw new Error("Camera-coordinate conversion requires pose landmarks.");
    const keypoints = frame.keypoints.map((point) => {
      if (!Array.isArray(point) || point.length !== 3 || !point.every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error("Camera-coordinate conversion requires finite x/y/z landmarks.");
      const [x, y, z] = point, convertedX = x * contract.scaleX, convertedY = y * contract.scaleY;
      if (!Number.isFinite(convertedX) || !Number.isFinite(convertedY)) throw new Error("Camera-coordinate conversion exceeded finite coordinate bounds.");
      return [convertedX, convertedY, z];
    });
    return { ...frame, keypoints, ...(Array.isArray(frame.confidences) ? { confidences: [...frame.confidences] } : {}) };
  });
}
