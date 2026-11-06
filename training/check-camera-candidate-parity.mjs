// Explicit local research check; real research files are not core-test fixtures.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preprocessPoseSequence, predictFeatureProbabilities, validateTrainedModel } from "../src/lib/trainedSignModel.js";
import { predictTrainedCameraSign } from "../src/lib/cameraWordRecognition.js";

const [directory, reportPath] = process.argv.slice(2);
if (!directory || process.argv.length > 4) throw new Error("Usage: node training/check-camera-candidate-parity.mjs STUDY_DIRECTORY [NEW_REPORT.json]");
const load = async name => {
  const bytes = await readFile(resolve(directory, name));
  assert.ok(bytes.length > 0 && bytes.length < 4 * 1024 * 1024, "Bounded nonempty research JSON required");
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
};
const [{ bytes, value: model }, { value: fixture }] = await Promise.all([load("candidate.json"), load("canonical-validation-parity.json")]);
const modelSha256 = createHash("sha256").update(bytes).digest("hex");
validateTrainedModel(model, "isl");
assert.equal(fixture.format, "signbridge-camera-aligned-parity-v1");
assert.equal(modelSha256, fixture.candidateSha256);
assert.equal(model.cameraInput.space, "normalized-image");
assert.equal(model.cameraInput.scaleX, 1); assert.equal(model.cameraInput.scaleY, 1);
assert.equal(model.threshold, .95); assert.equal(model.margin, .3);
assert.ok(fixture.fixtures.length >= 1 && fixture.fixtures.length <= 3);
assert.equal(fixture.nativeProbabilities.length, fixture.fixtures.length);
let maxFeatureError = 0, maxProbabilityError = 0;
for (const [index, sample] of fixture.fixtures.entries()) {
  assert.equal(sample.split, "val");
  const actual = preprocessPoseSequence(sample.frames);
  assert.equal(actual.length, 32); assert.equal(sample.features.length, 32);
  for (let t = 0; t < 32; t++) {
    assert.equal(actual[t].length, 81); assert.equal(sample.features[t].length, 81);
    for (let f = 0; f < 81; f++) {
      assert.ok(Number.isFinite(actual[t][f]) && Number.isFinite(sample.features[t][f]));
      maxFeatureError = Math.max(maxFeatureError, Math.abs(actual[t][f] - sample.features[t][f]));
    }
  }
  // Compare preprocessing + actual browser arithmetic, not just prepared features.
  const scores = predictFeatureProbabilities(model, actual);
  assert.equal(scores.length, model.labels.length);
  assert.equal(scores.length, fixture.nativeProbabilities[index].length);
  scores.forEach((value, label) => {
    assert.ok(Number.isFinite(value) && Number.isFinite(fixture.nativeProbabilities[index][label]));
    maxProbabilityError = Math.max(maxProbabilityError, Math.abs(value - fixture.nativeProbabilities[index][label]));
  });
}
assert.ok(maxFeatureError < 1e-5, `Feature mismatch ${maxFeatureError}`);
assert.ok(maxProbabilityError < 1e-5, `Probability mismatch ${maxProbabilityError}`);
// An all-missing synthetic detection fixture must not reach candidate inference.
const emptyFrames = Array.from({ length: 16 }, (_, index) => ({ atMs: index * 125,
  keypoints: Array.from({ length: 75 }, () => [0, 0, 0]), confidences: Array(75).fill(0) }));
const noSign = predictTrainedCameraSign(model, emptyFrames, { durationMs: 2000 });
assert.equal(noSign.status, "no_sign"); assert.equal(noSign.meaning, "");
assert.equal(noSign.diagnostics.inferenceRan, false);
const report = { modelSha256, validationFixtures: fixture.fixtures.length, maxFeatureError, maxProbabilityError,
  tolerance: 1e-5, emptyDetectionGatePassed: true, passed: true,
  scope: "Native Python / browser JavaScript numerical parity and empty-frame gate; not webcam accuracy or idle-camera evaluation" };
if (reportPath) await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report));
