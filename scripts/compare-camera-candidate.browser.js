// Local research only: never imported by the app or packaged in public builds.
import { loadPoseTracker } from "../src/lib/poseTracker.js";
import { poseFrameFromHolistic, validateTrainedModel } from "../src/lib/trainedSignModel.js";
import { predictTrainedCameraSign } from "../src/lib/cameraWordRecognition.js";

const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
const predictionSummary = result => ({
  status: result.status, meaning: result.meaning,
  topLabel: result.diagnostics?.posterior?.topLabel ?? null,
  topScore: result.diagnostics?.posterior?.topScore ?? null,
  margin: result.margin,
  reasons: result.diagnostics?.reasonCodes ?? [],
  cameraGate: result.diagnostics?.cameraGate ?? null,
});

function waitDecoded(video, check, ensureCurrent) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = error => {
      if (done) return; done = true;
      clearTimeout(timeout); clearInterval(poll);
      video.removeEventListener("error", failed);
      error ? reject(error) : resolve();
    };
    const inspect = () => {
      try { ensureCurrent(); if (check()) finish(); } catch (error) { finish(error); }
    };
    const failed = () => finish(new Error("Local reference video could not be decoded."));
    const timeout = setTimeout(() => finish(new Error("Local video decoding timed out.")), 10000);
    const poll = setInterval(inspect, 30);
    video.addEventListener("error", failed); inspect();
  });
}

/** Use explicitly chosen public dataset files. Expected labels never enter inference. */
export async function compareCameraCandidate({ videos, models, onProgress = () => {}, isCancelled = () => false }) {
  if (!import.meta.env.DEV || !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) throw new Error("Local development only.");
  if (!Array.isArray(videos) || videos.length < 1 || videos.length > 8 || !Array.isArray(models) || models.length !== 2) throw new Error("Choose one to eight videos and exactly two pinned models.");
  const ensureCurrent = () => { if (isCancelled()) throw new Error("Candidate comparison cancelled."); };
  const parsed = [];
  for (const entry of models) {
    if (!(entry.file instanceof File) || entry.file.size > 4 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid pinned model file.");
    const bytes = await entry.file.arrayBuffer(); ensureCurrent();
    if (await digest(bytes) !== entry.sha256) throw new Error("Model file hash differs from frozen candidate.");
    const model = JSON.parse(new TextDecoder().decode(bytes)); validateTrainedModel(model, "isl");
    if (model.threshold !== .95 || model.margin !== .3) throw new Error("Comparison requires unchanged .95/.30 recognition gates.");
    parsed.push({ name: entry.name, sha256: entry.sha256, model });
  }
  const results = [];
  for (const [fileIndex, entry] of videos.entries()) {
    ensureCurrent();
    if (!(entry.file instanceof File) || entry.file.size < 1 || entry.file.size > 30 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid public reference video file.");
    const bytes = await entry.file.arrayBuffer();
    if (await digest(bytes) !== entry.sha256) throw new Error("Reference video hash differs from frozen manifest.");
    let video, url;
    try {
      video = document.createElement("video"); video.muted = true; video.playsInline = true;
      url = URL.createObjectURL(entry.file); video.src = url; video.preload = "auto";
      await waitDecoded(video, () => video.readyState >= 2 && video.videoWidth > 0, ensureCurrent);
      if (!Number.isFinite(video.duration) || video.duration < .5 || video.duration > 12) throw new Error("Unsupported reference duration.");
      const playing = waitDecoded(video, () => !video.paused && video.currentTime > 0, ensureCurrent); void playing.catch(() => {});
      await video.play(); await playing; video.pause();
      const source = { width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 };
      if (source.width > 4096 || source.height > 4096) throw new Error("Unsupported decoded dimensions.");
      const conditions = [
        { name: "original-8", width: source.width, height: source.height },
        { name: "aspect-preserved-640x480-8", width: 640, height: 480 },
      ];
      for (const condition of conditions) {
        let tracker;
        try {
          ensureCurrent(); onProgress({ fileIndex, condition: condition.name, phase: "loading-tracker" });
          tracker = await loadPoseTracker(isCancelled); ensureCurrent();
          if (!tracker) throw new Error("Tasks Holistic is unavailable.");
          const canvas = document.createElement("canvas"); canvas.width = condition.width; canvas.height = condition.height;
          const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unavailable.");
          const scale = Math.min(condition.width / source.width, condition.height / source.height);
          const width = source.width * scale, height = source.height * scale;
          const frames = [], count = Math.ceil(source.durationMs * 8 / 1000);
          if (count > 100) throw new Error("Reference exceeds 100 measured samples.");
          for (let index = 0; index < count; index++) {
            ensureCurrent(); const atMs = index * 125;
            video.currentTime = atMs / 1000;
            await waitDecoded(video, () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - atMs / 1000) < .001, ensureCurrent);
            if (video.videoWidth !== source.width || video.videoHeight !== source.height) throw new Error("Decoded video dimensions changed mid-comparison.");
            ctx.fillStyle = "black"; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
            frames.push({ ...poseFrameFromHolistic(await tracker.detectForVideo(canvas, atMs)), atMs });
            onProgress({ fileIndex, condition: condition.name, phase: "tracking", frameCount: frames.length, totalFrames: count });
          }
          const predictions = parsed.map(({ name, sha256, model }) => ({ name, sha256,
            ...predictionSummary(predictTrainedCameraSign(model, frames, { durationMs: source.durationMs })) }));
          const row = { videoSha256: entry.sha256, source, condition, frameCount: frames.length, predictions };
          results.push(row); onProgress({ fileIndex, condition: condition.name, phase: "complete", result: row });
          frames.length = 0;
        } finally { try { tracker?.close(); } catch {} }
      }
    } finally {
      if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
      if (url) URL.revokeObjectURL(url);
    }
  }
  return { format: "signbridge-camera-candidate-comparison-v1", results,
    tracker: "Current app Tasks Holistic CPU VIDEO loader; fresh instance per video/geometry",
    sampling: "Sequential real decoded source frames at 125 ms; not real-time throughput",
    gates: { threshold: .95, margin: .3 },
    limitations: ["Public reference videos, not webcam participants or signer-independent accuracy.",
      "Two geometries of a clip are correlated stress conditions, not independent samples.",
      "No expected label reaches inference; no speech, messages, fitted weights or persistent pose recordings."] };
}
