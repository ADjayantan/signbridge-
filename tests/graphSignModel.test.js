import assert from "node:assert/strict";
import { test } from "node:test";
import { describeGraphCapture, graphNoSign, graphPredictionFromProbabilities, readGraphResponseBytes, validateCameraTurn, validateGraphManifest, withGraphCaptureDiagnostics } from "../src/lib/graphSignModel.js";
import { graphFrames, graphManifest } from "./helpers/graph.js";

test("manifest isolates language/features/model dimensions and rejects corrupt identities/files", () => {
  assert.equal(validateGraphManifest(graphManifest(), "isl").modelId, "synthetic-isl");
  for (const mutate of [(m) => { m.signLanguage = "asl"; }, (m) => { m.contractHash = "0".repeat(64); }, (m) => { m.adjacencyHash = "0".repeat(64); }, (m) => { m.input.shape = [1, 3, 32, 75]; }, (m) => { m.normalization.stage = "browser"; }, (m) => { m.modelFile.name = "../model.onnx"; }, (m) => { m.modelFile.bytes = 6 * 1024 * 1024; }, (m) => { m.labels = ["WATER", "WATER"]; }]) {
    const model = graphManifest(); mutate(model); assert.throws(() => validateGraphManifest(model, "isl"));
  }
});
test("candidate/failed/spoofed promotion and missing device gates never activate in the app", () => {
  for (const mutate of [(m) => { m.promotion.status = "candidate"; }, (m) => { m.promotion.promoted = false; }, (m) => { m.acceptanceEnabled = false; }, (m) => { delete m.evaluation.gates.featureParity; }, (m) => { m.evaluation.gates.runtimeParity = false; }, (m) => { m.evaluation.gates.runtimePerformance = false; }, (m) => { delete m.evaluation.runtimeDeviceReport; }, (m) => { m.distribution.status = "unreviewed"; }]) {
    const model = graphManifest(); mutate(model); assert.throws(() => validateGraphManifest(model, "isl"), (error) => error.code === "unavailable");
  }
});
test("camera timing/framing gate rejects fabricated or long-gap turns before inference", () => {
  assert.equal(validateCameraTurn(graphFrames(), { durationMs: 500 }).ok, true);
  const untimed = graphFrames(); untimed.forEach((frame) => delete frame.atMs); assert.equal(validateCameraTurn(untimed).code, "timing");
  const repeated = graphFrames(); repeated[2].atMs = repeated[1].atMs; assert.equal(validateCameraTurn(repeated).code, "timing");
  const gap = graphFrames(); gap[3].atMs = 1800; assert.equal(validateCameraTurn(gap).code, "tracking-gap");
  assert.equal(validateCameraTurn(graphFrames(), { durationMs: 1600 }).code, "tracking-gap");
  const absent = graphFrames(); absent[2].confidences[11] = 0; assert.equal(validateCameraTurn(absent).code, "framing");
  assert.equal(validateCameraTurn(graphFrames(), { durationMs: 13000 }).code, "duration");
});
test("confidence rejection keeps suggestions tentative and invalid runtime probabilities cannot manufacture words", () => {
  const model = graphManifest();
  assert.equal(graphPredictionFromProbabilities(model, [.9, .1]).meaning, "WATER");
  assert.equal(graphPredictionFromProbabilities(model, [.6, .4]).status, "unclear");
  for (const scores of [[NaN, 1], [1, 1], [-.1, 1.1], [.9]]) assert.throws(() => graphPredictionFromProbabilities(model, scores), /invalid probabilities/);
});
test("graph diagnostics explain independent score/margin rejection with unchanged candidates", () => {
  for (const [threshold, margin, reasons] of [[.95, .1, ["low-score"]], [.7, .9, ["small-margin"]], [.95, .9, ["low-score", "small-margin"]], [.9, .8, ["recognized"]]]) {
    const model = graphManifest(); model.threshold = threshold; model.margin = margin;
    const result = graphPredictionFromProbabilities(model, [.9, .1]);
    assert.deepEqual(result.diagnostics.reasonCodes, reasons);
    assert.equal(result.diagnostics.inferenceRan, true);
    assert.equal(result.diagnostics.capture, null); // Probability-only helper never invents a raw frame count.
    assert.equal(result.diagnostics.model.signLanguage, "isl");
    assert.equal(result.diagnostics.model.engine, "graph");
    assert.equal(result.diagnostics.model.threshold, threshold);
    assert.equal(result.diagnostics.model.requiredMargin, margin);
    assert.deepEqual(result.diagnostics.posterior, { topLabel: "WATER", topScore: .9, runnerUpLabel: "HELP", runnerUpScore: .1,
      margin: .8, scorePassed: .9 >= threshold, marginPassed: .8 >= margin });
    assert.deepEqual(result.candidates, [{ label: "WATER", score: .9 }, { label: "HELP", score: .1 }]);
    assert.equal(result.meaning, reasons[0] === "recognized" ? "WATER" : "");
  }
});
test("graph camera recapture diagnostics retain authoritative raw counts without a measured posterior", () => {
  const frames = graphFrames(); frames[2].atMs = frames[1].atMs;
  const quality = validateCameraTurn(frames, { durationMs: 500 });
  const original = graphNoSign(quality.feedback);
  assert.equal(original.diagnostics.posterior, null); assert.equal(original.diagnostics.inferenceRan, false);
  const capture = describeGraphCapture(frames);
  const result = withGraphCaptureDiagnostics(original, { manifest: graphManifest(), capture, quality });
  assert.equal(result.status, "no_sign"); assert.equal(result.meaning, ""); assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.diagnostics.reasonCodes, ["timing"]);
  assert.deepEqual(result.diagnostics.cameraGate, { passed: false, code: "timing" });
  assert.equal(result.diagnostics.inferenceRan, false); assert.equal(result.diagnostics.posterior, null);
  assert.equal(result.diagnostics.capture.inputFrames, 4); assert.equal(result.diagnostics.capture.handFrames, 4);
  assert.equal(result.diagnostics.capture.modelFrames, 0); assert.equal(result.diagnostics.model.threshold, .7);
  assert.deepEqual(original.diagnostics.reasonCodes, ["recapture"]); // Context attachment does not mutate the worker result.
});
test("successful graph context reports camera samples separately from 32 model frames and retains measured timing", () => {
  const frames = graphFrames();
  frames.unshift({ ...graphFrames()[0], confidences: Array(75).fill(0), atMs: 0 });
  frames.forEach((frame, index) => { frame.atMs = index * 150; });
  const quality = validateCameraTurn(frames, { durationMs: 700 });
  const original = graphPredictionFromProbabilities(graphManifest(), [.9, .1]);
  const capture = describeGraphCapture(frames);
  const result = withGraphCaptureDiagnostics(original, { manifest: graphManifest(), capture, quality });
  assert.equal(result.status, "recognized"); assert.equal(result.meaning, "WATER");
  assert.deepEqual(result.candidates, original.candidates);
  assert.deepEqual(result.diagnostics.posterior, original.diagnostics.posterior);
  assert.deepEqual(result.diagnostics.capture, { inputFrames: 5, handFrames: 4, shoulderFrames: 4, qualifiedFrames: 4,
    trimmedFrames: 4, trimmedShoulderFrames: 4, modelFrames: 32, durationMs: 700, largestGapMs: 150 });
  assert.deepEqual(result.diagnostics.cameraGate, { passed: true, code: "" });
  assert.equal(original.diagnostics.capture, null);
  frames.push(graphFrames()[0]); assert.equal(result.diagnostics.capture.inputFrames, 5);
  assert.ok(!JSON.stringify(result.diagnostics).includes("keypoints"));
});
test("invalid graph poses expose unmeasured quality as null, preserving the camera gate rejection", () => {
  const frames = [{ keypoints: [], confidences: [] }];
  const capture = describeGraphCapture(frames);
  assert.equal(capture.inputFrames, 1); assert.equal(capture.handFrames, null);
  const quality = validateCameraTurn(frames);
  const result = withGraphCaptureDiagnostics(graphNoSign(quality.feedback), { manifest: graphManifest(), capture, quality });
  assert.deepEqual(result.diagnostics.reasonCodes, ["invalid-pose"]);
  assert.equal(result.diagnostics.posterior, null); assert.equal(result.diagnostics.capture.modelFrames, 0);
});
test("streamed artifact size limits cancel downloads once exceeded", async () => {
  let cancelled = false;
  const response = { headers: new Headers(), body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } }) };
  await assert.rejects(readGraphResponseBytes(response, 4), /size limit/); assert.equal(cancelled, true);
});
