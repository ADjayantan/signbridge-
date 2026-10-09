import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import NonsigningCapture from "../../src/components/NonsigningCapture.jsx";
import TrainingStudio from "../../src/modes/TrainingStudio.jsx";

const mock = vi.hoisted(() => ({ active: false, frame: null, cameraStatus: "on", trackingStatus: "ready", stop: vi.fn(), retry: vi.fn(), library: null, wordModel: vi.fn(), ai: vi.fn() }));
vi.mock("../../src/hooks/useTrainingSamples.js", () => ({ useTrainingSamples: () => mock.library }));
vi.mock("../../src/hooks/useWordRecognitionModel.js", () => ({ useWordRecognitionModel: mock.wordModel }));
vi.mock("../../src/lib/api.js", () => ({ askSign: mock.ai, checkSignAI: mock.ai }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useEffect, useRef } = await import("react");
  return { useCamera: ({ active }) => {
    mock.active = active;
    useEffect(() => { if (active) return () => mock.stop(); }, [active]);
    return { status: active ? mock.cameraStatus : "off", videoRef: useRef(null), error: "Camera permission denied. Allow access or close this section.", retry: mock.retry };
  } };
});
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ active, onFrame }) => { mock.frame = onFrame; return { status: active ? mock.trackingStatus : "idle", error: "Body tracking unavailable", retry: mock.retry }; } }));
let now;
const setup = (props = {}) => render(<NonsigningCapture signLanguage="asl" store={mock.library} {...props} />);
const button = (name) => screen.getByRole("button", { name });
const click = (name) => fireEvent.click(button(name));
const tick = (ms) => act(() => { now += ms; vi.advanceTimersByTime(ms); });
const emit = () => act(() => mock.frame({})); // A measured empty Holistic result has no visible hands or body.
const record = () => { click("Start nonsigning camera"); emit(); click("Record 3 seconds"); for (let i = 0; i < 24; i++) { now += 125; emit(); act(() => vi.advanceTimersByTime(125)); } };
const attest = () => {
  fireEvent.change(screen.getByLabelText("Anonymous signer code"), { target: { value: "participant-01" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /did not intentionally perform a sign/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to store/ }));
};
const openStudioCapture = async () => {
  const summary = screen.getByText(/Record no-sign examples/, { selector: "summary" });
  await act(async () => fireEvent.click(summary)); return summary;
};
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
  mock.active = false; mock.frame = null; mock.cameraStatus = "on"; mock.trackingStatus = "ready";
  mock.library = { samples: [], loading: false, error: "", add: vi.fn().mockResolvedValue({ id: "negative1" }), reload: vi.fn(), remove: vi.fn() };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("the optional Studio tool starts closed and unmounted, then explicit opening and camera start need no word model or AI", async () => {
  render(<TrainingStudio settings={{ signLanguage: "asl" }} onBack={vi.fn()} onCapture={vi.fn()} />);
  expect(mock.frame).toBeNull(); expect(screen.queryByRole("button", { name: "Start nonsigning camera" })).toBeNull();
  const summary = await openStudioCapture(); expect(summary.closest("details").open).toBe(true);
  expect(mock.active).toBe(false); expect(mock.wordModel).not.toHaveBeenCalled(); expect(mock.ai).not.toHaveBeenCalled();
  click("Start nonsigning camera"); expect(mock.active).toBe(true);
  expect(button("Record 3 seconds").disabled).toBe(true); emit(); expect(button("Record 3 seconds").disabled).toBe(false);
  expect(mock.library.add).not.toHaveBeenCalled(); expect(mock.ai).not.toHaveBeenCalled();
});

test("missing hands/body record as finite timed negatives, requiring signer, attestation and separate storage consent", async () => {
  setup(); record();
  expect(screen.getByText("24")).toBeTruthy(); expect(screen.getByText("3.0 seconds")).toBeTruthy();
  expect(mock.library.add).not.toHaveBeenCalled(); expect(button("Save nonsigning example").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Anonymous signer code"), { target: { value: "participant-01" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /did not intentionally perform a sign/ }));
  expect(button("Save nonsigning example").disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to store/ }));
  expect(button("Save nonsigning example").disabled).toBe(false);
  await act(async () => click("Save nonsigning example"));
  const saved = mock.library.add.mock.calls[0][0];
  expect(saved).toMatchObject({ signLanguage: "asl", signerId: "participant-01", kind: "unknown", label: "__unknown__", negativeType: "nonsigning", captureDurationMs: 3000, consent: true });
  expect(saved).not.toHaveProperty("prediction"); expect(saved.frames).toHaveLength(24);
  expect(saved.frames.map((frame) => frame.atMs)).toEqual(Array.from({ length: 24 }, (_, i) => (i + 1) * 125));
  expect(saved.frames.every((frame) => frame.confidences.every((confidence) => confidence === 0))).toBe(true);
  expect(mock.wordModel).not.toHaveBeenCalled(); expect(mock.ai).not.toHaveBeenCalled();
  expect(screen.getByText(/Saved one nonsigning example locally/)).toBeTruthy();
});

