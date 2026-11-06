import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePoseTracking } from "../../src/hooks/usePoseTracking.js";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../src/lib/poseTracker.js", () => ({
  loadPoseTracker: (...args) => mocks.load(...args),
  POSE_TRACKER_MODEL_URL: "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task",
}));
let queued, tracker, video;
beforeEach(() => {
  vi.clearAllMocks();
  tracker = { detectForVideo: vi.fn(() => ({ poseLandmarks: [] })), close: vi.fn() };
  mocks.load.mockResolvedValue(tracker);
  video = { readyState: 2, videoWidth: 640, videoHeight: 480, paused: false, ended: false, currentTime: 0 };
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => { queued = callback; return 7; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("tracking attaches actual frame geometry and keeps prior frame metadata detached", async () => {
  const onFrame = vi.fn(), videoRef = { current: video };
  const app = renderHook(({ active }) => usePoseTracking({ active, videoRef, onFrame }), { initialProps: { active: true } });
  await act(async () => {});
  act(() => queued(0));
  expect(onFrame).toHaveBeenCalledOnce();
  expect(onFrame.mock.calls[0][2]).toMatchObject({ width: 640, height: 480, mirrorApplied: false, tracker: "mediapipe-tasks-holistic", sampleIntervalMs: 125 });
  video.videoWidth = 1280; video.videoHeight = 720; video.currentTime = .125;
  act(() => queued(125));
  expect(onFrame.mock.calls[1][2]).toMatchObject({ width: 1280, height: 720 });
  expect(onFrame.mock.calls[0][2].width).toBe(640);
  expect(tracker.detectForVideo.mock.calls[0][0]).toBe(video);
  app.rerender({ active: false });
  expect(tracker.close).toHaveBeenCalledOnce();
});

test("an incomplete video size never fabricates the requested widescreen geometry", async () => {
  video.videoHeight = 0;
  const onFrame = vi.fn(), videoRef = { current: video };
  renderHook(() => usePoseTracking({ active: true, videoRef, onFrame }));
  await act(async () => {});
  act(() => queued(0));
  expect(onFrame).not.toHaveBeenCalled();
  expect(tracker.detectForVideo).not.toHaveBeenCalled();
});
