import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrainedSignMode from "../../src/modes/TrainedSignMode.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";

const mock = vi.hoisted(() => ({ frame: null, active: false, graphUnavailable: false, predict: vi.fn(), cancel: vi.fn(), retry: vi.fn(), speak: vi.fn(), stop: vi.fn(), check: vi.fn(), start: vi.fn() }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useRef } = await import("react");
  return { useCamera: ({ active }) => { mock.active = active; return { videoRef: useRef(null), status: active ? "on" : "off", devices: [], error: "", retry: vi.fn() }; } };
});
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ active, onFrame }) => { mock.frame = onFrame; return { status: active ? "ready" : "idle", error: "", retry: mock.retry }; } }));
vi.mock("../../src/hooks/useWordRecognitionModel.js", () => ({ useWordRecognitionModel: (_language, engine) => ({ engine, async: engine === "graph", status: engine === "graph" && mock.graphUnavailable ? "unavailable" : "ready", model: engine === "graph" && mock.graphUnavailable ? null : { labels: ["WATER", "HELP"] }, error: "No promoted graph model is installed", predict: mock.predict, cancel: mock.cancel, retry: vi.fn() }) }));
vi.mock("../../src/hooks/useSignSession.js", () => ({ useSignSession: () => ({ active: false, phase: "idle", log: [], error: "", start: mock.start, stopSpeech: mock.stop, end: vi.fn(), newConversation: vi.fn(), send: vi.fn(), interrupt: vi.fn(), speak: vi.fn(), speakReplies: false, setSpeakReplies: vi.fn() }) }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], error: "" }) }));
vi.mock("../../src/lib/api.js", () => ({ checkSignAI: mock.check }));
vi.mock("../../src/lib/trainedSignModel.js", () => ({ poseFrameFromHolistic: (pose) => pose }));
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, createSpeaker: () => ({ speak: mock.speak, cancel: mock.stop }) }));
vi.mock("../../src/lib/drawHands.js", () => ({ drawHands: vi.fn() }));
vi.mock("../../src/components/TrainingSampleForm.jsx", () => ({ default: () => null }));
vi.mock("../../src/components/SignVideoPlayer.jsx", () => ({ default: () => null }));

let now;
const setup = () => render(<TrainedSignMode settings={DEFAULT_SETTINGS} update={() => {}} onBack={() => {}} onLive={() => {}} />);
const button = (name) => screen.getByRole("button", { name });
const click = (name) => fireEvent.click(button(name));
const openAdvanced = () => {
  const summary = screen.getByText("Advanced settings", { selector: "summary", exact: true });
  const section = summary.closest("details");
  if (!section.open) fireEvent.click(summary);
  expect(section.open).toBe(true);
};
const draft = () => screen.getByLabelText("Review or edit your message");
const pose = () => {
  const keypoints = Array.from({ length: 75 }, () => [.5, .5, 0]); keypoints[11][0] = .4; keypoints[12][0] = .6;
  return { keypoints, confidences: Array(75).fill(1) };
};
const emit = (count = 1) => act(() => { for (let index = 0; index < count; index++) { now += 125; mock.frame(pose(), { videoWidth: 640, videoHeight: 480 }); } });
const pause = () => { now += 2100; act(() => vi.advanceTimersByTime(2100)); };
const word = { status: "recognized", meaning: "WATER", feedback: "Review the meaning", candidates: [] };

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
  mock.active = false; mock.frame = null; mock.graphUnavailable = false;
  mock.check.mockImplementation(() => new Promise(() => {})); mock.predict.mockReturnValue(word);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const emitPose = (value, advance = 125) => act(() => { now += advance; mock.frame(value, { videoWidth: 640, videoHeight: 480 }); });

