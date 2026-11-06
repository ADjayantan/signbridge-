// Local research only. Never imported by the app or included in public builds.
import { poseFrameFromHolistic } from "../src/lib/trainedSignModel.js";
import { validateCameraTurn } from "../src/lib/graphSignModel.js";

export const TASKS_TRAINING_CONFIG = Object.freeze({
  trackerBackend: "tasks-holistic", delegate: "CPU", runningMode: "VIDEO",
  sampleIntervalMs: 125, width: 1280, height: 720, fit: "contain", background: "black",
});
export const TASKS_TRAINING_LIMITS = Object.freeze({
  clips: 100, videoBytes: 45 * 1024 * 1024, totalVideoBytes: 1000000000,
  manifestBytes: 1024 * 1024, outputBytes: 16 * 1024 * 1024,
  durationMs: 12000, frames: 100, runMs: 30 * 60 * 1000,
});
const SPLITS = new Set(["train", "val", "test", "unknown_train", "unknown_val", "unknown_test"]);
const HASH = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const bytesOf = (value) => encoder.encode(JSON.stringify(value)).byteLength;
const safeName = (name) => typeof name === "string" && name.length > 0 && name.length <= 255 &&
  name === name.trim() && !/[\\/:\u0000-\u001f]/.test(name) && name !== "." && name !== "..";
const safeClipId = (id) => typeof id === "string" && id.length > 0 && id.length <= 512 &&
  id === id.trim() && !/[\\:\u0000-\u001f]/.test(id) &&
  id.split("/").every((part) => part && part !== "." && part !== "..");
const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  (value) => value.toString(16).padStart(2, "0")).join("");
const cancelled = (message = "Extraction cancelled.") => Object.assign(new Error(message), { name: "AbortError" });

/** Strict frozen-manifest membership; no legacy aliases, paths, labels or inferred splits. */
export function validateTasksExtractionSelection(manifest, files, { partitionGroup, clipIds } = {}) {
  if (!["learning", "test"].includes(partitionGroup)) throw new Error("Choose learning or test explicitly.");
  if (!manifest || manifest.format !== "signbridge-tasks-video-study-manifest-v1" ||
    !Array.isArray(manifest.clips) || !manifest.clips.length ||
    manifest.clips.length > TASKS_TRAINING_LIMITS.clips) throw new Error("Choose a frozen manifest with one to one hundred clips.");
  const identities = new Set(), names = new Set();
  for (const row of manifest.clips) {
    if (!row || !safeClipId(row.clipId) || !safeName(row.localFile) || !HASH.test(row.sha256) || !SPLITS.has(row.split) ||
      typeof row.label !== "string" || !row.label.length || row.label.length > 80 || row.label !== row.label.trim() ||
      /[\u0000-\u001f]/.test(row.label) ||
      identities.has(row.clipId.toLowerCase()) || names.has(row.localFile.toLowerCase())) {
      throw new Error("Invalid or ambiguous frozen clip identity, file, split or hash.");
    }
    identities.add(row.clipId.toLowerCase()); names.add(row.localFile.toLowerCase());
  }
  const allowed = manifest.clips.filter((row) => partitionGroup === "test"
    ? ["test", "unknown_test"].includes(row.split)
    : ["train", "val", "unknown_train", "unknown_val"].includes(row.split));
  if (clipIds !== undefined && (!Array.isArray(clipIds) || !clipIds.length ||
    clipIds.some((id) => !safeClipId(id)) || new Set(clipIds).size !== clipIds.length)) {
    throw new Error("Choose a nonempty unique frozen clip subset.");
  }
  const chosen = clipIds === undefined ? allowed : allowed.filter((row) => clipIds.includes(row.clipId));
  if (!chosen.length || (clipIds !== undefined && chosen.length !== clipIds.length)) {
    throw new Error("Selected clips must belong to the requested manifest partition group.");
  }
  if (!Array.isArray(files) || files.length !== chosen.length) throw new Error("Choose exactly the selected frozen video files.");
  const byName = new Map();
  let total = 0;
  for (const file of files) {
    if (!file || !safeName(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 ||
      file.size > TASKS_TRAINING_LIMITS.videoBytes || typeof file.arrayBuffer !== "function" || byName.has(file.name)) {
      throw new Error("Selected video files are empty, oversized or ambiguous.");
    }
    total += file.size;
    byName.set(file.name, file);
  }
  if (total > TASKS_TRAINING_LIMITS.totalVideoBytes || chosen.some((row) => !byName.has(row.localFile))) {
    throw new Error("Selected files differ from the frozen subset or exceed the one-GB bound.");
  }
  return chosen.map((row) => ({ row, file: byName.get(row.localFile) }));
}

/** Real source positions only, always strictly before the declared video end. */
export function tasksTrainingSampleTimes(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 350 || durationMs > TASKS_TRAINING_LIMITS.durationMs) {
    throw new Error("Source duration must be between 0.35 and 12 seconds.");
  }
  const count = Math.ceil(durationMs / TASKS_TRAINING_CONFIG.sampleIntervalMs);
  if (count < 4 || count > TASKS_TRAINING_LIMITS.frames) throw new Error("Source needs four to one hundred real samples.");
  return Array.from({ length: count }, (_, index) => index * TASKS_TRAINING_CONFIG.sampleIntervalMs);
}

