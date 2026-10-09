import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import RecognitionReplay from "../../src/components/RecognitionReplay.jsx";
import { legacyCameraModel } from "../helpers/legacyCamera.js";

const mock = vi.hoisted(() => ({ model: null, tracking: "ready", active: false, frame: null, videoRef: null, retry: vi.fn(), ai: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(), sequential: null, sequentialStart: vi.fn(), sequentialCancel: vi.fn() }));
vi.mock("../../src/hooks/useTrainedModel.js", () => ({ useTrainedModel: () => mock.model }));
vi.mock("../../src/hooks/usePoseTracking.js", async () => {
  const { useEffect } = await import("react");
  return { usePoseTracking: ({ videoRef, active, onFrame }) => {
    mock.frame = onFrame; mock.videoRef = videoRef;
    useEffect(() => { mock.active = active; return () => { mock.active = false; }; }, [active]);
    return { status: active ? mock.tracking : "idle", error: "Tracking unavailable", retry: mock.retry };
  } };
});
vi.mock("../../src/lib/api.js", () => ({ askSign: mock.ai, checkSignAI: mock.ai }));
vi.mock("../../src/hooks/useVideoPoseReplay.js", () => ({ useVideoPoseReplay: (callbacks) => {
  mock.sequential = callbacks;
  return { start: mock.sequentialStart, cancel: mock.sequentialCancel };
} }));

// A deliberately biased engineering fixture exercises the actual camera gate,
// pose conversion and learned-weight runner. It is not a sign-accuracy test.
const holistic = ({ hand = true, shoulders = true } = {}) => {
  const poseLandmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  poseLandmarks[11] = { x: .3, y: .5, z: 0, visibility: shoulders ? 1 : 0 };
  poseLandmarks[12] = { x: .7, y: .5, z: 0, visibility: shoulders ? 1 : 0 };
  const handLandmarks = Array.from({ length: 21 }, (_, index) => ({ x: .4 + (index % 5) * .01, y: .3 + Math.floor(index / 5) * .02, z: 0 }));
  return { poseLandmarks, leftHandLandmarks: hand ? handLandmarks : [], rightHandLandmarks: [] };
};

let play, pause, mediaTime, now, mediaDevicesDescriptor;
const button = (name) => screen.getByRole("button", { name });
const click = (name) => fireEvent.click(button(name));
const flush = async () => act(async () => {});
const setup = () => render(<RecognitionReplay signLanguage="asl" />);
const chooseVideo = (file = new File([new Uint8Array(128)], "private-person.mp4", { type: "video/mp4" })) => {
  if (!file.arrayBuffer) file.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(file.size < 1024 ? file.size : 0));
  fireEvent.change(screen.getByLabelText(/Reference video/), { target: { files: [file] } });
  return screen.queryByLabelText("Reference sign video");
};
const readyVideo = () => {
  const video = chooseVideo(); fireEvent.loadedMetadata(video); return video;
};
const start = async () => {
  await flush(); click("Run video through recognition"); await flush();
  if (mock.tracking === "ready") fireEvent.playing(screen.getByLabelText("Reference sign video"));
};
const emit = (count = 8, detected = holistic(), spacing = 125) => act(() => {
  for (let index = 0; index < count; index++) { now += spacing; mediaTime += spacing / 1000; mock.frame(detected, mock.videoRef.current); }
});
const baselineFile = (overrides = {}) => {
  const baseline = { format: "signbridge-recognition-baseline-v1", signLanguage: "asl", expectedLabel: "DRINK", modelSha256: "a".repeat(64), videoSha256: "b".repeat(64), prediction: { status: "recognized", topLabel: "DRINK", topScore: .99 }, ...overrides };
  const file = new File([JSON.stringify(baseline)], "reference.json", { type: "application/json" });
  file.text = vi.fn().mockResolvedValue(JSON.stringify(baseline)); return file;
};
const chooseBaseline = async (file = baselineFile()) => {
  fireEvent.change(screen.getByLabelText("Optional offline baseline JSON"), { target: { files: [file] } }); await flush();
};

