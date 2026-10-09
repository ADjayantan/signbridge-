import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVideoPoseReplay } from "../../src/hooks/useVideoPoseReplay.js";

const mock = vi.hoisted(() => ({ load: vi.fn(), legacyLoad: vi.fn(), legacyImport: vi.fn() }));
vi.mock("../../src/lib/poseTracker.js", () => ({ loadPoseTracker: (...args) => mock.load(...args) }));
vi.mock("../../src/lib/legacyPoseTracker.js", () => {
  mock.legacyImport();
  return { loadLegacyPoseTracker: (...args) => mock.legacyLoad(...args) };
});

const createVideo = (duration = 1.96) => {
  const video = new EventTarget();
  let time = 0;
  Object.assign(video, { duration, readyState: 4, seeking: false, muted: false, srcObject: null, pause: vi.fn(), play: vi.fn(), decode: true, decodedTime: 0 });
  Object.defineProperty(video, "currentTime", { get: () => time, set: (value) => {
    time = value; video.seeking = true;
    if (video.decode) queueMicrotask(() => { video.decodedTime = value; video.seeking = false; video.dispatchEvent(new Event("seeked")); });
  } });
  return video;
};
let tracker, callbacks, video, videoRef;
const setup = () => renderHook(() => useVideoPoseReplay({ videoRef, ...callbacks }));
beforeEach(() => {
  vi.clearAllMocks(); video = createVideo(); videoRef = { current: video };
  tracker = { detectForVideo: vi.fn((frame, atMs) => ({ frameTime: frame.decodedTime, atMs })), close: vi.fn() };
  callbacks = { onFrame: vi.fn(), onComplete: vi.fn(), onError: vi.fn(), onProgress: vi.fn() };
  mock.load.mockResolvedValue(tracker);
  mock.legacyLoad.mockResolvedValue(tracker);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("opening the hook starts no tracker, video playback, camera, upload, storage or speech", () => {
  const fetch = vi.fn(), speak = vi.fn(), open = vi.fn();
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("speechSynthesis", { speak }); vi.stubGlobal("indexedDB", { open });
  const storage = vi.spyOn(Storage.prototype, "setItem");
  const app = setup();
  expect(mock.load).not.toHaveBeenCalled(); expect(video.play).not.toHaveBeenCalled(); expect(video.pause).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  app.unmount(); expect(mock.load).not.toHaveBeenCalled();
  expect(mock.legacyImport).not.toHaveBeenCalled(); expect(mock.legacyLoad).not.toHaveBeenCalled();
});

test.each([[1.96, 49], [2.28, 57]])("a %s-second file samples all %s source frames despite an arbitrarily slow wall clock", async (duration, count) => {
  video.duration = duration;
  let wall = 1000; vi.spyOn(performance, "now").mockImplementation(() => { wall += 1750; return wall; });
  const { result, unmount } = setup(); let completed;
  await act(async () => { completed = await result.current.start({ fps: 25 }); });
  expect(completed).toBe(true); expect(tracker.detectForVideo).toHaveBeenCalledTimes(count);
  expect(tracker.detectForVideo.mock.calls.map((call) => call[1])).toEqual(Array.from({ length: count }, (_, index) => index * 40));
  expect(callbacks.onFrame.mock.calls.map((call) => call[2])).toEqual(Array.from({ length: count }, (_, index) => index * 40));
  expect(callbacks.onFrame.mock.calls.every(([detected, frame, atMs]) => frame === video && Math.abs(detected.frameTime * 1000 - atMs) < .001)).toBe(true);
  expect(callbacks.onComplete).toHaveBeenCalledExactlyOnceWith({ durationMs: duration * 1000, frameCount: count });
  expect(callbacks.onProgress).toHaveBeenLastCalledWith({ durationMs: duration * 1000, frameCount: count, totalFrames: count, atMs: (count - 1) * 40 });
  expect(video.muted).toBe(true); expect(video.play).not.toHaveBeenCalled(); expect(tracker.close).toHaveBeenCalledOnce();
  expect(mock.load).toHaveBeenCalledOnce(); expect(mock.legacyImport).not.toHaveBeenCalled(); expect(mock.legacyLoad).not.toHaveBeenCalled();
  unmount(); expect(tracker.close).toHaveBeenCalledOnce(); expect(callbacks.onError).not.toHaveBeenCalled();
});

test("unsupported rates, duration, sample counts and live streams fail before loading the tracker", async () => {
  const { result } = setup();
  for (const [duration, fps, stream] of [[1, 0, null], [1, 31, null], [1, 2.5, null], [.34, 25, null], [12.01, 8, null], [Infinity, 8, null], [5, 25, null], [1, 25, {}]]) {
    video.duration = duration; video.srcObject = stream;
    let completed; await act(async () => { completed = await result.current.start({ fps }); });
    expect(completed).toBe(false);
  }
  expect(mock.load).not.toHaveBeenCalled(); expect(callbacks.onError).toHaveBeenCalledTimes(8);
  expect(tracker.detectForVideo).not.toHaveBeenCalled(); expect(callbacks.onComplete).not.toHaveBeenCalled();
});

test("cancelling a pending tracker closes a late resolved runtime without any frame callbacks", async () => {
  let resolve; mock.load.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result } = setup(); let completion;
  act(() => { completion = result.current.start(); });
  const cancelled = mock.load.mock.calls[0][0]; expect(cancelled()).toBe(false);
  act(() => result.current.cancel()); expect(cancelled()).toBe(true);
  await act(async () => { resolve(tracker); await completion; });
  expect(tracker.close).toHaveBeenCalledOnce(); expect(tracker.detectForVideo).not.toHaveBeenCalled();
  expect(callbacks.onFrame).not.toHaveBeenCalled(); expect(callbacks.onComplete).not.toHaveBeenCalled(); expect(callbacks.onError).not.toHaveBeenCalled();
});

test("cancel during a pending seek removes listeners and suppresses late seek events and the timeout", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); video.decode = false;
  const add = vi.spyOn(video, "addEventListener"), remove = vi.spyOn(video, "removeEventListener");
  const { result } = setup(); let completion;
  await act(async () => { completion = result.current.start(); });
  expect(callbacks.onFrame).toHaveBeenCalledOnce(); // Source frame zero was already decoded.
  expect(video.seeking).toBe(true); expect(vi.getTimerCount()).toBe(1);
  act(() => result.current.cancel());
  await act(async () => { video.seeking = false; video.decodedTime = video.currentTime; video.dispatchEvent(new Event("seeked")); vi.advanceTimersByTime(8001); await completion; });
  expect(callbacks.onFrame).toHaveBeenCalledOnce(); expect(callbacks.onComplete).not.toHaveBeenCalled(); expect(callbacks.onError).not.toHaveBeenCalled();
  expect(tracker.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  expect(remove.mock.calls).toEqual(add.mock.calls);
});

