import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MODEL_PINCH_POSE, createHandModelBones, prepareHandModel } from "../src/lib/handModelRig.js";
import { FINGER_CURL_GAINS, thumbAnglesFor } from "../src/lib/handPoseSpec.js";
import { FINGER_SPECS } from "../src/lib/handSkinMesh.js";
import { THUMB_TIP_REFERENCES, extractLiveHandSpec, liveHandSpecs, thumbTipInPalmFrame } from "../src/lib/liveHandMirror.js";
import { createSyntheticHand, readHandModelData } from "./helpers/handModel.js";
import { seeded } from "./helpers/hands.js";

// These tests stand in for a webcam: the sculpted hand is posed like the stage poses it, turned
// into the landmarks a tracker would report (raw, unmirrored sensor coordinates), and read back.
// They prove the mirror's geometry. They are not evidence about a real camera or a real hand.
const template = prepareHandModel(THREE, readHandModelData(new URL("../public/hand3d/left.glb", import.meta.url)));
const hand = createSyntheticHand(THREE, {
  template,
  bones: createHandModelBones(THREE, template),
  fingerSpecs: FINGER_SPECS,
  curlGains: FINGER_CURL_GAINS,
  thumbAngles: thumbAnglesFor,
  pinchPose: MODEL_PINCH_POSE,
});

const FINGERS = ["index", "middle", "ring", "pinky"];
const CAMERAS = [4 / 3, 16 / 9];
const FIST = { index: 1, middle: 1, ring: 1, pinky: 1 };
/** Reads the hand the way the page does: with the camera's real aspect ratio. */
const read = (view = {}, landmarks = hand.landmarks(view)) => extractLiveHandSpec(landmarks, 0, 1, { aspect: view.aspect ?? 4 / 3 });

/** Tracker noise: `amount` is a fraction of the hand's size, depth is 2.5x noisier. */
function jitter(landmarks, { size = 0.22, aspect = 4 / 3 }, amount, rand) {
  const noise = () => (rand() + rand() + rand() + rand() - 2) * amount * size;
  return landmarks.map((lm) => ({ x: lm.x + noise() / aspect, y: lm.y + noise(), z: lm.z + (noise() * 2.5) / aspect }));
}

function eachView(visit, { rolls = [-0.5, 0, 0.5], sizes = [0.12, 0.3] } = {}) {
  for (const aspect of CAMERAS) for (const roll of rolls) for (const size of sizes) for (const thumbOnRight of [false, true]) visit({ aspect, roll, size, thumbOnRight });
}

test("the 3D hand moves the same way the hand moves in the mirrored preview", () => {
  hand.pose();
  const x = [0.2, 0.5, 0.8].map((screenX) => read({ screenX }).pos[0]);
  assert.ok(x[0] < 0, "left side of the preview must be the left (-X) of the stage");
  assert.ok(Math.abs(x[1]) < 1e-9);
  assert.ok(x[2] > 0, "right side of the preview must be the right (+X) of the stage");
  const y = [0.3, 0.7].map((screenY) => read({ screenY }).pos[1]);
  assert.ok(y[0] > y[1], "higher in the preview must be higher (+Y) on the stage");
});

test("tilting the hand tilts the 3D hand toward the same side", () => {
  hand.pose();
  for (const aspect of CAMERAS) {
    for (const thumbOnRight of [false, true]) {
      // roll > 0: the top of the hand leans toward the LEFT of the preview. Three.js turns the
      // same way for a positive Z rotation, so the stage roll must carry the same sign.
      const rolls = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1];
      const stage = rolls.map((roll) => read({ aspect, roll, thumbOnRight }).rot[2]);
      rolls.forEach((roll, i) => {
        if (roll === 0) assert.ok(Math.abs(stage[i]) < 0.05);
        else assert.equal(Math.sign(stage[i]), Math.sign(roll), `tilt ${roll} came out as ${stage[i]}`);
        if (i > 0) assert.ok(stage[i] >= stage[i - 1] - 1e-9, "more tilt must never show as less tilt");
      });
    }
  }
});

