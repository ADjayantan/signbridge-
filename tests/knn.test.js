import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toFeatures } from "../src/lib/features.js";
import { MAX_SAMPLES_PER_SIGN, SignClassifier, normalizeLabel } from "../src/lib/knn.js";
import { SHAPES, handPixels, makeHand, mirrorHands, seeded } from "./helpers/hands.js";

const W = 640;
const H = 480;
const rand = seeded(42);

function samples(curl, n, { side = "Right", jitter = 0.04 } = {}) {
  return Array.from({ length: n }, () => {
    const px = handPixels({
      cx: 200 + rand() * 240,
      cy: 250 + rand() * 150,
      size: 60 + rand() * 50,
      rotate: (rand() - 0.5) * 0.4,
      curl,
      jitter,
      rand,
    });
    const hands = [makeHand(px)];
    return toFeatures(side === "Left" ? mirrorHands(hands) : hands, W / H);
  });
}

function trained(options) {
  const c = new SignClassifier(options);
  c.addSamples("water", samples(SHAPES.call, 30));
  c.addSamples("help", samples(SHAPES.victory, 30));
  c.addSamples("me", samples(SHAPES.point, 30));
  return c;
}

describe("SignClassifier", () => {
  test("recognizes taught signs on new, noisy frames", () => {
    const c = trained();
    for (const [shape, label] of [
      [SHAPES.call, "WATER"],
      [SHAPES.victory, "HELP"],
      [SHAPES.point, "ME"],
    ]) {
      for (const v of samples(shape, 10)) {
        const p = c.predict(v);
        assert.equal(p.label, label);
        assert.ok(p.confidence > 0.8, `confidence ${p.confidence}`);
      }
    }
  });

  test("rejects frames that look like none of the taught signs", () => {
    const c = trained();
    const twoHands = toFeatures([makeHand(handPixels({ cx: 180 })), makeHand(handPixels({ cx: 470 }), { side: "Left" })], W / H);
    assert.equal(c.predict(twoHands).label, null);
    assert.equal(c.predict(samples(SHAPES.open, 1, { jitter: 0 })[0]).label, null);
  });

  test("a sign taught with the right hand is recognized with the left (mirror on)", () => {
    const left = samples(SHAPES.call, 5, { side: "Left" });
    const withMirror = trained();
    for (const v of left) assert.equal(withMirror.predict(v).label, "WATER");
    const noMirror = trained({ mirror: false });
    assert.ok(left.some((v) => noMirror.predict(v).label !== "WATER"));
  });

  test("saves and loads, normalizing names and dropping broken samples", () => {
    const c = trained();
    const json = JSON.parse(JSON.stringify(c.toJSON()));
    json.signs[" thank   you "] = [...samples(SHAPES.fist, 3), [1, 2, 3], "junk"];
    const loaded = SignClassifier.fromJSON(json);
    assert.deepEqual(
      loaded.labels().map((l) => [l.label, l.count]),
      [
        ["WATER", 30],
        ["HELP", 30],
        ["ME", 30],
        ["THANK YOU", 3],
      ],
    );
    const v = samples(SHAPES.victory, 1)[0];
    assert.equal(loaded.predict(v).label, c.predict(v).label);
  });

  test("refuses files that aren't SignBridge signs", () => {
    assert.throws(() => SignClassifier.fromJSON({ hello: 1 }), /isn't a SignBridge signs file/);
    assert.throws(() => SignClassifier.fromJSON({ version: 1, featureSize: 10, signs: {} }), /different version/);
  });

  test("keeps at most MAX_SAMPLES_PER_SIGN samples per sign, and can remove signs", () => {
    const c = new SignClassifier();
    c.addSamples("hi", samples(SHAPES.open, MAX_SAMPLES_PER_SIGN + 20));
    assert.equal(c.labels()[0].count, MAX_SAMPLES_PER_SIGN);
    assert.equal(c.remove("HI"), true);
    assert.equal(c.size, 0);
    assert.equal(c.predict(samples(SHAPES.open, 1)[0]), null);
  });

  test("normalizeLabel", () => {
    assert.equal(normalizeLabel("  thank   you "), "THANK YOU");
    assert.equal(normalizeLabel("தண்ணீர்"), "தண்ணீர்");
    assert.equal(normalizeLabel(""), "");
  });
});
