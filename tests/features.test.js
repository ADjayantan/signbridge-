import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FEATURE_SIZE, LANDMARKS, handCount, handsFromResult, mirrorFeatures, toFeatures } from "../src/lib/features.js";
import { SHAPES, handPixels, makeHand, mirrorHands, normalize } from "./helpers/hands.js";

function close(a, b, eps = 1e-9) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < eps, `index ${i}: ${a[i]} vs ${b[i]}`);
}
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const SHAPE = [1, 1 + LANDMARKS * 3]; // handshape part of the first hand slot
const shapeOf = (v) => v.slice(...SHAPE);
const ASPECT = 640 / 480;

describe("toFeatures", () => {
  test("has a fixed size and marks which hand slots are present", () => {
    assert.equal(toFeatures([makeHand(handPixels())], ASPECT).length, FEATURE_SIZE);
    assert.equal(handCount(toFeatures([makeHand(handPixels())], ASPECT)), 1);
    const two = [makeHand(handPixels({ cx: 200 })), makeHand(handPixels({ cx: 450 }), { side: "Left" })];
    assert.equal(handCount(toFeatures(two, ASPECT)), 2);
    assert.equal(handCount(toFeatures([], ASPECT)), 0);
  });

  test("the same handshape gives the same features anywhere in the frame and at any distance", () => {
    const a = toFeatures([makeHand(handPixels({ cx: 200, cy: 300, size: 60, curl: SHAPES.point }))], ASPECT);
    const b = toFeatures([makeHand(handPixels({ cx: 420, cy: 380, size: 110, curl: SHAPES.point }))], ASPECT);
    close(a, b);
  });

  test("a tilted hand keeps its handshape; only the orientation features change", () => {
    const upright = toFeatures([makeHand(handPixels({ curl: SHAPES.victory }))], ASPECT);
    const tilted = toFeatures([makeHand(handPixels({ curl: SHAPES.victory, rotate: 0.6 }))], ASPECT);
    close(shapeOf(upright), shapeOf(tilted));
    assert.ok(dist(upright, tilted) > 0.3, "orientation still differs");
  });

  test("thumb up and thumb down (same handshape, opposite direction) stay far apart", () => {
    const up = toFeatures([makeHand(handPixels({ curl: SHAPES.call }))], ASPECT);
    const down = toFeatures([makeHand(handPixels({ curl: SHAPES.call, rotate: Math.PI }))], ASPECT);
    assert.ok(dist(up, down) >= 2, String(dist(up, down)));
  });

  test("different handshapes are far apart", () => {
    const open = toFeatures([makeHand(handPixels({ curl: SHAPES.open }))], ASPECT);
    const fist = toFeatures([makeHand(handPixels({ curl: SHAPES.fist }))], ASPECT);
    assert.ok(dist(open, fist) > 2, String(dist(open, fist)));
  });

  test("without world landmarks, corrects image landmarks for the camera's aspect ratio", () => {
    const px = handPixels({ curl: SHAPES.victory });
    const vga = toFeatures([makeHand(px, { width: 640, height: 480, withWorld: false })], 640 / 480);
    const hd = toFeatures([makeHand(px, { width: 1280, height: 720, withWorld: false })], 1280 / 720);
    close(vga, hd);
    const wrong = toFeatures([makeHand(px, { width: 1280, height: 720, withWorld: false })], 1);
    assert.ok(dist(wrong, hd) > 0.05, "ignoring the aspect ratio distorts the shape");
  });
});

describe("mirrorFeatures", () => {
  test("equals the features of the mirrored image, for one and two hands, with or without world landmarks", () => {
    for (const withWorld of [true, false]) {
      const one = [makeHand(handPixels({ curl: SHAPES.call, rotate: 0.3 }), { withWorld })];
      close(mirrorFeatures(toFeatures(one, ASPECT)), toFeatures(mirrorHands(one), ASPECT));

      const two = [
        makeHand(handPixels({ cx: 220, cy: 330, curl: SHAPES.point, rotate: -0.4 }), { withWorld }),
        makeHand(handPixels({ cx: 430, cy: 300, size: 70, curl: SHAPES.victory }), { side: "Left", withWorld }),
      ];
      close(mirrorFeatures(toFeatures(two, ASPECT)), toFeatures(mirrorHands(two), ASPECT));
    }
  });

  test("mirroring twice gives the original", () => {
    const v = toFeatures(
      [makeHand(handPixels({ cx: 200 })), makeHand(handPixels({ cx: 460, curl: SHAPES.fist }), { side: "Left" })],
      ASPECT,
    );
    close(mirrorFeatures(mirrorFeatures(v)), v);
  });
});

describe("handsFromResult", () => {
  test("reads landmarks, world landmarks, handedness and the top gesture", () => {
    const px = handPixels();
    const lm = normalize(px, 640, 480);
    const hands = handsFromResult({
      landmarks: [lm],
      worldLandmarks: [lm],
      handedness: [[{ categoryName: "Left", score: 0.9 }]],
      gestures: [[{ categoryName: "Thumb_Up", score: 0.8 }]],
    });
    assert.deepEqual(hands, [
      { landmarks: lm, world: lm, handedness: "Left", score: 0.9, gesture: { name: "Thumb_Up", score: 0.8 } },
    ]);
    assert.deepEqual(handsFromResult({ landmarks: [] }), []);
    assert.deepEqual(handsFromResult(undefined), []);
  });

  test("incomplete or nonfinite joints cannot enter hand features; invalid world landmarks fall back to image joints", () => {
    const tracked = makeHand(handPixels(), { withWorld: false });
    const other = makeHand(handPixels({ cx: 450 }), { side: "Left", withWorld: false });
    const invalid = { ...tracked, landmarks: tracked.landmarks.map((point) => ({ ...point })) };
    invalid.landmarks[20].x = NaN;
    assert.deepEqual(handsFromResult({ landmarks: [invalid.landmarks, other.landmarks], handedness: [[], [{ categoryName: "Left", score: .9 }]] }).map((hand) => hand.handedness), ["Left"]);
    close(toFeatures([invalid, other], ASPECT), toFeatures([other], ASPECT));
    assert.deepEqual(toFeatures([{ landmarks: tracked.landmarks.slice(0, 20) }]), Array(FEATURE_SIZE).fill(0));
    const world = tracked.landmarks.map((point) => ({ ...point })); world[9].z = Infinity;
    close(toFeatures([{ ...tracked, world }], ASPECT), toFeatures([tracked], ASPECT));
    assert.equal(handsFromResult({ landmarks: [tracked.landmarks], worldLandmarks: [world] })[0].world, null);
  });
});
