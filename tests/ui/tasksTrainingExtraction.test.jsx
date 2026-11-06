import { File as PublicFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { extractTasksTraining, TASKS_TRAINING_CONFIG, TASKS_TRAINING_LIMITS } from "../../scripts/extract-tasks-training.browser.js";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../src/lib/poseTracker.js", () => ({ loadPoseTracker: (...args) => mock.load(...args), POSE_TRACKER_MODEL_URL: "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task" }));

const sha = async (bytes) => Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes)),
  (value) => value.toString(16).padStart(2, "0")).join("");
const points = (count) => Array.from({ length: count }, () => ({ x: .4, y: .6, z: -.7, visibility: 1 }));
const detection = () => {
  const body = points(33); body[11].x = .3; body[12].x = .7;
  return { poseLandmarks: [body], leftHandLandmarks: [points(21)] };
};
const newTracker = (result = detection()) => ({ detectForVideo: vi.fn(() => result), close: vi.fn() });
let videos, canvases, trackers, camera, network, speech, revoke;

const inputs = async (count = 2) => {
  const videoFiles = Array.from({ length: count }, (_, index) => new PublicFile([new Uint8Array([index + 1, 4, 7])], `clip-${index}.MOV`));
  const clips = await Promise.all(videoFiles.map(async (file, index) => ({ clipId: `Greetings/Hello/clip-${index}.MOV`,
    localFile: file.name, label: "HELLO", split: index === 0 ? "train" : "val", sha256: await sha(await file.arrayBuffer()) })));
  const manifestFile = new PublicFile([JSON.stringify({ format: "signbridge-tasks-video-study-manifest-v1", clips })], "manifest.json");
  return { manifestFile, videoFiles, partitionGroup: "learning" };
};

