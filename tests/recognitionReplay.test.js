import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_REPLAY_VIDEO_BYTES, prepareReplayFrames, summarizeReplay, validateReplayBaseline, validateReplayVideo } from "../src/lib/recognitionReplay.js";
import { predictTrainedCameraSign } from "../src/lib/cameraWordRecognition.js";
import { legacyCameraFrames, legacyCameraModel } from "./helpers/legacyCamera.js";

const modelHash = "a".repeat(64);
const videoHash = "c".repeat(64);
const video = (patch = {}) => ({ size: 1024, type: "video/mp4", name: "PRIVATE-CAPTURE.mp4", ...patch });
const baseline = (patch = {}) => ({ format: "signbridge-recognition-baseline-v1", signLanguage: "asl", expectedLabel: "BOOK", modelSha256: modelHash, videoSha256: videoHash,
  prediction: { status: "recognized", topLabel: "BOOK", topScore: 1 }, ...patch });
const run = (frames = legacyCameraFrames(), options = {}, model = legacyCameraModel()) => {
  const result = predictTrainedCameraSign(model, frames, { durationMs: 500 });
  return summarizeReplay(frames, 500, result, { signLanguage: "asl", modelSha256: modelHash, videoSha256: videoHash, ...options });
};

test("local video validation bounds bytes and duration without retaining the filename", () => {
  assert.deepEqual(validateReplayVideo(video()), { ok: true });
  for (const seconds of [.35, 12]) assert.equal(validateReplayVideo(video({ size: MAX_REPLAY_VIDEO_BYTES }), seconds).ok, true);
  for (const size of [0, -1, 1.5, NaN, Infinity, MAX_REPLAY_VIDEO_BYTES + 1]) assert.equal(validateReplayVideo(video({ size })).code, "size");
  for (const seconds of [0, .349, 12.001, NaN, Infinity, null, "1"]) assert.equal(validateReplayVideo(video(), seconds).code, "duration");
  assert.equal(validateReplayVideo(null).code, "file");
  assert.doesNotMatch(JSON.stringify(validateReplayVideo(video(), 100)), /PRIVATE/);
});

test("blank MIME permits known video extensions, while an explicit non-video MIME is rejected", () => {
  for (const name of ["clip.MP4", "clip.webm", "clip.mov", "clip.mkv", "clip.ogv"]) assert.equal(validateReplayVideo(video({ type: "", name })).ok, true);
  assert.equal(validateReplayVideo(video({ type: "video/custom", name: "clip.data" })).ok, true);
  for (const patch of [{ type: "image/png" }, { type: "application/octet-stream" }, { type: "video/" }, { type: "", name: "clip.txt" }, { type: "", name: "clip.mp4.txt" }]) assert.equal(validateReplayVideo(video(patch)).code, "type");
});

test("baseline validation returns an independent whitelist with normalized hash and no private fields", () => {
  const original = baseline({ expectedLabel: " BOOK ", modelSha256: "A".repeat(64), filename: "PRIVATE FILE", video: "PRIVATE VIDEO" });
  original.prediction.private = "PRIVATE PREDICTION";
  const validated = validateReplayBaseline(original);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.baseline, baseline());
  original.prediction.topLabel = "DRINK";
  assert.equal(validated.baseline.prediction.topLabel, "BOOK");
  assert.doesNotMatch(JSON.stringify(validated), /PRIVATE|filename|"video":/);
});

test("malformed baseline schema, scalars and prediction pairs fail closed", () => {
  for (const value of [null, [], {}, baseline({ format: "wrong" })]) assert.equal(validateReplayBaseline(value).ok, false);
  for (const patch of [{ signLanguage: "ASL" }, { expectedLabel: " " }, { expectedLabel: "x".repeat(81) }, { expectedLabel: "BOOK\nPRIVATE" }, { modelSha256: "a".repeat(63) }, { videoSha256: null }, { videoSha256: "c".repeat(63) }]) assert.equal(validateReplayBaseline(baseline(patch)).ok, false);
  for (const prediction of [{ status: "private", topLabel: "BOOK", topScore: 1 }, { status: "unclear", topLabel: null, topScore: 1 }, { status: "unclear", topLabel: "BOOK", topScore: null }, { status: "unclear", topLabel: "BOOK", topScore: NaN }, { status: "unclear", topLabel: "BOOK", topScore: 1.1 }, { status: "recognized", topLabel: null, topScore: null }, { status: "no_sign" }]) assert.equal(validateReplayBaseline(baseline({ prediction })).ok, false);
  assert.equal(validateReplayBaseline(baseline({ prediction: { status: "no_sign", topLabel: null, topScore: null } })).ok, true);
});

