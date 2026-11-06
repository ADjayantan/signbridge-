import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCameraFrame } from "../src/lib/cameraFrameHealth.js";

const image = (values) => ({ width: values.length, height: 1, data: Uint8ClampedArray.from(values.flatMap((value) => [value, value, value, 255])) });

test("uniform near-black samples are dark while a uniform bright image is visible", () => {
  assert.equal(analyzeCameraFrame(image([22, 22, 22, 22])), "dark");
  assert.equal(analyzeCameraFrame(image([0, 0, 0, 0])), "dark");
  assert.equal(analyzeCameraFrame(image([180, 180, 180, 180])), "visible");
});

test("low average brightness alone does not mark an image with visible detail as uniformly dark", () => {
  assert.equal(analyzeCameraFrame(image([0, 10, 20, 70])), "visible");
  assert.equal(analyzeCameraFrame(image([18, 25, 18, 25])), "visible");
});

test("missing, malformed or transparent image data remains unknown", () => {
  for (const value of [null, {}, { width: 1, height: 1, data: [22, 22, 22] }, { width: 1, height: 1, data: [22, NaN, 22, 255] }, { width: 1, height: 1, data: [0, 0, 0, 0] }]) assert.equal(analyzeCameraFrame(value), "unknown");
});
