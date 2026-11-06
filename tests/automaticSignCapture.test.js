import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTOMATIC_SIGN_CAPTURE_DEFAULTS, createAutomaticSignCapture } from "../src/lib/automaticSignCapture.js";
import { validateCameraTurn } from "../src/lib/graphSignModel.js";

// Actual 75-point camera contract: complete left hand, both shoulders, image x/y.
function pose({ x = 0, hand = true, shoulders = true, bodyX = 0, bodyY = 0, scale = 1 } = {}) {
  const keypoints = Array.from({ length: 75 }, () => [.5 + bodyX, .5 + bodyY, 0]);
  const confidences = Array(75).fill(0);
  keypoints[11] = [.5 - .2 * scale + bodyX, .5 + bodyY, 0];
  keypoints[12] = [.5 + .2 * scale + bodyX, .5 + bodyY, 0];
  confidences[11] = confidences[12] = shoulders ? 1 : 0;
  for (let joint = 0; joint < 21; joint++) {
    keypoints[33 + joint] = [.5 + (x + joint * .001) * scale + bodyX, .3 + (joint * .002) * scale + bodyY, 0];
    confidences[33 + joint] = hand ? 1 : 0;
  }
  return { keypoints, confidences, atMs: 9999 }; // Caller timing, not this unrelated field, is measured.
}

const feed = (capture, points, base = 0) => points.map(([at, x, extra]) => capture.push(pose({ x, ...extra }), base + at));
const preparation = [[0, 0], [125, 0], [250, 0], [375, 0]];
const movement = [[500, .04], [625, .08], [750, .12], [875, .16], [1000, .2]];
const settle = Array.from({ length: 7 }, (_, i) => [1125 + 125 * i, .2]);
const completeMovement = (capture, base = 0) => feed(capture, [...preparation, ...movement, ...settle], base);

test("a stable palm and small tracking jitter produce one held attempt, never an immediate motion start", () => {
  for (const jitter of [0, .0007]) {
    const capture = createAutomaticSignCapture();
    const events = Array.from({ length: 48 }, (_, i) => capture.push(pose({ x: i % 2 ? jitter : 0 }), i * 125));
    assert.ok(events.every((event) => event.type !== "start"));
    const completed = events.filter((event) => event.type === "complete");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].reason, "held-pose");
    assert.ok(completed[0].durationMs >= 1200);
    assert.ok(events.filter((event) => event.type === "complete").every((event) => event.meaning === undefined && event.label === undefined));
    assert.equal(capture.snapshot().state, "waiting");
  }
  const capture = createAutomaticSignCapture();
  feed(capture, Array.from({ length: 12 }, (_, i) => [i * 125, 0, { hand: i % 2 === 0 }]));
  assert.equal(capture.snapshot().segmentId, 0);
});

test("held capture measures at least 1.2 seconds of fresh full-hand samples and copies the actual timing", () => {
  const capture = createAutomaticSignCapture();
  const events = feed(capture, Array.from({ length: 11 }, (_, i) => [i * 125, 0]), 10000);
  assert.ok(events.slice(0, -1).every((event) => event.type === "waiting"));
  const completed = events.at(-1);
  assert.equal(completed.type, "complete");
  assert.equal(completed.reason, "held-pose");
  assert.equal(completed.segmentId, 1);
  assert.equal(completed.startAtMs, 10000);
  assert.equal(completed.endAtMs, 11250);
  assert.equal(completed.durationMs, 1250);
  assert.equal(completed.frames[0].atMs, 0);
  assert.equal(completed.frames.at(-1).atMs, 1250);
  assert.equal(completed.frames.length, 11);
  assert.equal(validateCameraTurn(completed.frames, { durationMs: completed.durationMs }).ok, true);
});

test("an emerging movement takes priority over a held dwell that would otherwise finish on the same frame", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, Array.from({ length: 10 }, (_, i) => [i * 125, 0]));
  const movementOnset = feed(capture, [[1250, .02], [1375, .04], [1500, .06]]);
  assert.equal(movementOnset[0].type, "waiting");
  assert.equal(movementOnset[1].type, "waiting");
  assert.equal(movementOnset[2].type, "start");
  assert.ok(movementOnset.every((event) => event.type !== "complete"));
});

test("explicit cancellation exposes and discards a pending hold, then latches it until fresh hand release", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, Array.from({ length: 8 }, (_, i) => [i * 125, 0]));
  assert.equal(capture.snapshot().heldPosePending, true);
  assert.equal(capture.reset("cancel").heldPosePending, false);
  const continued = feed(capture, Array.from({ length: 32 }, (_, i) => [1000 + i * 125, 0]));
  assert.ok(continued.every((event) => event.type !== "complete"));
  assert.equal(capture.snapshot().segmentId, 0);
  feed(capture, Array.from({ length: 7 }, (_, i) => [5000 + i * 125, 0, { hand: false }]));
  const fresh = feed(capture, Array.from({ length: 11 }, (_, i) => [5875 + i * 125, 0]));
  assert.equal(fresh.at(-1).type, "complete");
  assert.equal(fresh.at(-1).reason, "held-pose");
  assert.equal(fresh.at(-1).segmentId, 1);
  assert.equal(capture.snapshot().heldPosePending, false);
});

