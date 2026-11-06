import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import noSimdLoaderPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url";
import noSimdBinaryPath from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url";

export const POSE_TRACKER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";

/** Both realtime and diagnostic replay use identical detector options/assets. */
export async function loadPoseTracker(isCancelled = () => false) {
  const { FilesetResolver, HolisticLandmarker } = await import("@mediapipe/tasks-vision");
  if (isCancelled()) return null;
  const simd = await FilesetResolver.isSimdSupported();
  if (isCancelled()) return null;
  const files = simd ? { wasmLoaderPath, wasmBinaryPath } : { wasmLoaderPath: noSimdLoaderPath, wasmBinaryPath: noSimdBinaryPath };
  return HolisticLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: POSE_TRACKER_MODEL_URL, delegate: "CPU" }, runningMode: "VIDEO",
    outputFaceBlendshapes: false, outputPoseSegmentationMasks: false,
  });
}