/** Output pose rows are x/y/confidence, not x/y/z; raw detector confidences are preserved. */
export function tasksTrainingFrame(detection, atMs) {
  const frame = { ...poseFrameFromHolistic(detection), atMs };
  return { frame, serialized: { atMs, pose: frame.keypoints.map(([x, y], index) => [x, y, frame.confidences[index]]) } };
}

function waitDecoded(video, check, ensureCurrent) {
  return new Promise((resolve, reject) => {
    let done = false;
    const readinessEvents = ["loadedmetadata", "loadeddata", "seeked", "playing", "timeupdate"];
    const finish = (error) => {
      if (done) return;
      done = true; clearTimeout(timeout); clearInterval(poll);
      video.removeEventListener("error", failed);
      for (const event of readinessEvents) video.removeEventListener(event, inspect);
      error ? reject(error) : resolve();
    };
    const inspect = () => {
      try { ensureCurrent(); if (check()) finish(); } catch (error) { finish(error); }
    };
    const failed = () => finish(new Error("Public source video could not be decoded."));
    const timeout = setTimeout(() => finish(new Error("Source video decoding timed out.")), 10000);
    const poll = setInterval(inspect, 30);
    video.addEventListener("error", failed);
    for (const event of readinessEvents) video.addEventListener(event, inspect);
    inspect();
  });
}

/** Cancellation closes a late-created WASM runtime instead of leaking it. */
function waitTracker(load, ensureCurrent) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, tracker) => {
      if (settled || error) {
        try { tracker?.close(); } catch { /* A cancelled late runtime is already unused. */ }
        if (settled) return;
      }
      settled = true; clearInterval(poll);
      error ? reject(error) : resolve(tracker);
    };
    const poll = setInterval(() => {
      try { ensureCurrent(); } catch (error) { finish(error); }
    }, 30);
    Promise.resolve().then(load).then((tracker) => {
      try { ensureCurrent(); finish(null, tracker); }
      catch (error) { finish(error, tracker); }
    }, (error) => finish(error));
  });
}

const unfinishedRecord = (row) => ({
  clipId: row.clipId, videoSha256: row.sha256, source: null,
  geometry: { width: TASKS_TRAINING_CONFIG.width, height: TASKS_TRAINING_CONFIG.height },
  frames: [], cameraGate: { passed: false, code: "cancelled" }, status: "cancelled",
});

/**
 * Explicit selected public File objects only. No camera, filesystem endpoint, labels,
 * model inference, speech, output installation, fabricated tails or implicit retries.
 * onClip is awaited, allowing an external caller to persist incremental records.
 */