test("timing gaps reject the recording while missing frames cannot be substituted with zero-hand poses", () => {
  setup(); click("Start nonsigning camera"); emit(); click("Record 3 seconds");
  for (let i = 0; i < 4; i++) { now += 125; emit(); act(() => vi.advanceTimersByTime(125)); }
  tick(2500);
  expect(screen.getByRole("alert").textContent).toMatch(/Tracking paused/);
  expect(button("Save nonsigning example").disabled).toBe(true); expect(mock.library.add).not.toHaveBeenCalled();
});

test("a delayed completion timer reports the real duration and cannot disguise a long pause", () => {
  setup(); click("Start nonsigning camera"); emit(); click("Record 3 seconds");
  for (let i = 0; i < 23; i++) { now += 125; emit(); act(() => vi.advanceTimersByTime(125)); }
  now += 2125; act(() => vi.advanceTimersByTime(125));
  expect(screen.getByText("5.0 seconds")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/ran too long/);
  expect(button("Save nonsigning example").disabled).toBe(true);
  expect(mock.library.add).not.toHaveBeenCalled();
});

test("cancelling a recording clears its data, ignores a later timer and permits a fresh explicit recording", () => {
  setup(); click("Start nonsigning camera"); emit(); click("Record 3 seconds");
  now += 125; emit(); click("Cancel recording"); tick(3000);
  expect(screen.queryByText("Review this recording")).toBeNull(); expect(mock.library.add).not.toHaveBeenCalled();
  now += 125; emit(); expect(button("Record 3 seconds").disabled).toBe(false);
  click("Record 3 seconds"); expect(button("Cancel recording")).toBeTruthy();
});

test("signer or activity changes reset both explicit attestations before saving", () => {
  setup(); record(); attest(); expect(button("Save nonsigning example").disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Anonymous signer code"), { target: { value: "participant-02" } });
  expect(screen.getAllByRole("checkbox").every((input) => !input.checked)).toBe(true);
  expect(button("Save nonsigning example").disabled).toBe(true);
});

test("camera denial leaves helpful feedback and never starts recording or saving", () => {
  mock.cameraStatus = "error"; setup(); click("Start nonsigning camera");
  expect(screen.getByRole("alert").textContent).toMatch(/Camera permission denied/);
  expect(button("Record 3 seconds").disabled).toBe(true); click("Retry nonsigning camera"); expect(mock.retry).toHaveBeenCalledOnce();
  expect(mock.library.add).not.toHaveBeenCalled();
});

test("closing the Studio disclosure or changing language unmounts the tool and releases the camera", async () => {
  const app = render(<TrainingStudio settings={{ signLanguage: "asl" }} onBack={vi.fn()} onCapture={vi.fn()} />);
  const summary = await openStudioCapture(); click("Start nonsigning camera"); emit(); click("Record 3 seconds");
  await act(async () => fireEvent.click(summary));
  expect(mock.stop).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: "Record 3 seconds" })).toBeNull(); tick(3000);
  expect(mock.library.add).not.toHaveBeenCalled();
  await openStudioCapture(); click("Start nonsigning camera");
  app.rerender(<TrainingStudio settings={{ signLanguage: "isl" }} onBack={vi.fn()} onCapture={vi.fn()} />);
  expect(mock.stop).toHaveBeenCalledTimes(2); expect(mock.active).toBe(false);
});

test("duplicate saves and stale completion after unmount cannot produce new recording state or notices", async () => {
  let complete; mock.library.add.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const app = setup(); record(); attest(); const form = button("Save nonsigning example").closest("form");
  fireEvent.submit(form); fireEvent.submit(form); expect(mock.library.add).toHaveBeenCalledOnce();
  app.unmount(); expect(mock.stop).toHaveBeenCalledOnce();
  await act(async () => complete({ id: "saved" })); expect(screen.queryByText(/Saved one nonsigning example/)).toBeNull();
});

test("a storage error keeps the reviewed recording and provides an explicit reload-and-save retry", async () => {
  mock.library.add.mockImplementationOnce(async () => { mock.library.error = "Storage temporarily unavailable"; throw new Error(mock.library.error); });
  mock.library.reload.mockImplementation(async () => { mock.library.error = ""; });
  setup(); record(); attest();
  await act(async () => click("Save nonsigning example"));
  expect(screen.getByText("Review this recording")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/Storage temporarily unavailable/);
  expect(button("Save nonsigning example").disabled).toBe(true);
  await act(async () => click("Retry pose storage"));
  expect(mock.library.reload).toHaveBeenCalledOnce();
  expect(button("Save nonsigning example").disabled).toBe(false);
  await act(async () => click("Save nonsigning example"));
  expect(mock.library.add).toHaveBeenCalledTimes(2);
  expect(mock.library.add.mock.calls[1][0].frames).toEqual(mock.library.add.mock.calls[0][0].frames);
  expect(screen.getByText(/Saved one nonsigning example locally/)).toBeTruthy();
});

test("changing the activity discards the previous review rather than relabelling it", () => {
  setup(); record(); attest();
  fireEvent.change(screen.getByLabelText("What will you record?"), { target: { value: "everyday" } });
  expect(screen.queryByText("Review this recording")).toBeNull();
  expect(screen.getAllByRole("checkbox").every((input) => !input.checked)).toBe(true);
  expect(button("Save nonsigning example").disabled).toBe(true);
  expect(mock.library.add).not.toHaveBeenCalled();
});
