import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrainedSignMode from "../../src/modes/TrainedSignMode.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";

const mock = vi.hoisted(() => ({ video: null, trained: null, cameraState: "off", cameraActive: false,
  predict: vi.fn(), cancel: vi.fn(), speak: vi.fn(), stopSpeech: vi.fn(), ask: vi.fn(), save: vi.fn() }));
vi.mock("../../src/components/SignVideoInput.jsx", () => ({ default: (props) => { mock.video = props; return <div data-testid="video-input" />; } }));
vi.mock("../../src/components/GuidedSignPractice.jsx", () => ({ default: () => null }));
vi.mock("../../src/components/BridgeScene.jsx", () => ({ default: () => null }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useRef } = await import("react");
  return { useCamera: ({ active }) => { mock.cameraActive = active; return { videoRef: useRef(null), status: mock.cameraState, frameHealth: "unknown", devices: [] }; } };
});
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: () => ({ status: "idle" }) }));
vi.mock("../../src/hooks/useWordRecognitionModel.js", () => ({ useWordRecognitionModel: () => mock.trained }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], loading: false, error: "" }) }));
vi.mock("../../src/hooks/useTrainingSamples.js", () => ({ useTrainingSamples: () => ({ samples: [], loading: false, add: mock.save }) }));
vi.mock("../../src/lib/api.js", () => ({ askSign: mock.ask, checkSignAI: () => new Promise(() => {}) }));
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, createSpeaker: () => ({ speak: mock.speak, cancel: mock.stopSpeech }) }));

const props = { settings: DEFAULT_SETTINGS, update: () => {}, onBack: () => {}, onLive: () => {} };
const click = (name) => fireEvent.click(screen.getByRole("button", { name, exact: true }));
const setup = () => { const app = render(<TrainedSignMode {...props} />); click("Sign video"); return app; };
const sequence = () => Array.from({ length: 8 }, (_, i) => ({ atMs: i * 125, keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(1) }));
const complete = (withVoice = true) => {
  act(() => { mock.video.onStart(); mock.video.onBusyChange(true); });
  act(() => { mock.video.onBusyChange(false); mock.video.onComplete(sequence(), 1000, { withVoice }); });
};
beforeEach(() => {
  vi.clearAllMocks(); mock.cameraState = "off"; mock.cameraActive = false;
  mock.trained = { model: { labels: ["HELLO", "HELP"], signLanguage: "isl" }, status: "ready", async: false, predict: mock.predict, cancel: mock.cancel };
  mock.predict.mockReturnValue({ status: "recognized", meaning: "HELLO", feedback: "Check the meaning." });
  mock.speak.mockResolvedValue({ status: "ended" });
});
afterEach(cleanup);

test("video frames use the shared recognizer and produce accepted text plus one requested utterance", async () => {
  setup(); complete(); await act(async () => {});
  expect(mock.cameraActive).toBe(false);
  expect(mock.predict).toHaveBeenCalledExactlyOnceWith(sequence(), { durationMs: 1000 });
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELLO");
  expect(mock.speak).toHaveBeenCalledExactlyOnceWith("HELLO", expect.objectContaining({ lang: "en-IN" }));
  expect(screen.getByLabelText("Voice playback status").textContent).toMatch(/finished/);
  expect(screen.getByText(/Recognized from your selected video/)).toBeTruthy();
  expect(screen.queryByText("Save this turn for model training")).toBeNull();
  expect(mock.save).not.toHaveBeenCalled(); expect(mock.ask).not.toHaveBeenCalled();
});

test.each(["unclear", "no_sign"])("a %s video result is not converted into spoken HELLO", async (status) => {
  mock.predict.mockReturnValue({ status, meaning: "", feedback: "Try another complete sign." });
  setup(); complete(); await act(async () => {});
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  expect(mock.speak).not.toHaveBeenCalled(); expect(mock.ask).not.toHaveBeenCalled();
});

test("text-only video output stays silent and permits an explicit later Speak action", async () => {
  setup(); complete(false); await act(async () => {});
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELLO");
  expect(mock.speak).not.toHaveBeenCalled();
  click("Speak this word"); expect(mock.speak).toHaveBeenCalledOnce();
});

test("switching from the camera stops it while preserving the user's existing draft", () => {
  render(<TrainedSignMode {...props} />); click("Start camera"); expect(mock.cameraActive).toBe(true);
  fireEvent.change(screen.getByLabelText("Review or edit your message"), { target: { value: "Keep my message" } });
  click("Sign video"); expect(mock.cameraActive).toBe(false);
  expect(screen.getByLabelText("Review or edit your message").value).toBe("Keep my message");
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.speak).not.toHaveBeenCalled();
});

test("camera-off changes cannot cancel an asynchronous video result", async () => {
  let resolve; mock.trained.async = true; mock.predict.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const app = setup(); complete(); const cancellations = mock.cancel.mock.calls.length;
  mock.cameraState = "error"; app.rerender(<TrainedSignMode {...props} />);
  expect(mock.cancel).toHaveBeenCalledTimes(cancellations);
  await act(async () => resolve({ status: "recognized", meaning: "HELLO" }));
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELLO");
  expect(mock.speak).toHaveBeenCalledOnce();
});

test("switching source during inference discards the late result and voice", async () => {
  let resolve; mock.trained.async = true; mock.predict.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  setup(); complete(); click("Camera");
  await act(async () => resolve({ status: "recognized", meaning: "HELLO" }));
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(mock.speak).not.toHaveBeenCalled();
});

test("extraction locks message editing until it finishes or is cancelled", () => {
  setup(); act(() => { mock.video.onStart(); mock.video.onBusyChange(true); });
  expect(screen.getByLabelText("Review or edit your message").disabled).toBe(true);
  act(() => { mock.video.onBusyChange(false); mock.video.onCancel(); });
  expect(screen.getByLabelText("Review or edit your message").disabled).toBe(false);
  expect(mock.predict).not.toHaveBeenCalled();
});