beforeEach(() => {
  vi.clearAllMocks(); videos = []; canvases = []; trackers = [];
  vi.stubGlobal("File", PublicFile); vi.stubGlobal("crypto", webcrypto);
  camera = vi.fn(); network = vi.fn(); speech = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: camera } });
  vi.stubGlobal("fetch", network); vi.stubGlobal("speechSynthesis", { speak: speech });
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => `blob:public-${videos.length}`), revokeObjectURL: revoke = vi.fn(),
  }));
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name, options) => {
    if (name === "canvas") {
      const context = { fillRect: vi.fn(), drawImage: vi.fn() };
      const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), context };
      canvases.push(canvas); return canvas;
    }
    if (name !== "video") return realCreate(name, options);
    const video = new EventTarget();
    Object.assign(video, { currentTime: 0, readyState: 4, videoWidth: 640, videoHeight: 480,
      duration: .5, seeking: false, paused: true, removeAttribute: vi.fn(), load: vi.fn() });
    video.play = vi.fn(() => {
      video.paused = false; video.currentTime = .001; video.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    });
    video.pause = vi.fn(() => { video.paused = true; });
    videos.push(video); return video;
  });
  mock.load.mockImplementation(async () => { const tracker = newTracker(); trackers.push(tracker); return tracker; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("explicit public files produce measured source frames and a hash-bound export using fresh runtimes", async () => {
  const args = await inputs(); const onClip = vi.fn(), onProgress = vi.fn();
  const report = await extractTasksTraining({ ...args, onClip, onProgress });
  expect(report.format).toBe("signbridge-tasks-video-poses-v1");
  expect(report.manifestHash).toBe(await sha(await args.manifestFile.arrayBuffer()));
  expect(report.extractorModuleHash).toMatch(/^[a-f0-9]{64}$/);
  expect(report.config).toEqual(TASKS_TRAINING_CONFIG);
  expect(report.selection.clipIds).toEqual(["Greetings/Hello/clip-0.MOV", "Greetings/Hello/clip-1.MOV"]);
  expect(report.records.map((row) => row.status)).toEqual(["ok", "ok"]);
  for (let index = 0; index < 2; index++) {
    const record = report.records[index];
    expect(record.frames.map((frame) => frame.atMs)).toEqual([0, 125, 250, 375]);
    expect(record.frames.every((frame) => frame.pose.length === 75)).toBe(true);
    expect(record.frames[0].pose[33]).toEqual([.4, .6, 1]);
    expect(record.source).toEqual({ width: 640, height: 480, durationMs: 500 });
    expect(record.geometry).toEqual({ width: 1280, height: 720 });
    expect(record.cameraGate).toEqual({ passed: true, code: "" });
    expect(trackers[index].detectForVideo.mock.calls.map((call) => call[1])).toEqual([0, 125, 250, 375]);
    expect(canvases[index].context.fillRect).toHaveBeenCalledTimes(4);
    expect(canvases[index].context.fillStyle).toBe("black");
    expect(canvases[index].context.drawImage).toHaveBeenCalledWith(videos[index], 160, 0, 960, 720);
    expect(trackers[index].close).toHaveBeenCalledOnce();
    expect(videos[index].removeAttribute).toHaveBeenCalledWith("src");
    expect(videos[index].load).toHaveBeenCalledOnce();
  }
  expect(onClip).toHaveBeenCalledTimes(2); expect(revoke).toHaveBeenCalledTimes(2);
  expect(onProgress).toHaveBeenLastCalledWith({ phase: "finished", total: 2, completed: 2, stopCode: "" });
  expect(camera).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled(); expect(speech).not.toHaveBeenCalled();
});

test("hash mismatch remains an explicit error row and the next chosen source is still extracted", async () => {
  const args = await inputs();
  args.videoFiles[0] = new PublicFile(["different"], "clip-0.MOV");
  const report = await extractTasksTraining(args);
  expect(report.records).toHaveLength(2);
  expect(report.records[0].status).toBe("error");
  expect(report.records[0].frames).toEqual([]);
  expect(report.records[0].error.message).toMatch(/hash differs/);
  expect(report.records[1].status).toBe("ok");
  expect(mock.load).toHaveBeenCalledOnce(); expect(trackers[0].close).toHaveBeenCalledOnce();
});

test("missing measured hands retain the complete rejected sequence rather than disappearing", async () => {
  mock.load.mockImplementation(async () => { const tracker = newTracker({}); trackers.push(tracker); return tracker; });
  const report = await extractTasksTraining(await inputs(1));
  expect(report.records[0].status).toBe("quality-rejected");
  expect(report.records[0].frames).toHaveLength(4);
  expect(report.records[0].cameraGate).toEqual({ passed: false, code: "framing" });
  expect(report.records[0].frames[0].pose.every((point) => point.every((value) => value === 0))).toBe(true);
  expect(trackers[0].close).toHaveBeenCalledOnce();
});

test("detector failure is explicit, releases its runtime and does not prevent the next source", async () => {
  const bad = newTracker(); bad.detectForVideo.mockImplementation(() => { throw new Error("Detector unavailable"); });
  const good = newTracker(); mock.load.mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
  const report = await extractTasksTraining(await inputs());
  expect(report.records.map((row) => row.status)).toEqual(["error", "ok"]);
  expect(report.records[0].error.message).toBe("Detector unavailable");
  expect(bad.close).toHaveBeenCalledOnce(); expect(good.close).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledTimes(2);
});

test("cancelling a pending tracker yields every identity and closes a late runtime", async () => {
  let resolveTracker, cancelled = false;
  const lateTracker = newTracker(); mock.load.mockImplementationOnce(() => new Promise((resolve) => { resolveTracker = resolve; }));
  const args = await inputs(); const onClip = vi.fn();
  const pending = extractTasksTraining({ ...args, isCancelled: () => cancelled, onClip });
  await vi.waitFor(() => expect(mock.load).toHaveBeenCalledOnce());
  cancelled = true;
  const report = await pending;
  expect(report.records.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
  expect(onClip).toHaveBeenCalledTimes(2); expect(revoke).toHaveBeenCalledOnce();
  resolveTracker(lateTracker);
  await vi.waitFor(() => expect(lateTracker.close).toHaveBeenCalledOnce());
  expect(lateTracker.detectForVideo).not.toHaveBeenCalled();
});

test("wall-clock expiry retains all cancelled identities without starting another runtime", async () => {
  let now = 1; vi.spyOn(performance, "now").mockImplementation(() => now);
  const report = await extractTasksTraining({ ...await inputs(), onProgress: (progress) => {
    if (progress.phase === "loading-tracker") now += TASKS_TRAINING_LIMITS.runMs;
  } });
  expect(report.records.map((row) => row.status)).toEqual(["cancelled", "cancelled"]);
  expect(report.records[0].error.code).toBe("wall-clock-limit");
  expect(report.records[1].error.code).toBe("wall-clock-limit");
  expect(mock.load).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledOnce();
});

test("failed playback cannot strand the group on an unresolved play promise", async () => {
  const realCreate = document.createElement.getMockImplementation();
  document.createElement.mockImplementation((name, options) => {
    const value = realCreate(name, options);
    if (name === "video") value.play = vi.fn(() => Promise.reject(new Error("Not allowed")));
    return value;
  });
  const report = await extractTasksTraining(await inputs(1));
  expect(report.records[0].status).toBe("error"); expect(report.records[0].error.message).toMatch(/playback/);
  expect(mock.load).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledOnce();
});

test("decoded seek events advance all source frames without advancing the polling timer", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  const realCreate = document.createElement.getMockImplementation();
  document.createElement.mockImplementation((name, options) => {
    const value = realCreate(name, options);
    if (name === "video") {
      let time = 0;
      Object.defineProperty(value, "currentTime", {
        get: () => time,
        set: (next) => {
          time = next; value.seeking = true;
          queueMicrotask(() => { value.seeking = false; value.dispatchEvent(new Event("seeked")); });
        },
      });
      vi.spyOn(value, "addEventListener"); vi.spyOn(value, "removeEventListener");
    }
    return value;
  });
  const report = await extractTasksTraining(await inputs(1));
  expect(report.records[0].status).toBe("ok");
  expect(report.records[0].frames.map((frame) => frame.atMs)).toEqual([0, 125, 250, 375]);
  expect(videos[0].removeEventListener.mock.calls).toEqual(videos[0].addEventListener.mock.calls);
  expect(new Set(videos[0].addEventListener.mock.calls.map(([event]) => event))).toEqual(
    new Set(["error", "loadedmetadata", "loadeddata", "seeked", "playing", "timeupdate"]));
  expect(vi.getTimerCount()).toBe(0); expect(trackers[0].close).toHaveBeenCalledOnce();
});

test.each(["cancelled", "timeout"])("%s decoded wait removes readiness listeners and releases media", async (kind) => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  let cancel = false, playbackStarted;
  const started = new Promise((resolve) => { playbackStarted = resolve; });
  const realCreate = document.createElement.getMockImplementation();
  document.createElement.mockImplementation((name, options) => {
    const value = realCreate(name, options);
    if (name === "video") {
      value.play = vi.fn(() => { playbackStarted(); return new Promise(() => {}); });
      vi.spyOn(value, "addEventListener"); vi.spyOn(value, "removeEventListener");
    }
    return value;
  });
  const pending = extractTasksTraining({ ...await inputs(1), isCancelled: () => cancel });
  await started;
  if (kind === "cancelled") { cancel = true; videos[0].dispatchEvent(new Event("timeupdate")); }
  else await vi.advanceTimersByTimeAsync(10000);
  const report = await pending;
  expect(report.records[0].status).toBe(kind === "cancelled" ? "cancelled" : "error");
  expect(videos[0].removeEventListener.mock.calls).toEqual(videos[0].addEventListener.mock.calls);
  expect(mock.load).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