test("real unchanged camera predictor produces scalar replay measurements and a matched-model comparison", () => {
  const report = run(undefined, { baseline: baseline() });
  assert.equal(report.format, "signbridge-recognition-replay-v1");
  assert.equal(report.frameCount, 4); assert.equal(report.durationMs, 500);
  assert.deepEqual(report.quality, { passed: true, code: "", handFrames: 4, shoulderFrames: 4, qualifiedFrames: 4, largestGapMs: 125 });
  assert.equal(report.prediction.status, "recognized"); assert.equal(report.prediction.meaning, "BOOK"); assert.equal(report.prediction.modelFrames, 32);
  assert.deepEqual(report.comparison, { status: "matched-model", baselineExpectedLabel: "BOOK", baselineStatus: "recognized", baselineTopLabel: "BOOK", baselineTopScore: 1,
    topLabelMatches: true, acceptedMeaningMatches: true });
  assert.match(report.purpose, /no live-camera.*accuracy/);
});

test("top-label agreement and acceptance agreement are separate even with the same model hash", () => {
  const rejectedBaseline = baseline({ prediction: { status: "unclear", topLabel: "BOOK", topScore: .8 } });
  const accepted = run(undefined, { baseline: rejectedBaseline });
  assert.equal(accepted.comparison.topLabelMatches, true); assert.equal(accepted.comparison.acceptedMeaningMatches, false);
  const rejectedModel = legacyCameraModel(); rejectedModel.threshold = 1; rejectedModel.margin = 1; rejectedModel.weights.head_bias = [0, 0];
  const rejected = run(undefined, { baseline: rejectedBaseline }, rejectedModel);
  assert.equal(rejected.prediction.status, "unclear"); assert.equal(rejected.prediction.meaning, "");
  assert.equal(rejected.comparison.topLabelMatches, true); assert.equal(rejected.comparison.acceptedMeaningMatches, true);
  const different = run(undefined, { baseline: baseline({ prediction: { status: "recognized", topLabel: "DRINK", topScore: .99 } }) });
  assert.equal(different.comparison.topLabelMatches, false); assert.equal(different.comparison.acceptedMeaningMatches, false);
});

test("expected label is only a supplied reference and cannot change the real prediction", () => {
  const book = run(undefined, { baseline: baseline() });
  const otherReference = run(undefined, { baseline: baseline({ expectedLabel: "DRINK" }) });
  assert.deepEqual(otherReference.prediction, book.prediction);
  assert.equal(otherReference.comparison.baselineExpectedLabel, "DRINK");
  assert.equal(otherReference.comparison.topLabelMatches, true); assert.equal(otherReference.comparison.acceptedMeaningMatches, true);
});

test("sampling mode and capture clock distinguish replay paths without leaking unknown options or changing inference", () => {
  const realtime = run();
  assert.equal(realtime.samplingMode, "realtime-8hz"); assert.equal(realtime.captureClock, "wall");
  const sequential = run(undefined, { samplingMode: "sequential-25fps" });
  assert.equal(sequential.samplingMode, "sequential-25fps"); assert.equal(sequential.captureClock, "source");
  assert.deepEqual(sequential.prediction, realtime.prediction);
  assert.equal(realtime.trackerBackend, "tasks-holistic");
  assert.equal(run(undefined, { trackerBackend: "solutions-holistic-experiment" }).trackerBackend, "tasks-holistic");
  assert.equal(run(undefined, { samplingMode: "sequential-25fps", trackerBackend: "solutions-holistic-experiment" }).trackerBackend, "solutions-holistic-experiment");
  assert.equal(run(undefined, { samplingMode: "sequential-25fps", trackerBackend: "PRIVATE TRACKER" }).trackerBackend, "tasks-holistic");
  for (const samplingMode of [null, undefined, "PRIVATE MODE", {}, 25]) {
    const report = run(undefined, { samplingMode, captureClock: "PRIVATE CLOCK" });
    assert.equal(report.samplingMode, "realtime-8hz"); assert.equal(report.captureClock, "wall");
    assert.deepEqual(report.prediction, realtime.prediction);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  }
});

