import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useHandTracking } from "../../src/hooks/useHandTracking.js";
const mocks = vi.hoisted(() => ({ load: vi.fn(), slow: vi.fn() }));
vi.mock("../../src/lib/handTracker.js", () => ({ loadGestureRecognizer: mocks.load, markGpuSlow: mocks.slow }));
let queue, id, now, video, callback;
beforeEach(() => {
  vi.clearAllMocks(); queue = new Map(); id = 0; now = 1000;
  vi.stubGlobal("requestAnimationFrame", (fn) => { queue.set(++id, fn); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key) => queue.delete(key));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  video = { currentTime: 0, readyState: 4, videoWidth: 640 }; callback = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tick = () => act(() => { video.currentTime += .03; now += 30; const [key, fn] = [...queue][0]; queue.delete(key); fn(); });

test("slow GPU recognition switches once to CPU and displays the current delegate", async () => {
  const gpu = { recognizeForVideo: () => { now += 200; return { landmarks: [] }; } };
  const cpu = { recognizeForVideo: () => ({ landmarks: [] }) };
  mocks.load.mockResolvedValueOnce({ recognizer: gpu, delegate: "GPU" }).mockResolvedValue({ recognizer: cpu, delegate: "CPU" });
  const videoRef = { current: video };
  const { result } = renderHook(() => useHandTracking({ videoRef, active: true, onFrame: callback }));
  await act(async () => {});
  for (let i = 0; i < 7; i++) tick();
  await act(async () => {});
  expect(mocks.slow).toHaveBeenCalledOnce(); expect(result.current.delegate).toBe("CPU");
  tick(); expect(callback).toHaveBeenCalledTimes(8);
});

test("repeated model failures stop the loop and show retry instead of reporting stale FPS", async () => {
  mocks.load.mockResolvedValue({ recognizer: { recognizeForVideo() { throw new Error("Runtime failure"); } }, delegate: "CPU" });
  const videoRef = { current: video };
  const { result } = renderHook(() => useHandTracking({ videoRef, active: true, onFrame: callback }));
  await act(async () => {}); for (let i = 0; i < 30; i++) tick();
  expect(result.current.status).toBe("error"); expect(result.current.fps).toBe(0);
  expect(queue.size).toBe(0); expect(callback).not.toHaveBeenCalled();
});

test("late model loading after unmount never starts a video loop", async () => {
  let resolve; mocks.load.mockImplementation(() => new Promise((r) => { resolve = r; }));
  const videoRef = { current: video };
  const { unmount } = renderHook(() => useHandTracking({ videoRef, active: true, onFrame: callback }));
  unmount();
  await act(async () => resolve({ recognizer: {}, delegate: "CPU" }));
  expect(queue.size).toBe(0); expect(callback).not.toHaveBeenCalled();
});
