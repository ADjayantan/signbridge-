import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { poseFrameFromHolistic } from "../../src/lib/trainedSignModel.js";

let api, instances, behavior, Holistic;
const flush = async () => { for (let tick = 0; tick < 10; tick++) await Promise.resolve(); };
const script = () => document.querySelector('script[src*="@mediapipe/holistic@"]');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rawPose = () => ({
  poseLandmarks: Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: .8 })),
  leftHandLandmarks: Array.from({ length: 21 }, () => ({ x: .4, y: .3, z: 0 })),
  rightHandLandmarks: [], image: "PRIVATE IMAGE", faceLandmarks: ["PRIVATE FACE"], private: "PRIVATE METADATA",
});
const create = async (options) => {
  const loading = api.createLegacyPoseTracker(options);
  script()?.dispatchEvent(new Event("load"));
  return loading;
};

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  document.querySelectorAll('script[src*="@mediapipe/holistic@"]').forEach((element) => element.remove());
  instances = [];
  behavior = { initialize: () => Promise.resolve(), send: (instance) => { instance.results(rawPose()); return Promise.resolve(); }, close: () => Promise.resolve() };
  Holistic = class {
    constructor(configuration) {
      this.configuration = configuration; instances.push(this);
      this.initialize = vi.fn(() => behavior.initialize(this));
      this.setOptions = vi.fn(); this.onResults = vi.fn((callback) => { this.results = callback; });
      this.send = vi.fn((input) => behavior.send(this, input)); this.close = vi.fn(() => behavior.close(this));
    }
  };
  vi.stubGlobal("Holistic", Holistic);
  api = await import("../../src/lib/legacyPoseTracker.js");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("importing is lazy; pre-cancelled loading and public-demo never add a runtime script", async () => {
  expect(script()).toBeNull(); expect(instances).toHaveLength(0);
  expect(await api.loadLegacyPoseTracker(() => true)).toBeNull(); expect(script()).toBeNull();
  const cancelled = new AbortController(); cancelled.abort();
  await expect(api.createLegacyPoseTracker({ signal: cancelled.signal })).rejects.toMatchObject({ name: "AbortError" });
  vi.stubEnv("MODE", "public-demo");
  await expect(api.loadLegacyPoseTracker()).rejects.toMatchObject({ code: "public-demo" });
  expect(script()).toBeNull(); expect(instances).toHaveLength(0);
});

test("pinned classic script, asset paths and options produce only consumer-compatible pose arrays", async () => {
  const loading = api.loadLegacyPoseTracker();
  const element = script();
  expect(element.src).toBe("https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629/holistic.js");
  expect(element.crossOrigin).toBe("anonymous"); expect(element.async).toBe(true);
  element.dispatchEvent(new Event("load"));
  const tracker = await loading, instance = instances[0];
  expect(script()).toBeNull();
  expect(instance.configuration.locateFile("holistic_solution_packed_assets.data")).toBe(`${api.LEGACY_POSE_TRACKER_BASE_URL}holistic_solution_packed_assets.data`);
  expect(instance.setOptions).toHaveBeenCalledWith({ modelComplexity: 2, smoothLandmarks: true, enableSegmentation: false,
    refineFaceLandmarks: false, minDetectionConfidence: .5, minTrackingConfidence: .5, selfieMode: false });
  expect(instance.initialize).toHaveBeenCalledOnce();
  const video = document.createElement("video"), result = await tracker.detectForVideo(video, 0);
  expect(instance.send).toHaveBeenCalledWith({ image: video });
  expect(Object.keys(result)).toEqual(["poseLandmarks", "leftHandLandmarks", "rightHandLandmarks"]);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|image|faceLandmarks/);
  const pose = poseFrameFromHolistic(result);
  expect(pose.keypoints).toHaveLength(75); expect(pose.confidences[11]).toBe(.8); expect(pose.confidences[33]).toBe(1); expect(pose.confidences[54]).toBe(0);
  await tracker.close(); await tracker.close(); expect(instance.close).toHaveBeenCalledOnce();
});

