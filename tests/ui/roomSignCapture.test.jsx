import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import RoomSignCapture from "../../src/components/RoomSignCapture.jsx";
import { legacyCameraModel } from "../helpers/legacyCamera.js";

const mock = vi.hoisted(() => ({ model: null, frame: null, tracking: "ready", predict: vi.fn(), retry: vi.fn(), append: vi.fn(), activity: vi.fn(), borrowed: null }));
vi.mock("../../src/hooks/useTrainedModel.js", () => ({ useTrainedModel: () => mock.model }));
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ videoRef, active, onFrame }) => {
  mock.borrowed = videoRef; mock.frame = onFrame;
  return { status: active ? mock.tracking : "idle", error: "Tracking unavailable", retry: mock.retry };
} }));
vi.mock("../../src/lib/trainedSignModel.js", async (original) => {
  const real = await original();
  return { ...real, poseFrameFromHolistic: (value) => value, predictTrainedSign: (...args) => {
    const result = mock.predict(...args);
    return { ...result, diagnostics: result.diagnostics ?? real.predictTrainedSign(...args).diagnostics };
  } };
});
const videoRef = { current: null };
const view = (props = {}) => <RoomSignCapture videoRef={videoRef} cameraStatus="on" signLanguage="isl" onAppend={mock.append} onActivityChange={mock.activity} {...props} />;
const click = (name) => fireEvent.click(screen.getByRole("button", { name }));
let now;
const emit = (count = 5) => act(() => {
  for (let i = 0; i < count; i++) { now += 125; mock.frame({ keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(1) }); }
});
const start = () => { emit(1); click("Capture a word"); };
beforeEach(() => {
  vi.clearAllMocks(); mock.tracking = "ready"; mock.borrowed = null;
  mock.append.mockReset();
  mock.model = { status: "ready", model: legacyCameraModel(), retry: mock.retry };
  mock.predict.mockReturnValue({ status: "recognized", meaning: "WATER", feedback: "Review this meaning", candidates: [] });
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("borrows the call video and infers only a finished turn; review is required before adding", () => {
  render(view()); expect(mock.borrowed).toBe(videoRef);
  emit(); expect(mock.predict).not.toHaveBeenCalled();
  click("Capture a word"); emit(); expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
  click(/^Finish sign/); expect(mock.predict).toHaveBeenCalledOnce(); expect(mock.predict.mock.calls[0][1]).toHaveLength(5);
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "WATER PLEASE" } });
  click("Add reviewed word to message"); expect(mock.append).toHaveBeenCalledWith({ text: "WATER PLEASE", lang: "en", inputMethod: "sign", signLanguage: "isl" });
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
});

test("recognized-word guidance explains local voice and partner draft actions without speaking or adding", () => {
  const read = vi.fn(); render(view({ onRead: read, canRead: true })); start(); emit(); click(/^Finish sign/);
  expect(screen.getByText(/Choose Speak reviewed word to hear it on this device/)).toBeTruthy();
  expect(screen.getByText(/Capture alone does not send a message or request an AI reply/)).toBeTruthy();
  expect(mock.append).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

test("added-word feedback clears when editing, selecting another candidate, or starting another capture", () => {
  mock.predict.mockReturnValue({ status: "recognized", meaning: "HELLO", feedback: "Review this meaning", candidates: [{ label: "THANK YOU", score: .5 }] });
  const reviewed = vi.fn(); render(view({ onReviewChange: reviewed })); start(); emit(); click(/^Finish sign/);
  const added = () => screen.queryByText(/Added to your partner message draft/);
  click("Add reviewed word to message"); expect(added()).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "HELLO THERE" } });
  expect(added()).toBeNull(); expect(reviewed).toHaveBeenCalledOnce();
  click("Add reviewed word to message"); expect(added()).toBeTruthy();
  click("THANK YOU"); expect(added()).toBeNull(); expect(reviewed).toHaveBeenCalledTimes(2);
  click("Add reviewed word to message"); expect(added()).toBeTruthy();
  start(); expect(added()).toBeNull(); expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
});

