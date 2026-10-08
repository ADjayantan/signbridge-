import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HAND_CONNECTIONS,
  HAND_FINGERS,
  HAND_JOINT_COUNT,
  HAND_JOINT_NAMES,
  handJointCounts,
  handsFromPoseFrame,
  isCompleteHandLandmarks,
} from "../src/lib/handJoints.js";

const HAND_OFFSETS = { Left: 33, Right: 54 };

function makePose({ left = true, right = true } = {}) {
  const keypoints = Array.from({ length: 75 }, () => [0, 0, 0]);
  const confidences = Array(75).fill(0);
  for (const [side, present] of [["Left", left], ["Right", right]]) {
    if (!present) continue;
    const offset = HAND_OFFSETS[side];
    const sideBase = side === "Left" ? 0.1 : 0.6;
    for (let joint = 0; joint < 21; joint++) {
      // Every joint and every axis is distinct, so mirroring, swapping, or
      // filling a hand from one wrist cannot accidentally pass these tests.
      keypoints[offset + joint] = [sideBase + joint / 100, 0.2 + joint / 80, -0.01 - joint / 200];
      confidences[offset + joint] = 0.5 + joint / 50;
    }
  }
  return { keypoints, confidences };
}

function expectedLandmarks(pose, side) {
  const offset = HAND_OFFSETS[side];
  return pose.keypoints.slice(offset, offset + 21).map(([x, y, z]) => ({ x, y, z }));
}

function makeLandmarks() {
  return Array.from({ length: 21 }, (_, joint) => ({ x: joint / 25, y: 1 - joint / 30, z: -joint / 100 }));
}

describe("hand joint metadata", () => {
  test("names all 21 joints and connects every finger through a continuous hand skeleton", () => {
    assert.equal(HAND_JOINT_COUNT, 21);
    assert.equal(HAND_JOINT_NAMES.length, 21);
    assert.equal(new Set(HAND_JOINT_NAMES).size, 21);
    assert.ok(HAND_JOINT_NAMES.every((name) => typeof name === "string" && name.trim().length > 0));
    assert.match(HAND_JOINT_NAMES[0], /wrist/i);
    assert.deepEqual(HAND_FINGERS.map(({ name }) => name.toLowerCase()), ["thumb", "index", "middle", "ring", "pinky"]);

    const expectedChains = [
      [0, 1, 2, 3, 4],
      [0, 5, 6, 7, 8],
      [0, 9, 10, 11, 12],
      [0, 13, 14, 15, 16],
      [0, 17, 18, 19, 20],
    ];
    assert.deepEqual(HAND_FINGERS.map(({ joints }) => joints), expectedChains);
    assert.ok(HAND_FINGERS.every(({ color }) => typeof color === "string" && color.length > 0));
    const edges = new Set(HAND_CONNECTIONS.map(([from, to]) => `${Math.min(from, to)}:${Math.max(from, to)}`));
    for (const edge of HAND_CONNECTIONS) {
      assert.equal(edge.length, 2);
      assert.ok(edge.every((joint) => Number.isInteger(joint) && joint >= 0 && joint < 21));
      assert.notEqual(edge[0], edge[1]);
    }
    for (const chain of expectedChains) {
      for (let index = 2; index < chain.length; index++) {
        assert.ok(edges.has(`${chain[index - 1]}:${chain[index]}`), `missing edge ${chain[index - 1]}:${chain[index]}`);
      }
    }
    const reachable = new Set([0]);
    for (let pass = 0; pass < 21; pass++) {
      for (const [from, to] of HAND_CONNECTIONS) {
        if (reachable.has(from)) reachable.add(to);
        if (reachable.has(to)) reachable.add(from);
      }
    }
    assert.equal(reachable.size, 21, "every joint is connected to the wrist through the hand skeleton");
  });
});

describe("isCompleteHandLandmarks", () => {
  test("accepts 21 finite image landmarks with an optional z coordinate", () => {
    assert.equal(isCompleteHandLandmarks(makeLandmarks()), true);
    assert.equal(isCompleteHandLandmarks(makeLandmarks().map(({ x, y }) => ({ x, y }))), true);
  });

  test("rejects absent, partial, sparse, and nonfinite landmarks", () => {
    for (const points of [undefined, null, [], makeLandmarks().slice(0, 20), [...makeLandmarks(), { x: 0, y: 0, z: 0 }]]) {
      assert.equal(isCompleteHandLandmarks(points), false);
    }
    const sparse = makeLandmarks();
    delete sparse[10];
    assert.equal(isCompleteHandLandmarks(sparse), false);
    for (const badPoint of [null, {}, { x: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 0, y: 0, z: NaN }, { x: "0", y: 0 }]) {
      const points = makeLandmarks();
      points[10] = badPoint;
      assert.equal(isCompleteHandLandmarks(points), false, `accepted ${String(badPoint)}`);
    }
  });
});