test("a callback alone does not permit another frame until the SDK send also finishes", async () => {
  const sending = deferred(); behavior.send = (instance) => { instance.results(rawPose()); return sending.promise; };
  const tracker = await create(), video = document.createElement("video");
  let complete = false; const first = tracker.detectForVideo(video, 0).then((result) => { complete = true; return result; });
  await flush(); expect(complete).toBe(false);
  await expect(tracker.detectForVideo(video, 40)).rejects.toMatchObject({ code: "frame-pending" });
  expect(instances[0].send).toHaveBeenCalledOnce();
  sending.resolve(); await first; expect(complete).toBe(true);
  await tracker.close();
});

test("a completed send still waits for its corresponding results callback", async () => {
  behavior.send = () => Promise.resolve();
  const tracker = await create(); let complete = false;
  const pending = tracker.detectForVideo(document.createElement("video"), 0).then((result) => { complete = true; return result; });
  await flush(); expect(complete).toBe(false);
  instances[0].results(rawPose()); await pending; expect(complete).toBe(true);
  await tracker.close();
});

test("timestamps must increase and missing/invalid frame requests never reach the SDK", async () => {
  const tracker = await create(), video = document.createElement("video");
  for (const atMs of [-1, NaN, Infinity, "0", null]) await expect(tracker.detectForVideo(video, atMs)).rejects.toMatchObject({ code: "timestamp" });
  await expect(tracker.detectForVideo(null, 0)).rejects.toMatchObject({ code: "timestamp" });
  expect(instances[0].send).not.toHaveBeenCalled();
  await tracker.detectForVideo(video, 0);
  await expect(tracker.detectForVideo(video, 0)).rejects.toMatchObject({ code: "timestamp" });
  await tracker.detectForVideo(video, 40); expect(instances[0].send).toHaveBeenCalledTimes(2);
  await tracker.close();
});

test("synchronous close before the deferred send microtask prevents SDK send entirely", async () => {
  const tracker = await create();
  const pending = tracker.detectForVideo(document.createElement("video"), 0);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  tracker.close(); await rejected; await flush();
  expect(instances[0].send).not.toHaveBeenCalled(); expect(instances[0].close).toHaveBeenCalledOnce();
  await expect(tracker.detectForVideo(document.createElement("video"), 40)).rejects.toMatchObject({ code: "closed" });
});

test("closing an in-flight frame rejects it once and ignores late callbacks and send completion", async () => {
  const sending = deferred(); behavior.send = () => sending.promise;
  const tracker = await create();
  const pending = tracker.detectForVideo(document.createElement("video"), 0);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await flush(); tracker.close(); tracker.close();
  instances[0].results(rawPose()); sending.resolve(); await rejected; await flush();
  expect(instances[0].close).toHaveBeenCalledOnce();
});

test.each(["sync", "async"])("%s SDK close failure remains nonthrowing for fire-and-forget cleanup", async (kind) => {
  behavior.close = () => { if (kind === "sync") throw new Error("SDK close failed"); return Promise.reject(new Error("SDK close failed")); };
  const tracker = await create(); await expect(tracker.close()).resolves.toBeUndefined();
  await expect(tracker.close()).resolves.toBeUndefined(); expect(instances[0].close).toHaveBeenCalledOnce();
});

test("a send failure closes the broken instance and a fresh explicit loader can retry", async () => {
  behavior.send = () => Promise.reject(new Error("runtime failed"));
  const first = await create();
  await expect(first.detectForVideo(document.createElement("video"), 0)).rejects.toMatchObject({ code: "frame-send" });
  expect(instances[0].close).toHaveBeenCalledOnce();
  instances[0].results(rawPose());
  behavior.send = (instance) => { instance.results(rawPose()); return Promise.resolve(); };
  const retry = await create(); expect(instances).toHaveLength(2); expect(script()).toBeNull();
  expect((await retry.detectForVideo(document.createElement("video"), 0)).leftHandLandmarks).toHaveLength(21);
  await retry.close();
});

test("missing results time out, close the instance and cannot contaminate a new attempt", async () => {
  behavior.send = () => Promise.resolve();
  const tracker = await create({ frameTimeoutMs: 100 });
  const pending = tracker.detectForVideo(document.createElement("video"), 0);
  const rejected = expect(pending).rejects.toMatchObject({ code: "frame-timeout" });
  await vi.advanceTimersByTimeAsync(100); await rejected;
  expect(instances[0].close).toHaveBeenCalledOnce(); instances[0].results(rawPose());
  await expect(tracker.detectForVideo(document.createElement("video"), 40)).rejects.toMatchObject({ code: "closed" });
});

