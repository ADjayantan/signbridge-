import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrainedSignMode from "../../src/modes/TrainedSignMode.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";
import { legacyCameraModel } from "../helpers/legacyCamera.js";
import { validateCameraTurn } from "../../src/lib/graphSignModel.js";

// Camera/tracker and learned output are synthetic; the real automatic segmenter,
// coordinate adapter and camera-quality gates remain in this integration test.
const mocks = vi.hoisted(() => ({
  active: false, frame: null, cameraStatus: "on", frameHealth: "visible", trackingStatus: "ready", trained: null,
  predict: vi.fn(), speak: vi.fn(), stopSpeech: vi.fn(), retry: vi.fn(), ask: vi.fn(), check: vi.fn(),
  graphPredict: vi.fn(), graphCancel: vi.fn(), save: vi.fn(),
  graphModel: { acceptanceEnabled: true, labels: ["HELLO", "HELP"] },
}));
vi.mock("../../src/lib/drawHands.js", () => ({ drawHands: vi.fn() }));
vi.mock("../../src/components/RecognitionReplay.jsx", () => ({ default: () => <p>Reference replay</p> }));
vi.mock("../../src/lib/api.js", () => ({ askSign: mocks.ask, checkSignAI: mocks.check, interpretSignVideo: vi.fn() }));
vi.mock("../../src/hooks/useTrainingSamples.js", () => ({ useTrainingSamples: () => ({ samples: [], loading: false, error: "", add: mocks.save }) }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], loading: false, error: "" }) }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useRef } = await import("react");
  return { useCamera: ({ active }) => {
    mocks.active = active;
    return { videoRef: useRef(null), status: active ? mocks.cameraStatus : "off", frameHealth: active ? mocks.frameHealth : "unknown", devices: [], error: "Camera disconnected", retry: mocks.retry };
  } };
});
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ onFrame, active }) => {
  mocks.frame = onFrame;
  return { status: active ? mocks.trackingStatus : "idle", error: "Tracking unavailable", retry: mocks.retry };
} }));
vi.mock("../../src/hooks/useTrainedModel.js", () => ({ useTrainedModel: () => mocks.trained }));
vi.mock("../../src/hooks/useGraphSignModel.js", () => ({ useGraphSignModel: (_language, { enabled }) => ({
  status: enabled ? "ready" : "idle", model: enabled ? mocks.graphModel : null,
  error: "", predict: mocks.graphPredict, cancel: mocks.graphCancel, retry: mocks.retry,
}) }));
vi.mock("../../src/lib/trainedSignModel.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, poseFrameFromHolistic: (frame) => frame, predictTrainedSign: (...args) => {
    const next = mocks.predict(...args);
    return { ...next, diagnostics: next.diagnostics ?? real.predictTrainedSign(...args).diagnostics };
  } };
});
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, createSpeaker: () => ({ speak: mocks.speak, cancel: mocks.stopSpeech, busy: false }) }));

const props = () => ({ settings: DEFAULT_SETTINGS, update: () => {}, onBack: () => {}, onLive: () => {} });
const setup = (extra = {}) => render(<TrainedSignMode {...props()} {...extra} />);
const button = (name) => screen.getByRole("button", { name });
const click = (name) => fireEvent.click(button(name));
const automatic = () => screen.getByRole("switch", { name: /^Automatic sign capture/ });
const word = () => screen.getByLabelText("Review or correct the word");
const message = () => screen.getByLabelText("Review or edit your message");

