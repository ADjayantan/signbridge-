import { handsFromPoseFrame } from "./handJoints.js";

const MAX_MESSAGE = 2000;
const MAX_UNDO = 30;
export const EMPTY_SIGN_DRAFT = Object.freeze({ text: "", history: [] });

/** Undo keeps whole reviewed additions intact, including repeated and multi-word signs. */
export function signDraftReducer(state, action) {
  if (action.type === "clear") return { text: "", history: [] };
  if (action.type === "undo") {
    if (!state.history.length) return state;
    return { text: state.history.at(-1), history: state.history.slice(0, -1) };
  }
  const value = typeof action.text === "string" ? action.text : "";
  const text = action.type === "append" ? [state.text.trim(), value.trim()].filter(Boolean).join(" ") : value;
  if (!["append", "edit"].includes(action.type) || text.length > MAX_MESSAGE || text === state.text) return state;
  return { text, history: [...state.history, state.text].slice(-MAX_UNDO) };
}

export function poseFraming(frame) {
  const hands = handsFromPoseFrame(frame);
  const clipped = hands.some((hand) => hand.landmarks.some(({ x, y }) => x <= .02 || x >= .98 || y <= .02 || y >= .98));
  return { hands: hands.length, body: frame?.confidences?.[11] >= .2 && frame?.confidences?.[12] >= .2, clipped };
}

/** Capture diagnostics describe tracking quality; they do not score the signer's language. */
export function describePoseCapture(frames, elapsedMs) {
  const count = frames.length;
  const handFrames = frames.filter((frame) => handsFromPoseFrame(frame).length > 0).length;
  const shoulderFrames = frames.filter((frame) => frame.confidences[11] >= .2 && frame.confidences[12] >= .2).length;
  const clippedFrames = frames.filter((frame) => poseFraming(frame).clipped).length;
  const timestamps = frames.map((frame) => frame.atMs);
  const timed = timestamps.every(Number.isFinite) && timestamps.every((at, i) => i === 0 || at >= timestamps[i - 1]);
  const gaps = timed ? timestamps.slice(1).map((at, i) => at - timestamps[i]) : [];
  // Include time before the first and after the last tracked sample.
  const largestGapMs = timed && count ? Math.max(timestamps[0], Math.max(0, elapsedMs - timestamps.at(-1)), ...gaps) : null;
  const hints = [];
  if (handFrames < 4) hints.push("Show your signing hand for the whole movement.");
  if (shoulderFrames < 4 || (count && shoulderFrames / count < .8)) hints.push("Keep both shoulders in view; move the camera farther back.");
  if (clippedFrames) hints.push("Your hand reached the edge of the frame. Leave more space around your signing area.");
  if (largestGapMs > 750) hints.push("Tracking paused during this turn. Try again with steady lighting and fewer apps running.");
  return { count, durationMs: elapsedMs, samplesPerSecond: elapsedMs > 0 ? count / (elapsedMs / 1000) : 0,
    handFrames, shoulderFrames, clippedFrames, largestGapMs, hints };
}