describe("handsFromPoseFrame and handJointCounts", () => {
  test("preserves every left and right joint exactly without mirroring or swapping sides", () => {
    const pose = makePose();
    const hands = handsFromPoseFrame(pose);
    assert.deepEqual(hands.map(({ handedness }) => handedness), ["Left", "Right"]);
    for (const hand of hands) {
      assert.deepEqual(hand.landmarks, expectedLandmarks(pose, hand.handedness));
      assert.equal(hand.landmarks.length, 21);
      assert.ok(Number.isFinite(hand.score) && hand.score >= 0.5 && hand.score <= 1);
    }
    assert.notDeepEqual(hands[0].landmarks, hands[1].landmarks);
    assert.deepEqual(handJointCounts(pose), { left: 21, right: 21, total: 42, hands: 2 });
  });

  test("counts a complete hand independently of the body or the other hand", () => {
    for (const side of ["Left", "Right"]) {
      const pose = makePose({ left: side === "Left", right: side === "Right" });
      // Body landmarks are absent, and neither shoulders nor a body wrist
      // can gate an otherwise complete hand.
      for (let joint = 0; joint < 33; joint++) delete pose.keypoints[joint];
      const hands = handsFromPoseFrame(pose);
      assert.equal(hands.length, 1);
      assert.equal(hands[0].handedness, side);
      assert.deepEqual(hands[0].landmarks, expectedLandmarks(pose, side));
      assert.deepEqual(handJointCounts(pose), {
        left: side === "Left" ? 21 : 0,
        right: side === "Right" ? 21 : 0,
        total: 21,
        hands: 1,
      });
    }
  });

  test("does not turn synthetic zero coordinates or a lone wrist into a hand", () => {
    const emptyPose = makePose({ left: false, right: false });
    assert.deepEqual(handsFromPoseFrame(emptyPose), []);
    assert.deepEqual(handJointCounts(emptyPose), { left: 0, right: 0, total: 0, hands: 0 });
    for (const offset of [33, 54]) {
      const pose = makePose({ left: false, right: false });
      pose.keypoints[offset] = [0.3, 0.4, -0.1];
      pose.confidences[offset] = 1;
      assert.deepEqual(handsFromPoseFrame(pose), []);
      assert.deepEqual(handJointCounts(pose), { left: 0, right: 0, total: 0, hands: 0 });
    }
    for (const frame of [undefined, null, {}, { keypoints: [], confidences: [] }]) {
      assert.deepEqual(handsFromPoseFrame(frame), []);
      assert.deepEqual(handJointCounts(frame), { left: 0, right: 0, total: 0, hands: 0 });
    }
  });

  test("accepts confidence 0.5 and requires sufficient finite confidence at every joint", () => {
    const pose = makePose();
    pose.confidences.fill(0.5, 33);
    assert.equal(handsFromPoseFrame(pose).length, 2);
    for (const badConfidence of [0, 0.499, NaN, Infinity, undefined, "1"]) {
      for (const side of ["Left", "Right"]) {
        const candidate = makePose();
        candidate.confidences[HAND_OFFSETS[side] + 20] = badConfidence;
        const otherSide = side === "Left" ? "Right" : "Left";
        const hands = handsFromPoseFrame(candidate);
        assert.deepEqual(hands.map(({ handedness }) => handedness), [otherSide]);
        assert.deepEqual(hands[0].landmarks, expectedLandmarks(candidate, otherSide));
        assert.deepEqual(handJointCounts(candidate), {
          left: side === "Left" ? 0 : 21,
          right: side === "Right" ? 0 : 21,
          total: 21,
          hands: 1,
        });
      }
    }
  });

  test("drops an incomplete or nonfinite hand while preserving all joints of the other hand", () => {
    const corruptions = [
      (pose, index) => { delete pose.keypoints[index]; },
      (pose, index) => { pose.keypoints[index] = null; },
      (pose, index) => { pose.keypoints[index] = [0.2, 0.3]; },
      (pose, index) => { pose.keypoints[index] = [NaN, 0.3, 0]; },
      (pose, index) => { pose.keypoints[index] = [0.2, Infinity, 0]; },
      (pose, index) => { pose.keypoints[index] = [0.2, 0.3, NaN]; },
      (pose, index) => { pose.keypoints[index] = [0.2, 0.3, "0"]; },
      (pose, index) => { delete pose.confidences[index]; },
    ];
    for (const corrupt of corruptions) {
      for (const side of ["Left", "Right"]) {
        const pose = makePose();
        corrupt(pose, HAND_OFFSETS[side] + 12);
        const otherSide = side === "Left" ? "Right" : "Left";
        const hands = handsFromPoseFrame(pose);
        assert.equal(hands.length, 1);
        assert.equal(hands[0].handedness, otherSide);
        assert.deepEqual(hands[0].landmarks, expectedLandmarks(pose, otherSide));
      }
    }
  });

  test("reads frozen poses without mutating their coordinates or confidence values", () => {
    const pose = makePose();
    const before = structuredClone(pose);
    pose.keypoints.forEach(Object.freeze);
    Object.freeze(pose.keypoints);
    Object.freeze(pose.confidences);
    Object.freeze(pose);
    handsFromPoseFrame(pose);
    handJointCounts(pose);
    assert.deepEqual(pose, before);
  });
});