export async function extractTasksTraining({
  manifestFile, videoFiles, partitionGroup, clipIds, onClip = () => {},
  onProgress = () => {}, isCancelled = () => false,
} = {}) {
  if (!import.meta.env?.DEV || !["127.0.0.1", "localhost", "[::1]"].includes(globalThis.location?.hostname)) {
    throw new Error("Local development only.");
  }
  if (!(manifestFile instanceof File) || manifestFile.size < 1 || manifestFile.size > TASKS_TRAINING_LIMITS.manifestBytes ||
    typeof onClip !== "function" || typeof onProgress !== "function" || typeof isCancelled !== "function") {
    throw new Error("Choose the bounded frozen JSON manifest and valid extraction callbacks.");
  }
  const started = performance.now();
  let stopCode = "";
  const mustStop = () => {
    if (isCancelled()) stopCode = "cancelled";
    else if (performance.now() - started >= TASKS_TRAINING_LIMITS.runMs) stopCode = "wall-clock-limit";
    return Boolean(stopCode);
  };
  const ensureCurrent = () => { if (mustStop()) throw cancelled(stopCode); };
  const manifestBytes = await manifestFile.arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const selected = validateTasksExtractionSelection(manifest, videoFiles, { partitionGroup, clipIds });
  if (videoFiles.some((file) => !(file instanceof File))) throw new Error("Choose actual local public video File objects.");
  // ?raw binds the original helper source, rather than Vite's transformed response.
  const sourceModule = await import("./extract-tasks-training.browser.js?raw");
  const report = {
    format: "signbridge-tasks-video-poses-v1", manifestHash: await digest(manifestBytes),
    extractorModuleHash: await digest(encoder.encode(sourceModule.default)),
    partitionGroup, selection: { clipIds: selected.map(({ row }) => row.clipId) },
    config: { ...TASKS_TRAINING_CONFIG }, records: selected.map(({ row }) => unfinishedRecord(row)),
  };
  let outputBytes = bytesOf(report);
  const { loadPoseTracker } = await import("../src/lib/poseTracker.js");
  for (const [index, { row, file }] of selected.entries()) {
    let record = unfinishedRecord(row), video, url, tracker;
    const originalBytes = bytesOf(report.records[index]);
    try {
      ensureCurrent();
      if (await digest(await file.arrayBuffer()) !== row.sha256) throw new Error("Selected source video hash differs from its frozen manifest.");
      ensureCurrent();
      video = document.createElement("video"); video.muted = true; video.playsInline = true; video.preload = "auto";
      url = URL.createObjectURL(file); video.src = url;
      await waitDecoded(video, () => video.readyState >= 2 && video.videoWidth > 0, ensureCurrent);
      if (!Number.isFinite(video.duration)) throw new Error("Source duration is unavailable.");
      record.source = { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 };
      if (![record.source.width, record.source.height].every((size) => Number.isSafeInteger(size) && size > 0 && size <= 4096)) {
        throw new Error("Unsupported source video dimensions.");
      }
      const times = tasksTrainingSampleTimes(record.source.durationMs);
      let playFailure;
      const playing = waitDecoded(video, () => !video.paused && video.currentTime > 0, () => {
        ensureCurrent(); if (playFailure) throw new Error("Public source video playback could not start.");
      });
      // The decoded-state wait, rather than an unbounded play promise, owns the timeout.
      try { void Promise.resolve(video.play()).catch((error) => { playFailure = error; }); }
      catch (error) { playFailure = error; }
      await playing; video.pause();
      await onProgress({ clipId: row.clipId, index, total: selected.length, phase: "loading-tracker" });
      ensureCurrent();
      tracker = await waitTracker(() => loadPoseTracker(mustStop), ensureCurrent);
      ensureCurrent();
      if (!tracker) throw new Error("Current Tasks Holistic detector is unavailable.");
      const canvas = document.createElement("canvas");
      canvas.width = TASKS_TRAINING_CONFIG.width; canvas.height = TASKS_TRAINING_CONFIG.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      const scale = Math.min(canvas.width / record.source.width, canvas.height / record.source.height);
      const width = record.source.width * scale, height = record.source.height * scale;
      const cameraFrames = [];
      for (const atMs of times) {
        ensureCurrent(); video.currentTime = atMs / 1000;
        await waitDecoded(video, () => !video.seeking && video.readyState >= 2 &&
          Math.abs(video.currentTime - atMs / 1000) < .001, ensureCurrent);
        if (video.videoWidth !== record.source.width || video.videoHeight !== record.source.height) throw new Error("Source dimensions changed during extraction.");
        context.fillStyle = "black"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        const { frame, serialized } = tasksTrainingFrame(await tracker.detectForVideo(canvas, atMs), atMs);
        ensureCurrent(); cameraFrames.push(frame); record.frames.push(serialized);
        await onProgress({ clipId: row.clipId, index, total: selected.length, phase: "tracking",
          frameCount: record.frames.length, totalFrames: times.length, atMs });
      }
      const quality = validateCameraTurn(cameraFrames, { durationMs: record.source.durationMs });
      record.cameraGate = { passed: quality.ok, code: quality.code };
      record.status = quality.ok ? "ok" : "quality-rejected";
    } catch (error) {
      record.frames = [];
      record.status = error?.name === "AbortError" ? "cancelled" : "error";
      record.cameraGate = { passed: false, code: record.status === "cancelled" ? "cancelled" : "extraction-error" };
      record.error = { code: record.status === "cancelled" ? (stopCode || "cancelled") : "extraction-error",
        message: String(error?.message || "Source extraction failed.").slice(0, 180) };
    } finally {
      try { tracker?.close(); } catch { /* Continue releasing the selected source. */ }
      if (video) { try { video.pause(); video.removeAttribute("src"); video.load(); } catch {} }
      if (url) URL.revokeObjectURL(url);
    }
    let replacementBytes = bytesOf(record);
    // Reserve bounded error metadata for every remaining selected identity.
    if (outputBytes - originalBytes + replacementBytes > TASKS_TRAINING_LIMITS.outputBytes - 65536) {
      stopCode = "output-limit";
      record = { ...unfinishedRecord(row), status: "error", cameraGate: { passed: false, code: "extraction-error" },
        error: { code: "output-limit", message: "Bounded extraction output would exceed sixteen MiB." } };
      replacementBytes = bytesOf(record);
    }
    report.records[index] = record;
    outputBytes += replacementBytes - originalBytes;
    await onClip(record, { index, total: selected.length, outputBytes });
    await onProgress({ clipId: row.clipId, index, total: selected.length, phase: "complete",
      frameCount: record.frames.length, status: record.status, cameraGate: record.cameraGate });
    if (mustStop()) {
      for (let pending = index + 1; pending < selected.length; pending++) {
        const remaining = report.records[pending];
        remaining.error = { code: stopCode, message: "No complete extraction was produced for this selected clip." };
        await onClip(remaining, { index: pending, total: selected.length, outputBytes });
      }
      break;
    }
  }
  if (bytesOf(report) > TASKS_TRAINING_LIMITS.outputBytes) throw new Error("Bounded extraction output exceeded sixteen MiB.");
  await onProgress({ phase: "finished", total: selected.length,
    completed: report.records.filter((record) => ["ok", "quality-rejected"].includes(record.status)).length,
    stopCode });
  return report;
}
