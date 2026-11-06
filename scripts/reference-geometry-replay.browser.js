// Local Vite browser diagnostic only. This module is never imported by the app.
// Example in a local developer console:
// const { runHelloGeometryReplay } = await import('/scripts/reference-geometry-replay.browser.js');
// const report = await runHelloGeometryReplay({ onProgress: console.info });
import { loadPoseTracker } from "../src/lib/poseTracker.js";
import { poseFrameFromHolistic, validateTrainedModel } from "../src/lib/trainedSignModel.js";
import { predictTrainedCameraSign } from "../src/lib/cameraWordRecognition.js";
import { cameraGeometryForExperiment } from "../src/lib/cameraGeometryExperiment.js";
import { describeGraphCapture, validateCameraTurn } from "../src/lib/graphSignModel.js";

const VIDEO_HASH = "61a50323776fe04f732aba8668a1ea8fac09c17d387af26c78a94412f003e7ff";
const MODEL_HASH = "55c23fffe387944a102c804676ae91aa7276781d598b7adaf03f0115234acdd9";
const METADATA_URL = "/api/local-reference/isl-hello/metadata";
const VIDEO_URL = "/api/local-reference/isl-hello/video";
const MODEL_URL = "/models/isl.json";
const SEEK_TIMEOUT_MS = 8000;
const FETCH_TIMEOUT_MS = 15000;
const abortError = () => Object.assign(new Error("Reference geometry replay cancelled."), { name: "AbortError" });
const dimensions = (video) => ({ width: video.videoWidth, height: video.videoHeight });
const sameDimensions = (left, right) => left.width === right.width && left.height === right.height;
const allowedDimensions = ({ width, height }) => width === 1920 && [1080, 1088].includes(height);
const sha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function boundedFetch(url, maximum, signal) {
  const response = await fetch(url, { cache: "no-store", signal, redirect: "error" });
  if (!response.ok || Number(response.headers.get("content-length")) > maximum) throw new Error("The pinned local reference or model is unavailable or exceeds its byte limit.");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error("The pinned local response exceeds its byte limit.");
    return { bytes, contentType: response.headers.get("content-type") || "" };
  }
  let length = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("The pinned local response exceeds its byte limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, contentType: response.headers.get("content-type") || "" };
}

function waitForVideo(video, events, check, ensureCurrent) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timeout); clearInterval(cancelPoll);
      for (const event of events) video.removeEventListener(event, inspect);
      video.removeEventListener("error", failed);
    };
    const finish = (error) => { if (!finished) { finished = true; cleanup(); error ? reject(error) : resolve(); } };
    const inspect = () => {
      try { ensureCurrent(); if (check()) finish(); } catch (error) { finish(error); }
    };
    const failed = () => finish(new Error("The pinned local video could not be decoded."));
    const timeout = setTimeout(() => finish(new Error("Video decoding or seeking exceeded eight seconds.")), SEEK_TIMEOUT_MS);
    const cancelPoll = setInterval(inspect, 100);
    for (const event of events) video.addEventListener(event, inspect);
    video.addEventListener("error", failed);
    inspect();
  });
}

async function seekDecoded(video, atSeconds, ensureCurrent) {
  ensureCurrent();
  if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - atSeconds) < .001) return;
  const decoded = waitForVideo(video, ["seeked", "loadeddata"], () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - atSeconds) < .001, ensureCurrent);
  try { video.currentTime = atSeconds; } catch { /* The bounded wait reports an unavailable decoded source frame. */ }
  await decoded; ensureCurrent();
}

const scalarPrediction = (prediction) => {
  const diagnostic = prediction.diagnostics || {}, posterior = diagnostic.posterior;
  const finiteOrNull = (value) => Number.isFinite(value) ? value : null;
  return {
    status: prediction.status,
    meaning: prediction.status === "recognized" && posterior?.topLabel === prediction.meaning ? prediction.meaning : "",
    score: finiteOrNull(prediction.score), margin: finiteOrNull(prediction.margin),
    topLabel: typeof posterior?.topLabel === "string" ? posterior.topLabel : null,
    topScore: finiteOrNull(posterior?.topScore), inferenceRan: diagnostic.inferenceRan === true,
    reasonCodes: Array.isArray(diagnostic.reasonCodes) ? [...diagnostic.reasonCodes] : [],
    scorePassed: typeof posterior?.scorePassed === "boolean" ? posterior.scorePassed : null,
    marginPassed: typeof posterior?.marginPassed === "boolean" ? posterior.marginPassed : null,
    cameraGate: diagnostic.cameraGate ? { passed: diagnostic.cameraGate.passed === true, code: diagnostic.cameraGate.code || "" } : null,
  };
};

