import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePoseTracking } from "../../src/hooks/usePoseTracking.js";

const mocks = vi.hoisted(() => ({ simd: vi.fn(), create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({ FilesetResolver: { isSimdSupported: mocks.simd }, HolisticLandmarker: { createFromOptions: mocks.create } }));
let queue, identifier, clock, video, task, onFrame;
beforeEach(() => {
  vi.clearAllMocks(); queue = new Map(); identifier = 0; clock = 1000;
  vi.stubGlobal("requestAnimationFrame", (callback) => { queue.set(++identifier, callback); return identifier; });
  vi.stubGlobal("cancelAnimationFrame", (id) => queue.delete(id));
  video = { currentTime: 0, readyState: 4, videoWidth: 640, paused: false, ended: false };
  task = { detectForVideo: vi.fn().mockReturnValue({ poseLandmarks: [], leftHandLandmarks: [], rightHandLandmarks: [] }), close: vi.fn() };
  mocks.simd.mockResolvedValue(true); mocks.create.mockResolvedValue(task); onFrame = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tick = (advance = .15) => act(() => {
  video.currentTime += advance; clock += 150;
  const [id, callback] = [...queue][0]; queue.delete(id); callback(clock);
});

test("turning tracking off before WASM capability detection finishes never creates a model or opens a camera", async () => {
  let resolve; mocks.simd.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const stop = vi.fn(); video.srcObject = { getTracks: () => [{ stop }] }; const videoRef = { current: video };
  const { result, rerender } = renderHook(({ active }) => usePoseTracking({ videoRef, active, onFrame }), { initialProps: { active: true } }); await act(async () => {});
  rerender({ active: false }); await act(async () => resolve(true));
  expect(mocks.create).not.toHaveBeenCalled(); expect(queue.size).toBe(0); expect(stop).not.toHaveBeenCalled(); expect(result.current.status).toBe("idle");
});
test("a model resolving after tracking is disabled is closed once without starting the loop or stopping call video", async () => {
  let resolve; mocks.create.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const stop = vi.fn(); video.srcObject = { getTracks: () => [{ stop }] }; const videoRef = { current: video };
  const { rerender, unmount } = renderHook(({ active }) => usePoseTracking({ videoRef, active, onFrame }), { initialProps: { active: true } }); await act(async () => {});
  rerender({ active: false }); await act(async () => resolve(task)); unmount();
  expect(task.close).toHaveBeenCalledOnce(); expect(queue.size).toBe(0); expect(onFrame).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
});
test("repeated runtime failures release the failed model and expose retry while preserving the camera stream", async () => {
  task.detectForVideo.mockImplementation(() => { throw new Error("Model runtime failed"); }); const stop = vi.fn(); video.srcObject = { getTracks: () => [{ stop }] };
  const videoRef = { current: video }; const { result, unmount } = renderHook(() => usePoseTracking({ videoRef, active: true, onFrame })); await act(async () => {});
  for (let index = 0; index < 8; index++) tick();
  expect(result.current.status).toBe("error"); expect(result.current.error).toMatch(/tracking stopped/); expect(task.close).toHaveBeenCalledOnce(); expect(queue.size).toBe(0); expect(stop).not.toHaveBeenCalled();
  const replacement = { detectForVideo: vi.fn().mockReturnValue({ poseLandmarks: [] }), close: vi.fn() }; mocks.create.mockResolvedValue(replacement);
  await act(async () => result.current.retry()); tick(); expect(result.current.status).toBe("ready"); expect(onFrame).toHaveBeenCalledOnce(); expect(replacement.detectForVideo).toHaveBeenCalledOnce(); unmount(); expect(task.close).toHaveBeenCalledOnce(); expect(replacement.close).toHaveBeenCalledOnce();
});
test("tracking skips paused and repeated video frames and forwards fresh results to the latest capture callback", async () => {
  const videoRef = { current: video }; const { rerender } = renderHook(({ callback }) => usePoseTracking({ videoRef, active: true, onFrame: callback }), { initialProps: { callback: onFrame } }); await act(async () => {});
  video.paused = true; tick(); expect(task.detectForVideo).not.toHaveBeenCalled();
  video.paused = false; tick(); expect(task.detectForVideo).toHaveBeenCalledOnce(); expect(onFrame).toHaveBeenCalledWith(expect.any(Object), video);
  tick(0); expect(task.detectForVideo).toHaveBeenCalledOnce();
  const next = vi.fn(); rerender({ callback: next }); tick(); expect(mocks.create).toHaveBeenCalledOnce(); expect(next).toHaveBeenCalledOnce(); expect(onFrame).toHaveBeenCalledOnce();
});
