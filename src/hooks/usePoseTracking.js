import { useEffect, useEffectEvent, useState } from "react";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import noSimdLoaderPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url";
import noSimdBinaryPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";

/** Body + left/right hands use the same joint order as the training corpus. */
export function usePoseTracking({ videoRef, active, onFrame }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "idle", error: "" });
  const frame = useEffectEvent(onFrame);
  useEffect(() => {
    if (!active) { setState({ status: "idle", error: "" }); return; }
    let stopped = false, task = null, raf = 0, lastAt = -Infinity, lastVideoTime = -1;
    setState({ status: "loading", error: "" });
    const release = () => {
      cancelAnimationFrame(raf); raf = 0;
      const previous = task; task = null;
      try { previous?.close(); } catch { /* A failed task must not keep the frame loop alive. */ }
    };
    const fail = (runtime = false) => {
      release();
      if (!stopped) setState({ status: "error", error: runtime ? "Body and hand tracking stopped. Retry tracking; the camera can stay on." : "Body and hand tracking could not start. Check your connection, then retry tracking." });
    };
    (async () => {
      const { FilesetResolver, HolisticLandmarker } = await import("@mediapipe/tasks-vision");
      if (stopped) return;
      const simd = await FilesetResolver.isSimdSupported();
      if (stopped) return;
      const files = simd ? { wasmLoaderPath, wasmBinaryPath } : { wasmLoaderPath: noSimdLoaderPath, wasmBinaryPath: noSimdBinaryPath };
      task = await HolisticLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" }, runningMode: "VIDEO",
        outputFaceBlendshapes: false, outputPoseSegmentationMasks: false,
      });
      if (stopped) { release(); return; }
      setState({ status: "ready", error: "" });
      let failures = 0;
      const loop = (now) => {
        if (stopped || !task) return;
        const video = videoRef.current;
        // At most eight samples per second; synchronous tracking can run slower on this device.
        if (now - lastAt >= 125 && video?.readyState >= 2 && video.videoWidth && !video.paused && !video.ended && video.currentTime !== lastVideoTime) {
          lastAt = now; lastVideoTime = video.currentTime;
          try { frame(task.detectForVideo(video, now), video); failures = 0; }
          catch { if (++failures >= 8) { fail(true); return; } }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })().catch(() => fail());
    return () => { stopped = true; release(); };
  }, [active, attempt, videoRef]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