test("an abort during initialization closes once and late initialization cannot return a tracker", async () => {
  const initialization = deferred(), controller = new AbortController(); behavior.initialize = () => initialization.promise;
  const loading = api.createLegacyPoseTracker({ signal: controller.signal });
  const rejected = expect(loading).rejects.toMatchObject({ name: "AbortError" });
  script().dispatchEvent(new Event("load")); await flush(); expect(instances).toHaveLength(1);
  controller.abort(); await rejected; expect(instances[0].close).toHaveBeenCalledOnce();
  initialization.resolve(); await flush(); expect(instances[0].close).toHaveBeenCalledOnce();
});

test("initialization has a finite total budget and failure still allows a fresh instance", async () => {
  const initialization = deferred(); behavior.initialize = () => initialization.promise;
  const loading = api.createLegacyPoseTracker({ initializationTimeoutMs: 100 });
  const rejected = expect(loading).rejects.toMatchObject({ code: "initialization-timeout" });
  script().dispatchEvent(new Event("load")); await flush();
  await vi.advanceTimersByTimeAsync(100); await rejected; expect(instances[0].close).toHaveBeenCalledOnce();
  initialization.resolve(); await flush();
  behavior.initialize = () => Promise.resolve(); const retry = await create(); await retry.close();
  expect(instances).toHaveLength(2);
});

test("the existing cancellation-callback contract cancels a script wait and permits a later retry", async () => {
  let cancelled = false;
  const loading = api.loadLegacyPoseTracker(() => cancelled);
  const firstScript = script(); cancelled = true;
  await vi.advanceTimersByTimeAsync(50); expect(await loading).toBeNull(); expect(firstScript.isConnected).toBe(false); expect(instances).toHaveLength(0);
  const tracker = await create(); expect(instances).toHaveLength(1); await tracker.close();
});

test("network errors, missing APIs and timed-out script downloads are retryable", async () => {
  const failed = api.createLegacyPoseTracker(); const firstError = expect(failed).rejects.toMatchObject({ code: "script-load" });
  script().dispatchEvent(new Event("error")); await firstError; expect(script()).toBeNull();
  vi.stubGlobal("Holistic", undefined);
  const missing = api.createLegacyPoseTracker(); const missingError = expect(missing).rejects.toMatchObject({ code: "script-api" });
  script().dispatchEvent(new Event("load")); await missingError;
  const timed = api.createLegacyPoseTracker(); const timeoutError = expect(timed).rejects.toMatchObject({ code: "script-timeout" });
  await vi.advanceTimersByTimeAsync(30000); await timeoutError; expect(script()).toBeNull();
  vi.stubGlobal("Holistic", Holistic); const retry = await create(); await retry.close();
});

test("cancelling one shared script waiter leaves another explicit request usable", async () => {
  const controller = new AbortController();
  const first = api.createLegacyPoseTracker({ signal: controller.signal });
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  const second = api.createLegacyPoseTracker(); const shared = script();
  expect(document.querySelectorAll('script[src*="@mediapipe/holistic@"]').length).toBe(1);
  controller.abort(); await rejected; expect(shared.isConnected).toBe(true);
  shared.dispatchEvent(new Event("load")); const tracker = await second;
  expect(instances).toHaveLength(1); await tracker.close();
});

test("a synchronous script insertion error does not poison the subsequent retry", async () => {
  vi.spyOn(document.head, "appendChild").mockImplementationOnce(() => { throw new Error("page refused script"); });
  await expect(api.createLegacyPoseTracker()).rejects.toMatchObject({ code: "script-load" });
  const tracker = await create(); await tracker.close(); expect(instances).toHaveLength(1);
});

test("invalid timeout overrides fail before any script is loaded", async () => {
  for (const value of [0, -1, 60001, Infinity, "100", .5]) await expect(api.createLegacyPoseTracker({ initializationTimeoutMs: value })).rejects.toMatchObject({ code: "timeout-option" });
  await expect(api.createLegacyPoseTracker({ frameTimeoutMs: Infinity })).rejects.toMatchObject({ code: "timeout-option" });
  expect(script()).toBeNull(); expect(instances).toHaveLength(0);
});
