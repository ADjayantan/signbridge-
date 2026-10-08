import assert from "node:assert/strict";
import { test } from "node:test";
import { createSignRecognitionReport } from "../src/lib/signRecognitionReport.js";

const at = "2026-10-05T07:00:00.000Z";
const trial = () => ({ status: "unclear", score: .72, meaning: "PRIVATE REVIEWED MESSAGE", glosses: ["PRIVATE GLOSS"], feedback: "PRIVATE FEEDBACK",
  diagnostics: { inferenceRan: true, reasonCodes: ["low-score", "small-margin"],
    model: { signLanguage: "asl", engine: "legacy", labelsCount: 100, threshold: .98, requiredMargin: .3, acceptanceEnabled: true },
    capture: { inputFrames: 12, handFrames: 10, shoulderFrames: 12, qualifiedFrames: 10, trimmedFrames: 11, trimmedShoulderFrames: 11, modelFrames: 32 },
    posterior: { topLabel: "MOTHER", topScore: .42, runnerUpLabel: "DRINK", runnerUpScore: .35, margin: .07, scorePassed: false, marginPassed: false } } });

test("explicit report whitelists measurements without exporting poses, reviewed text or arbitrary metadata", () => {
  const result = trial();
  const privateFields = { roomId: "PRIVATE ROOM", apiKey: "PRIVATE KEY", userAgent: "PRIVATE UA", frames: [{ atMs: 125, keypoints: [[.5, .5, 0]], confidences: [1] }], weights: { private: "PRIVATE WEIGHTS" } };
  Object.assign(result, privateFields); Object.assign(result.diagnostics, privateFields); Object.assign(result.diagnostics.model, privateFields);
  result.diagnostics.capture.frames = privateFields.frames;
  const report = createSignRecognitionReport(result, { count: 12, durationMs: 1500, samplesPerSecond: 8, handFrames: 10, shoulderFrames: 12, clippedFrames: 0, largestGapMs: 125, ...privateFields }, at);
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /PRIVATE|frames|keypoints|confidences|atMs|roomId|apiKey|userAgent|weights|meaning|glosses|feedback/);
  assert.equal(report.format, "signbridge-recognition-report-v1"); assert.equal(report.exportedAt, at);
  assert.equal(report.result.posterior.topLabel, "MOTHER"); assert.equal(report.result.posterior.runnerUpLabel, "DRINK");
  assert.equal(report.result.capture.inputFrames, 12); assert.equal(report.result.capture.modelFrames, 32);
  assert.equal(report.captureQuality.durationMs, 1500); assert.match(report.purpose, /no reviewed ground truth/);
});

test("an unrun model has no posterior despite compatibility scores or injected tentative labels", () => {
  const result = trial(); result.status = "no_sign"; result.score = 0;
  result.diagnostics.inferenceRan = false; result.diagnostics.reasonCodes = ["no-hands"];
  const report = createSignRecognitionReport(result, null, at);
  assert.equal(report.result.posterior, null); assert.equal(report.result.inferenceRan, false);
  assert.equal(report.captureQuality, null); assert.doesNotMatch(JSON.stringify(report), /MOTHER|DRINK|"score":0/);
});

test("invalid scalar measurements become null and unknown enums cannot leak arbitrary strings", () => {
  const result = trial();
  result.diagnostics.reasonCodes = ["low-score", "PRIVATE REASON", "low-score", null];
  Object.assign(result.diagnostics.model, { signLanguage: "PRIVATE LANGUAGE", engine: "PRIVATE ENGINE", threshold: "0.98", requiredMargin: 2, labelsCount: 999, acceptanceEnabled: "true" });
  Object.assign(result.diagnostics.capture, { inputFrames: NaN, handFrames: -1, shoulderFrames: 3.5, durationMs: Infinity, largestGapMs: -1 });
  Object.assign(result.diagnostics.posterior, { topScore: NaN, margin: -1, runnerUpScore: "0.5", scorePassed: 1, runnerUpLabel: "x".repeat(81) });
  result.diagnostics.cameraGate = { passed: "false", code: "PRIVATE CODE" };
  const report = createSignRecognitionReport(result, { durationMs: 99999 }, at);
  assert.deepEqual(report.result.reasonCodes, ["low-score"]);
  assert.deepEqual(report.result.model, { signLanguage: null, engine: null, labelsCount: null, threshold: null, requiredMargin: null, acceptanceEnabled: null });
  assert.equal(report.result.capture.inputFrames, null); assert.equal(report.result.capture.handFrames, null); assert.equal(report.result.capture.shoulderFrames, null);
  assert.equal(report.result.posterior.topScore, null); assert.equal(report.result.posterior.margin, null); assert.equal(report.result.posterior.runnerUpLabel, null);
  assert.deepEqual(report.result.cameraGate, { passed: null, code: null }); assert.equal(report.captureQuality.durationMs, null);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|NaN|Infinity/);
});

test("report snapshots remain separate from mutable diagnostics and never mutate the result", () => {
  const result = trial(); const before = JSON.stringify(result);
  const report = createSignRecognitionReport(result, null, at);
  assert.equal(JSON.stringify(result), before);
  result.diagnostics.reasonCodes.push("recognized"); result.diagnostics.posterior.topScore = 1; result.diagnostics.capture.handFrames = 0;
  assert.deepEqual(report.result.reasonCodes, ["low-score", "small-margin"]); assert.equal(report.result.posterior.topScore, .42); assert.equal(report.result.capture.handFrames, 10);
});

test("missing diagnostics, unknown statuses, ambiguous inference state and invalid time cannot produce a report", () => {
  assert.throws(() => createSignRecognitionReport({ status: "unclear" }), /no recognition diagnostics/);
  const result = trial(); result.status = "PRIVATE STATUS";
  assert.throws(() => createSignRecognitionReport(result), /no recognition diagnostics/);
  result.status = "unclear"; result.diagnostics.inferenceRan = "false";
  assert.throws(() => createSignRecognitionReport(result), /no recognition diagnostics/);
  result.diagnostics.inferenceRan = true;
  assert.throws(() => createSignRecognitionReport(result, null, "invalid"), /timestamp/);
});