beforeEach(() => {
  mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  vi.clearAllMocks(); mock.active = false; mock.frame = null; mock.videoRef = null; mock.tracking = "ready";
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xbb).buffer) } });
  mock.model = { status: "ready", model: legacyCameraModel(), sourceSha256: "a".repeat(64), retry: mock.retry };
  mock.sequential = null; mock.sequentialStart.mockResolvedValue(true);
  mock.createUrl.mockImplementation(() => `blob:local-replay-${mock.createUrl.mock.calls.length}`);
  URL.createObjectURL = mock.createUrl; URL.revokeObjectURL = mock.revokeUrl;
  mediaTime = 0; now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => mediaTime);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation((value) => { mediaTime = value; });
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(1);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(480);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  else delete navigator.mediaDevices;
});

test("opening the diagnostic starts no media, tracking, AI, uploads, storage or speech", () => {
  const fetch = vi.fn(), open = vi.fn(), speak = vi.fn(), getUserMedia = vi.fn();
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("indexedDB", { open }); vi.stubGlobal("speechSynthesis", { speak });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const save = vi.spyOn(Storage.prototype, "setItem");
  setup();
  expect(mock.active).toBe(false); expect(mock.createUrl).not.toHaveBeenCalled();
  expect(button("Run video through recognition").disabled).toBe(true);
  expect(screen.queryByLabelText("Reference sign video")).toBeNull();
  expect(play).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled(); expect(mock.ai).not.toHaveBeenCalled();
});

test("invalid or oversized video files are rejected before creating a local URL", () => {
  setup();
  for (const file of [new File(["x"], "notes.txt", { type: "text/plain" }), new File([], "empty.mp4", { type: "video/mp4" }), { name: "large.mp4", type: "video/mp4", size: 100 * 1024 * 1024 + 1 }]) {
    expect(chooseVideo(file)).toBeNull(); expect(screen.getByRole("alert")).toBeTruthy();
    expect(button("Run video through recognition").disabled).toBe(true); expect(mock.active).toBe(false);
  }
  expect(mock.createUrl).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
});

test("metadata and a loaded model are required; an unavailable model remains an explicit blocker", () => {
  mock.model = { status: "error", model: null, error: "Local research weights are unavailable.", retry: mock.retry };
  setup(); const video = chooseVideo();
  expect(button("Run video through recognition").disabled).toBe(true);
  fireEvent.loadedMetadata(video);
  expect(button("Run video through recognition").disabled).toBe(true);
  expect(screen.getByText(/Local research weights are unavailable/)).toBeTruthy();
  click("Retry local model"); expect(mock.retry).toHaveBeenCalledOnce();
  expect(mock.active).toBe(false); expect(play).not.toHaveBeenCalled();
});

test("overlong or nonfinite metadata cannot enable recognition", () => {
  setup(); const video = chooseVideo();
  const duration = vi.spyOn(HTMLMediaElement.prototype, "duration", "get");
  for (const value of [12.01, Infinity, NaN]) {
    duration.mockReturnValue(value); fireEvent.loadedMetadata(video);
    expect(button("Run video through recognition").disabled).toBe(true); expect(screen.getByRole("alert")).toBeTruthy();
  }
  expect(play).not.toHaveBeenCalled(); expect(mock.active).toBe(false);
});

test("real pose conversion and camera inference retain the predicted word even when the baseline expects another", async () => {
  setup(); const video = readyVideo(); await chooseBaseline();
  expect(screen.getByText("DRINK")).toBeTruthy();
  expect(button("Run video through recognition").disabled).toBe(false);
  await start(); expect(mock.active).toBe(true); expect(play).toHaveBeenCalledOnce();
  expect(video.muted).toBe(true); expect(video.playbackRate).toBe(1);
  emit(); fireEvent.ended(video);
  expect(mock.active).toBe(false); expect(pause).toHaveBeenCalled();
  expect(screen.getByText("Predicted word: BOOK")).toBeTruthy();
  expect(screen.getByLabelText("Replay result").textContent).toMatch(/8 tracked samples/);
  expect(screen.getByLabelText("Replay result").textContent).toMatch(/Top label differs/);
  expect(mock.ai).not.toHaveBeenCalled();
});

