import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraGeometryForExperiment } from "../src/lib/cameraGeometryExperiment.js";
import { cameraFramesForModel } from "../src/lib/cameraCoordinateContract.js";
import { preprocessPoseSequence } from "../src/lib/trainedSignModel.js";
import { legacyCameraFrames } from "./helpers/legacyCamera.js";

const geometry = (overrides = {}) => ({ sourceWidth: 640, sourceHeight: 480, referenceWidth: 1920, referenceHeight: 1088, ...overrides });

test("explicit geometry correction scales normalized x offsets around image center only", () => {
  const frames = legacyCameraFrames();
  frames[0].keypoints[33] = [.7, .65, -.12];
  const corrected = cameraGeometryForExperiment(frames, geometry());
  const factor = (640 / 480) / (1920 / 1088);
  assert.equal(corrected[0].keypoints[33][0], .5 + (.7 - .5) * factor);
  assert.deepEqual(corrected[0].keypoints[33].slice(1), [.65, -.12]);
  assert.deepEqual(corrected.map((frame) => frame.atMs), frames.map((frame) => frame.atMs));
  assert.deepEqual(corrected.map((frame) => frame.confidences), frames.map((frame) => frame.confidences));
});

test("confidence-zero joints retain absent zero placeholders without synthesizing positions", () => {
  const frames = legacyCameraFrames();
  frames[0].keypoints[34] = [0, 0, 0]; frames[0].confidences[34] = 0;
  frames[0].keypoints[35] = [.9, .2, -.3]; frames[0].confidences[35] = 0;
  const corrected = cameraGeometryForExperiment(frames, geometry());
  assert.deepEqual(corrected[0].keypoints[34], [0, 0, 0]);
  assert.deepEqual(corrected[0].keypoints[35], [.9, .2, -.3]);
  assert.equal(corrected[0].confidences[34], 0);
  assert.equal(corrected[0].confidences[35], 0);
});

test("equal source/reference aspect preserves exact identity even at a different resolution", () => {
  const frames = legacyCameraFrames();
  assert.equal(cameraGeometryForExperiment(frames, geometry({ sourceWidth: 960, sourceHeight: 544 })), frames);
  assert.equal(cameraGeometryForExperiment(frames, geometry({ sourceWidth: 1920, sourceHeight: 1088 })), frames);
});

test("geometry and frozen pose inputs are never mutated", () => {
  const frames = legacyCameraFrames(), metadata = geometry();
  const before = JSON.stringify({ frames, metadata });
  frames.forEach((frame) => {
    frame.keypoints.forEach(Object.freeze); Object.freeze(frame.keypoints); Object.freeze(frame.confidences); Object.freeze(frame);
  });
  Object.freeze(frames); Object.freeze(metadata);
  const corrected = cameraGeometryForExperiment(frames, metadata);
  assert.equal(JSON.stringify({ frames, metadata }), before);
  assert.notEqual(corrected, frames); assert.notEqual(corrected[0], frames[0]);
  assert.notEqual(corrected[0].keypoints, frames[0].keypoints);
  assert.notEqual(corrected[0].confidences, frames[0].confidences);
});

test("missing, partial, extra or inferred geometry is rejected rather than guessed", () => {
  const frames = legacyCameraFrames();
  for (const invalid of [undefined, null, [], false, "640x480", {}, { sourceWidth: 640, sourceHeight: 480 },
    { ...geometry(), referenceHeight: undefined }, { ...geometry(), signLanguage: "isl" },
    { ...geometry(), expectedLabel: "HELLO" }]) {
    assert.throws(() => cameraGeometryForExperiment(frames, invalid), /explicit source and reference/);
  }
});

test("all four geometry dimensions require finite numbers bounded from 1 through 16384", () => {
  const frames = legacyCameraFrames();
  for (const key of Object.keys(geometry())) {
    for (const value of [0, -1, .5, 16385, Infinity, NaN, "640", null, true]) {
      assert.throws(() => cameraGeometryForExperiment(frames, geometry({ [key]: value })), /width\/height/);
    }
  }
  assert.doesNotThrow(() => cameraGeometryForExperiment(frames, geometry({ sourceWidth: 1, sourceHeight: 16384 })));
  assert.doesNotThrow(() => cameraGeometryForExperiment(frames, geometry({ sourceWidth: 640.5 })));
});

test("invalid pose data is rejected even when geometry would be identity", () => {
  const same = geometry({ sourceWidth: 1920, sourceHeight: 1088 });
  for (const value of [null, {}, new Array(1), [{ keypoints: [], confidences: [] }]]) {
    assert.throws(() => cameraGeometryForExperiment(value, same), /normalized poses/);
  }
  for (const change of [
    (frame) => { frame.keypoints[0][0] = NaN; },
    (frame) => { frame.keypoints[0][0] = 1080; },
    (frame) => { frame.keypoints[0] = new Array(3); },
    (frame) => { frame.confidences[0] = 2; },
    (frame) => { frame.confidences = new Array(75); },
  ]) {
    const frames = legacyCameraFrames(); change(frames[0]);
    assert.throws(() => cameraGeometryForExperiment(frames, same), /normalized poses/);
  }
});

test("aspect-preserving 4:3 framing restores the reference feature metric including tilted shoulders", () => {
  const reference = legacyCameraFrames();
  reference.forEach((frame, i) => {
    frame.keypoints[11] = [.3, .45, 0]; frame.keypoints[12] = [.7, .55, 0];
    frame.keypoints[33] = [.6 + .01 * i, .7, -.1];
  });
  const factor = (640 / 480) / (1920 / 1088);
  const framed = reference.map((frame) => ({ ...frame, keypoints: frame.keypoints.map(([x, y, z], joint) =>
    frame.confidences[joint] === 0 ? [x, y, z] : [x, .5 + (y - .5) * factor, z]) }));
  const model = { format: "signbridge-gru-v2", cameraInput: {
    format: "signbridge-camera-coordinates-v1", space: "axis-scaled-image", scaleX: 1080, scaleY: 1920,
  } };
  const features = (frames) => preprocessPoseSequence(cameraFramesForModel(model, frames));
  const baseline = features(reference), corrected = features(cameraGeometryForExperiment(framed, geometry()));
  const wrong = features(framed);
  const maxDifference = (values) => Math.max(...baseline.flatMap((row, i) => row.map((value, j) => Math.abs(value - values[i][j]))));
  assert.ok(maxDifference(wrong) > .1);
  assert.ok(maxDifference(corrected) < 1e-12);
  assert.deepEqual(model.cameraInput, { format: "signbridge-camera-coordinates-v1", space: "axis-scaled-image", scaleX: 1080, scaleY: 1920 });
});