/**
 * Re-run one known validation reference under five physical image geometries.
 * Every condition gets a fresh real Tasks tracker. All samples use real decoded
 * source timestamps; no fabricated tail, repeated poses or expected-label input.
 * Returns only bounded scalar diagnostics, never video bytes or pose coordinates.
 * Throws on cancellation, unavailable artifacts, changing intrinsic dimensions,
 * decode timeout, or a model hash different from the original experiment.
 */
export async function runHelloGeometryReplay({ onProgress, isCancelled = () => false } = {}) {
  if (!import.meta.env?.DEV || !globalThis.document || !globalThis.crypto?.subtle || !["localhost", "127.0.0.1", "[::1]"].includes(globalThis.location?.hostname)) throw new Error("Run this diagnostic only from the local Vite development app.");
  if (typeof isCancelled !== "function" || (onProgress !== undefined && typeof onProgress !== "function")) throw new Error("Progress and cancellation callbacks must be functions.");
  const fetchAbort = new AbortController();
  let video, tracker, objectUrl = "", fetchTimedOut = false;
  const ensureCurrent = () => { if (isCancelled() || fetchAbort.signal.aborted) throw abortError(); };
  const cancelPoll = setInterval(() => { if (isCancelled()) fetchAbort.abort(); }, 100);
  const fetchTimeout = setTimeout(() => { fetchTimedOut = true; fetchAbort.abort(); }, FETCH_TIMEOUT_MS);
  const notify = (value) => { ensureCurrent(); onProgress?.(value); ensureCurrent(); };
  try {
    ensureCurrent(); notify({ phase: "loading-pinned-artifacts" });
    const metadataDownload = await boundedFetch(METADATA_URL, 4096, fetchAbort.signal);
    const metadata = JSON.parse(new TextDecoder().decode(metadataDownload.bytes));
    if (metadata.available !== true || metadata.signLanguage !== "isl" || metadata.label !== "HELLO" || metadata.videoUrl !== VIDEO_URL || metadata.videoSha256 !== VIDEO_HASH) throw new Error("The local reference metadata does not identify the pinned permitted video.");
    const [videoDownload, modelDownload] = await Promise.all([
      boundedFetch(VIDEO_URL, 11 * 1024 * 1024, fetchAbort.signal),
      boundedFetch(MODEL_URL, 4 * 1024 * 1024, fetchAbort.signal),
    ]);
    ensureCurrent();
    const [videoSha256, modelSha256] = await Promise.all([sha256(videoDownload.bytes), sha256(modelDownload.bytes)]);
    ensureCurrent();
    if (videoSha256 !== VIDEO_HASH || modelSha256 !== MODEL_HASH) throw new Error("The actual video or model bytes differ from the pinned geometry experiment. No comparison was run.");
    const model = JSON.parse(new TextDecoder().decode(modelDownload.bytes));
    validateTrainedModel(model, "isl");
    if (model.threshold !== .95 || model.margin !== .3) throw new Error("The original recognition gates changed. No comparison was run.");
    clearTimeout(fetchTimeout);
    video = document.createElement("video"); video.muted = true; video.playsInline = true; video.preload = "auto";
    objectUrl = URL.createObjectURL(new Blob([videoDownload.bytes], { type: videoDownload.contentType || "video/quicktime" }));
    video.src = objectUrl;
    await waitForVideo(video, ["loadedmetadata"], () => video.readyState >= 1 && video.videoWidth > 0, ensureCurrent);
    const metadataDimensions = dimensions(video);
    if (!allowedDimensions(metadataDimensions) || !Number.isFinite(video.duration) || Math.abs(video.duration - 1.96) > .01) throw new Error("The pinned video's metadata dimensions or duration differ from the measured reference.");
    // Some decoders initially report the coded 1088-pixel height, then expose
    // 1080 after playback starts. Record both; choose no hidden stretch/scale.
    const decoded = waitForVideo(video, ["playing", "loadeddata", "timeupdate"], () => !video.paused && video.readyState >= 2 && video.currentTime > 0, ensureCurrent);
    // Attach the rejection branch immediately: autoplay can fail before the
    // bounded decode wait settles. Final cleanup aborts and releases that wait.
    void decoded.catch(() => {});
    try { await video.play(); } catch { throw new Error("Muted local video decoding could not start."); }
    await decoded; video.pause();
    const source = { ...dimensions(video), durationSeconds: video.duration };
    if (!allowedDimensions(source)) throw new Error("The first decoded frame has unsupported intrinsic dimensions.");
    await seekDecoded(video, 0, ensureCurrent);
    if (!sameDimensions(dimensions(video), source)) throw new Error("Intrinsic video dimensions changed after decoding. The experiment stopped instead of silently stretching frames.");
    const durationMs = source.durationSeconds * 1000;
    const conditions = [
      { name: "original-25", width: source.width, height: source.height, fps: 25 },
      { name: "padded-4x3-25", width: 1920, height: 1440, fps: 25 },
      { name: "original-8", width: source.width, height: source.height, fps: 8 },
      { name: "padded-4x3-8", width: 1920, height: 1440, fps: 8 },
      { name: "resized-4x3-8", width: 640, height: 480, fps: 8 },
    ];
    const results = [];
    for (const [conditionIndex, condition] of conditions.entries()) {
      ensureCurrent();
      const totalFrames = Math.ceil(source.durationSeconds * condition.fps);
      if (totalFrames < 4 || totalFrames > 100) throw new Error("The reference requires an unsupported number of source samples.");
      notify({ phase: "loading-tracker", condition: condition.name, conditionIndex, totalConditions: conditions.length });
      tracker = await loadPoseTracker(() => isCancelled() || fetchAbort.signal.aborted);
      ensureCurrent(); if (!tracker) throw new Error("The real Tasks tracker could not start.");
      const canvas = document.createElement("canvas"); canvas.width = condition.width; canvas.height = condition.height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("A real canvas is unavailable for the image geometry comparison.");
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "low";
      const scale = Math.min(condition.width / source.width, condition.height / source.height);
      const drawWidth = source.width * scale, drawHeight = source.height * scale;
      const offsetX = (condition.width - drawWidth) / 2, offsetY = (condition.height - drawHeight) / 2;
      const frames = [], observedDimensions = [];
      for (let index = 0; index < totalFrames; index++) {
        const atMs = index * 1000 / condition.fps;
        await seekDecoded(video, atMs / 1000, ensureCurrent);
        const measured = dimensions(video); observedDimensions.push({ atMs, ...measured });
        if (!sameDimensions(measured, source)) throw new Error(`Intrinsic video dimensions changed during ${condition.name}. The experiment stopped before transforming that frame.`);
        context.fillStyle = "#000"; context.fillRect(0, 0, condition.width, condition.height);
        context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
        const detected = await tracker.detectForVideo(canvas, atMs); ensureCurrent();
        frames.push({ ...poseFrameFromHolistic(detected), atMs });
        notify({ phase: "tracking", condition: condition.name, conditionIndex, totalConditions: conditions.length, frameCount: frames.length, totalFrames, atMs });
      }
      tracker.close(); tracker = null; ensureCurrent();
      const geometry = { sourceWidth: condition.width, sourceHeight: condition.height, referenceWidth: source.width, referenceHeight: source.height };
      const adjustedFrames = cameraGeometryForExperiment(frames, geometry);
      const quality = validateCameraTurn(frames, { durationMs }), measured = describeGraphCapture(frames);
      const fixed = scalarPrediction(predictTrainedCameraSign(model, frames, { durationMs }));
      const adjusted = scalarPrediction(predictTrainedCameraSign(model, adjustedFrames, { durationMs }));
      const result = { ...condition, frameCount: frames.length, durationMs,
        factor: (condition.width / condition.height) / (source.width / source.height),
        draw: { scale, width: drawWidth, height: drawHeight, offsetX, offsetY },
        observedSourceDimensions: observedDimensions,
        quality: { passed: quality.ok, code: quality.code, handFrames: measured.handFrames, shoulderFrames: measured.shoulderFrames, qualifiedFrames: measured.qualifiedFrames, largestGapMs: quality.metrics?.largestGapMs ?? null },
        fixed, adjusted };
      results.push(result); notify({ phase: "condition-complete", condition: condition.name, conditionIndex, totalConditions: conditions.length, result });
      frames.length = 0;
    }
    return {
      format: "signbridge-geometry-experiment-v2", scope: "Local known-reference diagnostic; not a webcam recognition or new accuracy test",
      videoSha256, modelSha256, source, metadataDimensions, historicalExperimentReference: { width: 1920, height: 1088 },
      tracker: "Existing Tasks Holistic CPU VIDEO loader, fresh instance per condition",
      sampling: "Sequential decoded source timestamps; not realtime throughput",
      padding: "Centered black aspect-preserving padding; original conditions use a canvas at actual intrinsic dimensions",
      resizeSmoothing: { enabled: true, quality: "low" },
      correction: "Diagnostic centered x offsets times sourceAspect/measuredReferenceAspect; y/z/confidences/timing unchanged",
      threshold: model.threshold, requiredMargin: model.margin, results,
      limits: ["One previously known validation clip; no held-out signer or webcam performance established.", "Metadata and every sampled decoded frame dimension are recorded; changing dimensions fail explicitly.", "The correction is diagnostic only and is not connected to live inference.", "No fabricated quiet tail, duplicated poses, expected-label predictor argument, saved recording or AI request.", "Scalar report only; video and pose coordinates are not returned."],
    };
  } catch (error) {
    if (fetchTimedOut) throw new Error("Pinned local artifact loading exceeded fifteen seconds.");
    if (isCancelled() || error?.name === "AbortError") throw abortError();
    throw error;
  } finally {
    clearTimeout(fetchTimeout); clearInterval(cancelPoll); fetchAbort.abort();
    try { tracker?.close(); } catch { /* Release the remaining video even after runtime failure. */ }
    if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