test("each finger reads back curled or straight, and can never bend backwards", () => {
  for (const curled of FINGERS) {
    hand.pose({ thumb: "tucked", [curled]: 1 });
    eachView((view) => {
      const spec = read(view);
      for (const finger of FINGERS) {
        if (finger === curled) assert.ok(spec[finger] > 0.8, `${finger} curled reads ${spec[finger]}`);
        else assert.ok(spec[finger] < 0.2, `${finger} straight reads ${spec[finger]} while ${curled} is curled`);
      }
    });
  }
  // Whatever the tracker throws at it, the pose stays inside what a hand can do.
  const rand = seeded(7);
  hand.pose({ thumb: "open", index: 0.4, middle: 0.6, ring: 0.2, pinky: 0.9 });
  for (let i = 0; i < 300; i++) {
    const view = { aspect: CAMERAS[i % 2], roll: (rand() - 0.5) * 6, size: 0.1 + rand() * 0.25, thumbOnRight: rand() > 0.5 };
    const spec = read(view, jitter(hand.landmarks(view), view, 0.12, rand));
    for (const finger of FINGERS) assert.ok(spec[finger] >= 0 && spec[finger] <= 1, `${finger} curl ${spec[finger]} is outside 0..1`);
    assert.ok(["open", "wide", "tucked", "fist", "up", "pinch"].includes(spec.thumb));
    assert.ok(spec.mirrorX === 1 || spec.mirrorX === -1);
    for (const value of [...spec.pos, ...spec.rot]) assert.ok(Number.isFinite(value));
  }
});

test("a slowly closing hand closes just as gradually on the stage", () => {
  for (const aspect of CAMERAS) {
    let previous = null;
    for (let step = 0; step <= 10; step++) {
      const curl = step / 10;
      // thumb tucked so no gesture logic is involved; fingers move together, as in a real grasp
      const spec = read({ aspect }, hand.pose({ thumb: "tucked", index: curl, middle: curl, ring: curl, pinky: curl }).landmarks({ aspect }));
      for (const finger of FINGERS) {
        assert.ok(Math.abs(spec[finger] - curl) <= 0.12, `${finger} at true curl ${curl} is shown as ${spec[finger].toFixed(2)}`);
        if (previous) {
          assert.ok(spec[finger] >= previous[finger] - 1e-9, "closing further must never open the 3D finger");
          assert.ok(spec[finger] - previous[finger] <= 0.25, `${finger} snaps between curl ${(curl - 0.1).toFixed(1)} and ${curl}`);
        }
      }
      previous = spec;
    }
  }
});

test("every thumb pose the stage can show is read back as itself", () => {
  const poses = {
    HELLO: { thumb: "open", splay: 0.05 },
    "THANK YOU": { thumb: "tucked", splay: 0.01 },
    PLEASE: { thumb: "wide", ring: 1, pinky: 1, splay: 0.09 },
    SORRY: { thumb: "fist", ...FIST, splay: 0 },
    BYE: { thumb: "tucked", ring: 1, pinky: 1, splay: 0.15 },
    "I LOVE YOU": { thumb: "wide", middle: 1, ring: 1, splay: 0.07 },
    OK: { thumb: "pinch", index: 0.68, splay: 0.08 },
    GOOD: { thumb: "tucked", middle: 1, ring: 1, splay: 0.06 },
    WAIT: { thumb: "tucked", middle: 1, ring: 1, pinky: 1, splay: 0 },
    WATER: { thumb: "tucked", pinky: 1, splay: 0.11 },
    FOOD: { thumb: "tucked", index: 1, middle: 1, ring: 1, splay: 0.04 },
    "COME HERE": { thumb: "wide", middle: 1, ring: 1, pinky: 1, splay: 0.04 },
    "CALL ME": { thumb: "wide", index: 1, middle: 1, ring: 1, splay: 0.08 },
  };
  const rand = seeded(11);
  for (const [sign, pose] of Object.entries(poses)) {
    hand.pose(pose);
    eachView((view) => {
      for (const landmarks of [hand.landmarks(view), jitter(hand.landmarks(view), view, 0.015, rand)]) {
        const spec = read(view, landmarks);
        assert.equal(spec.thumb, pose.thumb, `${sign} thumb in view ${JSON.stringify(view)}`);
        assert.equal(spec.mirrorX, view.thumbOnRight ? -1 : 1, `${sign} came out as the opposite hand in ${JSON.stringify(view)}`);
      }
    });
  }
});

