import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import RoomSignCapture from "../../src/components/RoomSignCapture.jsx";

const mock = vi.hoisted(() => ({ frame: null, predict: vi.fn(), cancel: vi.fn(), append: vi.fn(), read: vi.fn(), unavailable: false }));
vi.mock("../../src/hooks/useWordRecognitionModel.js", () => ({ useWordRecognitionModel: (language, engine) => ({ engine, async: engine === "graph", status: mock.unavailable && engine === "graph" ? "unavailable" : "ready", model: { labels: ["WATER", "HELP"] }, error: "No evaluated local graph weights", predict: mock.predict, cancel: mock.cancel, retry: vi.fn() }) }));
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ active, onFrame }) => { mock.frame = onFrame; return { status: active ? "ready" : "idle", retry: vi.fn() }; } }));
vi.mock("../../src/lib/trainedSignModel.js", () => ({ poseFrameFromHolistic: (pose) => pose }));
let now;
const view = (props = {}) => <RoomSignCapture cameraStatus="on" signLanguage="isl" videoRef={{ current: null }} onAppend={mock.append} onRead={mock.read} canRead {...props} />;
const emit = () => act(() => { for (let i = 0; i < 5; i++) { now += 125; mock.frame({ keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(1) }); } });
const click = (name) => fireEvent.click(screen.getByRole("button", { name }));
function captureGraph() {
  fireEvent.change(screen.getByLabelText("Word recognition model", { exact: false }), { target: { value: "graph" } });
  emit(); click("Capture a word"); emit(); click(/^Finish sign/);
}
const word = { status: "recognized", meaning: "WATER", feedback: "Review the meaning", candidates: [] };
beforeEach(() => { vi.clearAllMocks(); mock.unavailable = false; now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now); });
afterEach(cleanup);

test("graph Finish awaits inference and never speaks or sends until reviewed explicitly", async () => {
  let resolve; mock.predict.mockReturnValue(new Promise((yes) => { resolve = yes; }));
  render(view()); captureGraph();
  expect(screen.getByRole("status").textContent).toMatch(/Recognising/);
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
  await act(async () => { resolve(word); });
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "WATER PLEASE" } });
  click("Speak reviewed word"); expect(mock.read).toHaveBeenCalledWith({ text: "WATER PLEASE", lang: "en" });
  expect(mock.append).not.toHaveBeenCalled();
  click("Add reviewed word to message"); expect(mock.append).toHaveBeenCalledWith(expect.objectContaining({ text: "WATER PLEASE", inputMethod: "sign" }));
});

test.each(["cancel", "camera loss", "model change", "language change"])("late graph results are discarded after %s", async (action) => {
  let resolve; mock.predict.mockReturnValue(new Promise((yes) => { resolve = yes; }));
  const app = render(view()); captureGraph();
  if (action === "cancel") click("Cancel recognition");
  if (action === "camera loss") app.rerender(view({ cameraStatus: "off" }));
  if (action === "model change") fireEvent.change(screen.getByLabelText("Word recognition model", { exact: false }), { target: { value: "legacy" } });
  if (action === "language change") app.rerender(view({ signLanguage: "asl" }));
  await act(async () => { resolve(word); });
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.append).not.toHaveBeenCalled();
});

test("unavailable graph model keeps hand tracking without falling back to a legacy prediction", () => {
  mock.unavailable = true; render(view());
  fireEvent.change(screen.getByLabelText("Word recognition model", { exact: false }), { target: { value: "graph" } });
  emit(); expect(screen.getByText(/No evaluated local graph weights/)).toBeTruthy();
  expect(screen.getByLabelText("Detected hand joints").textContent).toContain("42 / 42");
  expect(screen.queryByRole("button", { name: "Capture a word" })).toBeNull(); expect(mock.predict).not.toHaveBeenCalled();
});
