import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import GuidedSignPractice from "../../src/components/GuidedSignPractice.jsx";

const readyMetadata = { available: true, signLanguage: "isl", label: "HELLO", videoUrl: "/api/local-reference/isl-hello/video" };
const model = { signLanguage: "isl", labels: ["HELLO", "BOOK"] };
const props = { signLanguage: "isl", modelStatus: "ready", model };
let fetchMock, play, pause;
const response = (value = readyMetadata) => ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => value });
const flush = async () => act(async () => {});
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetchMock);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("supported ISL model shows the real fixed reference with source clearly separated from camera", async () => {
  render(<GuidedSignPractice {...props} />); await flush();
  const example = screen.getByLabelText("INCLUDE ISL HELLO reference example");
  expect(example.getAttribute("src")).toBe("/api/local-reference/isl-hello/video");
  expect(example.classList.contains("mirror")).toBe(false);
  expect(screen.getByText("Reference example · not your camera")).toBeTruthy();
  expect(screen.getByText(/Watching this clip does not run recognition/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Dataset and attribution" }).href).toBe("https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  expect(play).not.toHaveBeenCalled();
});
test("ASL, missing model and unsupported HELLO never fetch or present this example", async () => {
  const app = render(<GuidedSignPractice {...props} signLanguage="asl" />); await flush();
  expect(screen.getByLabelText("HELLO practice availability").textContent).toMatch(/Choose ISL/);
  app.rerender(<GuidedSignPractice {...props} model={null} />); await flush();
  expect(screen.getByLabelText("HELLO practice availability").textContent).toMatch(/needs a loaded ISL model/);
  app.rerender(<GuidedSignPractice {...props} model={{ ...model, labels: ["BOOK"] }} />); await flush();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("INCLUDE ISL HELLO reference example")).toBeNull();
});
test("a mismatched language model cannot provide the HELLO practice example", async () => {
  render(<GuidedSignPractice {...props} model={{ ...model, signLanguage: "asl" }} />); await flush();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Watch example" })).toBeNull();
});
test("watch, pause and half-speed controls affect only local video playback", async () => {
  render(<GuidedSignPractice {...props} />); await flush();
  const example = screen.getByLabelText("INCLUDE ISL HELLO reference example");
  fireEvent.click(screen.getByRole("checkbox", { name: "Half speed" }));
  expect(example.playbackRate).toBe(.5);
  fireEvent.click(screen.getByRole("button", { name: "Watch example" })); await flush();
  expect(play).toHaveBeenCalledTimes(1);
  fireEvent.play(example);
  fireEvent.click(screen.getByRole("button", { name: "Pause example" }));
  expect(pause).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("textbox")).toBeNull();
});
test("starting camera pauses the example and disables competing playback controls", async () => {
  const app = render(<GuidedSignPractice {...props} />); await flush();
  app.rerender(<GuidedSignPractice {...props} cameraOn />); await flush();
  expect(pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Watch example" }).disabled).toBe(true);
  expect(screen.getByLabelText("INCLUDE ISL HELLO reference example").controls).toBe(false);
  expect(screen.getByLabelText("HELLO practice availability").textContent).toMatch(/paused for your camera trial/);
});
test("unavailable or unrelated returned video cannot be played", async () => {
  fetchMock.mockResolvedValue(response({ ...readyMetadata, videoUrl: "https://example.com/unrelated.mp4" }));
  render(<GuidedSignPractice {...props} />); await flush();
  expect(screen.queryByLabelText("INCLUDE ISL HELLO reference example")).toBeNull();
  expect(screen.getByRole("button", { name: "Check local example again" })).toBeTruthy();
});
test("failed availability can be retried and decode failure remains explicit", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  render(<GuidedSignPractice {...props} />); await flush();
  expect(screen.getByLabelText("HELLO practice availability").textContent).toMatch(/unavailable on this laptop/);
  fireEvent.click(screen.getByRole("button", { name: "Check local example again" })); await flush();
  fireEvent.error(screen.getByLabelText("INCLUDE ISL HELLO reference example"));
  expect(screen.queryByLabelText("INCLUDE ISL HELLO reference example")).toBeNull();
  expect(screen.getByLabelText("HELLO practice availability").textContent).toMatch(/unavailable/);
});
test("playback errors are visible without creating a prediction or message", async () => {
  play.mockRejectedValueOnce(new Error("denied"));
  render(<GuidedSignPractice {...props} />); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Watch example" })); await flush();
  expect(screen.getByRole("alert").textContent).toMatch(/could not play/);
  expect(screen.queryByText(/Predicted word/)).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
});
test("language change aborts availability and hides stale reference results", async () => {
  let resolve; fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
  const app = render(<GuidedSignPractice {...props} />);
  const signal = fetchMock.mock.calls[0][1].signal;
  app.rerender(<GuidedSignPractice {...props} signLanguage="asl" />);
  expect(signal.aborted).toBe(true);
  resolve(response()); await flush();
  expect(screen.queryByLabelText("INCLUDE ISL HELLO reference example")).toBeNull();
});
test("unmount releases file playback and pending fetch ownership", async () => {
  const app = render(<GuidedSignPractice {...props} />); await flush();
  const signal = fetchMock.mock.calls[0][1].signal;
  app.unmount(); expect(signal.aborted).toBe(true); expect(pause).toHaveBeenCalled();
});
test("late playback failure cannot replace the camera-trial guidance", async () => {
  let reject; play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const app = render(<GuidedSignPractice {...props} />); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Watch example" }));
  app.rerender(<GuidedSignPractice {...props} cameraOn />);
  reject(new Error("late failure")); await flush();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("HELLO practice availability").textContent).toMatch(/paused for your camera trial/);
});
test("public-demo contains no local guide and makes no local asset requests", async () => {
  vi.stubEnv("MODE", "public-demo");
  render(<GuidedSignPractice {...props} />); await flush();
  expect(screen.queryByLabelText("Guided ISL HELLO practice")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});