test("thumbs up and thumbs down point the 3D thumb exactly where the real thumb points", () => {
  hand.pose({ thumb: "up", ...FIST, splay: 0 });
  const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  for (const aspect of CAMERAS) {
    for (const thumbOnRight of [false, true]) {
      const side = thumbOnRight ? -1 : 1;
      // The YES and NO signs hold the fist rolled by -1.15 and +1.95 (mirrored for the other hand).
      for (const [sign, signRoll] of [["YES", -1.15], ["NO", 1.95]]) {
        const spec = read({ aspect, thumbOnRight, roll: signRoll * side });
        assert.equal(spec.thumb, "up", `${sign} must read as a thumb held out of a fist`);
        assert.equal(spec.mirrorX, side, `${sign} came out as the opposite hand`);
        assert.ok(Math.abs(wrap(spec.rot[2] - signRoll * side)) < 0.1, `${sign} roll ${spec.rot[2]} should be about ${signRoll * side}`);
      }
      // Anywhere a thumbs up / down is seen, the stage thumb (1.15 rad off the finger axis)
      // must end up pointing the way the tracked thumb points on screen.
      for (let roll = -3; roll <= 3; roll += 0.25) {
        const view = { aspect, thumbOnRight, roll };
        const landmarks = hand.landmarks(view);
        const spec = read(view, landmarks);
        if (spec.thumb !== "up") continue;
        const dx = -(landmarks[4].x - landmarks[2].x) * aspect; // mirrored preview: x flipped, y up
        const dy = -(landmarks[4].y - landmarks[2].y);
        const pointing = Math.atan2(-dx, dy);
        assert.ok(Math.abs(wrap(spec.rot[2] + 1.15 * spec.mirrorX - pointing)) < 0.03, `thumb direction lost at roll ${roll}`);
      }
    }
  }
});

test("a relaxed or half-closed hand is not mistaken for a pinch or a thumbs up", () => {
  const rand = seeded(23);
  const relaxed = [];
  for (const curl of [0.2, 0.3, 0.4, 0.5]) relaxed.push({ thumb: "open", index: curl, middle: curl, ring: curl, pinky: curl });
  for (const curl of [0.3, 0.5, 0.7]) relaxed.push({ thumb: "open", index: curl });
  for (const pose of relaxed) {
    hand.pose(pose);
    eachView((view) => {
      for (let rep = 0; rep < 3; rep++) {
        const spec = read(view, jitter(hand.landmarks(view), view, 0.015, rand));
        assert.ok(["open", "wide"].includes(spec.thumb), `${JSON.stringify(pose)} read as "${spec.thumb}" in ${JSON.stringify(view)}`);
      }
    }, { rolls: [-0.4, 0, 0.4] });
  }
  // A closing fist with the thumb held against it is a fist, never a thumbs up.
  for (const curl of [0.6, 0.8, 1]) {
    hand.pose({ thumb: "tucked", index: curl, middle: curl, ring: curl, pinky: curl });
    eachView((view) => assert.ok(["fist", "tucked"].includes(read(view).thumb)));
  }
});