test("a seeked event without decoded data does not run detection until loadeddata arrives", async () => {
  video.duration = .35; video.decode = false;
  const { result } = setup(); let completion;
  await act(async () => { completion = result.current.start({ fps: 3 }); });
  expect(callbacks.onFrame).toHaveBeenCalledOnce();
  video.readyState = 1; video.seeking = false;
  await act(async () => video.dispatchEvent(new Event("seeked")));
  expect(callbacks.onFrame).toHaveBeenCalledOnce();
  video.readyState = 2; video.decodedTime = video.currentTime;
  await act(async () => { video.dispatchEvent(new Event("loadeddata")); await completion; });
  expect(callbacks.onFrame).toHaveBeenCalledTimes(2); expect(callbacks.onComplete).toHaveBeenCalledExactlyOnceWith({ durationMs: 350, frameCount: 2 });
});

test.each(["timeout", "decode", "detector"])("%s failures release the runtime and provide one error without completion", async (failure) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); video.decode = false;
  if (failure === "detector") tracker.detectForVideo.mockImplementationOnce(() => { throw new Error("Runtime failed"); });
  const { result } = setup(); let completion;
  await act(async () => { completion = result.current.start(); });
  await act(async () => {
    if (failure === "timeout") vi.advanceTimersByTime(8000);
    if (failure === "decode") video.dispatchEvent(new Event("error"));
    await completion;
  });
  expect(callbacks.onError).toHaveBeenCalledOnce(); expect(callbacks.onComplete).not.toHaveBeenCalled();
  expect(tracker.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); expect(video.pause).toHaveBeenCalled();
});