test("the room can clear added-word feedback after its draft changes or is sent", () => {
  const app = render(view({ addedToDraft: false })); start(); emit(); click(/^Finish sign/);
  click("Add reviewed word to message"); app.rerender(view({ addedToDraft: true }));
  expect(screen.getByText(/Added to your partner message draft/)).toBeTruthy();
  app.rerender(view({ addedToDraft: false }));
  expect(screen.queryByText(/Added to your partner message draft/)).toBeNull();
  expect(mock.append).toHaveBeenCalledOnce();
});

test("a rejected message addition preserves the reviewed word for editing and retry", () => {
  mock.append.mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(view()); start(); emit(); click(/^Finish sign/);
  const review = screen.getByLabelText("Review or correct the word");
  fireEvent.change(review, { target: { value: "WATER PLEASE" } });
  click("Add reviewed word to message");
  expect(mock.append).toHaveBeenCalledOnce();
  expect(review.value).toBe("WATER PLEASE");
  expect(screen.queryByText(/Added to your partner message draft/)).toBeNull();
  expect(screen.getByRole("alert").textContent).toMatch(/Shorten it/);
  expect(screen.getByRole("button", { name: "Add reviewed word to message" }).disabled).toBe(false);
  expect(mock.predict).toHaveBeenCalledOnce();
  click("Add reviewed word to message");
  expect(mock.append).toHaveBeenCalledTimes(2);
  expect(mock.append.mock.calls[1][0]).toMatchObject({ text: "WATER PLEASE", inputMethod: "sign", signLanguage: "isl" });
  expect(review.value).toBe("");
  expect(screen.getByText(/Added to your partner message draft/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("uncertain candidates remain an explicit manual choice", () => {
  mock.predict.mockReturnValue({ status: "uncertain", meaning: "", feedback: "Check alternatives", candidates: [{ label: "HELP", score: .3 }] });
  render(view({ signLanguage: "asl" })); start(); emit(); click(/^Finish sign/);
  expect(screen.getByRole("button", { name: "Add reviewed word to message" }).disabled).toBe(true); expect(mock.append).not.toHaveBeenCalled();
  click("HELP"); click("Add reviewed word to message"); expect(mock.append).toHaveBeenCalledWith(expect.objectContaining({ text: "HELP", signLanguage: "asl" }));
});

test("cancel, language changes and camera loss discard partial frames without inference", () => {
  const app = render(view()); start(); emit(2); click("Cancel capture"); expect(mock.predict).not.toHaveBeenCalled();
  start(); emit(3); app.rerender(view({ signLanguage: "asl" })); expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull();
  start(); emit(4); app.rerender(view({ signLanguage: "asl", cameraStatus: "error" }));
  expect(screen.getByRole("alert").textContent).toMatch(/Capture stopped/); expect(mock.predict).not.toHaveBeenCalled(); expect(mock.activity).toHaveBeenLastCalledWith(false);
});

test("capture stops at twelve seconds and bounds malformed samples without running inference", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); render(view()); start();
  act(() => { for (let i = 0; i < 150; i++) { now += 10; mock.frame({ keypoints: [], confidences: [] }); } });
  now += 12000; act(() => vi.advanceTimersByTime(100));
  expect(mock.predict).not.toHaveBeenCalled(); expect(screen.getByText(/100 pose samples · hands visible/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull(); expect(mock.activity).toHaveBeenLastCalledWith(false);
});

test("missing public weights explain availability and never start capture", () => {
  mock.model = { status: "error", model: null, retry: mock.retry }; render(view());
  expect(screen.getByText(/Local research weights are unavailable/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Capture a word" })).toBeNull();
  click("Check local model again"); expect(mock.retry).toHaveBeenCalledOnce(); expect(mock.predict).not.toHaveBeenCalled();
});

test("real hand joints remain visible without word weights, while inference and word capture stay unavailable", () => {
  mock.model = { status: "error", model: null, retry: mock.retry };
  render(view()); emit(1);
  expect(screen.getByRole("img", { name: /21 detected joints per hand/ })).toBeTruthy();
  const counts = screen.getByLabelText("Detected hand joints");
  expect(counts.textContent).toContain("Left hand: 21 / 21");
  expect(counts.textContent).toContain("Right hand: 21 / 21");
  expect(counts.textContent).toContain("Total: 42 / 42");
  expect(screen.getByText("Hand joints detected · word model unavailable")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Capture a word" })).toBeNull();
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
});

test("joint tracking continues while weights load and enables capture only after the model is ready", () => {
  mock.model = { status: "loading", model: null, retry: mock.retry };
  const app = render(view()); emit(1);
  expect(screen.getByLabelText("Detected hand joints").textContent).toContain("42 / 42");
  expect(screen.queryByRole("button", { name: "Capture a word" })).toBeNull();
  mock.model = { status: "ready", model: { labels: ["WATER"] }, retry: mock.retry };
  app.rerender(view());
  expect(screen.getByRole("button", { name: "Capture a word" }).disabled).toBe(false);
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
});

test("per-hand joint counts reject a wrist-only partial hand and clear when the camera stops", () => {
  const app = render(view());
  const pose = { keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(1) };
  pose.confidences.fill(0, 34, 54);
  act(() => mock.frame(pose));
  const counts = screen.getByLabelText("Detected hand joints");
  expect(counts.textContent).toContain("Left hand: 0 / 21");
  expect(counts.textContent).toContain("Right hand: 21 / 21");
  expect(counts.textContent).toContain("Total: 21 / 42");
  const numbers = screen.getByRole("checkbox", { name: "Show joint numbers (0–20)" });
  expect(numbers.checked).toBe(false); fireEvent.click(numbers); expect(numbers.checked).toBe(true);
  app.rerender(view({ cameraStatus: "off" }));
  expect(screen.queryByLabelText("Detected hand joints")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByRole("button", { name: "Capture a word" }).disabled).toBe(true);
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
});

test("unmount signals capture cancellation without touching shared media", () => {
  const app = render(view()); start(); emit(); app.unmount();
  expect(mock.activity).toHaveBeenLastCalledWith(false); expect(mock.predict).not.toHaveBeenCalled();
});

test("idle detections show hand and shoulder visibility without predicting or adding words", () => {
  render(view()); expect(screen.getByRole("button", { name: "Capture a word" }).disabled).toBe(true);
  const pose = { keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(0) };
  act(() => mock.frame(pose)); expect(screen.getByText(/0 hands tracked/)).toBeTruthy();
  expect(screen.queryByText(/Show your signing hand in good light/)).toBeNull();
  pose.confidences[11] = pose.confidences[12] = 1;
  act(() => mock.frame(pose)); expect(screen.getByText(/Show your signing hand in good light/)).toBeTruthy();
  pose.confidences.fill(1, 33, 54);
  act(() => mock.frame(pose)); expect(screen.getByText(/1 hand tracked/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Capture a word" }).disabled).toBe(false);
  pose.keypoints[34] = [.99, .5, 0];
  act(() => mock.frame(pose)); expect(screen.getByText(/hand is reaching the camera edge/)).toBeTruthy();
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
});

test("stale frames disable new captures and expose retry, then fresh frames restore readiness", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); render(view()); emit(1);
  now += 2100; act(() => vi.advanceTimersByTime(500));
  expect(screen.getByText("Tracking frames paused")).toBeTruthy();
  expect(screen.getByLabelText("Detected hand joints").textContent).toMatch(/Paused/);
  expect(screen.getByLabelText("Detected hand joints").textContent).not.toMatch(/42 \/ 42/);
  expect(screen.getByRole("button", { name: "Capture a word" }).disabled).toBe(true);
  click("Retry paused tracking"); expect(mock.retry).toHaveBeenCalledOnce();
  emit(1); expect(screen.queryByText("Tracking frames paused")).toBeNull();
  expect(screen.getByRole("button", { name: "Capture a word" }).disabled).toBe(false);
  expect(mock.predict).not.toHaveBeenCalled();
});

test("capture progress counts only explicit capture samples and missing hands remain a rejection", () => {
  mock.predict.mockReturnValue({ status: "no_sign", meaning: "", feedback: "No visible hands were captured.", candidates: [] });
  render(view()); emit(5); click("Capture a word");
  expect(screen.getByText(/0 pose samples captured/)).toBeTruthy();
  act(() => {
    for (let index = 0; index < 4; index++) {
      now += 125;
      mock.frame({ keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(0) });
    }
  });
  expect(screen.getByText(/4 pose samples captured/)).toBeTruthy();
  click(/^Finish sign/); expect(mock.predict).not.toHaveBeenCalled();
  expect(screen.getByText("No reliable word match")).toBeTruthy();
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  expect(screen.getByRole("button", { name: "Add reviewed word to message" }).disabled).toBe(true);
  expect(mock.append).not.toHaveBeenCalled();
});

test("Finish rejects a trailing tracking gap before inference and leaves manual review usable", () => {
  const read = vi.fn(); render(view({ onRead: read, canRead: true })); start(); emit(4);
  now += 1500; click(/^Finish sign/);
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  expect(screen.getByText(/Tracking paused for over one second/)).toBeTruthy();
  const review = screen.getByLabelText("Review or correct the word"); expect(review.value).toBe("");
  expect(screen.getByRole("button", { name: "Speak reviewed word" }).disabled).toBe(true);
  fireEvent.change(review, { target: { value: "MY REVIEWED MEANING" } });
  click("Speak reviewed word"); expect(read).toHaveBeenCalledWith({ text: "MY REVIEWED MEANING", lang: "en" });
  click("Add reviewed word to message"); expect(mock.append).toHaveBeenCalledWith(expect.objectContaining({ text: "MY REVIEWED MEANING" }));
});

test("separate hand-only and shoulder-only samples never become a room word prediction", () => {
  const read = vi.fn(); render(view({ onRead: read, canRead: true })); start();
  act(() => {
    for (let index = 0; index < 8; index++) {
      now += 125;
      const confidences = Array(75).fill(1);
      if (index === 0 || index > 4) confidences[11] = confidences[12] = 0;
      else confidences.fill(0, 33);
      mock.frame({ keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences });
    }
  });
  click(/^Finish sign/);
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  expect(screen.getByText(/visible for at least four samples/)).toBeTruthy();
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
});

test("a recognized sign stays silent until the reviewed word is explicitly spoken, without adding or sending it", () => {
  const read = vi.fn(); render(view({ onRead: read, canRead: true })); start(); emit(); click(/^Finish sign/);
  expect(read).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "WATER PLEASE" } });
  click("Speak reviewed word"); expect(read).toHaveBeenCalledWith({ text: "WATER PLEASE", lang: "en" });
  expect(mock.append).not.toHaveBeenCalled(); expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER PLEASE");
});

test("the room's diagnostic download preserves the reviewed word and never speaks or appends it", async () => {
  mock.predict.mockReturnValue({ status: "unclear", meaning: "", feedback: "Review this turn", candidates: [],
    diagnostics: { inferenceRan: true, reasonCodes: ["low-score"], model: { signLanguage: "asl", engine: "legacy", labelsCount: 100, threshold: .98, requiredMargin: .3, acceptanceEnabled: true },
      capture: { inputFrames: 5, handFrames: 5, shoulderFrames: 5, modelFrames: 32 },
      posterior: { topLabel: "CITY", topScore: .6, runnerUpLabel: "DRINK", runnerUpScore: .4, margin: .2 } } });
  const read = vi.fn(), blobs = [];
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return "blob:room-diagnostic"; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const app = render(view({ signLanguage: "asl", onRead: read, canRead: true }));
  try {
    start(); emit(); click(/^Finish sign/);
    const review = screen.getByLabelText("Review or correct the word");
    fireEvent.change(review, { target: { value: "PRIVATE REVIEWED MEANING" } });
    expect(blobs).toHaveLength(0);
    click("Download recognition report");
    expect(blobs).toHaveLength(1); expect(review.value).toBe("PRIVATE REVIEWED MEANING");
    const json = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blobs[0]); });
    const report = JSON.parse(json);
    expect(report.result.posterior.topLabel).toBe("CITY"); expect(report.result.model.signLanguage).toBe("asl");
    expect(report.captureQuality).toMatchObject({ count: 5, durationMs: 625, handFrames: 5, shoulderFrames: 5 });
    expect(json).not.toMatch(/PRIVATE|keypoints|confidences/);
    expect(mock.append).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(mock.predict).toHaveBeenCalledOnce();
  } finally { app.unmount(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test("an uncertain sign cannot speak an empty result, and selecting a suggestion still requires explicit speech", () => {
  mock.predict.mockReturnValue({ status: "uncertain", meaning: "", feedback: "Check alternatives", candidates: [{ label: "HELP", score: .3 }] });
  const read = vi.fn(); render(view({ onRead: read, canRead: true })); start(); emit(); click(/^Finish sign/);
  expect(screen.getByRole("button", { name: "Speak reviewed word" }).disabled).toBe(true); expect(read).not.toHaveBeenCalled();
  click("HELP"); expect(read).not.toHaveBeenCalled(); click("Speak reviewed word"); expect(read).toHaveBeenCalledWith({ text: "HELP", lang: "en" }); expect(mock.append).not.toHaveBeenCalled();
});

test("speech unavailability leaves word review and manual message addition usable", () => {
  const read = vi.fn(); render(view({ onRead: read, canRead: false })); start(); emit(); click(/^Finish sign/);
  expect(screen.queryByRole("button", { name: "Speak reviewed word" })).toBeNull(); click("Add reviewed word to message");
  expect(mock.append).toHaveBeenCalledWith(expect.objectContaining({ text: "WATER", lang: "en" })); expect(read).not.toHaveBeenCalled();
});

test("active reviewed-word playback has a stop action and cleanup cancels only its own pending playback", () => {
  const read = vi.fn().mockReturnValue(new Promise(() => {})), stopReading = vi.fn();
  const props = { onRead: read, canRead: true, onStopReading: stopReading };
  const app = render(view(props)); start(); emit(); click(/^Finish sign/);
  expect(stopReading).not.toHaveBeenCalled(); click("Speak reviewed word");
  app.rerender(view({ ...props, speaking: true })); expect(screen.getByRole("button", { name: "Speak reviewed word" }).disabled).toBe(true);
  click("Stop word playback"); expect(stopReading).toHaveBeenCalledOnce();
  app.unmount(); expect(stopReading).toHaveBeenCalledTimes(2); expect(mock.append).not.toHaveBeenCalled();
});

test("changing sign language cancels its pending spoken word and clears the old review", () => {
  const read = vi.fn().mockReturnValue(new Promise(() => {})), stopReading = vi.fn();
  const props = { onRead: read, canRead: true, onStopReading: stopReading };
  const app = render(view(props)); start(); emit(); click(/^Finish sign/); click("Speak reviewed word");
  app.rerender(view({ ...props, signLanguage: "asl", speaking: true }));
  expect(stopReading).toHaveBeenCalledOnce(); expect(screen.queryByLabelText("Review or correct the word")).toBeNull(); expect(mock.append).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
});
