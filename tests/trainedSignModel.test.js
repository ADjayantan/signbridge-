import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { POSE_FRAMES, POSE_INPUT_SIZE, POSE_JOINTS, poseFrameFromHolistic, predictFeatureProbabilities, predictTrainedSign, preprocessPoseSequence, validateTrainedModel } from "../src/lib/trainedSignModel.js";

function pose({ x = 0.7, hand = true, shoulders = true } = {}) {
  const keypoints = Array.from({ length: 75 }, () => [0, 0, 0]);
  const confidences = Array(75).fill(0);
  keypoints[0] = [x, 0.3, 0]; confidences[0] = 0.8;
  keypoints[11] = [0.3, 0.5, 0]; confidences[11] = shoulders ? 1 : 0;
  keypoints[12] = [0.7, 0.5, 0]; confidences[12] = shoulders ? 1 : 0;
  keypoints[33] = [x, 0.6, 0]; confidences[33] = hand ? 1 : 0;
  return { keypoints, confidences };
}

function model() {
  const hiddenSize = 2;
  const inputWeights = Array.from({ length: 6 }, () => Array(POSE_INPUT_SIZE).fill(0));
  [0.4, -0.3, 0.2, -0.5, 0.7, -0.6].forEach((weight, row) => { inputWeights[row][0] = weight; });
  return {
    format: "signbridge-gru-v1", signLanguage: "isl", labels: ["WATER", "HELP"], frames: POSE_FRAMES,
    inputSize: POSE_INPUT_SIZE, hiddenSize, joints: [...POSE_JOINTS],
    mean: Array(POSE_INPUT_SIZE).fill(0), std: Array(POSE_INPUT_SIZE).fill(1), threshold: 0.7, margin: 0.1,
    weights: {
      weight_ih_l0: inputWeights,
      weight_hh_l0: [[0.2, -0.1], [-0.3, 0.15], [0.1, 0.25], [-0.05, 0.1], [0.4, 0.35], [-0.25, 0.3]],
      bias_ih_l0: [0.1, -0.2, 0.05, 0.1, 0.2, -0.1], bias_hh_l0: [0.2, -0.1, 0.15, -0.2, 0.3, -0.4],
      head_weight: [[1.2, -0.8], [-0.4, 0.6]], head_bias: [0.1, -0.2],
    },
  };
}

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

