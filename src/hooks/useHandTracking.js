import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { loadGestureRecognizer, markGpuSlow } from "../lib/handTracker.js";

const WARM_UP_FRAMES = 2; // the first GPU frames include shader compilation
const TIMED_FRAMES = 5;
const SLOW_MS = 150;

/**
 * Runs MediaPipe on every new video frame while `active`, calling onFrame(result, video).
 * If the GPU delegate proves slow on this machine, it switches to the CPU delegate.
 * status: "idle" | "loading" | "ready" | "error"
 */
export function useHandTracking({ videoRef, active, onFrame }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ attempt: -1, status: "loading", error: "" });
  const [metrics, setMetrics] = useState({ fps: 0, delegate: "" });
  const handleFrame = useEffectEvent((frame, video) => onFrame(frame, video));

  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let raf = 0;

    const fail = (err) => {
      console.error("SignBridge: couldn't load the hand-tracking model.", err);
      if (!stopped) {
        setMetrics({ fps: 0, delegate: "" });
        setResult({
          attempt,
          status: "error",
          error: "The hand-tracking model couldn't load. Check your internet connection and try again.",
        });
      }
    };

    const run = ({ recognizer, delegate }) => {
      if (stopped) return;
      setResult({ attempt, status: "ready", error: "" });
      setMetrics({ fps: 0, delegate });
      let lastTime = -1;
      let failures = 0;
      let timed = 0;
      let slow = 0;
      let frames = 0;
      let metricsAt = performance.now();

      const loop = () => {
        if (stopped) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth && video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          const started = performance.now();
          let frame = null;
          try {
            frame = recognizer.recognizeForVideo(video, started);
            failures = 0;
          } catch (err) {
            failures += 1;
            if (failures >= 30) {
              console.error("SignBridge: hand tracking stopped.", err);
              setResult({ attempt, status: "error", error: "Hand tracking stopped unexpectedly. Try again." });
              setMetrics({ fps: 0, delegate });
              return;
            }
          }
          const took = performance.now() - started;
          if (frame) handleFrame(frame, video);
          frames += 1;
          if (performance.now() - metricsAt >= 1000) {
            setMetrics({ fps: Math.round(frames * 1000 / (performance.now() - metricsAt)), delegate });
            frames = 0;
            metricsAt = performance.now();
          }

          if (delegate === "GPU" && timed < WARM_UP_FRAMES + TIMED_FRAMES) {
            timed += 1;
            if (timed > WARM_UP_FRAMES && took > SLOW_MS) slow += 1;
            if (timed === WARM_UP_FRAMES + TIMED_FRAMES && slow > TIMED_FRAMES / 2) {
              console.warn("SignBridge: GPU hand tracking is slow on this device; switching to CPU.");
              markGpuSlow();
              loadGestureRecognizer().then(run, fail);
              return;
            }
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };

    loadGestureRecognizer().then(run, fail);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [active, videoRef, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!active) return { status: "idle", error: "", retry };
  if (result.attempt !== attempt) return { status: "loading", error: "", retry };
  return { status: result.status, error: result.error, retry, ...metrics };
}
