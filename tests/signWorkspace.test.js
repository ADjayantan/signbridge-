import assert from "node:assert/strict";
import { test } from "node:test";
import { describePoseCapture, EMPTY_SIGN_DRAFT, poseFraming, signDraftReducer } from "../src/lib/signWorkspace.js";

const frame = (atMs, hand = true, shoulders = true) => ({ atMs, keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array.from({ length: 75 }, (_, i) => i === 11 || i === 12 ? (shoulders ? 1 : 0) : i >= 33 ? (hand ? 1 : 0) : 0) });
test("undo removes one complete reviewed addition, including repeated and multi-word signs", () => {
  let state = signDraftReducer(EMPTY_SIGN_DRAFT, { type: "append", text: " HELP " });
  state = signDraftReducer(state, { type: "append", text: "HELP" });
  state = signDraftReducer(state, { type: "append", text: "THANK YOU" });
  assert.equal(state.text, "HELP HELP THANK YOU");
  state = signDraftReducer(state, { type: "undo" }); assert.equal(state.text, "HELP HELP");
  state = signDraftReducer(state, { type: "edit", text: "I need help" });
  state = signDraftReducer(state, { type: "undo" }); assert.equal(state.text, "HELP HELP");
});
test("draft limits never silently truncate a reviewed sign and clearing drops undo history", () => {
  const state = signDraftReducer(EMPTY_SIGN_DRAFT, { type: "edit", text: "x".repeat(1999) });
  assert.equal(signDraftReducer(state, { type: "append", text: "HELP" }), state);
  assert.equal(signDraftReducer(state, { type: "edit", text: "x".repeat(2001) }), state);
  assert.deepEqual(signDraftReducer(state, { type: "clear" }), { text: "", history: [] });
});
test("framing supports one-hand signs and diagnoses visible hand clipping without counting missing zeros", () => {
  const single = frame(0); single.confidences.fill(0, 54);
  assert.deepEqual(poseFraming(single), { hands: 1, body: true, clipped: false });
  single.keypoints[37][0] = .999; assert.equal(poseFraming(single).clipped, true);
  single.confidences.fill(0, 33); assert.equal(poseFraming(single).clipped, false);
});
test("quality includes initial/final sampling gaps and shoulder loss, without grading signing ability", () => {
  const captures = [frame(200), frame(400), frame(1500, true, false), frame(1700)];
  const quality = describePoseCapture(captures, 2000);
  assert.equal(quality.largestGapMs, 1100); assert.equal(quality.samplesPerSecond, 2);
  assert.equal(quality.handFrames, 4); assert.equal(quality.shoulderFrames, 3);
  assert.ok(quality.hints.some((s) => s.includes("Tracking paused")));
  assert.ok(quality.hints.some((s) => s.includes("shoulders")));
  assert.equal(describePoseCapture([], 1000).largestGapMs, null);
});

test("framing requires a complete detected hand, not only a confident wrist or imputed missing joints", () => {
  const partial = frame(0); partial.confidences.fill(0, 33); partial.confidences[33] = 1;
  partial.keypoints[34] = [0, 0, 0];
  assert.deepEqual(poseFraming(partial), { hands: 0, body: true, clipped: false });
  assert.equal(describePoseCapture([partial], 125).handFrames, 0);
  partial.confidences.fill(1, 33, 54); partial.keypoints[34] = [.5, .5, NaN];
  assert.equal(poseFraming(partial).hands, 0);
});