test("a held pose stays latched across cooldown and interruptions until measured release", () => {
  const capture = createAutomaticSignCapture();
  const first = feed(capture, Array.from({ length: 25 }, (_, i) => [i * 125, 0]));
  assert.equal(first.filter((event) => event.type === "complete").length, 1);
  capture.push(pose(), 3125, { dark: true });
  const heldAfterDark = feed(capture, Array.from({ length: 25 }, (_, i) => [3250 + i * 125, 0]));
  assert.ok(heldAfterDark.every((event) => event.type !== "complete" && event.type !== "start"));
  const release = feed(capture, Array.from({ length: 7 }, (_, i) => [6375 + i * 125, 0, { hand: false }]));
  assert.ok(release.every((event) => event.type !== "complete"));
  const fresh = feed(capture, Array.from({ length: 11 }, (_, i) => [7250 + i * 125, 0]));
  assert.equal(fresh.at(-1).type, "complete");
  assert.equal(fresh.at(-1).reason, "held-pose");
  assert.equal(fresh.at(-1).segmentId, 2);
});

test("one-frame dropout cannot release a held pose; a sustained substantial new pose can", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, Array.from({ length: 25 }, (_, i) => [i * 125, 0]));
  capture.push(pose({ hand: false }), 3125);
  const continuingHold = feed(capture, Array.from({ length: 15 }, (_, i) => [3250 + i * 125, 0]));
  assert.ok(continuingHold.every((event) => event.type !== "complete"));
  const changed = feed(capture, Array.from({ length: 15 }, (_, i) => [5125 + i * 125, .2]));
  assert.ok(changed.every((event) => event.type !== "start"));
  assert.equal(changed.filter((event) => event.type === "complete").length, 1);
  assert.equal(changed.find((event) => event.type === "complete").reason, "held-pose");
  assert.equal(capture.snapshot().segmentId, 2);
});

test("partial hands, clipping, lost shoulders and repeated hand appearance cannot form a held attempt", () => {
  for (const makeFrame of [() => pose({ hand: false }), () => pose({ shoulders: false }),
    () => pose({ x: .49 }), () => { const frame = pose(); frame.confidences[40] = 0; return frame; }]) {
    const capture = createAutomaticSignCapture();
    const events = Array.from({ length: 32 }, (_, i) => capture.push(makeFrame(), i * 125));
    assert.ok(events.every((event) => event.type !== "complete" && event.type !== "start"));
  }
});

test("dark, stale and busy frames discard the dwell timer instead of completing an old held pose", () => {
  for (const health of [{ dark: true }, { trackingFresh: false }, { busy: true }]) {
    const capture = createAutomaticSignCapture();
    feed(capture, Array.from({ length: 9 }, (_, i) => [i * 125, 0]));
    assert.equal(capture.push(pose(), 1125, health).type, "reset");
    const recovery = feed(capture, Array.from({ length: 15 }, (_, i) => [1250 + i * 125, 0]));
    const completed = recovery.filter((event) => event.type === "complete");
    assert.equal(completed.length, 1);
    assert.ok(completed[0].startAtMs > 1125);
    assert.ok(completed[0].durationMs >= 1200);
    assert.ok(recovery.filter((event) => event.type === "complete").every((event) => event.meaning === undefined && event.label === undefined));
  }
});

test("a measured tracking gap or framing loss cannot finish a held window from before interruption", () => {
  for (const interrupt of [
    (capture) => { capture.push(pose(), 2000); return 2125; },
    (capture) => { capture.push(pose({ x: .49 }), 1125); return 1250; },
    (capture) => { capture.push(pose({ shoulders: false }), 1125); return 1250; },
  ]) {
    const capture = createAutomaticSignCapture();
    feed(capture, Array.from({ length: 9 }, (_, i) => [i * 125, 0]));
    const recoveryAt = interrupt(capture);
    const recovery = feed(capture, Array.from({ length: 8 }, (_, i) => [recoveryAt + i * 125, 0]));
    assert.ok(recovery.every((event) => event.type !== "complete"));
  }
});