test("starting a replacement run releases the earlier pending run and retains only the replacement callbacks", async () => {
  let resolveOld; mock.load.mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }));
  const oldTracker = { detectForVideo: vi.fn(), close: vi.fn() };
  const { result } = setup(); let oldCompletion;
  act(() => { oldCompletion = result.current.start(); });
  let newCompletion; await act(async () => { newCompletion = await result.current.start({ fps: 1 }); });
  expect(newCompletion).toBe(true); expect(callbacks.onFrame).toHaveBeenCalledTimes(2);
  await act(async () => { resolveOld(oldTracker); await oldCompletion; });
  expect(oldTracker.close).toHaveBeenCalledOnce(); expect(oldTracker.detectForVideo).not.toHaveBeenCalled();
  expect(callbacks.onComplete).toHaveBeenCalledOnce(); expect(callbacks.onFrame).toHaveBeenCalledTimes(2); expect(callbacks.onError).not.toHaveBeenCalled();
});

test("unmount cancels seeking, releases the owned detached video and blocks late callbacks", async () => {
  video.decode = false; const { result, unmount } = setup(); let completion;
  await act(async () => { completion = result.current.start(); });
  const start = result.current.start; video.pause.mockClear(); videoRef.current = null;
  unmount(); expect(video.pause).toHaveBeenCalled();
  await act(async () => { video.seeking = false; video.dispatchEvent(new Event("seeked")); await completion; });
  expect(tracker.close).toHaveBeenCalledOnce(); expect(callbacks.onFrame).toHaveBeenCalledOnce(); expect(callbacks.onComplete).not.toHaveBeenCalled(); expect(callbacks.onError).not.toHaveBeenCalled();
  expect(await start()).toBe(false); expect(mock.load).toHaveBeenCalledOnce();
});

test("changing the selected video while replay is active fails safely instead of mixing sources", async () => {
  callbacks.onFrame.mockImplementationOnce(() => { videoRef.current = createVideo(.5); });
  const { result } = setup(); let complete;
  await act(async () => { complete = await result.current.start(); });
  expect(complete).toBe(false); expect(callbacks.onFrame).toHaveBeenCalledOnce(); expect(callbacks.onComplete).not.toHaveBeenCalled();
  expect(callbacks.onError).toHaveBeenCalledOnce(); expect(callbacks.onError.mock.calls[0][0].message).toMatch(/selected video changed/);
  expect(tracker.close).toHaveBeenCalledOnce();
});

test("unknown tracker backends fail before importing or loading any detector", async () => {
  const { result } = setup();
  for (const trackerBackend of ["legacy", "unknown", null]) {
    let complete; await act(async () => { complete = await result.current.start({ trackerBackend }); });
    expect(complete).toBe(false);
  }
  expect(callbacks.onError).toHaveBeenCalledTimes(3); expect(mock.load).not.toHaveBeenCalled();
  expect(mock.legacyLoad).not.toHaveBeenCalled(); expect(mock.legacyImport).not.toHaveBeenCalled();
  expect(tracker.detectForVideo).not.toHaveBeenCalled(); expect(callbacks.onComplete).not.toHaveBeenCalled();
});

test("the explicit legacy experiment lazily loads only its backend and awaits every asynchronous source-frame result", async () => {
  video.duration = .35;
  tracker.detectForVideo.mockImplementation(async (frame, atMs) => {
    await Promise.resolve(); return { frameTime: frame.decodedTime, atMs };
  });
  const { result } = setup(); let complete;
  await act(async () => { complete = await result.current.start({ trackerBackend: "solutions-holistic-experiment" }); });
  expect(complete).toBe(true); expect(mock.legacyImport).toHaveBeenCalledOnce(); expect(mock.legacyLoad).toHaveBeenCalledOnce();
  expect(mock.load).not.toHaveBeenCalled(); expect(tracker.detectForVideo).toHaveBeenCalledTimes(9);
  expect(callbacks.onFrame.mock.calls.map(([detected, _video, atMs]) => [detected.atMs, atMs])).toEqual(Array.from({ length: 9 }, (_, index) => [index * 40, index * 40]));
  expect(callbacks.onComplete).toHaveBeenCalledExactlyOnceWith({ durationMs: 350, frameCount: 9 });
  expect(callbacks.onError).not.toHaveBeenCalled(); expect(tracker.close).toHaveBeenCalledOnce(); expect(video.play).not.toHaveBeenCalled();
});

