import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraFramesForModel, validateCameraInputContract } from "../src/lib/cameraCoordinateContract.js";
import { POSE_JOINTS, preprocessPoseSequence } from "../src/lib/trainedSignModel.js";
import { legacyCameraFrames } from "./helpers/legacyCamera.js";

const contract = (overrides = {}) => ({ format: "signbridge-camera-coordinates-v1", space: "axis-scaled-image", scaleX: 1080, scaleY: 1920, ...overrides });
const model = (cameraInput = contract()) => ({ format: "signbridge-gru-v2", cameraInput });

test("v1 without metadata preserves historical identity without inferring a language, model hash or image size", () => {
  const frames = legacyCameraFrames();
  for (const legacy of [{ format: "signbridge-gru-v1", signLanguage: "isl" }, { format: "signbridge-gru-v1", signLanguage: "asl", modelSha256: "a".repeat(64), videoWidth: 1920, videoHeight: 1080 }]) {
    assert.equal(validateCameraInputContract(legacy), null);
    assert.equal(cameraFramesForModel(legacy, frames), frames);
  }
});

test("normalized-image metadata explicitly declares identity while v2 requires a complete coordinate contract", () => {
  const frames = legacyCameraFrames(), normalized = model(contract({ space: "normalized-image", scaleX: 1, scaleY: 1 }));
  assert.equal(cameraFramesForModel(normalized, frames), frames);
  assert.deepEqual(validateCameraInputContract(normalized), normalized.cameraInput);
  assert.throws(() => validateCameraInputContract({ format: "signbridge-gru-v2" }), /camera-coordinate/);
  assert.throws(() => validateCameraInputContract({ format: "signbridge-gru-v1", cameraInput: contract() }), /gru-v2/);
});

test("declared image-axis scales change XY only and preserve exact shoulder geometry before resampling", () => {
  const frames = legacyCameraFrames();
  for (const frame of frames) frame.keypoints[33] = [.6, .7, -.123];
  const converted = cameraFramesForModel(model(), frames);
  assert.deepEqual(converted[0].keypoints[11], [324, 960, 0]);
  assert.deepEqual(converted[0].keypoints[12], [756, 960, 0]);
  assert.deepEqual(converted[0].keypoints[33], [648, 1344, -.123]);
  const index = POSE_JOINTS.indexOf(33) * 3;
  const features = preprocessPoseSequence(converted), original = preprocessPoseSequence(frames);
  assert.ok(Math.abs(features[0][index] - .25) < 1e-12);
  assert.ok(Math.abs(features[0][index + 1] - 8 / 9) < 1e-12);
  assert.ok(Math.abs(original[0][index + 1] - .5) < 1e-12);
  assert.equal(features[0][index + 2], original[0][index + 2]);
});

test("axis scaling uses the full declared XY metric for tilted shoulders, without swapping or mirroring", () => {
  const frames = legacyCameraFrames();
  for (const frame of frames) {
    frame.keypoints[11] = [.3, .45, 0]; frame.keypoints[12] = [.7, .55, 0]; frame.keypoints[33] = [.6, .7, 0];
  }
  const features = preprocessPoseSequence(cameraFramesForModel(model(), frames));
  const index = POSE_JOINTS.indexOf(33) * 3, shoulderDistance = Math.hypot(432, 192);
  assert.ok(Math.abs(features[0][index] - 108 / shoulderDistance) < 1e-12);
  assert.ok(Math.abs(features[0][index + 1] - 384 / shoulderDistance) < 1e-12);
});

test("conversion cannot mutate input poses, confidence values, timings or model metadata", () => {
  const frames = legacyCameraFrames(), artifact = model(), before = JSON.stringify({ frames, artifact });
  for (const frame of frames) { frame.keypoints.forEach(Object.freeze); Object.freeze(frame.keypoints); Object.freeze(frame.confidences); Object.freeze(frame); }
  Object.freeze(frames); Object.freeze(artifact.cameraInput); Object.freeze(artifact);
  const converted = cameraFramesForModel(artifact, frames);
  assert.equal(JSON.stringify({ frames, artifact }), before);
  assert.notEqual(converted, frames); assert.notEqual(converted[0], frames[0]);
  assert.notEqual(converted[0].keypoints, frames[0].keypoints); assert.notEqual(converted[0].confidences, frames[0].confidences);
  assert.deepEqual(converted.map((frame) => frame.atMs), frames.map((frame) => frame.atMs));
  assert.deepEqual(converted.map((frame) => frame.confidences), frames.map((frame) => frame.confidences));
});

test("model-space opt-out prevents a second transform but still validates metadata and its boolean type", () => {
  const artifact = model(), converted = cameraFramesForModel(artifact, legacyCameraFrames());
  assert.equal(cameraFramesForModel(artifact, converted, { framesAlreadyInModelSpace: true }), converted);
  assert.notDeepEqual(cameraFramesForModel(artifact, converted)[0].keypoints, converted[0].keypoints);
  for (const value of [null, 0, 1, "false", "true", {}]) assert.throws(() => cameraFramesForModel(artifact, converted, { framesAlreadyInModelSpace: value }), /must be a boolean/);
  assert.throws(() => cameraFramesForModel(model({ ...contract(), scaleX: 0 }), converted, { framesAlreadyInModelSpace: true }), /camera-coordinate/);
});

test("unknown formats, spaces, fields and missing coordinate fields fail closed", () => {
  for (const input of [null, [], false, "normalized-image", {}, { ...contract(), format: "future-v9" }, { ...contract(), space: "pixels" }, { ...contract(), expectedLabel: "HELLO" }, { ...contract(), scaleY: undefined }]) {
    assert.throws(() => validateCameraInputContract(model(input)), /camera-coordinate/);
  }
  assert.throws(() => validateCameraInputContract({ format: "signbridge-gru-v3", cameraInput: contract() }), /Unsupported/);
});

test("image-axis scales must be bounded positive integers and normalized space must remain identity", () => {
  for (const value of [0, -1, .5, 16385, Infinity, NaN, "1080", null]) {
    assert.throws(() => validateCameraInputContract(model(contract({ scaleX: value }))), /camera-coordinate/);
    assert.throws(() => validateCameraInputContract(model(contract({ scaleY: value }))), /camera-coordinate/);
  }
  assert.throws(() => validateCameraInputContract(model(contract({ space: "normalized-image" }))), /camera-coordinate/);
  assert.deepEqual(validateCameraInputContract(model(contract({ scaleX: 1, scaleY: 16384 }))), contract({ scaleX: 1, scaleY: 16384 }));
});

test("conversion rejects nonfinite results instead of supplying invented landmarks", () => {
  const frames = legacyCameraFrames(); frames[0].keypoints[0][0] = Number.MAX_VALUE;
  assert.throws(() => cameraFramesForModel(model(), frames), /finite coordinate/);
  frames[0].keypoints[0][0] = NaN;
  assert.throws(() => cameraFramesForModel(model(), frames), /finite x\/y\/z/);
});
