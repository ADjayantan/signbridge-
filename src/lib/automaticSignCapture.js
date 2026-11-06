import { handsFromPoseFrame } from "./handJoints.js";
import { validatePoseGraphFrames } from "./poseGraphFeatures.js";
import { copyFrameCaptureContext } from "./poseCaptureContext.js";

/** Capture boundaries only. These settings never decide a word or relax a model gate. */
export const AUTOMATIC_SIGN_CAPTURE_DEFAULTS = Object.freeze({
  framingReadyMs: 300,
  preRollMs: 300,
  motionStartSpeed: .3, // Shoulder widths per second, using image x/y only.
  motionQuietSpeed: .12,
  motionOnsetMs: 180,
  quietFinishMs: 700,
  lostHandsFinishMs: 600,
  minimumDurationMs: 700,
  minimumQualifiedFrames: 4,
  maximumDurationMs: 8000,
  maximumFrames: 100,
  sampleIntervalMs: 100,
  staleAfterMs: 750,
  cooldownMs: 700,
  rearmQuietMs: 250,
  heldPoseMs: 1200,
  heldPoseDisplacement: .06, // Maximum RMS change from the held pose, in shoulder widths.
  heldPoseRearmDisplacement: .2,
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const cloneFrame = (frame, atMs) => ({
  keypoints: frame.keypoints.map((point) => [...point]), confidences: [...frame.confidences], atMs,
  ...copyFrameCaptureContext(frame),
});

function observation(frame) {
  try { validatePoseGraphFrames([frame]); } catch { return null; }
  const shoulders = frame.confidences[11] >= .2 && frame.confidences[12] >= .2;
  if (!shoulders) return { framed: false, hands: new Map() };
  const left = frame.keypoints[11], right = frame.keypoints[12];
  const width = Math.hypot(left[0] - right[0], left[1] - right[1]);
  if (width < .05) return { framed: false, hands: new Map() };
  const centerX = (left[0] + right[0]) / 2, centerY = (left[1] + right[1]) / 2;
  const tracked = handsFromPoseFrame(frame);
  const clipped = tracked.some((hand) => hand.landmarks.some(({ x, y }) => x <= .02 || x >= .98 || y <= .02 || y >= .98));
  return { framed: !clipped, hands: new Map(tracked.map((hand) => [hand.handedness,
    hand.landmarks.map(({ x, y }) => [(x - centerX) / width, (y - centerY) / width])])),
  };
}

// Appearance/disappearance is not motion. Only joints tracked in both frames count.
function motionSpeed(previous, current, elapsedMs) {
  if (!previous || elapsedMs <= 0) return null;
  let maximum = null;
  for (const [name, points] of current.hands) {
    const before = previous.hands.get(name);
    if (!before) continue;
    const squared = points.reduce((sum, point, i) => sum + (point[0] - before[i][0]) ** 2 + (point[1] - before[i][1]) ** 2, 0);
    const speed = Math.sqrt(squared / points.length) * 1000 / elapsedMs;
    maximum = Math.max(maximum ?? 0, speed);
  }
  return maximum;
}

// A changed hand set starts a new observation window; missing joints are never
// silently treated as the same held pose. Body translation/scale stay removed.
function poseDisplacement(before, after) {
  if (!before || before.size !== after.size) return Infinity;
  let maximum = 0;
  for (const [name, points] of after) {
    const baseline = before.get(name);
    if (!baseline) return Infinity;
    const squared = points.reduce((sum, point, i) => sum + (point[0] - baseline[i][0]) ** 2 + (point[1] - baseline[i][1]) ** 2, 0);
    maximum = Math.max(maximum, Math.sqrt(squared / points.length));
  }
  return maximum;
}

function validateOptions(options) {
  const config = { ...AUTOMATIC_SIGN_CAPTURE_DEFAULTS, ...options };
  if (Object.keys(options).some((key) => !(key in AUTOMATIC_SIGN_CAPTURE_DEFAULTS)) ||
    !Object.values(config).every((value) => finite(value) && value >= 0) ||
    config.motionQuietSpeed >= config.motionStartSpeed || config.motionStartSpeed <= 0 ||
    config.minimumDurationMs < 350 || config.maximumDurationMs + config.staleAfterMs > 12000 ||
    config.maximumDurationMs <= config.minimumDurationMs || config.preRollMs >= config.maximumDurationMs ||
    config.sampleIntervalMs <= 0 || config.sampleIntervalMs > config.staleAfterMs ||
    config.staleAfterMs > 1000 || config.quietFinishMs > config.staleAfterMs ||
    config.lostHandsFinishMs > config.staleAfterMs ||
    config.heldPoseMs < 1200 || config.heldPoseMs > config.maximumDurationMs ||
    config.heldPoseDisplacement <= 0 || config.heldPoseRearmDisplacement <= config.heldPoseDisplacement ||
    !Number.isInteger(config.minimumQualifiedFrames) || config.minimumQualifiedFrames < 4 ||
    !Number.isInteger(config.maximumFrames) || config.maximumFrames > 100 ||
    config.maximumFrames < config.minimumQualifiedFrames) {
    throw new Error("Automatic capture settings must preserve the camera timing and sample gates.");
  }
  return config;
}

/**
 * Feed fresh image-space poses with their monotonic arrival timestamps. A held
 * pose may produce one bounded attempt after the measured dwell time; it never
 * names a word. Motion capture takes priority. Neither completion is proof of
 * a sign's meaning; the existing model still decides it.
 *
 * start/complete contain copied pose frames, rebased to the first retained real
 * sample. progress only contains scalar measurements. Call reset on device,
 * mode, language or inference changes; busy/dark/stale/disabled also reset.
 */
export function createAutomaticSignCapture(options = {}) {
  const config = validateOptions(options);
  let state, lastAt, previous, readyAt, onsetAt, quietAt, missingAt;
  let preRoll, samples, startedAt, segmentId = 0, cooldownUntil, rearmAt, releaseRequired = false, releaseAt = null;
  let heldSamples, heldStartedAt, heldBaseline;
  let heldLatch = null, heldReleaseAt = null, heldChangeAt = null;

  function clearHeldWindow() { heldSamples = []; heldStartedAt = null; heldBaseline = null; }

  function clear() {
    state = "waiting"; lastAt = null; previous = null; readyAt = null; onsetAt = null;
    quietAt = null; missingAt = null; preRoll = []; samples = []; startedAt = null;
    cooldownUntil = null; rearmAt = null;
    clearHeldWindow();
  }
  clear();

  const duration = (at = lastAt) => startedAt === null || at === null ? 0 : at - startedAt;
  const snapshot = () => ({ state, segmentId, frameCount: samples.length, durationMs: duration(), heldPosePending: heldStartedAt !== null && heldSamples.length > 0 && !heldLatch });
  function reset(reason = "reset") {
    const pendingCooldown = ["busy", "inference"].includes(reason) ? cooldownUntil : null;
    // Explicit cancellation ends this pose's attempt; keeping it raised must not
    // quietly restart a held capture after the short recovery interval.
    if (reason === "cancel" && previous?.hands.size) heldLatch = previous.hands;
    clear();
    releaseRequired = true; releaseAt = null;
    // A tracking interruption is not evidence that the person released a pose.
    // Keep the latch, but never count time spent dark, stale or busy as release.
    heldReleaseAt = null; heldChangeAt = null;
    if (pendingCooldown !== null) { state = "cooldown"; cooldownUntil = pendingCooldown; }
    return { type: "reset", ...snapshot(), reason };
  }
  function result(type, nowMs, extra = {}) {
    return { type, ...snapshot(), durationMs: duration(nowMs), ...extra };
  }
  function retain(frame, nowMs) {
    if (samples.length < config.maximumFrames && (!samples.length || nowMs - samples.at(-1).atMs >= config.sampleIntervalMs)) samples.push(cloneFrame(frame, nowMs));
  }
  function frames() {
    return samples.map((frame) => cloneFrame(frame, frame.atMs - startedAt));
  }
  function complete(nowMs, reason, motion) {
    // Include the actual last sample without exceeding the existing 100-frame gate.
    const qualified = samples.filter((frame) => observation(frame)?.hands.size > 0).length;
    const event = duration(nowMs) >= config.minimumDurationMs && qualified >= config.minimumQualifiedFrames
      ? result("complete", nowMs, { reason, motion, frames: frames(), startAtMs: startedAt, endAtMs: nowMs })
      : result("reset", nowMs, { reason: "incomplete-movement" });
    state = "cooldown"; cooldownUntil = nowMs + config.cooldownMs; rearmAt = null;
    // Also latch a moving sign's final hold so it is not captured a second time
    // as a stationary attempt immediately after its quiet ending.
    heldLatch = previous?.hands.size ? previous.hands : null;
    heldReleaseAt = null; heldChangeAt = null; clearHeldWindow();
    preRoll = []; samples = []; startedAt = null; readyAt = null; onsetAt = null; quietAt = null; missingAt = null;
    return { ...event, state };
  }

  function updateHeldLatch(current, nowMs) {
    if (!heldLatch) return;
    if (!current.hands.size) {
      heldChangeAt = null; heldReleaseAt ??= nowMs;
      if (nowMs - heldReleaseAt >= config.lostHandsFinishMs) heldLatch = null;
    } else {
      heldReleaseAt = null;
      if (poseDisplacement(heldLatch, current.hands) >= config.heldPoseRearmDisplacement) {
        heldChangeAt ??= nowMs;
        if (nowMs - heldChangeAt >= config.rearmQuietMs) heldLatch = null;
      } else heldChangeAt = null;
    }
    if (!heldLatch) { heldReleaseAt = null; heldChangeAt = null; clearHeldWindow(); }
  }

  function observeHold(frame, current, nowMs) {
    if (heldLatch) { clearHeldWindow(); return; }
    if (heldStartedAt === null || poseDisplacement(heldBaseline, current.hands) > config.heldPoseDisplacement) {
      clearHeldWindow(); heldStartedAt = nowMs; heldBaseline = current.hands;
    }
    if (!heldSamples.length || nowMs - heldSamples.at(-1).atMs >= config.sampleIntervalMs) {
      if (heldSamples.length < config.maximumFrames) heldSamples.push(cloneFrame(frame, nowMs));
      else heldSamples[heldSamples.length - 1] = cloneFrame(frame, nowMs);
    }
  }

  function completeHold(nowMs, motion) {
    samples = heldSamples; startedAt = heldStartedAt; segmentId += 1;
    // The downstream camera gate still rejects a custom cap that is too sparse.
    return complete(nowMs, "held-pose", motion);
  }

  function push(frame, nowMs, { enabled = true, trackingFresh = true, dark = false, busy = false } = {}) {
    if (!enabled || !trackingFresh || dark || busy) return reset(!enabled ? "disabled" : !trackingFresh ? "stale" : dark ? "dark" : "busy");
    if (!finite(nowMs) || nowMs < 0 || (lastAt !== null && nowMs <= lastAt)) return reset("timestamp");
    if (lastAt !== null && nowMs - lastAt > config.staleAfterMs) {
      reset("tracking-gap");
      // The new sample can establish a baseline, but cannot complete/start an old turn.
      lastAt = nowMs;
      previous = observation(frame);
      return result("reset", nowMs, { reason: "tracking-gap" });
    }
    const current = observation(frame);
    if (!current) return reset("invalid-pose");
    const motion = motionSpeed(previous, current, lastAt === null ? 0 : nowMs - lastAt);
    lastAt = nowMs; previous = current;
    if (!current.framed) return reset("framing-lost");
    const handsVisible = current.hands.size > 0;
    updateHeldLatch(current, nowMs);

    if (state === "cooldown") {
      if (nowMs >= cooldownUntil && (!handsVisible || (motion !== null && motion <= config.motionQuietSpeed))) {
        rearmAt ??= nowMs;
        if (nowMs - rearmAt >= config.rearmQuietMs) {
          state = "waiting"; readyAt = handsVisible ? nowMs : null; releaseRequired = false;
        }
      } else rearmAt = null;
      return result("waiting", nowMs, { reason: state === "cooldown" ? "pause-between-signs" : "ready", motion });
    }

    if (state === "capturing") {
      retain(frame, nowMs);
      if (handsVisible) {
        missingAt = null;
        if (motion !== null && motion <= config.motionQuietSpeed) quietAt ??= nowMs;
        else quietAt = null;
      } else { missingAt ??= nowMs; quietAt = null; }
      if (duration(nowMs) >= config.maximumDurationMs) return complete(nowMs, "maximum-duration", motion);
      if (samples.length >= config.maximumFrames) return complete(nowMs, "maximum-frames", motion);
      if (duration(nowMs) >= config.minimumDurationMs && quietAt !== null && nowMs - quietAt >= config.quietFinishMs) return complete(nowMs, "quiet", motion);
      if (missingAt !== null && nowMs - missingAt >= config.lostHandsFinishMs) return complete(nowMs, "hands-lost", motion);
      return result("progress", nowMs, { motion });
    }

    // A reset during inference or tracking loss must not turn the unfinished
    // remainder of the same movement into a fresh sign after recovery.
    if (releaseRequired) {
      if (!handsVisible || (motion !== null && motion <= config.motionQuietSpeed)) releaseAt ??= nowMs;
      else releaseAt = null;
      if (releaseAt !== null && nowMs - releaseAt >= config.rearmQuietMs) {
        releaseRequired = false; releaseAt = null; readyAt = handsVisible ? nowMs : null;
      }
      return result("waiting", nowMs, { reason: "pause-between-signs", motion });
    }

    if (!handsVisible) {
      readyAt = null; onsetAt = null; preRoll = [];
      clearHeldWindow();
      return result("waiting", nowMs, { reason: "show-hands", motion });
    }
    readyAt ??= nowMs;
    preRoll.push(cloneFrame(frame, nowMs));
    preRoll = preRoll.filter((sample) => nowMs - sample.atMs <= config.preRollMs);
    // Bound input memory even if callers supply poses faster than the tracker.
    if (preRoll.length > config.maximumFrames) preRoll = preRoll.slice(-config.maximumFrames);
    observeHold(frame, current, nowMs);
    if (nowMs - readyAt < config.framingReadyMs) return result("waiting", nowMs, { reason: "framing", motion });
    if (motion !== null && motion >= config.motionStartSpeed) onsetAt ??= nowMs;
    else onsetAt = null;
    if (onsetAt === null || nowMs - onsetAt < config.motionOnsetMs) {
      // An emerging movement wins even before its onset interval is confirmed.
      if (onsetAt === null && heldStartedAt !== null && nowMs - heldStartedAt >= config.heldPoseMs && heldSamples.length >= config.minimumQualifiedFrames) return completeHold(nowMs, motion);
      return result("waiting", nowMs, { reason: heldLatch ? "hold-already-captured" : "movement-or-hold", motion });
    }
    clearHeldWindow();
    samples = [];
    for (const sample of preRoll) retain(sample, sample.atMs);
    startedAt = samples[0].atMs; state = "capturing"; segmentId += 1;
    quietAt = null; missingAt = null;
    return result("start", nowMs, { motion, frames: frames(), startAtMs: startedAt });
  }

  return { push, reset, snapshot };
}
