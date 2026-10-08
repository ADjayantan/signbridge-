// Explicit training verification; ignored local data/model files are not core-test prerequisites.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { predictFeatureProbabilities, preprocessPoseSequence, validateTrainedModel } from "../src/lib/trainedSignModel.js";

const languages = process.argv.slice(2);
if (!languages.length) languages.push("isl", "asl");
if (!languages.every((language) => ["isl", "asl"].includes(language))) throw new Error("Usage: node training/check-browser-parity.mjs [isl] [asl]");
const readJSON = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const tolerance = 1e-5;
const difference = (actual, expected) => {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), "Parity numbers must be finite");
  const error = Math.abs(actual - expected);
  assert.ok(error <= tolerance, `Browser/PyTorch difference ${error} exceeds ${tolerance}: ${actual} vs ${expected}`);
  return error;
};

for (const language of languages) {
  const model = await readJSON(`../public/models/${language}.json`);
  const fixture = await readJSON(`./artifacts/${language}-parity.json`);
  validateTrainedModel(model, language);
  assert.equal(fixture.signLanguage, language);
  assert.ok(Array.isArray(fixture.features) && fixture.features.length > 0);
  assert.equal(fixture.probabilities.length, fixture.features.length);
  let maxProbabilityError = 0;
  for (let sample = 0; sample < fixture.features.length; sample++) {
    const actual = predictFeatureProbabilities(model, fixture.features[sample]);
    const expected = fixture.probabilities[sample];
    assert.equal(expected.length, model.labels.length);
    expected.forEach((score, index) => { maxProbabilityError = Math.max(maxProbabilityError, difference(actual[index], score)); });
    difference(actual.reduce((sum, value) => sum + value, 0), 1);
  }
  const raw = await readJSON(`../.training-data/prepared/${language}-raw-parity.json`);
  assert.equal(raw.signLanguage, language);
  assert.equal(raw.split, "test");
  assert.ok(typeof raw.clipId === "string" && raw.clipId.length > 0);
  const processed = preprocessPoseSequence(raw.frames);
  const expectedFeatures = raw.expected || raw.features;
  assert.ok(Array.isArray(expectedFeatures) && expectedFeatures.length === 32);
  assert.equal(processed.length, expectedFeatures.length);
  let maxPreprocessingError = 0;
  processed.forEach((row, step) => {
    assert.equal(row.length, 81);
    assert.equal(row.length, expectedFeatures[step].length);
    row.forEach((value, dimension) => { maxPreprocessingError = Math.max(maxPreprocessingError, difference(value, expectedFeatures[step][dimension])); });
  });
  console.log(JSON.stringify({ signLanguage: language, probabilitySamples: fixture.features.length, maxProbabilityError, preprocessingSamples: 1, preprocessingClipId: raw.clipId, maxPreprocessingError, tolerance, passed: true }));
}