test("sustained motion starts after framing and finishes only after the measured quiet interval", () => {
  const capture = createAutomaticSignCapture();
  const events = completeMovement(capture, 10000);
  const start = events.find((event) => event.type === "start"), complete = events.find((event) => event.type === "complete");
  assert.equal(start.endAtMs, undefined);
  assert.equal(start.startAtMs, 10500);
  assert.equal(start.frames[0].atMs, 0);
  assert.equal(events.filter((event) => event.type === "start").length, 1);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
  assert.equal(events.at(-2).type, "progress");
  assert.equal(complete.reason, "quiet");
  assert.equal(complete.segmentId, start.segmentId);
  assert.equal(complete.endAtMs, 11875);
  assert.equal(complete.durationMs, 1375);
  assert.equal(complete.frames.at(-1).atMs, complete.durationMs);
  assert.deepEqual(validateCameraTurn(complete.frames, { durationMs: complete.durationMs }).ok, true);
});

test("body translation and camera scale changes preserve a held pose without creating signing motion", () => {
  for (const cameraScale of [false, true]) {
    const capture = createAutomaticSignCapture();
    const events = Array.from({ length: 40 }, (_, i) => capture.push(pose({
      bodyX: cameraScale ? 0 : Math.sin(i / 5) * .03,
      bodyY: cameraScale ? 0 : Math.sin(i / 6) * .02,
      scale: cameraScale ? 1 + Math.sin(i / 5) * .1 : 1,
    }), i * 125));
    assert.ok(events.every((event) => event.type !== "start"));
    assert.equal(events.filter((event) => event.type === "complete").length, 1);
    assert.equal(events.find((event) => event.type === "complete").reason, "held-pose");
  }
});

test("brief internal pauses do not prematurely split one movement", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, [...preparation, ...movement]);
  const pause = feed(capture, [[1125, .2], [1250, .2], [1375, .2], [1500, .2]]);
  assert.ok(pause.every((event) => event.type === "progress"));
  const continued = feed(capture, [[1625, .16], [1750, .12], [1875, .08]]);
  assert.ok(continued.every((event) => event.type === "progress"));
  const ending = feed(capture, Array.from({ length: 7 }, (_, i) => [2000 + i * 125, .08]));
  assert.equal(ending.at(-1).type, "complete");
  assert.equal(ending.at(-1).segmentId, 1);
});

test("sustained hand loss finishes an already moving turn, but brief dropout and stationary loss do not", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, [...preparation, ...movement]);
  assert.equal(capture.push(pose({ hand: false }), 1125).type, "progress");
  assert.equal(capture.push(pose({ hand: false }), 1250).type, "progress");
  assert.equal(capture.push(pose({ x: .2 }), 1375).type, "progress");
  const ending = feed(capture, Array.from({ length: 6 }, (_, i) => [1500 + i * 125, 0, { hand: false }]));
  assert.equal(ending.at(-1).type, "complete");
  assert.equal(ending.at(-1).reason, "hands-lost");
  assert.equal(validateCameraTurn(ending.at(-1).frames, { durationMs: ending.at(-1).durationMs }).ok, true);
  const stationary = createAutomaticSignCapture();
  const events = feed(stationary, [...preparation, ...Array.from({ length: 12 }, (_, i) => [500 + i * 125, 0, { hand: false }])]);
  assert.ok(events.every((event) => event.type === "waiting"));
});

test("completion is emitted once; holding the final pose never captures it repeatedly", () => {
  const capture = createAutomaticSignCapture();
  const first = completeMovement(capture);
  const holding = feed(capture, Array.from({ length: 48 }, (_, i) => [2000 + i * 125, .2]));
  assert.equal(first.filter((event) => event.type === "complete").length, 1);
  assert.ok(holding.every((event) => event.type === "waiting"));
  assert.equal(capture.snapshot().segmentId, 1);
});

test("a second real movement after quiet rearming may produce the same word again", () => {
  const capture = createAutomaticSignCapture();
  completeMovement(capture);
  feed(capture, Array.from({ length: 12 }, (_, i) => [2000 + i * 125, .2]));
  const events = feed(capture, [[3500, .16], [3625, .12], [3750, .08], [3875, .04], [4000, 0],
    ...Array.from({ length: 7 }, (_, i) => [4125 + i * 125, 0])]);
  assert.equal(events.filter((event) => event.type === "start").length, 1);
  assert.equal(events.at(-1).type, "complete");
  assert.equal(events.at(-1).segmentId, 2);
});

test("unbroken motion at the hard maximum completes once and requires quiet release", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, [...preparation, ...movement]);
  const events = feed(capture, Array.from({ length: 90 }, (_, i) => [1125 + i * 125, i % 2 ? .08 : .16]));
  const complete = events.find((event) => event.type === "complete");
  assert.equal(complete.reason, "maximum-duration");
  assert.equal(complete.durationMs, AUTOMATIC_SIGN_CAPTURE_DEFAULTS.maximumDurationMs);
  assert.ok(complete.frames.length <= 100);
  assert.equal(validateCameraTurn(complete.frames, { durationMs: complete.durationMs }).ok, true);
  assert.equal(events.filter((event) => event.type === "complete").length, 1);
  assert.equal(capture.snapshot().segmentId, 1);
});

