import { useCallback, useEffect, useRef } from "react";
import { loadPoseTracker } from "../lib/poseTracker.js";

const SEEK_TIMEOUT_MS = 8000;
const abort = () => Object.assign(new Error("Video replay cancelled."), { name: "AbortError" });

/** Seeked + decoded data, rather than elapsed wall time, selects each source frame. */
function seekDecodedFrame(run, atSeconds, isCurrent) {
  const video = run.video;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("seeked", decoded);
      video.removeEventListener("loadeddata", decoded);
      video.removeEventListener("error", failed);
      if (run.abortSeek === cancelled) run.abortSeek = null;
    };
    const finish = (cause) => {
      if (settled) return;
      settled = true; cleanup(); cause ? reject(cause) : resolve();
    };
    const cancelled = () => finish(abort());
    const failed = () => finish(new Error("This video could not be decoded. Choose a supported local video."));
    const decoded = () => {
      if (!isCurrent()) { cancelled(); return; }
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - atSeconds) < .001) finish();
    };
    const timeout = setTimeout(() => finish(new Error("Video decoding paused for more than eight seconds. Try the replay again.")), SEEK_TIMEOUT_MS);
    run.abortSeek = cancelled;
    video.addEventListener("seeked", decoded);
    video.addEventListener("loadeddata", decoded);
    video.addEventListener("error", failed);
    if (!isCurrent()) { cancelled(); return; }
    // A paused video's already-decoded initial frame needs no seek event.
    if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - atSeconds) < .001) { finish(); return; }
    try { video.currentTime = atSeconds; }
    catch { failed(); }
  });
}

/**
 * Local-file diagnostic: independently decode every sampled source frame.
 * onFrame(result, video, atMs) always receives source-video timestamps.
 * onProgress({ frameCount, totalFrames, atMs, durationMs }) describes sampling.
 * start({ fps, trackerBackend }) defaults to Tasks; the legacy backend is an
 * explicit local diagnostic and can return asynchronous detection results.
 * start resolves true only after onComplete; cancellation resolves false silently.
 */
export function useVideoPoseReplay({ videoRef, onFrame, onComplete, onError, onProgress }) {
  const callbacks = useRef({ onFrame, onComplete, onError, onProgress });
  callbacks.current = { onFrame, onComplete, onError, onProgress };
  const current = useRef(null), generation = useRef(0), mounted = useRef(true);
  const release = useCallback((run) => {
    run.abortSeek?.(); run.abortSeek = null;
    try { run.video.pause(); } catch { /* Release the tracker even if the video has detached. */ }
    if (run.tracker && !run.closed) {
      run.closed = true;
      try { run.tracker.close(); } catch { /* A failed runtime must still be detached. */ }
    }
    if (current.current === run) current.current = null;
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    const run = current.current;
    if (!run) return;
    run.cancelled = true; release(run);
  }, [release]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, [cancel]);

  const start = useCallback(async ({ fps = 25, trackerBackend = "tasks-holistic" } = {}) => {
    cancel();
    if (!mounted.current) return false;
    if (trackerBackend !== "tasks-holistic" && trackerBackend !== "solutions-holistic-experiment") {
      callbacks.current.onError?.(new Error("Choose Tasks Holistic or the legacy Holistic diagnostic experiment."));
      return false;
    }
    const video = videoRef.current, duration = video?.duration;
    if (!video || video.srcObject || !Number.isInteger(fps) || fps < 1 || fps > 30 ||
      !Number.isFinite(duration) || duration < .35 || duration > 12 || Math.ceil(duration * fps) > 100) {
      callbacks.current.onError?.(new Error("Choose a local video between 0.35 and 12 seconds, at 1–30 frames per second and no more than 100 samples."));
      return false;
    }
    const run = { id: ++generation.current, video, tracker: null, closed: false, cancelled: false, abortSeek: null };
    current.current = run;
    const isCurrent = () => mounted.current && !run.cancelled && run.id === generation.current;
    const durationMs = duration * 1000, totalFrames = Math.ceil(duration * fps);
    let frameCount = 0;
    try {
      video.pause(); video.muted = true;
      // The experimental runtime/assets are never imported by the default path.
      const loadTracker = trackerBackend === "tasks-holistic" ? loadPoseTracker
        : (await import("../lib/legacyPoseTracker.js")).loadLegacyPoseTracker;
      if (!isCurrent()) { release(run); return false; }
      run.tracker = await loadTracker(() => !isCurrent());
      if (!isCurrent()) { release(run); return false; }
      if (!run.tracker) throw new Error("Body and hand tracking could not start. Try the replay again.");
      for (let index = 0; index < totalFrames; index++) {
        if (!isCurrent()) { release(run); return false; }
        if (videoRef.current !== video) throw new Error("The selected video changed. Start a new replay.");
        const atMs = index * 1000 / fps;
        await seekDecodedFrame(run, atMs / 1000, isCurrent);
        if (!isCurrent()) { release(run); return false; }
        const detected = await run.tracker.detectForVideo(video, atMs);
        if (!isCurrent()) { release(run); return false; }
        callbacks.current.onFrame?.(detected, video, atMs);
        if (!isCurrent()) { release(run); return false; }
        frameCount++;
        callbacks.current.onProgress?.({ frameCount, totalFrames, atMs, durationMs });
      }
      release(run);
      if (!isCurrent()) return false;
      callbacks.current.onComplete?.({ durationMs, frameCount });
      return true;
    } catch (cause) {
      release(run);
      if (isCurrent() && cause?.name !== "AbortError") callbacks.current.onError?.(cause instanceof Error ? cause : new Error("Video replay failed. Try a supported local video."));
      return false;
    }
  }, [cancel, release, videoRef]);

  return { start, cancel };
}
