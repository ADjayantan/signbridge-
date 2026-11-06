import assert from "node:assert/strict";
import test from "node:test";
import { DAILY_CONVERSATION_SIGNS, detectHandLandmarkShortcut, detectPoseFrameShortcut, detectPoseSequenceShortcut } from "../src/lib/handPoseShortcuts.js";

function makeOpenPalmLandmarks(offsetX = 0) {
  return [
    { x: 0.5 + offsetX, y: 0.75, z: 0 }, // 0: Wrist
    { x: 0.44 + offsetX, y: 0.70, z: 0 }, // 1: Thumb CMC
    { x: 0.39 + offsetX, y: 0.63, z: 0 }, // 2: Thumb MCP
    { x: 0.34 + offsetX, y: 0.57, z: 0 }, // 3: Thumb IP
    { x: 0.28 + offsetX, y: 0.51, z: 0 }, // 4: Thumb tip
    { x: 0.45 + offsetX, y: 0.58, z: 0 }, // 5: Index MCP
    { x: 0.44 + offsetX, y: 0.48, z: 0 }, // 6: Index PIP
    { x: 0.43 + offsetX, y: 0.41, z: 0 }, // 7: Index DIP
    { x: 0.42 + offsetX, y: 0.34, z: 0 }, // 8: Index tip
    { x: 0.50 + offsetX, y: 0.56, z: 0 }, // 9: Middle MCP
    { x: 0.50 + offsetX, y: 0.45, z: 0 }, // 10: Middle PIP
    { x: 0.50 + offsetX, y: 0.37, z: 0 }, // 11: Middle DIP
    { x: 0.50 + offsetX, y: 0.30, z: 0 }, // 12: Middle tip
    { x: 0.55 + offsetX, y: 0.58, z: 0 }, // 13: Ring MCP
    { x: 0.56 + offsetX, y: 0.48, z: 0 }, // 14: Ring PIP
    { x: 0.57 + offsetX, y: 0.40, z: 0 }, // 15: Ring DIP
    { x: 0.58 + offsetX, y: 0.34, z: 0 }, // 16: Ring tip
    { x: 0.60 + offsetX, y: 0.61, z: 0 }, // 17: Pinky MCP
    { x: 0.62 + offsetX, y: 0.53, z: 0 }, // 18: Pinky PIP
    { x: 0.63 + offsetX, y: 0.47, z: 0 }, // 19: Pinky DIP
    { x: 0.65 + offsetX, y: 0.41, z: 0 }, // 20: Pinky tip
  ];
}

function makePose({ left = null, right = null }) {
  const keypoints = Array.from({ length: 75 }, () => [0, 0, 0]);
  const confidences = Array(75).fill(0);
  if (left) {
    left.forEach((pt, idx) => {
      keypoints[33 + idx] = [pt.x, pt.y, pt.z ?? 0];
      confidences[33 + idx] = 0.95;
    });
  }
  if (right) {
    right.forEach((pt, idx) => {
      keypoints[54 + idx] = [pt.x, pt.y, pt.z ?? 0];
      confidences[54 + idx] = 0.95;
    });
  }
  return { keypoints, confidences };
}

test("DAILY_CONVERSATION_SIGNS provides 20 structured daily conversation words and phrases", () => {
  assert.equal(DAILY_CONVERSATION_SIGNS.length, 20);
  const meanings = DAILY_CONVERSATION_SIGNS.map((item) => item.meaning);
  assert.ok(meanings.includes("HELLO"));
  assert.ok(meanings.includes("HOW ARE YOU"));
  assert.ok(meanings.includes("I AM FINE"));
  assert.ok(meanings.includes("GOOD MORNING"));
  assert.ok(meanings.includes("THANK YOU"));
  assert.ok(meanings.includes("PLEASE"));
  assert.ok(meanings.includes("HELP"));
  assert.ok(meanings.includes("WATER"));
});

test("detectHandLandmarkShortcut recognizes 1-hand open palm as HELLO and 2-hand open palms as HOW ARE YOU", () => {
  const singleMatch = detectHandLandmarkShortcut(makeOpenPalmLandmarks());
  assert.equal(singleMatch?.meaning, "HELLO");

  const twoHandPose = makePose({
    left: makeOpenPalmLandmarks(-0.25),
    right: makeOpenPalmLandmarks(0.25),
  });
  const twoHandMatch = detectPoseFrameShortcut(twoHandPose);
  assert.equal(twoHandMatch?.meaning, "HOW ARE YOU");

  const namastePose = makePose({
    left: makeOpenPalmLandmarks(-0.04),
    right: makeOpenPalmLandmarks(0.04),
  });
  const namasteMatch = detectPoseFrameShortcut(namastePose);
  assert.equal(namasteMatch?.meaning, "GOOD MORNING");
});

test("detectPoseSequenceShortcut finds HELLO across a close-up webcam sequence and ignores synthetic zero-span test fixtures", () => {
  const realFrames = Array.from({ length: 6 }, (_, i) => ({
    ...makePose({ left: makeOpenPalmLandmarks() }),
    atMs: i * 120,
  }));
  const realMatch = detectPoseSequenceShortcut(realFrames);
  assert.equal(realMatch?.meaning, "HELLO");

  const syntheticFrames = Array.from({ length: 6 }, (_, i) => ({
    keypoints: Array.from({ length: 75 }, () => [0.5, 0.5, 0]),
    confidences: Array(75).fill(1),
    atMs: i * 120,
  }));
  assert.equal(detectPoseFrameShortcut(syntheticFrames[0]), null);
  assert.equal(detectPoseSequenceShortcut(syntheticFrames), null);
});