test("cancelling a pending legacy loader closes its eventual runtime without selecting the default tracker", async () => {
  let resolve; mock.legacyLoad.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result } = setup(); let completion;
  await act(async () => { completion = result.current.start({ trackerBackend: "solutions-holistic-experiment" }); });
  const cancelled = mock.legacyLoad.mock.calls[0][0]; expect(cancelled()).toBe(false);
  act(() => result.current.cancel()); expect(cancelled()).toBe(true);
  await act(async () => { resolve(tracker); expect(await completion).toBe(false); });
  expect(tracker.close).toHaveBeenCalledOnce(); expect(tracker.detectForVideo).not.toHaveBeenCalled();
  expect(mock.load).not.toHaveBeenCalled(); expect(callbacks.onFrame).not.toHaveBeenCalled(); expect(callbacks.onComplete).not.toHaveBeenCalled(); expect(callbacks.onError).not.toHaveBeenCalled();
});

test.each(["cancel", "unmount"])("%s during asynchronous detection closes once and ignores the late result", async (action) => {
  let resolve; tracker.detectForVideo.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result, unmount } = setup(); let completion;
  await act(async () => { completion = result.current.start({ trackerBackend: "solutions-holistic-experiment" }); });
  expect(tracker.detectForVideo).toHaveBeenCalledOnce(); expect(callbacks.onFrame).not.toHaveBeenCalled();
  if (action === "cancel") act(() => result.current.cancel());
  else unmount();
  expect(tracker.close).toHaveBeenCalledOnce();
  await act(async () => { resolve({ atMs: 0 }); expect(await completion).toBe(false); });
  expect(tracker.close).toHaveBeenCalledOnce(); expect(callbacks.onFrame).not.toHaveBeenCalled(); expect(callbacks.onProgress).not.toHaveBeenCalled();
  expect(callbacks.onComplete).not.toHaveBeenCalled(); expect(callbacks.onError).not.toHaveBeenCalled();
});

test("an asynchronous detector rejection releases the experiment and reports one error without completing", async () => {
  tracker.detectForVideo.mockRejectedValueOnce(new Error("Legacy tracking failed."));
  const { result } = setup(); let complete;
  await act(async () => { complete = await result.current.start({ trackerBackend: "solutions-holistic-experiment" }); });
  expect(complete).toBe(false); expect(tracker.close).toHaveBeenCalledOnce();
  expect(callbacks.onError).toHaveBeenCalledOnce(); expect(callbacks.onError.mock.calls[0][0].message).toBe("Legacy tracking failed.");
  expect(callbacks.onFrame).not.toHaveBeenCalled(); expect(callbacks.onComplete).not.toHaveBeenCalled(); expect(mock.load).not.toHaveBeenCalled();
});

test("a legacy loader failure remains explicit instead of falling back to Tasks", async () => {
  mock.legacyLoad.mockRejectedValueOnce(new Error("Legacy runtime unavailable."));
  const { result } = setup(); let complete;
  await act(async () => { complete = await result.current.start({ trackerBackend: "solutions-holistic-experiment" }); });
  expect(complete).toBe(false); expect(callbacks.onError).toHaveBeenCalledOnce(); expect(callbacks.onError.mock.calls[0][0].message).toBe("Legacy runtime unavailable.");
  expect(mock.load).not.toHaveBeenCalled(); expect(tracker.detectForVideo).not.toHaveBeenCalled(); expect(callbacks.onComplete).not.toHaveBeenCalled();
});