test("default replay coordinates preserve the exact original frame identity and values", () => {
  const frames = legacyCameraFrames(), before = JSON.stringify(frames);
  assert.equal(prepareReplayFrames(frames), frames);
  assert.equal(prepareReplayFrames(frames, "normalized-image", "isl"), frames);
  assert.equal(prepareReplayFrames(frames, "normalized-image", "asl"), frames);
  assert.equal(JSON.stringify(frames), before);
});

test("the explicit ISL archive experiment scales only x/y into independent copied frames", () => {
  const frames = legacyCameraFrames(); frames[0].keypoints[0] = [.25, .75, -.125]; frames[0].confidences[0] = .6;
  const before = JSON.stringify(frames);
  const transformed = prepareReplayFrames(frames, "archive-isl-hw-1080x1920-experiment", "isl");
  assert.notEqual(transformed, frames); assert.notEqual(transformed[0], frames[0]);
  assert.notEqual(transformed[0].keypoints, frames[0].keypoints); assert.notEqual(transformed[0].confidences, frames[0].confidences);
  assert.deepEqual(transformed[0].keypoints[0], [270, 1440, -.125]);
  for (let frame = 0; frame < frames.length; frame++) {
    assert.equal(transformed[frame].atMs, frames[frame].atMs); assert.deepEqual(transformed[frame].confidences, frames[frame].confidences);
    frames[frame].keypoints.forEach(([x, y, z], joint) => assert.deepEqual(transformed[frame].keypoints[joint], [x * 1080, y * 1920, z]));
  }
  assert.equal(JSON.stringify(frames), before);
  transformed[0].keypoints[0][0] = -1; transformed[0].confidences[0] = 0;
  assert.equal(JSON.stringify(frames), before);
});

test("unsupported coordinate modes and non-ISL experiments fail without echoing arbitrary values", () => {
  const frames = legacyCameraFrames();
  for (const coordinateContract of [null, "PRIVATE CONTRACT", {}, 1080]) assert.throws(() => prepareReplayFrames(frames, coordinateContract, "isl"), (reason) => /supported replay coordinate contract/.test(reason.message) && !/PRIVATE/.test(reason.message));
  for (const signLanguage of [undefined, "asl"]) assert.throws(() => prepareReplayFrames(frames, "archive-isl-hw-1080x1920-experiment", signLanguage), /ISL only/);
  assert.throws(() => prepareReplayFrames(frames, "normalized-image", "PRIVATE LANGUAGE"), (reason) => /Choose ISL or ASL/.test(reason.message) && !/PRIVATE/.test(reason.message));
  assert.throws(() => prepareReplayFrames([{ keypoints: [] }], "archive-isl-hw-1080x1920-experiment", "isl"), /75 finite/);
});

test("coordinate experiment report metadata is whitelisted and contains no transformed poses", () => {
  assert.equal(run().coordinateContract, "normalized-image");
  const model = legacyCameraModel(); model.signLanguage = "isl";
  const frames = prepareReplayFrames(legacyCameraFrames(), "archive-isl-hw-1080x1920-experiment", "isl");
  const result = predictTrainedCameraSign(model, frames, { durationMs: 500 });
  const report = summarizeReplay(frames, 500, result, { signLanguage: "isl", coordinateContract: "archive-isl-hw-1080x1920-experiment" });
  assert.equal(report.coordinateContract, "archive-isl-hw-1080x1920-experiment");
  assert.equal(report.frameCount, 4); assert.equal(report.quality.passed, true);
  assert.doesNotMatch(JSON.stringify(report), /keypoints|confidences|atMs/);
  assert.equal(run(undefined, { coordinateContract: "archive-isl-hw-1080x1920-experiment" }).coordinateContract, "normalized-image");
  for (const coordinateContract of [null, "PRIVATE CONTRACT", {}, 1080]) {
    const safe = run(undefined, { coordinateContract });
    assert.equal(safe.coordinateContract, "normalized-image"); assert.doesNotMatch(JSON.stringify(safe), /PRIVATE/);
  }
});