test("the hand keeps its handedness however it is turned in the picture", () => {
  for (const pose of [{ thumb: "open" }, { thumb: "up", ...FIST }, { thumb: "tucked", index: 1, middle: 1 }]) {
    hand.pose(pose);
    for (const thumbOnRight of [false, true]) {
      for (let roll = -3; roll <= 3; roll += 0.3) {
        assert.equal(read({ roll, thumbOnRight }).mirrorX, thumbOnRight ? -1 : 1, `flipped at roll ${roll.toFixed(1)} with ${JSON.stringify(pose)}`);
      }
    }
  }
});

test("two hands stay on their own sides whatever order the tracker reports them in", () => {
  hand.pose({ thumb: "fist", ...FIST });
  const leftFist = { landmarks: hand.landmarks({ screenX: 0.25 }) };
  hand.pose({ thumb: "open" });
  const rightOpen = { landmarks: hand.landmarks({ screenX: 0.75, thumbOnRight: true }) };
  for (const order of [[leftFist, rightOpen], [rightOpen, leftFist]]) {
    const { primary, secondary } = liveHandSpecs(order, { aspect: 4 / 3 });
    assert.equal(primary.thumb, "fist", "the hand on the left of the preview must be the primary (left) stage hand");
    assert.equal(secondary.thumb, "open");
    assert.ok(primary.pos[0] <= -0.5 && secondary.pos[0] >= 0.5);
    assert.equal(primary.mirrorX, 1);
    assert.equal(secondary.mirrorX, -1);
  }
  assert.deepEqual(liveHandSpecs([]), { primary: null, secondary: null });
  assert.equal(liveHandSpecs([{ landmarks: [] }, rightOpen], { aspect: 4 / 3 }).secondary, null, "a broken hand must not blank the good one");
});

test("the same hand reads the same on a 4:3 and a 16:9 camera", () => {
  for (const pose of [{ thumb: "wide", middle: 1, ring: 1 }, { thumb: "open", index: 0.4, middle: 0.4, ring: 0.4, pinky: 0.4 }]) {
    hand.pose(pose);
    for (const roll of [-0.6, 0, 0.6]) {
      const [narrow, wide] = CAMERAS.map((aspect) => read({ aspect, roll }));
      assert.equal(narrow.thumb, wide.thumb);
      assert.ok(Math.abs(narrow.rot[2] - wide.rot[2]) < 1e-9, "tilt must not depend on the camera shape");
      for (const finger of FINGERS) assert.ok(Math.abs(narrow[finger] - wide[finger]) < 1e-9);
    }
  }
  // Without the aspect ratio a widescreen frame squeezes sideways distances, and the tilt shrinks.
  hand.pose();
  const view = { aspect: 16 / 9, roll: 0.5 };
  const corrected = read(view).rot[2];
  const uncorrected = extractLiveHandSpec(hand.landmarks(view)).rot[2];
  assert.ok(uncorrected < corrected - 0.05);
});

test("the thumb reference table still matches the sculpted hand", () => {
  const reference = Object.fromEntries(THUMB_TIP_REFERENCES.map(([mode, along, across]) => [mode, [along, across]]));
  const measure = (thumb) => thumbTipInPalmFrame(hand.pose({ thumb }).landmarks({ aspect: 16 / 9, roll: 0.7 }), { aspect: 16 / 9 });
  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(gap(measure("open"), reference.open) < 0.03);
  assert.ok(gap(measure("wide"), reference.wide) < 0.03);
  // "tucked" stands for both thumb-across-the-palm poses.
  assert.ok(gap(measure("tucked"), reference.tucked) < 0.1);
  assert.ok(gap(measure("fist"), reference.tucked) < 0.1);
  // The poses must stay far enough apart for "nearest" to be a stable choice.
  assert.ok(gap(reference.open, reference.wide) > 0.35 && gap(reference.open, reference.tucked) > 0.6);
});
