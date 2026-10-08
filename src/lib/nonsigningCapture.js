export const NONSIGNING_CAPTURE_MS = 3000;
// A late timer must retain its actual window and pass the same one-second gap limit.
export const NONSIGNING_MAX_ELAPSED_MS = NONSIGNING_CAPTURE_MS + 1000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

// Missing body or hands are valid negatives. A paused tracker is not a recording.
export function copyNonsigningFrame(pose, atMs) {
  if (!finite(atMs) || atMs < 0 || atMs > NONSIGNING_CAPTURE_MS ||
    !Array.isArray(pose?.keypoints) || pose.keypoints.length !== 75 ||
    !Array.isArray(pose.confidences) || pose.confidences.length !== 75 ||
    !Array.from(pose.keypoints).every((point) => Array.isArray(point) && point.length === 3 && Array.from(point).every((value) => finite(value) && Math.abs(value) <= 10)) ||
    !Array.from(pose.confidences).every((value) => finite(value) && value >= 0 && value <= 1)) return null;
  return { keypoints: pose.keypoints.map((point) => [...point]), confidences: [...pose.confidences], atMs };
}

export function assessNonsigningCapture(frames, durationMs) {
  const fail = (feedback) => ({ ok: false, feedback, count: Array.isArray(frames) ? frames.length : 0, durationMs });
  if (!finite(durationMs) || durationMs < 350 || durationMs > NONSIGNING_MAX_ELAPSED_MS) return fail("Recording timing could not be checked or the recording ran too long. Record a fresh three-second example.");
  if (!Array.isArray(frames) || frames.length < 4 || frames.length > 100) return fail("Not enough fresh tracking samples. Keep the camera running and record again.");
  let previous = -1;
  for (const frame of frames) {
    if (!copyNonsigningFrame(frame, frame?.atMs) || frame.atMs <= previous || frame.atMs > durationMs) return fail("Tracking data or timing could not be read. Record a new example.");
    previous = frame.atMs;
  }
  const largestGapMs = Math.max(frames[0].atMs, durationMs - frames.at(-1).atMs, ...frames.slice(1).map((frame, index) => frame.atMs - frames[index].atMs));
  if (largestGapMs > 1000) return fail("Tracking paused for over one second. Nothing was saved; retry tracking and record again.");
  return { ok: true, feedback: "Check the recording and confirm that you did not intentionally sign.", count: frames.length, durationMs, largestGapMs };
}