test.each([
  ["missing signing hands", () => emit(8, holistic({ hand: false })), /framing/],
  ["a real tracking gap", () => { emit(4); now += 1500; }, /tracking-gap/],
])("%s rejects before learned inference instead of accepting the biased fixture", async (_name, capture, reason) => {
  setup(); const video = readyVideo(); await start(); capture(); fireEvent.ended(video);
  const report = screen.getByLabelText("Replay result");
  expect(report.textContent).toContain("No word accepted");
  expect(report.textContent).toContain("Inference did not run"); expect(report.textContent).toMatch(reason);
  expect(report.textContent).not.toContain("Predicted word: BOOK");
});

test("cancel discards partial samples and stale ended events; only a new explicit run can predict", async () => {
  setup(); const video = readyVideo(); await start(); emit(4); const staleFrame = mock.frame;
  click("Cancel replay"); expect(mock.active).toBe(false); expect(pause).toHaveBeenCalled();
  act(() => { now += 125; staleFrame(holistic(), video); }); fireEvent.ended(video);
  expect(screen.queryByLabelText("Replay result")).toBeNull(); expect(button("Run video through recognition").disabled).toBe(false);
  await start(); emit(); fireEvent.ended(video);
  expect(screen.getByLabelText("Replay result").textContent).toContain("8 tracked samples");
});

test("replacing a video cancels tracking, discards old results and revokes each owned source on replacement/unmount", async () => {
  const app = setup(); readyVideo(); await start(); emit(4);
  const staleFrame = mock.frame; const replacement = chooseVideo(new File(["x"], "second.webm", { type: "video/webm" }));
  expect(mock.active).toBe(false); expect(mock.revokeUrl).toHaveBeenCalledWith("blob:local-replay-1");
  act(() => staleFrame(holistic(), replacement)); fireEvent.ended(replacement);
  expect(screen.queryByLabelText("Replay result")).toBeNull(); expect(button("Run video through recognition").disabled).toBe(true);
  app.unmount(); expect(mock.revokeUrl).toHaveBeenCalledWith("blob:local-replay-2"); expect(pause).toHaveBeenCalled();
});

test.each(["cancel", "replacement", "unmount"])("a late play rejection after %s cannot resurrect tracking or overwrite new state", async (action) => {
  let reject; play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const app = setup(); readyVideo(); await start();
  if (action === "cancel") click("Cancel replay");
  else if (action === "replacement") chooseVideo();
  else { pause.mockClear(); app.unmount(); expect(pause).toHaveBeenCalled(); }
  await act(async () => reject(new Error("old playback failed")));
  expect(mock.active).toBe(false); expect(screen.queryByText(/Video playback could not start/)).toBeNull();
  expect(screen.queryByLabelText("Replay result")).toBeNull();
});

test("tracking failure or a stalled playback stops the run and provides a retryable error", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const app = setup(); readyVideo(); await start(); emit(4);
  mock.tracking = "error"; app.rerender(<RecognitionReplay signLanguage="asl" />);
  expect(mock.active).toBe(false); expect(screen.getByRole("alert").textContent).toMatch(/Tracking unavailable/);
  mock.tracking = "ready"; await start();
  act(() => vi.advanceTimersByTime(12500));
  expect(mock.active).toBe(false); expect(screen.getByRole("alert").textContent).toMatch(/Playback stalled/);
  expect(screen.queryByLabelText("Replay result")).toBeNull();
});

