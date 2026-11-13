import assert from "node:assert/strict";
import test from "node:test";
import { PATTERNS, SCREEN_ANGLES, buildScreen, coverageAt, dotRadius } from "../src/lib/halftone.js";

test("dot area tracks the tone it prints", () => {
  const cell = 10;
  assert.equal(dotRadius(0, cell), 0);
  let previous = -1;
  for (let coverage = 0; coverage <= 1.0001; coverage += 0.05) {
    const radius = dotRadius(coverage, cell);
    assert.ok(radius > previous, "more tone must never print a smaller dot");
    previous = radius;
  }
  // Area, not radius, is proportional to tone: a quarter tone is half the full radius.
  assert.ok(Math.abs(dotRadius(0.25, cell) / dotRadius(1, cell) - 0.5) < 1e-9);
  // Full tone closes the gaps between neighbours (radius past half a cell), out-of-range input is clamped.
  assert.ok(dotRadius(1, cell) > cell / 2);
  assert.equal(dotRadius(2, cell), dotRadius(1, cell));
  assert.equal(dotRadius(-1, cell), 0);
});

test("each ink's screen covers the whole box at its own angle", () => {
  const [width, height, cell] = [320, 180, 10];
  assert.equal(SCREEN_ANGLES.length, 2);
  assert.ok(Math.abs(SCREEN_ANGLES[1] - SCREEN_ANGLES[0] - Math.PI / 3) < 1e-9, "screens sit 60° apart to avoid moiré");
  for (const angle of SCREEN_ANGLES) {
    const screen = buildScreen(width, height, cell, angle);
    assert.equal(screen.length % 4, 0);
    const dots = screen.length / 4;
    // One dot per cell of area, give or take the margin ring.
    assert.ok(dots > (width * height) / (cell * cell) && dots < ((width + 2 * cell) * (height + 2 * cell)) / (cell * cell) * 1.05);
    for (let i = 0; i < screen.length; i += 4) {
      assert.ok(screen[i] >= -cell && screen[i] <= width + cell && screen[i + 1] >= -cell && screen[i + 1] <= height + cell);
      assert.ok(Math.abs(screen[i + 2] - screen[i] / width) < 1e-5 && Math.abs(screen[i + 3] - screen[i + 1] / height) < 1e-5);
    }
    // No gaps: every point of the box is within one cell of a dot centre.
    for (const [x, y] of [[0, 0], [width, height], [width / 2, height / 3], [17, 151]]) {
      let nearest = Infinity;
      for (let i = 0; i < screen.length; i += 4) nearest = Math.min(nearest, Math.hypot(screen[i] - x, screen[i + 1] - y));
      assert.ok(nearest <= cell * Math.SQRT1_2 + 1e-6);
    }
  }
  assert.equal(buildScreen(0, 100, 10, 0).length, 0);
  assert.equal(buildScreen(100, 100, 0, 0).length, 0);
});

test("every pattern prints coverage between 0 and 1, and the pointer only adds ink", () => {
  const scenes = [
    { aspect: 16 / 9, energy: 1, pointer: null },
    { aspect: 1, energy: 1.7, pointer: null },
    { aspect: 0.5, energy: 0.45, pointer: { u: 0.5, v: 0.5, strength: 1 } },
  ];
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    let printed = 0;
    for (const scene of scenes) {
      for (let t = 0; t < 6; t += 1.3) {
        for (let u = 0; u <= 1; u += 0.1) {
          for (let v = 0; v <= 1; v += 0.1) {
            for (const ink of [0, 1]) {
              const coverage = coverageAt(pattern, u, v, t, ink, scene);
              assert.ok(coverage >= 0 && coverage <= 1, `${name} printed ${coverage}`);
              printed = Math.max(printed, coverage);
              const without = coverageAt(pattern, u, v, t, ink, { ...scene, pointer: null });
              assert.ok(coverage >= without - 1e-12, `${name}: the pointer removed ink`);
            }
          }
        }
      }
    }
    assert.ok(printed > 0.3, `${name} should print something visible`);
  }
});

test("the meet pattern brings one ink in from each side", () => {
  const scene = { aspect: 4, energy: 1, pointer: null };
  const average = (ink, u) => {
    let sum = 0;
    for (let t = 0; t < 6; t += 0.25) sum += PATTERNS.meet(u, 0.5, t, ink, scene);
    return sum / 24;
  };
  assert.ok(average(0, 0.05) > average(0, 0.95) + 0.3, "ink 0 starts on the left");
  assert.ok(average(1, 0.95) > average(1, 0.05) + 0.3, "ink 1 starts on the right");
});