// One complete tracked left hand moves relative to a fixed, well-framed body.
// It is deliberately not a representation of HELLO or any other real sign.
const pose = (handOffset = 0, { hands = true, shoulders = true } = {}) => {
  const keypoints = Array.from({ length: 75 }, () => [.5, .5, 0]);
  const confidences = Array(75).fill(1);
  keypoints[11] = [.3, .5, 0]; keypoints[12] = [.7, .5, 0];
  confidences[11] = confidences[12] = shoulders ? 1 : 0;
  for (let joint = 33; joint < 54; joint++) keypoints[joint] = [.4 + handOffset + (joint % 4) * .006, .4 + (joint % 5) * .008, 0];
  confidences.fill(0, 54);
  if (!hands) confidences.fill(0, 33);
  return { keypoints, confidences };
};
let now;
const emit = (offsets, options = {}) => act(() => {
  for (const offset of offsets) { now += 125; mocks.frame(pose(offset, options), { videoWidth: 640, videoHeight: 480 }); }
});
// Motion cases prime for less than the held-pose dwell interval.
const still = (count = 8, offset = 0) => emit(Array(count).fill(offset));
const move = () => emit([.04, .08, .12, .16, .12, .08, .04, 0]);
const completeMovement = () => { still(); move(); still(); };
const rerender = (app) => app.rerender(<TrainedSignMode {...props()} />);
const chooseGraph = () => {
  const advanced = screen.getByText("Advanced settings", { selector: "summary" }).closest("details");
  if (!advanced.open) fireEvent.click(advanced.querySelector("summary"));
  fireEvent.change(screen.getByRole("combobox", { name: /^Word recognition model/ }), { target: { value: "graph" } });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.active = false; mocks.frame = null; mocks.cameraStatus = "on"; mocks.frameHealth = "visible"; mocks.trackingStatus = "ready";
  mocks.trained = { status: "ready", model: { ...legacyCameraModel(), signLanguage: "isl", labels: ["HELLO", "HELP"] }, error: "", retry: mocks.retry };
  mocks.predict.mockReturnValue({ status: "recognized", meaning: "HELLO", glosses: ["HELLO"], feedback: "Review this synthetic prediction" });
  mocks.graphPredict.mockResolvedValue({ status: "recognized", meaning: "HELLO", glosses: ["HELLO"], feedback: "Review this synthetic graph prediction" });
  mocks.check.mockImplementation(() => new Promise(() => {}));
  mocks.ask.mockResolvedValue({ reply: "Hello" });
  mocks.save.mockResolvedValue({ id: "sample" });
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("automatic capture is visible and on by default; hand appearance before the dwell interval never becomes a word or speech", () => {
  setup();
  expect(automatic().checked).toBe(true);
  expect(automatic().closest("details")).toBeNull();
  click("Start camera"); still();
  expect(mocks.active).toBe(true);
  expect(screen.getByRole("switch", { name: /^Speak recognized words/ }).checked).toBe(false);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(mocks.speak).not.toHaveBeenCalled();
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("a stationary held-pose attempt runs once through model review; a rejected hold remains silent", () => {
  mocks.predict.mockReturnValue({ status: "unclear", meaning: "", glosses: [], feedback: "No reliable vocabulary match", candidates: [] });
  setup({ initialDestination: "ai" }); click("Start camera + read aloud"); still(32);
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(screen.getByText("No reliable word match")).toBeTruthy();
  expect(word().value).toBe("");
  const captured = mocks.predict.mock.calls[0][1];
  expect(captured.at(-1).atMs).toBeGreaterThanOrEqual(1200);
  expect(validateCameraTurn(captured, { durationMs: captured.at(-1).atMs }).ok).toBe(true);
  still(32);
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("a model-accepted held attempt shows and speaks once without drafting or sending to AI", () => {
  // Accepted learned output is mocked; a synthetic static pose is not proof of HELLO accuracy.
  setup({ initialDestination: "ai" }); click("Start camera + read aloud"); still(32);
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
  expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("HELLO", expect.objectContaining({ lang: "en-IN" }));
  expect(message().value).toBe(""); expect(mocks.ask).not.toHaveBeenCalled();
  still(32);
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(mocks.speak).toHaveBeenCalledOnce();
  emit(Array(7).fill(0), { hands: false }); still(20);
  expect(mocks.predict).toHaveBeenCalledTimes(2); expect(mocks.speak).toHaveBeenCalledTimes(2);
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("focusing a camera-mode switch or output radio does not incorrectly pause recognition as text editing", () => {
  setup(); click("Start camera");
  act(() => automatic().focus()); completeMovement();
  expect(mocks.predict).toHaveBeenCalledOnce();
  const readAloud = screen.getByRole("switch", { name: /^Speak recognized words/ });
  act(() => readAloud.focus()); fireEvent.click(readAloud); completeMovement();
  expect(mocks.predict).toHaveBeenCalledTimes(2); expect(mocks.speak).toHaveBeenCalledOnce();
  const localOutput = screen.getByRole("radio", { name: /^Text & voice/ });
  act(() => localOutput.focus()); completeMovement();
  expect(mocks.predict).toHaveBeenCalledTimes(3);
});

test("a completed movement automatically shows one tentative word through the unchanged camera gates without focus stealing", () => {
  setup(); click("Start camera"); still();
  const cameraHeading = screen.getByRole("heading", { name: /1 Sign with your camera/ });
  act(() => cameraHeading.focus());
  move();
  expect(mocks.predict).not.toHaveBeenCalled();
  still();
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(word().value).toBe("HELLO");
  expect(screen.getByText("HELLO", { selector: ".live-interpretation > strong" })).toBeTruthy();
  expect(document.activeElement).toBe(cameraHeading);
  const captured = mocks.predict.mock.calls[0][1];
  expect(captured.length).toBeGreaterThanOrEqual(4);
  expect(validateCameraTurn(captured, { durationMs: captured.at(-1).atMs }).ok).toBe(true);
  expect(mocks.speak).not.toHaveBeenCalled();
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("read aloud speaks once for each deliberate completed movement, never repeatedly for a held ending pose", () => {
  setup(); click("Start camera + read aloud"); completeMovement();
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("HELLO", expect.objectContaining({ lang: "en-IN" }));
  still(24);
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(mocks.speak).toHaveBeenCalledOnce();
  move(); still();
  expect(mocks.predict).toHaveBeenCalledTimes(2);
  expect(mocks.speak).toHaveBeenCalledTimes(2);
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("an automatically segmented but rejected turn stays silent and cannot send to AI", () => {
  mocks.predict.mockReturnValue({ status: "unclear", meaning: "", glosses: [], feedback: "No reliable vocabulary match", candidates: [] });
  setup({ initialDestination: "ai" }); click("Start camera + read aloud"); completeMovement();
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(screen.getByText("No reliable word match")).toBeTruthy();
  expect(word().value).toBe("");
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("a failed automatic turn clears the previous tentative word but preserves the composed message", () => {
  setup(); click("Start camera + read aloud"); completeMovement();
  expect(word().value).toBe("HELLO");
  fireEvent.change(message(), { target: { value: "Keep this reviewed message" } });
  mocks.predict.mockImplementation(() => { throw new Error("Inference failed"); });
  completeMovement();
  expect(mocks.predict).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(screen.queryByRole("button", { name: "Speak this word", exact: true })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add word to message", exact: true })).toBeNull();
  expect(screen.getByText(/Could not read this turn/)).toBeTruthy();
  expect(message().value).toBe("Keep this reviewed message");
  expect(mocks.speak).toHaveBeenCalledOnce(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("an accepted automatic word still requires explicit confirmation before AI receives it", async () => {
  mocks.check.mockResolvedValue({ configured: true });
  setup({ initialDestination: "ai" });
  await act(async () => {});
  click("Start camera + read aloud"); completeMovement();
  expect(word().value).toBe("HELLO");
  expect(mocks.speak).toHaveBeenCalledOnce(); expect(mocks.ask).not.toHaveBeenCalled();
  expect(button("Confirm word & get AI reply").disabled).toBe(false);
});

test("unavailable weights keep automatic word inference off while typing and explicit local voice remain usable", () => {
  mocks.trained = { status: "unavailable", model: null, error: "No trained vocabulary installed", retry: mocks.retry };
  setup(); click("Start camera"); completeMovement();
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  fireEvent.change(message(), { target: { value: "My typed message" } }); click("Speak my message");
  expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("My typed message", expect.objectContaining({ lang: "en-IN" }));
});

test("turning automatic capture off discards partial motion and leaves explicit manual capture available", () => {
  setup(); click("Start camera + read aloud"); still(); move();
  fireEvent.click(automatic());
  expect(automatic().checked).toBe(false); still();
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  click(/^Capture a sign/); still(5); click(/^Finish sign/);
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
});

test("Escape cancels the current automatic movement while leaving the mode ready for a genuinely new sign", () => {
  setup(); click("Start camera + read aloud"); still(); move();
  fireEvent.keyDown(window, { key: "Escape" }); still();
  expect(automatic().checked).toBe(true);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  move(); still();
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
});

test("Escape cancels a pending held pose until a fresh measured hand release", () => {
  setup(); click("Start camera + read aloud"); still();
  fireEvent.keyDown(window, { key: "Escape" }); still(32);
  expect(automatic().checked).toBe(true);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  emit(Array(7).fill(0), { hands: false }); still(20);
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
  expect(mocks.speak).toHaveBeenCalledOnce(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("dark-camera interruption cancels partial automatic motion and recovery requires a new complete movement", () => {
  const app = setup(); click("Start camera + read aloud"); still(); move();
  mocks.frameHealth = "dark"; rerender(app); still();
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  mocks.frameHealth = "visible"; rerender(app); still();
  expect(mocks.predict).not.toHaveBeenCalled();
  move(); still();
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
});

test("a gap in measured frames discards unfinished motion instead of treating its held ending as a word", () => {
  setup(); click("Start camera + read aloud"); still(); move();
  now += 1000; still();
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  move(); still();
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
});

test("editing a reviewed word pauses automatic capture instead of overwriting the correction", () => {
  setup(); click("Start camera"); completeMovement();
  expect(mocks.predict).toHaveBeenCalledOnce();
  act(() => word().focus());
  fireEvent.change(word(), { target: { value: "My correction" } });
  completeMovement();
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("My correction");
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  act(() => word().blur());
  completeMovement();
  expect(mocks.predict).toHaveBeenCalledTimes(2);
});

test("an open training-review disclosure preserves its frames and word despite new movement", () => {
  setup(); click("Start camera"); completeMovement();
  const review = screen.getByText("More result options", { selector: "summary" }).closest("details");
  fireEvent.click(review.querySelector("summary"));
  expect(review.open).toBe(true);
  completeMovement();
  expect(mocks.predict).toHaveBeenCalledOnce(); expect(word().value).toBe("HELLO");
});

test("End clears automatic capture and a late movement cannot speak or recreate the result", () => {
  setup(); click("Start camera + read aloud"); still(); move(); click("End session"); still();
  expect(mocks.active).toBe(false);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
});

test("automatic graph results remain silent until explicit review speech, even after opting into legacy read aloud", async () => {
  setup(); click("Start camera + read aloud"); chooseGraph(); completeMovement();
  expect(mocks.graphPredict).toHaveBeenCalledOnce();
  await act(async () => {});
  expect(word().value).toBe("HELLO");
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  click("Speak this word");
  expect(mocks.speak).toHaveBeenCalledExactlyOnceWith("HELLO", expect.objectContaining({ lang: "en-IN" }));
});

for (const action of ["pause", "end"]) test(`${action} invalidates an in-flight automatic graph result instead of showing or speaking it later`, async () => {
  let resolvePrediction;
  mocks.graphPredict.mockImplementationOnce(() => new Promise((resolve) => { resolvePrediction = resolve; }));
  setup(); click("Start camera + read aloud"); chooseGraph(); completeMovement();
  expect(mocks.graphPredict).toHaveBeenCalledOnce();
  if (action === "pause") fireEvent.click(automatic()); else click("End session");
  await act(async () => resolvePrediction({ status: "recognized", meaning: "HELLO", glosses: ["HELLO"], feedback: "Stale synthetic graph result" }));
  expect(mocks.graphCancel).toHaveBeenCalled();
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(screen.queryByText("HELLO", { selector: ".live-interpretation > strong" })).toBeNull();
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("tracking freshness expiry invalidates a pending automatic graph result before its late completion", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let resolvePrediction;
  mocks.graphPredict.mockImplementationOnce(() => new Promise((resolve) => { resolvePrediction = resolve; }));
  setup(); click("Start camera"); chooseGraph(); completeMovement();
  expect(mocks.graphPredict).toHaveBeenCalledOnce();
  act(() => { now += 2001; vi.advanceTimersByTime(2001); });
  expect(mocks.graphCancel).toHaveBeenCalled();
  await act(async () => resolvePrediction({ status: "recognized", meaning: "HELLO", feedback: "Stale tracking result" }));
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("fresh tracking arriving during asynchronous recognition refreshes the watchdog without cancelling its result", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let resolvePrediction;
  mocks.graphPredict.mockImplementationOnce(() => new Promise((resolve) => { resolvePrediction = resolve; }));
  setup(); click("Start camera"); chooseGraph(); completeMovement();
  expect(mocks.graphPredict).toHaveBeenCalledOnce();
  mocks.graphCancel.mockClear();
  for (let frame = 0; frame < 24; frame++) {
    still(1);
    act(() => vi.advanceTimersByTime(125));
  }
  expect(mocks.graphCancel).not.toHaveBeenCalled();
  await act(async () => resolvePrediction({ status: "recognized", meaning: "HELLO", feedback: "Fresh tracking result" }));
  expect(word().value).toBe("HELLO");
  expect(mocks.graphPredict).toHaveBeenCalledOnce(); expect(mocks.speak).not.toHaveBeenCalled();
});