test("tracking initialization cannot play a cancelled run when it eventually becomes ready", async () => {
  mock.tracking = "loading"; const app = setup(); const video = readyVideo(); await start();
  expect(mock.active).toBe(true); expect(play).not.toHaveBeenCalled();
  click("Cancel replay"); mock.tracking = "ready";
  app.rerender(<RecognitionReplay signLanguage="asl" />); await flush();
  expect(mock.active).toBe(false); expect(play).not.toHaveBeenCalled();
  fireEvent.ended(video); expect(screen.queryByLabelText("Replay result")).toBeNull();
});

test("an earlier pending fingerprint cannot enable a replacement video while its own fingerprint is still loading", async () => {
  let resolveFirst, resolveSecond;
  const first = new File(["one"], "first.mp4", { type: "video/mp4" });
  const second = new File(["two"], "second.mp4", { type: "video/mp4" });
  first.arrayBuffer = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));
  second.arrayBuffer = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSecond = resolve; }));
  setup(); chooseVideo(first); const video = chooseVideo(second); fireEvent.loadedMetadata(video);
  expect(button("Run video through recognition").disabled).toBe(true);
  await act(async () => resolveFirst(new ArrayBuffer(3)));
  expect(button("Run video through recognition").disabled).toBe(true); expect(play).not.toHaveBeenCalled();
  await act(async () => resolveSecond(new ArrayBuffer(3)));
  expect(button("Run video through recognition").disabled).toBe(false);
});

test("report download is explicit and excludes private video names and joint coordinates without uploading or speaking", async () => {
  const fetch = vi.fn(), open = vi.fn(), speak = vi.fn();
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("indexedDB", { open }); vi.stubGlobal("speechSynthesis", { speak });
  const save = vi.spyOn(Storage.prototype, "setItem");
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const app = setup(); const video = readyVideo(); await start(); emit(); fireEvent.ended(video);
  expect(mock.createUrl).toHaveBeenCalledOnce(); expect(anchor).not.toHaveBeenCalled();
  click("Download replay report"); expect(anchor).toHaveBeenCalledOnce();
  const exported = mock.createUrl.mock.calls[1][0]; expect(exported).toBeInstanceOf(Blob);
  const text = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(exported); });
  expect(text).not.toMatch(/private-person|keypoints|confidences|blob:|data:video/);
  expect(JSON.parse(text).prediction.meaning).toBe("BOOK");
  expect(fetch).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled(); expect(mock.ai).not.toHaveBeenCalled();
  app.unmount(); expect(mock.revokeUrl).toHaveBeenCalledWith("blob:local-replay-2");
});

test("oversized baseline files are not read and an earlier asynchronous selection cannot replace the latest baseline", async () => {
  setup(); const oversized = { size: 16385, text: vi.fn() }; await chooseBaseline(oversized);
  expect(oversized.text).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toMatch(/16 KB/);
  let resolve; const old = baselineFile(); old.text.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.change(screen.getByLabelText("Optional offline baseline JSON"), { target: { files: [old] } });
  await chooseBaseline(baselineFile({ expectedLabel: "BOOK" }));
  await act(async () => resolve(JSON.stringify({ format: "signbridge-recognition-baseline-v1", signLanguage: "asl", expectedLabel: "DRINK", modelSha256: "a".repeat(64), videoSha256: "b".repeat(64), prediction: { status: "recognized", topLabel: "DRINK", topScore: .99 } })));
  expect(screen.getByText("BOOK")).toBeTruthy(); expect(screen.queryByText("DRINK")).toBeNull();
});