describe("pose preprocessing", () => {
  test("preserves shoulder-relative location, confidence and motion without mirroring", () => {
    const frames = [pose({ x: 0.3 }), pose({ x: 0.4 }), pose({ x: 0.5 }), pose({ x: 0.6 })];
    const processed = preprocessPoseSequence(frames);
    assert.equal(processed.length, 32);
    assert.equal(processed[0].length, 81);
    near(processed[0][0], -0.5); near(processed[31][0], 0.25);
    near(processed[0][1], -0.5); near(processed[0][2], 0.8);
    near(processed[10][0], -0.5 + (0.75 * 10 / 31));
    const reflected = frames.map((frame) => ({ ...frame, keypoints: frame.keypoints.map(([x, y, z]) => [1 - x, y, z]) }));
    near(preprocessPoseSequence(reflected)[0][0], 0.5);
  });

  test("trims hand-free ends but retains internal missing-hand and missing-shoulder frames", () => {
    const frames = [pose({ hand: false }), ...Array.from({ length: 4 }, () => pose()), pose({ hand: false })];
    assert.deepEqual(preprocessPoseSequence(frames), preprocessPoseSequence(frames.slice(1, 5)));
    const internal = [pose(), pose({ hand: false }), pose({ shoulders: false }), pose(), pose(), pose()];
    const processed = preprocessPoseSequence(internal);
    // Resampling includes the zero row rather than silently deleting the interruption.
    assert.ok(processed.some((row) => row[0] < 0.1));
    assert.ok(processed.some((row) => row[23] < 0.1)); // left wrist confidence at feature21+2
  });

  test("low-confidence joints are zero and coordinates/confidences are bounded", () => {
    const frame = pose({ x: 100 });
    frame.confidences[0] = 2;
    frame.confidences[2] = 0.1; frame.keypoints[2] = [100, 100, 10];
    const processed = preprocessPoseSequence(Array(4).fill(frame));
    assert.deepEqual(processed[0].slice(0, 3), [5, -0.5000000000000001, 1]);
    assert.deepEqual(processed[0].slice(3, 6), [0, 0, 0]);
    frame.keypoints[11] = [0.5, 0.5, 0]; frame.keypoints[12] = [0.5, 0.5, 0];
    assert.ok(preprocessPoseSequence(Array(4).fill(frame))[0].every(Number.isFinite));
  });

  test("short, hand-free and malformed captures cannot become training features", () => {
    assert.deepEqual(preprocessPoseSequence(Array(3).fill(pose())), []);
    assert.deepEqual(preprocessPoseSequence(Array(4).fill(pose({ hand: false }))), []);
    assert.throws(() => preprocessPoseSequence([{ keypoints: [], confidences: [] }]), /75 finite/);
    const frame = pose(); frame.keypoints[0][0] = NaN;
    assert.throws(() => preprocessPoseSequence([frame]), /75 finite/);
    assert.throws(() => preprocessPoseSequence(Array(2049).fill(pose())), /2048/);
  });

  test("adapts Holistic body/left/right landmarks with missing-body safety", () => {
    const landmarks = (count, x) => Array.from({ length: count }, () => ({ x, y: 0.5, z: 0.1 }));
    const result = poseFrameFromHolistic({ poseLandmarks: landmarks(33, 0.4), leftHandLandmarks: landmarks(21, 0.2), rightHandLandmarks: landmarks(21, 0.8) });
    assert.equal(result.keypoints.length, 75);
    assert.equal(result.keypoints[33][0], 0.2); assert.equal(result.keypoints[54][0], 0.8);
    assert.equal(result.confidences[11], 1); assert.equal(result.confidences[33], 1);
    assert.deepEqual(poseFrameFromHolistic({ leftHandLandmarks: [landmarks(21, 0.2)] }).keypoints[33], [0.2, 0.5, 0.1]);
    const missing = poseFrameFromHolistic({ leftHandLandmarks: landmarks(21, 0.2) });
    assert.equal(predictTrainedSign(model(), Array(4).fill(missing)).status, "unclear");
  });

  test("Tasks zero hand visibility means a detected hand, matching the OpenHands extraction contract", () => {
    // The installed Tasks Qa decoder emits visibility:0 when the hand protobuf omits it.
    const landmarks = (count, x) => Array.from({ length: count }, () => ({ x, y: 0.5, z: 0, visibility: 0, presence: 0 }));
    const body = landmarks(33, 0.5);
    body[0] = { x: 0.7, y: 0.3, z: 0, visibility: 0.8 };
    body[11] = { x: 0.3, y: 0.5, z: 0, visibility: 0.9 };
    body[12] = { x: 0.7, y: 0.5, z: 0, visibility: 0.7 };
    const frame = poseFrameFromHolistic({ poseLandmarks: [body], leftHandLandmarks: [landmarks(21, 0.3)], rightHandLandmarks: [landmarks(21, 0.8)] });
    assert.equal(frame.confidences[11], 0.9); assert.equal(frame.confidences[12], 0.7);
    assert.equal(frame.confidences[2], 0); // Invisible body landmarks stay invisible.
    assert.deepEqual(frame.confidences.slice(33), Array(42).fill(1));
    assert.equal(preprocessPoseSequence(Array(4).fill(frame)).length, 32);
    assert.equal(predictTrainedSign(model(), Array(4).fill(frame)).status, "recognized");
  });

  test("absent, partial or nonfinite hand arrays keep zero confidence and cannot trigger a sign", () => {
    const body = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    body[11].x = 0.3; body[12].x = 0.7;
    const invalid = Array.from({ length: 21 }, () => ({ x: 0.4, y: 0.6, z: 0, visibility: 0 }));
    invalid[20].x = NaN;
    for (const hands of [undefined, [], [[]], invalid.slice(0, 20), [invalid]]) {
      const frame = poseFrameFromHolistic({ poseLandmarks: [body], leftHandLandmarks: hands, rightHandLandmarks: [] });
      assert.deepEqual(frame.confidences.slice(33), Array(42).fill(0));
      assert.equal(predictTrainedSign(model(), Array(4).fill(frame)).status, "no_sign");
    }
  });
});

