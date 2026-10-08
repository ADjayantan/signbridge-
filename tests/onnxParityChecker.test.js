import assert from "node:assert/strict";
import { test } from "node:test";
import { calibrationDecision, compareProbabilityParity, summarizeTimings } from "../training/check-onnx-parity.mjs";

const calibration = { threshold: .7, margin: .4, acceptanceEnabled: true };

test("calibration decisions preserve first-index ties and accept exact confidence and margin boundaries", () => {
  assert.deepEqual(calibrationDecision([.5, .5], { threshold: .5, margin: 0, acceptanceEnabled: true }), {
    top1: 0, accepted: true, confidence: .5, margin: 0,
  });
  assert.deepEqual(calibrationDecision([.75, .25], { threshold: .75, margin: .5, acceptanceEnabled: true }), {
    top1: 0, accepted: true, confidence: .75, margin: .5,
  });
  assert.equal(calibrationDecision([.75, .25], { threshold: .75001, margin: .5, acceptanceEnabled: true }).accepted, false);
  assert.equal(calibrationDecision([.75, .25], { threshold: .75, margin: .50001, acceptanceEnabled: true }).accepted, false);
  const decision = calibrationDecision([.2, .55, .25], calibration);
  assert.equal(decision.top1, 1);
  assert.equal(decision.confidence, .55);
  assert.ok(Math.abs(decision.margin - .3) < 1e-12);
});

test("disabled calibration cannot accept even a certain prediction", () => {
  assert.deepEqual(calibrationDecision([1, 0], { threshold: 0, margin: 0, acceptanceEnabled: false }), {
    top1: 0, accepted: false, confidence: 1, margin: 1,
  });
});

test("calibration rejects invalid distributions and invalid calibration values", () => {
  for (const probabilities of [[], [1], [NaN, 1], [Infinity, 0], [-.1, 1.1], [1.1, -.1], [.6, .6], [.2, .2]]) {
    assert.throws(() => calibrationDecision(probabilities, calibration));
  }
  for (const settings of [
    null, {},
    { ...calibration, threshold: NaN }, { ...calibration, threshold: Infinity },
    { ...calibration, threshold: -.01 }, { ...calibration, threshold: 1.01 },
    { ...calibration, margin: NaN }, { ...calibration, margin: -.01 }, { ...calibration, margin: 1.01 },
    { ...calibration, acceptanceEnabled: undefined }, { ...calibration, acceptanceEnabled: 1 },
  ]) assert.throws(() => calibrationDecision([.8, .2], settings));
});

test("timing summaries sort inputs and use nearest-rank p50 and p95", () => {
  const timings = [20, 1, 19, 2, 18, 3, 17, 4, 16, 5, 15, 6, 14, 7, 13, 8, 12, 9, 11, 10];
  assert.deepEqual(summarizeTimings(timings), {
    iterations: 20, p50Ms: 10, p95Ms: 19, minimumMs: 1, maximumMs: 20,
  });
  assert.deepEqual(summarizeTimings([0]), {
    iterations: 1, p50Ms: 0, p95Ms: 0, minimumMs: 0, maximumMs: 0,
  });
  assert.deepEqual(summarizeTimings([8, 2, 5]), {
    iterations: 3, p50Ms: 5, p95Ms: 8, minimumMs: 2, maximumMs: 8,
  });
});

test("timing summaries reject empty, negative and nonfinite samples", () => {
  for (const timings of [[], [-1], [1, NaN], [Infinity], [1, -Infinity]]) {
    assert.throws(() => summarizeTimings(timings));
  }
});

test("probability parity reports fixture counts, maximum error and calibrated decisions", () => {
  const report = compareProbabilityParity([[.75001, .24999], [.59999, .40001]], [[.75, .25], [.6, .4]], calibration);
  assert.equal(report.fixtures, 2);
  assert.ok(Math.abs(report.maximumProbabilityError - .00001) < 1e-12);
  assert.equal(report.top1Matches, true);
  assert.equal(report.acceptanceMatches, true);
  assert.equal(report.expectedAccepted, 1);
  assert.equal(report.actualAccepted, 1);
  assert.equal(report.passed, true);
});

test("numerical parity tolerance does not hide top1 or acceptance boundary mismatches", () => {
  assert.throws(() => compareProbabilityParity([[.7502, .2498]], [[.75, .25]], calibration));
  assert.throws(() => compareProbabilityParity([[.49999, .50001]], [[.50001, .49999]], {
    threshold: .8, margin: 0, acceptanceEnabled: true,
  }));
  assert.throws(() => compareProbabilityParity([[.79999, .20001]], [[.8, .2]], {
    threshold: .8, margin: .5, acceptanceEnabled: true,
  }));
  assert.throws(() => compareProbabilityParity([[.74999, .25001]], [[.75, .25]], {
    threshold: .7, margin: .5, acceptanceEnabled: true,
  }));
});

test("disabled calibration preserves parity across otherwise active acceptance boundaries", () => {
  const report = compareProbabilityParity([[.79999, .20001]], [[.8, .2]], {
    threshold: .8, margin: .5, acceptanceEnabled: false,
  });
  assert.equal(report.acceptanceMatches, true);
  assert.equal(report.expectedAccepted, 0);
  assert.equal(report.actualAccepted, 0);
  assert.equal(report.passed, true);
});

test("parity rejects absent fixtures, inconsistent row dimensions and invalid probabilities", () => {
  for (const [actual, expected] of [
    [[], []], [[[.8, .2]], []],
    [[[.8, .2]], [[.8, .1, .1]]],
    [[[.8, .2], [.8, .1, .1]], [[.8, .2], [.8, .1, .1]]],
    [[[NaN, 1]], [[.8, .2]]],
    [[[.8, .2]], [[.6, .6]]],
  ]) assert.throws(() => compareProbabilityParity(actual, expected, calibration));
});
