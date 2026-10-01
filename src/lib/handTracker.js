// Loads MediaPipe's Gesture Recognizer. It finds up to two hands (21 landmarks each) and
// recognizes 7 gestures, entirely in the browser: camera frames never leave the device.
// The Wasm runtime is bundled by Vite from the npm package, so its version always matches.
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import noSimdLoaderPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url";
import noSimdBinaryPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url";

export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const cache = new Map(); // delegate → Promise<{ recognizer, delegate }>
let preferred = null;

// When the browser has no real GPU (lab PCs without drivers, VMs, remote desktops), WebGL runs
// in software and MediaPipe's GPU delegate gets ~20× slower than its CPU one.
function softwareRenderer() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return true;
  }
}

function defaultDelegate() {
  preferred ??= softwareRenderer() ? "CPU" : "GPU";
  return preferred;
}

/** Call when the GPU delegate turns out to be slow: later loads use the CPU. */
export function markGpuSlow() {
  preferred = "CPU";
  const gpu = cache.get("GPU");
  cache.delete("GPU");
  gpu
    ?.then(({ recognizer, delegate }) => {
      if (delegate === "GPU") recognizer.close();
    })
    .catch(() => {});
}

/** → Promise<{ recognizer, delegate: "GPU" | "CPU" }>, shared by every caller. */
export function loadGestureRecognizer(delegate = defaultDelegate()) {
  if (!cache.has(delegate)) {
    const loading = (async () => {
      const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
      const simd = await FilesetResolver.isSimdSupported();
      const fileset = simd
        ? { wasmLoaderPath, wasmBinaryPath }
        : { wasmLoaderPath: noSimdLoaderPath, wasmBinaryPath: noSimdBinaryPath };
      const create = (d) =>
        GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
          runningMode: "VIDEO",
          numHands: 2,
        });
      if (delegate === "CPU") return { recognizer: await create("CPU"), delegate: "CPU" };
      try {
        return { recognizer: await create("GPU"), delegate: "GPU" };
      } catch (gpuError) {
        console.warn("SignBridge: GPU hand tracking unavailable, using CPU.", gpuError);
        return { recognizer: await create("CPU"), delegate: "CPU" };
      }
    })();
    loading.catch(() => cache.delete(delegate)); // allow a retry after a failed load
    cache.set(delegate, loading);
  }
  return cache.get(delegate);
}
