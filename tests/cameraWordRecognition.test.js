import assert from "node:assert/strict";
import { test } from "node:test";
import { predictTrainedCameraSign } from "../src/lib/cameraWordRecognition.js";
import { predictTrainedSign } from "../src/lib/trainedSignModel.js";
import { legacyCameraFrame, legacyCameraFrames, legacyCameraModel } from "./helpers/legacyCamera.js";

const recapture = (result, reason) => {
  assert.equal(result.status, "no_sign");
  assert.equal(result.meaning, "");
  assert.deepEqual(result.glosses, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.diagnostics.inferenceRan, false);
  assert.equal(result.diagnostics.posterior, null);
  assert.equal(result.diagnostics.capture.modelFrames, 0);
  assert.deepEqual(result.diagnostics.reasonCodes, [reason]);
  assert.deepEqual(result.diagnostics.cameraGate, { passed: false, code: reason });
};

test("valid camera capture preserves the archive predictor's numerical decision and adds measured timing", () => {
  const model = legacyCameraModel(), frames = legacyCameraFrames();
  const archive = predictTrainedSign(model, frames);
  const camera = predictTrainedCameraSign(model, frames, { durationMs: 500 });
  assert.equal(camera.status, "recognized");
  for (const key of ["status", "meaning", "glosses", "feedback", "score", "margin", "candidates"]) assert.deepEqual(camera[key], archive[key]);
  assert.deepEqual(camera.diagnostics.posterior, archive.diagnostics.posterior);
  assert.deepEqual(camera.diagnostics.reasonCodes, archive.diagnostics.reasonCodes);
  assert.deepEqual(camera.diagnostics.cameraGate, { passed: true, code: "" });
  assert.equal(camera.diagnostics.capture.durationMs, 500);
  assert.equal(camera.diagnostics.capture.largestGapMs, 125);
  assert.equal(camera.diagnostics.capture.modelFrames, 32);
});

test("healthy camera timing does not override an uncertain learned prediction or disabled model acceptance", () => {
  for (const model of [legacyCameraModel(), { ...legacyCameraModel(), acceptanceEnabled: false }]) {
    model.weights.head_bias = [1, -1];
    const frames = legacyCameraFrames(), archive = predictTrainedSign(model, frames);
    const camera = predictTrainedCameraSign(model, frames, { durationMs: 500 });
    assert.equal(camera.status, "unclear"); assert.equal(camera.meaning, "");
    assert.deepEqual(camera.diagnostics.posterior, archive.diagnostics.posterior);
    assert.deepEqual(camera.diagnostics.reasonCodes, archive.diagnostics.reasonCodes);
    assert.equal(camera.diagnostics.inferenceRan, archive.diagnostics.inferenceRan);
    assert.deepEqual(camera.diagnostics.cameraGate, { passed: true, code: "" });
  }
});

test("hand-only and shoulder-only samples cannot together qualify a camera capture", () => {
  const frames = [legacyCameraFrame({ shoulders: false }),
    ...Array.from({ length: 4 }, (_, i) => legacyCameraFrame({ hand: false, atMs: 125 * (i + 1) })),
    ...Array.from({ length: 3 }, (_, i) => legacyCameraFrame({ shoulders: false, atMs: 625 + 125 * i }))];
  const model = legacyCameraModel();
  assert.equal(predictTrainedSign(model, frames).status, "recognized");
  const result = predictTrainedCameraSign(model, frames, { durationMs: 1000 });
  recapture(result, "framing");
  assert.equal(result.diagnostics.capture.handFrames, 4);
  assert.equal(result.diagnostics.capture.shoulderFrames, 4);
  assert.equal(result.diagnostics.capture.qualifiedFrames, 0);
});

for (const [position, times, durationMs, largestGapMs] of [
  ["initial", [1100, 1225, 1350, 1475], 1500, 1100],
  ["internal", [0, 125, 1500, 1625], 1750, 1375],
  ["trailing", [0, 125, 250, 375], 3000, 2625],
]) test(`${position} tracking gaps reject a camera capture before inference`, () => {
  const frames = times.map((atMs) => legacyCameraFrame({ atMs }));
  const model = legacyCameraModel();
  assert.equal(predictTrainedSign(model, frames).status, "recognized");
  const result = predictTrainedCameraSign(model, frames, { durationMs });
  recapture(result, "tracking-gap");
  assert.equal(result.diagnostics.capture.largestGapMs, largestGapMs);
});

for (const [name, durationMs] of [["missing", undefined], ["nonfinite", NaN], ["too short", 349], ["too long", 12001], ["before the last frame", 374]]) {
  test(`${name} actual capture duration cannot silently use the last sample's timestamp`, () => {
    const result = predictTrainedCameraSign(legacyCameraModel(), legacyCameraFrames(), { durationMs });
    recapture(result, "duration");
    if (!Number.isFinite(durationMs)) assert.equal("durationMs" in result.diagnostics.capture, false);
  });
}

for (const [name, mutate] of [
  ["missing", (frames) => { delete frames[0].atMs; }],
  ["negative", (frames) => { frames[0].atMs = -1; }],
  ["regressing", (frames) => { frames[2].atMs = 100; }],
  ["repeated", (frames) => { frames[2].atMs = 125; }],
]) test(`${name} sample timestamps cannot become a fresh camera turn`, () => {
  const frames = legacyCameraFrames(); mutate(frames);
  recapture(predictTrainedCameraSign(legacyCameraModel(), frames, { durationMs: 500 }), "timing");
});

test("too few, too many and malformed samples remain reviewable recaptures", () => {
  recapture(predictTrainedCameraSign(legacyCameraModel(), legacyCameraFrames(3), { durationMs: 500 }), "sample-count");
  recapture(predictTrainedCameraSign(legacyCameraModel(), legacyCameraFrames(101), { durationMs: 12000 }), "sample-count");
  recapture(predictTrainedCameraSign(legacyCameraModel(), [{ keypoints: [], confidences: [] }], { durationMs: 500 }), "invalid-pose");
});

test("camera diagnostics retain only scalar observations and never raw poses", () => {
  const frames = legacyCameraFrames(), result = predictTrainedCameraSign(legacyCameraModel(), frames, { durationMs: 3000 });
  const original = JSON.stringify(result.diagnostics);
  frames[0].keypoints[33][0] = .99;
  assert.equal(JSON.stringify(result.diagnostics), original);
  assert.doesNotMatch(original, /keypoints|confidences|atMs/);
});