test("sample cap and high camera frame rate never exceed the unchanged model gate", () => {
  const capture = createAutomaticSignCapture({ maximumFrames: 10 });
  const events = feed(capture, [...preparation, ...movement,
    ...Array.from({ length: 15 }, (_, i) => [1125 + i * 125, i % 2 ? .08 : .16])]);
  const complete = events.find((event) => event.type === "complete");
  assert.equal(complete.reason, "maximum-frames");
  assert.equal(complete.frames.length, 10);
  assert.equal(validateCameraTurn(complete.frames, { durationMs: complete.durationMs }).ok, true);
  const fast = createAutomaticSignCapture();
  const highRate = Array.from({ length: 1000 }, (_, i) => fast.push(pose({ x: Math.sin(i / 10) * .1 }), i * 10));
  for (const event of highRate.filter((item) => item.type === "complete")) {
    assert.ok(event.frames.length <= 100);
    assert.equal(validateCameraTurn(event.frames, { durationMs: event.durationMs }).ok, true);
  }
  assert.ok(highRate.some((event) => event.type === "complete"));
});

for (const [name, health] of [["camera off", { enabled: false }], ["dark", { dark: true }],
  ["stale", { trackingFresh: false }], ["inference", { busy: true }]]) {
  test(`${name} discards an active capture and requires a fresh quiet baseline`, () => {
    const capture = createAutomaticSignCapture();
    feed(capture, [...preparation, ...movement]);
    assert.equal(capture.push(pose({ x: .2 }), 1125, health).type, "reset");
    const remainder = feed(capture, Array.from({ length: 15 }, (_, i) => [1250 + i * 125, i % 2 ? .08 : .16]));
    assert.ok(remainder.every((event) => event.type === "waiting"));
    assert.equal(capture.snapshot().frameCount, 0);
    assert.equal(capture.snapshot().segmentId, 1);
  });
}

test("inference reset preserves the completed turn's cooldown and never rearms a held palm", () => {
  const capture = createAutomaticSignCapture();
  completeMovement(capture);
  assert.equal(capture.reset("inference").state, "cooldown");
  const events = feed(capture, Array.from({ length: 30 }, (_, i) => [2000 + i * 125, .2]));
  assert.ok(events.every((event) => event.type === "waiting"));
  assert.equal(capture.snapshot().segmentId, 1);
});

test("tracking gaps, invalid timestamps, invalid poses and lost shoulders cannot finish a stale word", () => {
  for (const [nextFrame, now, reason] of [[pose(), 2000, "tracking-gap"], [pose(), 1000, "timestamp"],
    [pose(), NaN, "timestamp"], [{ keypoints: [], confidences: [] }, 1125, "invalid-pose"],
    [pose({ shoulders: false }), 1125, "framing-lost"]]) {
    const capture = createAutomaticSignCapture();
    feed(capture, [...preparation, ...movement]);
    const event = capture.push(nextFrame, now);
    assert.equal(event.type, "reset"); assert.equal(event.reason, reason);
    assert.equal(capture.snapshot().frameCount, 0);
    assert.equal(capture.snapshot().state, "waiting");
  }
});

test("retained and emitted frames do not alias caller data or earlier event results", () => {
  const capture = createAutomaticSignCapture();
  feed(capture, [...preparation, ...movement.slice(0, 2)]);
  const input = pose({ x: .12 }), start = capture.push(input, 750);
  input.keypoints[33][0] = .99;
  start.frames[0].keypoints[33][0] = .01;
  const events = feed(capture, [...movement.slice(3), ...settle]);
  const complete = events.at(-1);
  assert.equal(complete.type, "complete");
  assert.equal(complete.frames[0].keypoints[33][0], .54);
  assert.equal(complete.frames[2].keypoints[33][0], .62);
});

test("configuration cannot weaken timing/frame bounds or accept invalid motion hysteresis", () => {
  for (const options of [{ maximumFrames: 101 }, { minimumQualifiedFrames: 3 }, { minimumDurationMs: 349 },
    { maximumDurationMs: 12000 }, { staleAfterMs: 1001 }, { sampleIntervalMs: 0 },
    { motionQuietSpeed: .3 }, { heldPoseMs: 1199 }, { heldPoseMs: 8001 },
    { heldPoseDisplacement: 0 }, { heldPoseRearmDisplacement: .06 }, { unexpected: true }]) {
    assert.throws(() => createAutomaticSignCapture(options), /preserve the camera/);
  }
});
