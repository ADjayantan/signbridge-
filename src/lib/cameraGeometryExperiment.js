const geometryKeys = ["sourceWidth", "sourceHeight", "referenceWidth", "referenceHeight"];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const dimension = (value) => finite(value) && value >= 1 && value <= 16384;

/**
 * Diagnostic only: compare normalized camera geometry with an explicitly pinned
 * reference aspect before the existing model-domain adapter. This does not
 * identify a model, alter its coordinate metadata, or establish camera accuracy.
 */
export function cameraGeometryForExperiment(frames, geometry) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry) ||
    Object.keys(geometry).length !== geometryKeys.length ||
    !geometryKeys.every((key) => Object.hasOwn(geometry, key) && dimension(geometry[key]))) {
    throw new Error("The geometry experiment needs explicit source and reference width/height between 1 and 16384.");
  }
  if (!Array.isArray(frames) || frames.length > 4096 || !Array.from(frames).every((frame) =>
    Array.isArray(frame?.keypoints) && frame.keypoints.length === 75 &&
    Array.isArray(frame.confidences) && frame.confidences.length === 75 &&
    Array.from(frame.confidences).every((value) => finite(value) && value >= 0 && value <= 1) &&
    Array.from(frame.keypoints).every((point) => Array.isArray(point) && point.length === 3 &&
      Array.from(point).every((value) => finite(value) && Math.abs(value) <= 10)))) {
    throw new Error("The geometry experiment needs normalized poses with 75 finite joints and confidence values.");
  }
  const { sourceWidth, sourceHeight, referenceWidth, referenceHeight } = geometry;
  // Equal aspect returns the original array, without floating-point drift or an
  // unnecessary copy. Validation still occurs before this identity fast path.
  if (sourceWidth * referenceHeight === referenceWidth * sourceHeight) return frames;
  const factor = (sourceWidth / sourceHeight) / (referenceWidth / referenceHeight);
  return frames.map((frame) => ({
    ...frame,
    keypoints: frame.keypoints.map(([x, y, z], joint) =>
      frame.confidences[joint] === 0 ? [x, y, z] : [.5 + (x - .5) * factor, y, z]),
    confidences: [...frame.confidences],
  }));
}