test("mismatched language, model, unavailable hash and invalid baseline never produce agreement booleans", () => {
  const cases = [
    [{ baseline: baseline({ signLanguage: "isl" }) }, "language-mismatch"],
    [{ baseline: baseline({ modelSha256: "b".repeat(64) }) }, "model-mismatch"],
    [{ baseline: baseline(), modelSha256: null }, "model-unavailable"],
    [{ baseline: baseline(), modelSha256: "PRIVATE HASH" }, "model-unavailable"],
    [{ baseline: baseline(), videoSha256: null }, "video-unavailable"],
    [{ baseline: baseline(), videoSha256: "d".repeat(64) }, "video-mismatch"],
    [{ baseline: baseline({ videoSha256: "d".repeat(64) }) }, "video-mismatch"],
    [{ baseline: { ...baseline(), modelSha256: "PRIVATE HASH" } }, "invalid-baseline"],
    [{}, "missing-baseline"],
  ];
  for (const [options, status] of cases) {
    const report = run(undefined, options);
    assert.equal(report.comparison.status, status);
    assert.equal(report.comparison.topLabelMatches, null); assert.equal(report.comparison.acceptedMeaningMatches, null);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  }
});

test("failed camera quality has no invented posterior and two rejections are not label agreement", () => {
  const report = run([], { baseline: baseline({ prediction: { status: "no_sign", topLabel: null, topScore: null } }) });
  assert.equal(report.quality.passed, false); assert.equal(report.quality.code, "sample-count");
  assert.equal(report.prediction.inferenceRan, false); assert.equal(report.prediction.topLabel, null); assert.equal(report.prediction.topScore, null);
  assert.equal(report.prediction.meaning, ""); assert.deepEqual(report.prediction.reasonCodes, ["sample-count"]);
  assert.equal(report.comparison.topLabelMatches, null); assert.equal(report.comparison.acceptedMeaningMatches, true);
});

test("report never retains raw poses, private metadata, review text or mutable references", () => {
  const frames = legacyCameraFrames(), result = predictTrainedCameraSign(legacyCameraModel(), frames, { durationMs: 500 });
  const privateData = { filename: "PRIVATE FILE", roomId: "PRIVATE ROOM", frames, userAgent: "PRIVATE UA", token: "PRIVATE TOKEN" };
  Object.assign(result, privateData, { meaning: "PRIVATE REVIEWED MESSAGE" });
  Object.assign(result.diagnostics, privateData);
  Object.assign(result.diagnostics.capture, privateData);
  result.diagnostics.reasonCodes.push("PRIVATE REASON");
  const report = summarizeReplay(frames, 500, result, { signLanguage: "asl", modelSha256: modelHash, videoSha256: videoHash, baseline: baseline({ ...privateData }), ...privateData });
  const before = JSON.stringify(report);
  assert.equal(report.prediction.meaning, "");
  assert.doesNotMatch(before, /PRIVATE|filename|keypoints|confidences|atMs|roomId|userAgent|token/);
  result.diagnostics.posterior.topLabel = "DRINK"; result.diagnostics.reasonCodes.push("low-score"); frames[0].confidences[33] = 0;
  assert.equal(JSON.stringify(report), before);
});

test("missing diagnostics or an inconsistent language cannot masquerade as a comparable replay", () => {
  assert.throws(() => summarizeReplay([], 500, { status: "unclear" }, { signLanguage: "asl" }), /no recognition diagnostics/);
  const result = predictTrainedCameraSign(legacyCameraModel(), legacyCameraFrames(), { durationMs: 500 });
  assert.throws(() => summarizeReplay([], 500, result, { signLanguage: "PRIVATE LANGUAGE" }), /Choose ISL or ASL/);
  assert.throws(() => summarizeReplay([], 500, result, { signLanguage: "isl", modelSha256: modelHash }), /different sign language/);
});