test("sequential sampling keeps the realtime tracker off and uses source time despite a slow wall clock", async () => {
  setup(); readyVideo(); await chooseBaseline();
  fireEvent.change(screen.getByLabelText("Replay sampling"), { target: { value: "sequential-25fps" } });
  await start();
  expect(mock.sequentialStart).toHaveBeenCalledExactlyOnceWith({ fps: 25, trackerBackend: "tasks-holistic" });
  expect(mock.active).toBe(false); expect(play).not.toHaveBeenCalled();
  const callbacks = mock.sequential;
  act(() => {
    for (let index = 0; index < 25; index++) {
      now += 2000; callbacks.onFrame(holistic(), mock.videoRef.current, index * 40);
      callbacks.onProgress({ frameCount: index + 1, totalFrames: 25, atMs: index * 40, durationMs: 1000 });
    }
  });
  expect(screen.getByText(/Decoding source frames: 25 of 25 source samples/)).toBeTruthy();
  expect(screen.queryByLabelText("Replay result")).toBeNull();
  act(() => callbacks.onComplete({ durationMs: 1000, frameCount: 25 }));
  const report = screen.getByLabelText("Replay result");
  expect(report.textContent).toContain("Predicted word: BOOK");
  expect(report.textContent).toContain("25 tracked samples · 1.00 seconds");
  expect(report.textContent).toMatch(/Sampling: sequential-25fps.*source/);
  expect(report.textContent).toContain("Top label differs");
  expect(mock.ai).not.toHaveBeenCalled();
});

test("cancel stops sequential sampling and late frame, completion and error callbacks cannot publish a result", async () => {
  setup(); readyVideo();
  fireEvent.change(screen.getByLabelText("Replay sampling"), { target: { value: "sequential-25fps" } });
  await start(); const callbacks = mock.sequential;
  act(() => callbacks.onFrame(holistic(), mock.videoRef.current, 0));
  mock.sequentialCancel.mockClear(); click("Cancel replay");
  expect(mock.sequentialCancel).toHaveBeenCalledOnce(); expect(mock.active).toBe(false);
  act(() => {
    for (let index = 1; index < 25; index++) callbacks.onFrame(holistic(), mock.videoRef.current, index * 40);
    callbacks.onComplete({ durationMs: 1000, frameCount: 25 }); callbacks.onError(new Error("old runtime failure"));
  });
  expect(screen.queryByLabelText("Replay result")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
  expect(button("Run video through recognition").disabled).toBe(false); expect(play).not.toHaveBeenCalled();
});

test("a sequential decoding error releases the run, ignores late completion and allows an explicit retry", async () => {
  setup(); readyVideo();
  fireEvent.change(screen.getByLabelText("Replay sampling"), { target: { value: "sequential-25fps" } });
  await start(); const callbacks = mock.sequential; mock.sequentialCancel.mockClear();
  act(() => callbacks.onError(new Error("Video decoding paused for more than eight seconds.")));
  expect(mock.sequentialCancel).toHaveBeenCalledOnce(); expect(mock.active).toBe(false);
  expect(screen.getByRole("alert").textContent).toMatch(/Video decoding paused/);
  act(() => callbacks.onComplete({ durationMs: 1000, frameCount: 25 }));
  expect(screen.queryByLabelText("Replay result")).toBeNull();
  await start(); expect(mock.sequentialStart).toHaveBeenCalledTimes(2); expect(screen.queryByRole("alert")).toBeNull();
  expect(play).not.toHaveBeenCalled();
});

test("older tracker is an explicit sequential experiment and returning to realtime restores the camera tracker", async () => {
  setup(); readyVideo(); await flush();
  expect(screen.getByLabelText("Diagnostic tracker").value).toBe("tasks-holistic");
  fireEvent.change(screen.getByLabelText("Diagnostic tracker"), { target: { value: "solutions-holistic-experiment" } });
  expect(screen.getByLabelText("Replay sampling").value).toBe("sequential-25fps");
  await start();
  expect(mock.active).toBe(false);
  expect(mock.sequentialStart).toHaveBeenCalledExactlyOnceWith({ fps: 25, trackerBackend: "solutions-holistic-experiment" });
  expect(screen.getByLabelText("Diagnostic tracker").disabled).toBe(true);
  click("Cancel replay");
  fireEvent.change(screen.getByLabelText("Replay sampling"), { target: { value: "realtime-8hz" } });
  expect(screen.getByLabelText("Diagnostic tracker").value).toBe("tasks-holistic");
  expect(mock.ai).not.toHaveBeenCalled();
});
