const statuses = new Set(["recognized", "unclear", "no_sign"]);
const reasons = new Set(["no-hands", "acceptance-disabled", "hand-samples", "shoulder-samples", "shoulders-during-sign", "short-sequence", "low-score", "small-margin", "recognized", "invalid-pose", "sample-count", "timing", "duration", "framing", "tracking-gap", "recapture"]);
const numeric = (value, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const count = (value) => Number.isSafeInteger(value) ? numeric(value) : null;
const boolean = (value) => typeof value === "boolean" ? value : null;
const label = (value) => typeof value === "string" && value.trim() && value.length <= 80 ? value.trim() : null;

/** Explicit, scalar-only engineering report; never a training sample or accuracy result. */
export function createSignRecognitionReport(result, captureQuality = null, exportedAt = new Date().toISOString()) {
  const diagnostics = result?.diagnostics;
  if (!statuses.has(result?.status) || !diagnostics || typeof diagnostics.inferenceRan !== "boolean") throw new Error("This turn has no recognition diagnostics to export.");
  const date = new Date(exportedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("The report timestamp could not be read.");
  const { model, capture } = diagnostics;
  const posterior = diagnostics.inferenceRan === true ? diagnostics.posterior : null;
  return {
    format: "signbridge-recognition-report-v1",
    exportedAt: date.toISOString(),
    purpose: "Engineering diagnostics only; no reviewed ground truth or recognition accuracy is established.",
    result: {
      status: result.status,
      inferenceRan: diagnostics.inferenceRan,
      reasonCodes: [...new Set((Array.isArray(diagnostics.reasonCodes) ? diagnostics.reasonCodes : []).filter((code) => reasons.has(code)))],
      model: model ? {
        signLanguage: ["isl", "asl"].includes(model.signLanguage) ? model.signLanguage : null,
        engine: ["legacy", "graph"].includes(model.engine) ? model.engine : null,
        labelsCount: Number.isInteger(model.labelsCount) && model.labelsCount >= 2 && model.labelsCount <= 500 ? model.labelsCount : null,
        threshold: numeric(model.threshold, 1), requiredMargin: numeric(model.requiredMargin, 1), acceptanceEnabled: boolean(model.acceptanceEnabled),
      } : null,
      capture: capture ? Object.fromEntries([
        "inputFrames", "handFrames", "shoulderFrames", "qualifiedFrames", "trimmedFrames", "trimmedShoulderFrames", "modelFrames",
      ].map((key) => [key, count(capture[key])]).concat([
        ["durationMs", numeric(capture.durationMs, 12000)], ["largestGapMs", numeric(capture.largestGapMs, 12000)],
      ])) : null,
      posterior: posterior ? {
        topLabel: label(posterior.topLabel), topScore: numeric(posterior.topScore, 1),
        runnerUpLabel: label(posterior.runnerUpLabel), runnerUpScore: numeric(posterior.runnerUpScore, 1),
        margin: numeric(posterior.margin, 1), scorePassed: boolean(posterior.scorePassed), marginPassed: boolean(posterior.marginPassed),
      } : null,
      cameraGate: diagnostics.cameraGate ? {
        passed: boolean(diagnostics.cameraGate.passed), code: reasons.has(diagnostics.cameraGate.code) ? diagnostics.cameraGate.code : null,
      } : null,
    },
    captureQuality: captureQuality ? {
      count: count(captureQuality.count), handFrames: count(captureQuality.handFrames), shoulderFrames: count(captureQuality.shoulderFrames),
      clippedFrames: count(captureQuality.clippedFrames), durationMs: numeric(captureQuality.durationMs, 12000),
      samplesPerSecond: numeric(captureQuality.samplesPerSecond), largestGapMs: numeric(captureQuality.largestGapMs, 12000),
    } : null,
  };
}
