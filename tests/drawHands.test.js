import assert from "node:assert/strict";
import { test } from "node:test";
import { drawHands } from "../src/lib/drawHands.js";

function canvasFixture() {
  const calls = [];
  const context = { measureText: (text) => ({ width: text.length * 6 }) };
  for (const method of ["clearRect", "beginPath", "moveTo", "lineTo", "stroke", "arc", "fill", "save", "restore", "translate", "scale", "strokeText", "fillText"]) {
    context[method] = (...args) => calls.push({ method, args, color: method === "stroke" ? context.strokeStyle : context.fillStyle });
  }
  return { canvas: { width: 0, height: 0, getContext: () => context }, calls };
}
const hand = (side = "Left", start = .2) => ({ handedness: side, landmarks: Array.from({ length: 21 }, (_, i) => ({ x: start + i * .005, y: .3 + i * .006, z: i * .001 })) });

test("two complete hands draw all 42 real joints and retain their exact image coordinates", () => {
  const { canvas, calls } = canvasFixture(), hands = [hand("Left"), hand("Right", .6)];
  drawHands(canvas, hands, 640, 480);
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 480);
  const dots = calls.filter((call) => call.method === "arc");
  assert.equal(dots.length, 42);
  assert.deepEqual(dots.map(({ args }) => args.slice(0, 2)), hands.flatMap(({ landmarks }) => landmarks.map((point) => [point.x * 640, point.y * 480])));
  assert.equal(calls.filter((call) => call.method === "stroke").length, 42);
  assert.ok(new Set(calls.filter((call) => call.method === "stroke").map((call) => call.color)).size >= 5);
  assert.ok(dots[0].args[2] > dots[1].args[2]); // Wrist is distinct from finger joints.
  assert.ok(dots[4].args[2] > dots[3].args[2]); // Fingertips are distinct too.
  assert.equal(calls.filter((call) => call.method === "fillText").length, 0);
  assert.equal(calls.filter((call) => call.method === "scale").length, 0);
});

test("optional numbering identifies each real joint and counter-mirrors only text", () => {
  const { canvas, calls } = canvasFixture(), tracked = hand();
  drawHands(canvas, [tracked], 640, 480, { showLabels: true, showJointNumbers: true, mirrorText: true });
  const labels = calls.filter((call) => call.method === "fillText").map((call) => call.args[0]);
  assert.equal(labels.length, 21);
  assert.equal(labels[0], "Left Wrist (0)"); assert.equal(labels[4], "Thumb tip (4)"); assert.equal(labels[8], "Index tip (8)"); assert.equal(labels[20], "Pinky tip (20)");
  assert.equal(labels[5], "5");
  assert.equal(calls.filter((call) => call.method === "scale").length, 21);
  assert.ok(calls.filter((call) => call.method === "scale").every((call) => call.args[0] === -1 && call.args[1] === 1));
  assert.deepEqual(calls.find((call) => call.method === "arc").args.slice(0, 2), [tracked.landmarks[0].x * 640, tracked.landmarks[0].y * 480]);
  assert.equal(calls.filter((call) => call.method === "save").length, calls.filter((call) => call.method === "restore").length);
});

test("lost or malformed hands clear the previous overlay without invented zero joints", () => {
  const { canvas, calls } = canvasFixture();
  drawHands(canvas, [hand()], 640, 480); calls.length = 0;
  const invalid = hand(); invalid.landmarks[20].x = Infinity;
  drawHands(canvas, [{ landmarks: [] }, { landmarks: hand().landmarks.slice(0, 20) }, invalid, null], 640, 480);
  assert.deepEqual(calls.map((call) => call.method), ["clearRect"]);
  assert.doesNotThrow(() => drawHands({ getContext: () => null }, [hand()], 640, 480));
  assert.doesNotThrow(() => drawHands({ getContext: () => { throw new Error("Unavailable canvas"); } }, [hand()], 640, 480));
});
