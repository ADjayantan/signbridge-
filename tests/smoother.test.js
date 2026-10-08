import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BUILT_IN_GESTURES, decideSign, gestureMap } from "../src/lib/gestures.js";
import { toFeatures } from "../src/lib/features.js";
import { SignClassifier } from "../src/lib/knn.js";
import { createSignSmoother } from "../src/lib/signSmoother.js";
import { SHAPES, handPixels, makeHand } from "./helpers/hands.js";

const FRAME = 33; // ms, about 30 fps

/** Feeds a list of [label, durationMs] at 30 fps; returns committed words. */
function run(smoother, script) {
  const words = [];
  let t = 0;
  for (const [label, ms] of script) {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME) {
      const { committed } = smoother.update(label, t);
      if (committed) words.push(committed);
      t += FRAME;
    }
  }
  return words;
}

describe("createSignSmoother", () => {
  test("commits a held sign once", () => {
    assert.deepEqual(run(createSignSmoother(), [["YES", 3000]]), ["YES"]);
  });

  test("a sign that is too short is not committed", () => {
    assert.deepEqual(run(createSignSmoother(), [["YES", 400], [null, 500]]), []);
  });

  test("the same sign twice needs the hands to change in between", () => {
    const words = run(createSignSmoother(), [
      ["NO", 900],
      [null, 400],
      ["NO", 900],
    ]);
    assert.deepEqual(words, ["NO", "NO"]);
  });

  test("moving straight from one sign to another commits both", () => {
    assert.deepEqual(run(createSignSmoother(), [["HELLO", 900], ["WATER", 900]]), ["HELLO", "WATER"]);
  });

  test("flickering predictions never commit", () => {
    const script = Array.from({ length: 60 }, (_, i) => [i % 2 ? "A" : "B", FRAME]);
    assert.deepEqual(run(createSignSmoother(), script), []);
  });

  test("reports hold progress", () => {
    const s = createSignSmoother({ holdMs: 600 });
    s.update("HI", 0);
    const mid = s.update("HI", 300);
    assert.ok(mid.progress > 0.4 && mid.progress < 0.6, String(mid.progress));
    assert.equal(mid.candidate, "HI");
  });
});

describe("decideSign", () => {
  const px = handPixels({ curl: SHAPES.call });
  const withGesture = (name, score) => [makeHand(px, { gesture: { name, score } })];
  const thumbsUp = withGesture("Thumb_Up", 0.9);

  test("maps a confident built-in gesture to its word", () => {
    const d = decideSign(thumbsUp, 4 / 3, null, gestureMap());
    assert.deepEqual(d, { label: "YES", source: "gesture", confidence: 0.9 });
  });

  test("each enabled gesture shortcut keeps its distinct mapped word", () => {
    for (const [name, word] of [
      ["Open_Palm", "HELLO"], ["Thumb_Up", "YES"], ["Thumb_Down", "NO"],
      ["Closed_Fist", "STOP"], ["Pointing_Up", "WAIT"], ["Victory", "BYE"],
      ["ILoveYou", "I LOVE YOU"],
    ]) {
      assert.deepEqual(decideSign(withGesture(name, .9), 4 / 3, null, gestureMap()),
        { label: word, source: "gesture", confidence: .9 });
    }
  });

  test("a stronger disabled gesture on one hand cannot mask another hand's enabled shortcut", () => {
    const hands = [
      makeHand(px, { gesture: { name: "Open_Palm", score: .98 } }),
      makeHand(px, { side: "Left", gesture: { name: "Thumb_Up", score: .9 } }),
    ];
    const map = gestureMap({ Open_Palm: { enabled: false } });
    assert.deepEqual(decideSign(hands, 4 / 3, null, map),
      { label: "YES", source: "gesture", confidence: .9 });
  });

  test("a fully disabled shortcut map produces no words even for confident gestures", () => {
    const map = gestureMap(Object.fromEntries(BUILT_IN_GESTURES.map((g) => [g.id, { enabled: false }])));
    for (const gesture of BUILT_IN_GESTURES) {
      assert.deepEqual(decideSign(withGesture(gesture.id, .99), 4 / 3, null, map),
        { label: null, source: null, confidence: 0 });
    }
  });

  test("ignores disabled, unsure and 'None' gestures", () => {
    assert.equal(decideSign(thumbsUp, 4 / 3, null, gestureMap({ Thumb_Up: { enabled: false } })).label, null);
    assert.equal(decideSign(withGesture("Thumb_Up", 0.3), 4 / 3, null, gestureMap()).label, null);
    assert.equal(decideSign(withGesture("None", 0.99), 4 / 3, null, gestureMap()).label, null);
    assert.equal(decideSign([], 4 / 3, null, gestureMap()).label, null);
  });

  test("careful mode rejects borderline gesture scores accepted by balanced mode", () => {
    const borderline = withGesture("Thumb_Up", 0.65);
    assert.equal(decideSign(borderline, 4 / 3, null, gestureMap()).label, "YES");
    assert.equal(decideSign(borderline, 4 / 3, null, gestureMap(), { minGestureScore: 0.7 }).label, null);
  });

  test("a taught sign wins over a built-in gesture", () => {
    const c = new SignClassifier();
    c.addSamples("water", [toFeatures([makeHand(px)], 4 / 3)]);
    assert.deepEqual(decideSign(thumbsUp, 4 / 3, c, gestureMap()).label, "WATER");
  });

  test("gestureMap keeps defaults and validates saved values", () => {
    const map = gestureMap({ Victory: { word: " peace ", enabled: false }, Thumb_Up: { word: 42 }, Bogus: { word: "x" } });
    assert.deepEqual(map.Victory, { word: "PEACE", enabled: false });
    assert.deepEqual(map.Thumb_Up, { word: "YES", enabled: true });
    assert.equal(Object.keys(map).length, BUILT_IN_GESTURES.length);
  });
});
