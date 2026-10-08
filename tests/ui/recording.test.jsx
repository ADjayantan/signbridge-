import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SignVideoLibrary from "../../src/modes/SignVideoLibrary.jsx";

let rec;
let track;
let library;
beforeEach(() => {
  vi.useFakeTimers();
  rec = undefined;
  URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
  track = { readyState: "live" };
  library = { clips: [], add: vi.fn(), remove: vi.fn() };
  window.MediaRecorder = globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { rec = this; this.state = "inactive"; this.mimeType = "video/webm"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob(["clip"]) }); this.onstop(); }
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const setup = () => render(<SignVideoLibrary library={library} signLanguage="isl" lang="en" videoRef={{ current: { srcObject: { getVideoTracks: () => [track] } } }} cameraReady />);
const start = () => {
  fireEvent.change(screen.getByLabelText("Exact word or phrase shown in the video"), { target: { value: "hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Record sign video" }));
};

test("a recording stopped by the browser clears its timer and stays in preview", () => {
  setup(); start(); act(() => vi.advanceTimersByTime(3000));
  act(() => rec.stop());
  act(() => vi.advanceTimersByTime(15000));
  expect(screen.queryByText("Preparing preview…")).toBeNull();
  expect(screen.getByLabelText("Preview your sign video")).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

test("camera loss during the countdown cancels recording with a recovery message", () => {
  setup(); start(); track.readyState = "ended";
  act(() => vi.advanceTimersByTime(3000));
  expect(rec).toBeUndefined();
  expect(screen.getByText(/Camera stopped/)).toBeTruthy();
});

test("a corrupt video cannot be saved into the dictionary", () => {
  setup();
  fireEvent.change(screen.getByLabelText("Exact word or phrase shown in the video"), { target: { value: "hello" } });
  fireEvent.change(screen.getByLabelText("Import sign video"), { target: { files: [new File(["bad data"], "bad.mp4", { type: "video/mp4" })] } });
  const preview = screen.getByLabelText("Preview your sign video");
  fireEvent.error(preview);
  expect(screen.getByRole("button", { name: "Save this sign video" }).disabled).toBe(true);
  expect(library.add).not.toHaveBeenCalled();
});