test("fresh shoulders without a hand explain the blocked capture and preserve typed output", () => {
  setup(); fireEvent.change(draft(), { target: { value: "Typing still works" } }); click("Start camera");
  const noHands = pose(); noHands.confidences.fill(0, 33); emitPose(noHands);
  expect(button(/^Capture a sign/).disabled).toBe(true);
  expect(screen.getByText("Show your signing hand in good light before capturing.")).toBeTruthy();
  expect(screen.getByLabelText("Camera framing checks").textContent).toContain("Signing handsNot detected");
  expect(screen.getByLabelText("Camera framing checks").textContent).toContain("Both shouldersVisible");
  fireEvent.keyDown(window, { code: "Space", key: " " });
  expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull();
  expect(draft().value).toBe("Typing still works"); expect(draft().disabled).toBe(false);
  expect(button("Speak my message").disabled).toBe(false); expect(mock.predict).not.toHaveBeenCalled();
});

test("one complete hand with both shoulders enables capture; clipping is only guidance", () => {
  setup(); click("Start camera");
  const oneHand = pose(); oneHand.confidences.fill(0, 54); oneHand.keypoints[33][0] = .01; emitPose(oneHand);
  expect(button(/^Capture a sign/).disabled).toBe(false);
  expect(screen.getByLabelText("Camera framing checks").textContent).toContain("Signing hands1 detected");
  expect(screen.getByText("Leave more space: your hand is reaching the edge of the camera.")).toBeTruthy();
  fireEvent.keyDown(window, { code: "Space", key: " " });
  expect(button(/^Finish sign/).disabled).toBe(false); expect(mock.predict).not.toHaveBeenCalled();
  emit(4); click(/^Finish sign/); expect(mock.predict).toHaveBeenCalledOnce();
});

test("latest framing loss blocks a new turn and never blocks Finish or Cancel during one", () => {
  setup(); click("Start camera"); emit();
  const noShoulders = pose(); noShoulders.confidences[11] = 0; noShoulders.confidences[12] = 0;
  emitPose(noShoulders);
  expect(button(/^Capture a sign/).disabled).toBe(true);
  expect(screen.getByLabelText("Camera framing checks").textContent).toContain("Both shouldersNot detected");
  fireEvent.keyDown(window, { code: "Space", key: " " });
  expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull();
  emit(); click(/^Capture a sign/); emitPose(noShoulders);
  expect(button(/^Finish sign/).disabled).toBe(false); expect(button("Cancel turn").disabled).toBe(false);
  click("Cancel turn"); expect(mock.predict).not.toHaveBeenCalled(); expect(button(/^Capture a sign/).disabled).toBe(true);
});

test("a ready tracking task waits for a measured frame before button or keyboard capture", () => {
  setup(); fireEvent.change(draft(), { target: { value: "Keep my reviewed message" } }); click("Start camera");
  expect(screen.getByText("Waiting for the first tracking frame…")).toBeTruthy();
  expect(button(/^Capture a sign/).disabled).toBe(true);
  fireEvent.keyDown(window, { code: "Space", key: " " });
  expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull(); expect(mock.predict).not.toHaveBeenCalled();
  emit(); expect(button(/^Capture a sign/).disabled).toBe(false); expect(screen.getByText("42 hand joints tracked")).toBeTruthy();
  expect(draft().value).toBe("Keep my reviewed message"); expect(mock.active).toBe(true); expect(mock.speak).not.toHaveBeenCalled();
});

test("stale frames stop claiming live joints and fresh recovery preserves the review, draft and camera", () => {
  setup(); click("Start camera"); emit(); click(/^Capture a sign/); emit(4); click(/^Finish sign/);
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "HELP" } });
  fireEvent.change(draft(), { target: { value: "My existing message" } });
  pause(); expect(screen.getByText("Hand-joint tracking paused")).toBeTruthy(); expect(screen.queryByText("42 hand joints tracked")).toBeNull();
  expect(button(/^Capture a sign/).disabled).toBe(true); expect(button("Retry paused tracking").disabled).toBe(false);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELP"); expect(draft().value).toBe("My existing message"); expect(mock.active).toBe(true);
  emit(); expect(screen.queryByText("Hand-joint tracking paused")).toBeNull(); expect(button(/^Capture a sign/).disabled).toBe(false);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELP"); expect(draft().value).toBe("My existing message");
  expect(mock.predict).toHaveBeenCalledOnce(); expect(mock.speak).not.toHaveBeenCalled();
});

