import test from "node:test";
import assert from "node:assert/strict";
import { assessNonsigningCapture, copyNonsigningFrame } from "../src/lib/nonsigningCapture.js";

const pose = () => ({ keypoints: Array.from({ length: 75 }, () => [0, 0, 0]), confidences: Array(75).fill(0) });
const sequence = (times = [0, 1000, 2000, 3000]) => times.map((atMs) => copyNonsigningFrame(pose(), atMs));

test("fresh measured zero-landmark poses are valid nonsigning examples without visible hands or shoulders", () => {
  assert.deepEqual(assessNonsigningCapture(sequence(), 3000), { ok: true, feedback: "Check the recording and confirm that you did not intentionally sign.", count: 4, durationMs: 3000, largestGapMs: 1000 });
});

test("capture snapshots only finite coordinates/confidences and timing, without arbitrary model or private metadata", () => {
  const raw = { ...pose(), prediction: { label: "BOOK" }, secret: "ignored" };
  const copy = copyNonsigningFrame(raw, 125); raw.keypoints[0][0] = .8; raw.confidences[0] = 1;
  assert.deepEqual(Object.keys(copy), ["keypoints", "confidences", "atMs"]);
  assert.equal(copy.keypoints[0][0], 0); assert.equal(copy.confidences[0], 0);
  for (const invalid of [NaN, Infinity, -1, 3001, undefined]) assert.equal(copyNonsigningFrame(pose(), invalid), null);
  const sparse = pose(); sparse.keypoints[0] = Array(3); assert.equal(copyNonsigningFrame(sparse, 0), null);
  delete sparse.keypoints[0]; assert.equal(copyNonsigningFrame(sparse, 0), null);
  const nonfinite = pose(); nonfinite.keypoints[4][1] = NaN; assert.equal(copyNonsigningFrame(nonfinite, 0), null);
});

test("missing, duplicate, reversed or out-of-window timings cannot be saved", () => {
  for (const frames of [sequence([0, 500, 500, 3000]), sequence([0, 1500, 1000, 3000]), [{ ...sequence()[0], atMs: undefined }, ...sequence().slice(1)], sequence([0, 500, 1000, 2500])]) {
    assert.equal(assessNonsigningCapture(frames, 2000).ok, false);
  }
  for (const duration of [undefined, NaN, 0, 349, 4001]) assert.equal(assessNonsigningCapture(sequence(), duration).ok, false);
  assert.equal(assessNonsigningCapture(sequence().slice(0, 3), 3000).ok, false);
  assert.equal(assessNonsigningCapture(Array.from({ length: 101 }, (_, i) => copyNonsigningFrame(pose(), i * 30)), 3000).ok, false);
});

test("interframe, initial and trailing tracking gaps above one second reject before storage", () => {
  for (const times of [[0, 500, 2001, 3000], [1001, 1500, 2000, 3000], [0, 500, 1000, 1999]]) {
    assert.match(assessNonsigningCapture(sequence(times), 3000).feedback, /Tracking paused/);
  }
});

test("malformed and sparse frame sequences reject without throwing or inventing tracking observations", () => {
  for (const invalid of [null, undefined, {}, []]) {
    const frames = sequence(); frames[1] = invalid;
    assert.equal(assessNonsigningCapture(frames, 3000).ok, false);
  }
  const sparse = sequence(); delete sparse[1];
  assert.equal(assessNonsigningCapture(sparse, 3000).ok, false);
});

test("actual timer delay is retained; a small delay is accepted but a long trailing pause rejects", () => {
  const delayed = assessNonsigningCapture(sequence(), 3150);
  assert.equal(delayed.ok, true); assert.equal(delayed.durationMs, 3150);
  const shortLastFrame = sequence([125, 1000, 2000, 2500]);
  assert.match(assessNonsigningCapture(shortLastFrame, 3800).feedback, /Tracking paused/);
  assert.equal(assessNonsigningCapture(sequence(), 5000).ok, false);
});
