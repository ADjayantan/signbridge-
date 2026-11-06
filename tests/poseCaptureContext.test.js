import test from "node:test";
import assert from "node:assert/strict";
import { captureContextForVideo, copyFrameCaptureContext, validateCaptureContext } from "../src/lib/poseCaptureContext.js";
import { copyNonsigningFrame } from "../src/lib/nonsigningCapture.js";
import { exportTrainingDataset, saveTrainingSample, validateTrainingSample } from "../src/lib/trainingSamples.js";
import { createAutomaticSignCapture } from "../src/lib/automaticSignCapture.js";
import { IDBFactory } from "fake-indexeddb";

const modelUrl = "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";
const context = (width = 640, height = 480) => captureContextForVideo({ videoWidth: width, videoHeight: height }, modelUrl);
function pose(atMs, captureContext) {
  const keypoints = Array.from({ length: 75 }, () => [.5, .5, 0]);
  keypoints[11] = [.3, .5, 0]; keypoints[12] = [.7, .5, 0];
  return { keypoints, confidences: Array(75).fill(1), atMs, ...(captureContext ? { captureContext } : {}) };
}
const sample = (captureContext) => ({ signLanguage: "isl", label: "HELLO", signerId: "participant-a", sessionId: "session-1", kind: "known", consent: true,
  frames: [0, 125, 250, 375].map((atMs) => pose(atMs, captureContext)) });

test("capture context records actual decoded dimensions, including a 4:3 fallback", () => {
  assert.equal(context().width, 640); assert.equal(context().height, 480);
  assert.equal(context(1280, 720).width, 1280);
  assert.equal(context().mirrorApplied, false);
  assert.throws(() => captureContextForVideo({ width: 1280, height: 720 }, modelUrl), /actual video dimensions/);
  assert.throws(() => captureContextForVideo({ videoWidth: 640, videoHeight: 480 }, "other-model"), /matching capture-context/);
});

test("invalid provenance is rejected rather than assigned a plausible tracker", () => {
  for (const patch of [{ width: 0 }, { width: 1.5 }, { width: true }, { height: Infinity }, { height: 16385 },
    { mirrorApplied: true }, { coordinateSpace: "pixels" }, { tracker: "legacy-solutions" },
    { delegate: "GPU" }, { sampleIntervalMs: "125" }, { deviceId: "private-device" }, { modelAsset: "other" }]) {
    assert.throws(() => validateCaptureContext({ ...context(), ...patch }), /Capture context/);
  }
  const missing = context(); delete missing.modelAsset;
  assert.throws(() => validateCaptureContext(missing), /Capture context/);
  assert.deepEqual(copyFrameCaptureContext({}), {});
  assert.throws(() => copyFrameCaptureContext({ captureContext: null }), /Capture context/);
});

test("consented storage and export preserve detached capture context with exact byte accounting", async () => {
  globalThis.indexedDB = new IDBFactory();
  const input = sample(context());
  const pending = saveTrainingSample(input);
  input.frames[0].captureContext.width = 1280;
  const saved = await pending;
  assert.equal(saved.frames[0].captureContext.width, 640);
  const exported = exportTrainingDataset([saved]);
  saved.frames[0].captureContext.width = 320;
  assert.equal(exported.samples[0].frames[0].captureContext.width, 640);
  assert.equal(exported.samples[0].byteSize, new TextEncoder().encode(JSON.stringify(exported.samples[0])).byteLength);
  assert.equal("captureContext" in validateTrainingSample(sample()).frames[0], false);
});

test("nonsigning copies preserve provenance while malformed metadata remains unsavable", () => {
  const input = pose(125, context());
  const copied = copyNonsigningFrame(input, 125);
  input.captureContext.width = 320;
  assert.equal(copied.captureContext.width, 640);
  assert.equal(copyNonsigningFrame(pose(125, { ...context(), width: -1 }), 125), null);
  assert.equal("captureContext" in copyNonsigningFrame(pose(125), 125), false);
});

test("automatic held-pose segments retain each measured frame's geometry without aliasing", () => {
  const capture = createAutomaticSignCapture();
  let complete;
  const raw = context();
  for (let now = 0; now <= 3000; now += 125) {
    const event = capture.push(pose(now, raw), now);
    if (event.type === "complete") { complete = event; break; }
  }
  assert.ok(complete?.frames.length >= 4);
  raw.width = 320;
  assert.ok(complete.frames.every((frame) => frame.captureContext.width === 640));
  assert.notEqual(complete.frames[0].captureContext, complete.frames[1].captureContext);
});