describe("exported GRU inference", () => {
  test("matches a hand-calculated r/z/n recurrent-gate golden result", () => {
    // Independently calculated scalar recurrence: h32=[.6608381471787234,-.5637752663920004].
    // Nonzero reset bias/recurrent cross-weights catch reset-before-matrix and gate-order mistakes.
    const features = Array.from({ length: 32 }, () => [0.5, ...Array(80).fill(0)]);
    const probabilities = predictFeatureProbabilities(model(), features);
    near(probabilities[0], 0.8953531064394125);
    near(probabilities[1], 1 - 0.8953531064394125);
    const prediction = predictTrainedSign(model(), Array(4).fill(pose()));
    assert.equal(prediction.status, "recognized"); assert.equal(prediction.meaning, "WATER");
    assert.deepEqual(prediction.glosses, ["WATER"]); near(prediction.margin, 0.7907062128788249);
  });

  test("applies exported mean/std once before the recurrent network", () => {
    const normalizedModel = model(); normalizedModel.mean[0] = 0.5; normalizedModel.std[0] = 0.5;
    const raw = Array.from({ length: 32 }, () => [1, ...Array(80).fill(0)]);
    const standardized = Array.from({ length: 32 }, () => [1, ...Array(80).fill(0)]);
    assert.deepEqual(predictFeatureProbabilities(normalizedModel, raw), predictFeatureProbabilities(model(), standardized));
  });

  test("keeps frame order rather than averaging the same frame collection", () => {
    const features = Array.from({ length: 32 }, (_, i) => [i / 31, ...Array(80).fill(0)]);
    const forward = predictFeatureProbabilities(model(), features)[0];
    const backward = predictFeatureProbabilities(model(), [...features].reverse())[0];
    assert.ok(Math.abs(forward - backward) > 0.05);
  });

  test("rejects low posterior scores and ambiguous runners-up without inventing meaning", () => {
    const strict = model(); strict.threshold = 0.99;
    const low = predictTrainedSign(strict, Array(4).fill(pose()));
    assert.equal(low.status, "unclear"); assert.equal(low.meaning, ""); assert.deepEqual(low.glosses, []);
    assert.equal(low.candidates[0].label, "WATER"); assert.equal(low.candidates.length, 2);
    assert.ok(low.candidates[0].score > low.candidates[1].score);
    const ambiguous = model(); ambiguous.margin = 0.9;
    assert.equal(predictTrainedSign(ambiguous, Array(4).fill(pose())).status, "unclear");
  });

  test("rejects no hands before a strongly biased network can guess a sign", () => {
    const biased = model(); biased.weights.head_bias = [20, -20];
    const prediction = predictTrainedSign(biased, Array(8).fill(pose({ hand: false })));
    assert.equal(prediction.status, "no_sign"); assert.equal(prediction.score, 0); assert.equal(prediction.meaning, "");
    assert.deepEqual(prediction.candidates, []);
    assert.equal(predictTrainedSign(biased, Array(3).fill(pose())).status, "unclear");
    const obscured = [...Array(4).fill(pose({ hand: false })), ...Array(4).fill(pose({ shoulders: false }))];
    assert.equal(predictTrainedSign(biased, obscured).status, "unclear");
  });

  test("failed rejection calibration disables acceptance even for highly biased logits", () => {
    const disabled = model(); disabled.weights.head_bias = [20, -20]; disabled.acceptanceEnabled = false;
    const prediction = predictTrainedSign(disabled, Array(4).fill(pose()));
    assert.equal(prediction.status, "unclear"); assert.equal(prediction.meaning, ""); assert.equal(prediction.score, 0);
    assert.deepEqual(prediction.candidates, []);
    assert.match(prediction.feedback, /could not calibrate reliable rejection/);
    assert.equal(predictTrainedSign(disabled, Array(4).fill(pose({ hand: false }))).status, "no_sign");
    disabled.acceptanceEnabled = true;
    assert.equal(predictTrainedSign(disabled, Array(4).fill(pose())).status, "recognized");
    disabled.acceptanceEnabled = "false";
    assert.throws(() => validateTrainedModel(disabled), /acceptance setting/);
    disabled.acceptanceEnabled = null;
    assert.throws(() => validateTrainedModel(disabled), /acceptance setting/);
  });

  test("diagnostics distinguish capture quality and disabled calibration from an unrun network", () => {
    const biased = model(); biased.weights.head_bias = [20, -20];
    const cases = [
      [[], ["no-hands"]],
      [Array(5).fill(pose({ hand: false })), ["no-hands"]],
      [[...Array(3).fill(pose()), ...Array(2).fill(pose({ hand: false }))], ["hand-samples"]],
      [[...Array(3).fill(pose()), ...Array(2).fill(pose({ shoulders: false }))], ["shoulder-samples"]],
      [[...Array(4).fill(pose({ hand: false })), ...Array(4).fill(pose({ shoulders: false }))], ["shoulders-during-sign"]],
    ];
    for (const [frames, reasons] of cases) {
      const result = predictTrainedSign(biased, frames);
      assert.deepEqual(result.diagnostics.reasonCodes, reasons);
      assert.equal(result.diagnostics.inferenceRan, false);
      assert.equal(result.diagnostics.posterior, null);
      assert.equal(result.diagnostics.capture.modelFrames, 0);
      assert.equal(result.diagnostics.capture.inputFrames, frames.length);
      assert.equal(result.meaning, ""); assert.deepEqual(result.candidates, []);
      assert.equal(result.score, 0); // Existing contract, not a measured posterior.
    }
    const disjoint = predictTrainedSign(biased, cases.at(-1)[0]).diagnostics.capture;
    assert.equal(disjoint.handFrames, 4); assert.equal(disjoint.shoulderFrames, 4);
    assert.equal(disjoint.qualifiedFrames, 0); assert.equal(disjoint.trimmedShoulderFrames, 0);
    biased.acceptanceEnabled = false;
    const disabled = predictTrainedSign(biased, Array(4).fill(pose())).diagnostics;
    assert.deepEqual(disabled.reasonCodes, ["acceptance-disabled"]);
    assert.equal(disabled.inferenceRan, false); assert.equal(disabled.posterior, null);
    assert.equal(disabled.model.acceptanceEnabled, false);
    assert.deepEqual(predictTrainedSign(biased, []).diagnostics.reasonCodes, ["no-hands"]);
  });

  test("diagnostics preserve raw/trimmed counts separately from the resampled model input", () => {
    const frames = [pose({ hand: false }), ...Array(5).fill(pose()), pose({ hand: false }), pose({ hand: false })];
    const result = predictTrainedSign(model(), frames);
    assert.equal(result.status, "recognized");
    assert.deepEqual(result.diagnostics.reasonCodes, ["recognized"]);
    assert.deepEqual(result.diagnostics.capture, {
      inputFrames: 8, handFrames: 5, shoulderFrames: 8, qualifiedFrames: 5,
      trimmedFrames: 5, trimmedShoulderFrames: 5, modelFrames: 32,
    });
    assert.deepEqual(result.diagnostics.model, {
      signLanguage: "isl", engine: "legacy", labelsCount: 2, threshold: .7, requiredMargin: .1, acceptanceEnabled: true,
    });
    const posterior = result.diagnostics.posterior;
    assert.equal(posterior.topLabel, result.candidates[0].label);
    assert.equal(posterior.topScore, result.score);
    assert.equal(posterior.runnerUpLabel, result.candidates[1].label);
    assert.equal(posterior.runnerUpScore, result.candidates[1].score);
    assert.equal(posterior.margin, result.margin);
    assert.equal(posterior.scorePassed, true); assert.equal(posterior.marginPassed, true);
    assert.equal(result.diagnostics.inferenceRan, true);
    assert.ok(!JSON.stringify(result.diagnostics).includes("keypoints"));
  });

  test("diagnostics report score/margin failures independently without changing probabilities", () => {
    const frames = Array(4).fill(pose());
    const reference = predictTrainedSign(model(), frames);
    for (const [threshold, margin, reasons] of [[.99, .1, ["low-score"]], [.7, .9, ["small-margin"]], [.99, .9, ["low-score", "small-margin"]]]) {
      const strict = model(); strict.threshold = threshold; strict.margin = margin;
      const rejected = predictTrainedSign(strict, frames);
      assert.deepEqual(rejected.candidates, reference.candidates);
      assert.equal(rejected.score, reference.score); assert.equal(rejected.margin, reference.margin);
      assert.equal(rejected.status, "unclear"); assert.equal(rejected.meaning, "");
      assert.deepEqual(rejected.diagnostics.reasonCodes, reasons);
      assert.equal(rejected.diagnostics.posterior.scorePassed, reference.score >= threshold);
      assert.equal(rejected.diagnostics.posterior.marginPassed, reference.margin >= margin);
      assert.equal(rejected.diagnostics.inferenceRan, true);
    }
    const boundary = model(); boundary.threshold = reference.score; boundary.margin = reference.margin;
    assert.equal(predictTrainedSign(boundary, frames).status, "recognized");
  });

  test("diagnostics are scalar snapshots and do not retain pose or mutable model references", () => {
    const selected = model(), frames = Array(4).fill(pose());
    const result = predictTrainedSign(selected, frames);
    selected.threshold = .99; selected.labels[0] = "CHANGED"; frames.push(pose());
    assert.equal(result.diagnostics.model.threshold, .7);
    assert.equal(result.diagnostics.posterior.topLabel, "WATER");
    assert.equal(result.diagnostics.capture.inputFrames, 4);
    assert.equal(result.diagnostics.capture.trimmedFrames, 4);
  });

  test("validates language, architecture, labels, finite weights and normalization bounds", () => {
    assert.equal(validateTrainedModel(model(), "isl").signLanguage, "isl");
    assert.throws(() => validateTrainedModel(model(), "asl"), /belongs to ISL/);
    const badModels = [
      { ...model(), labels: ["WATER", "WATER"] }, { ...model(), labels: Array(501).fill("WATER") },
      { ...model(), hiddenSize: 129 }, { ...model(), frames: 64 }, { ...model(), inputSize: 143 },
      { ...model(), joints: [...POSE_JOINTS].reverse() }, { ...model(), threshold: NaN },
    ];
    for (const bad of badModels) assert.throws(() => validateTrainedModel(bad));
    const zeroStd = model(); zeroStd.std[0] = 0; assert.throws(() => validateTrainedModel(zeroStd), /standard deviation/);
    const badWeight = model(); badWeight.weights.weight_hh_l0[0][0] = Infinity; assert.throws(() => validateTrainedModel(badWeight), /recurrent weights/);
    const wrongShape = model(); wrongShape.weights.head_weight[0].pop(); assert.throws(() => validateTrainedModel(wrongShape), /output weights/);
    assert.throws(() => predictFeatureProbabilities(model(), []), /32 pose/);
  });
});