test("tracking retry waits for new frames while keeping the camera and typed message", () => {
  setup(); click("Start camera"); fireEvent.change(draft(), { target: { value: "Typed conversation" } }); pause();
  click("Retry paused tracking"); expect(mock.retry).toHaveBeenCalledOnce(); expect(mock.active).toBe(true);
  expect(button(/^Capture a sign/).disabled).toBe(true); expect(screen.getByText("Waiting for the first tracking frame…")).toBeTruthy();
  expect(draft().value).toBe("Typed conversation"); emit(); expect(button(/^Capture a sign/).disabled).toBe(false);
  expect(mock.predict).not.toHaveBeenCalled();
});

test.each(["Finish", "Space", "Cancel"])("%s stays usable if frames pause during an explicit capture", (action) => {
  mock.predict.mockReturnValue({ status: "no_sign", meaning: "", feedback: "Tracking paused; capture a new complete word", candidates: [] });
  setup(); fireEvent.change(draft(), { target: { value: "Existing draft" } }); click("Start camera"); emit(); click(/^Capture a sign/); emit(2); pause();
  expect(button(/^Finish sign/).disabled).toBe(false); expect(button("Cancel turn").disabled).toBe(false); expect(button("Retry paused tracking").disabled).toBe(true);
  expect(mock.predict).not.toHaveBeenCalled();
  if (action === "Finish") click(/^Finish sign/);
  else if (action === "Space") fireEvent.keyDown(window, { code: "Space", key: " " });
  else click("Cancel turn");
  expect(mock.predict).toHaveBeenCalledTimes(action === "Cancel" ? 0 : 1);
  if (action !== "Cancel") expect(mock.predict.mock.calls[0][0]).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull(); expect(button(/^Capture a sign/).disabled).toBe(true);
  expect(draft().value).toBe("Existing draft"); expect(mock.active).toBe(true); expect(mock.speak).not.toHaveBeenCalled();
});

test("unavailable word weights still show fresh joints and editable typing without enabling capture", () => {
  mock.graphUnavailable = true; setup(); click("Start camera");
  openAdvanced();
  fireEvent.change(screen.getByLabelText("Word recognition model", { exact: false }), { target: { value: "graph" } }); emit();
  expect(screen.getByText("No promoted graph model is installed")).toBeTruthy(); expect(screen.getByText("42 hand joints tracked")).toBeTruthy();
  expect(button(/^Capture a sign/).disabled).toBe(true); expect(draft().disabled).toBe(false);
  pause(); expect(screen.getByText("Hand-joint tracking paused")).toBeTruthy(); emit(); expect(screen.getByText("42 hand joints tracked")).toBeTruthy();
  expect(button(/^Capture a sign/).disabled).toBe(true); expect(mock.predict).not.toHaveBeenCalled(); expect(mock.speak).not.toHaveBeenCalled();
});

test("a pending graph turn stays cancellable during paused frames and its late result cannot replace the draft", async () => {
  let resolve; mock.predict.mockReturnValue(new Promise((yes) => { resolve = yes; }));
  setup(); fireEvent.change(draft(), { target: { value: "Reviewed before capture" } }); click("Start camera");
  openAdvanced();
  fireEvent.change(screen.getByLabelText("Word recognition model", { exact: false }), { target: { value: "graph" } }); emit(); click(/^Capture a sign/); emit(4); click(/^Finish sign/); pause();
  expect(screen.getByText("Recognising your completed turn…")).toBeTruthy(); expect(button("Cancel recognition").disabled).toBe(false);
  click("Cancel recognition"); await act(async () => { resolve(word); });
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull(); expect(draft().value).toBe("Reviewed before capture");
  expect(mock.active).toBe(true); expect(mock.speak).not.toHaveBeenCalled(); expect(button(/^Capture a sign/).disabled).toBe(true);
});

test("leaving the workspace removes its freshness deadline without leaving camera callbacks active", () => {
  const app = setup(); click("Start camera"); emit(); expect(vi.getTimerCount()).toBeGreaterThan(0);
  app.unmount(); pause(); expect(vi.getTimerCount()).toBe(0);
  emit(); expect(vi.getTimerCount()).toBe(0); expect(mock.predict).not.toHaveBeenCalled();
});
