import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../src/App.jsx";
import WlaslVideoMode from "../../src/modes/WlaslVideoMode.jsx";

const voice = vi.hoisted(() => ({ speak: vi.fn(), cancel: vi.fn() }));
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, createSpeaker: () => voice }));
const status = { available: true, signLanguage: "asl", engine: "wlasl-i3d", labels: ["BOOK", "DRINK", "COMPUTER"], modelName: "WLASL100 I3D", calibrated: false };
const prediction = { status: "review", suggestion: "BOOK", candidates: [{ label: "BOOK", score: .7 }, { label: "DRINK", score: .2 }], calibrated: false, frames: 32, durationMs: 1200 };
const response = (data, ok = true) => ({ ok, json: async () => data });
const flush = () => act(async () => {});
const click = (name) => fireEvent.click(screen.getByRole("button", { name, exact: true }));
let fetchMock, getUserMedia, stream, track, recorders, now, nextUrl;

class Recorder {
  static isTypeSupported(type) { return type === "video/webm;codecs=vp8"; }
  constructor(value, options) { this.stream = value; this.mimeType = options.mimeType; this.state = "inactive"; recorders.push(this); }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["recorded video"], { type: this.mimeType }) }); this.onstop?.(); }
}
const select = (duration = 1.2, file = new File(["video"], "private-book.mov", { type: "video/quicktime" })) => {
  click("Choose a video"); fireEvent.change(screen.getByLabelText("Local ASL video"), { target: { files: [file] } });
  const video = screen.queryByLabelText("Selected ASL video preview");
  if (video) { Object.defineProperty(video, "duration", { configurable: true, value: duration }); fireEvent.loadedMetadata(video); }
  return file;
};
const mount = async () => { const view = render(<WlaslVideoMode settings={{ rate: 1.2 }} onBack={vi.fn()} />); await flush(); return view; };
beforeEach(() => {
  vi.clearAllMocks(); recorders = []; now = 0; nextUrl = 0;
  voice.speak.mockResolvedValue({ status: "ended" });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => `blob:asl-${++nextUrl}`), revokeObjectURL: vi.fn() }));
  track = { stop: vi.fn(), onended: null }; stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  getUserMedia = vi.fn().mockResolvedValue(stream); Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", Recorder);
  fetchMock = vi.fn(async (url) => response(url.endsWith("status") ? status : prediction)); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("a raw local video produces editable visible text, with speech only after explicit review", async () => {
  await mount(); const file = select();
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(voice.speak).not.toHaveBeenCalled();
  click("Analyze video"); await flush();
  expect(screen.getByText("Model suggestion—check meaning")).toBeTruthy();
  expect(screen.getByLabelText("Editable text").value).toBe("BOOK");
  const [url, request] = fetchMock.mock.calls[1];
  expect(url).toBe("/api/local-wlasl/predict"); expect(request.body).toBe(file);
  expect(request.headers).toEqual({ "Content-Type": "video/quicktime", "X-SignBridge-Local": "1" });
  expect(request.method).toBe("POST"); expect(voice.speak).not.toHaveBeenCalled();
  const automatic = screen.getByLabelText("Read results aloud automatically"); expect(automatic.disabled).toBe(false); expect(automatic.checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Editable text"), { target: { value: "I want a book" } }); click("Speak this text"); await flush();
  expect(voice.speak).toHaveBeenCalledExactlyOnceWith("I want a book", expect.objectContaining({ lang: "en-US", rate: 1.2 }));
});

test("Convert to text + voice and Start camera + read aloud produce both text and voice output automatically", async () => {
  await mount();
  select();
  click("Convert to text + voice");
  await flush();
  expect(screen.getByLabelText("Editable text").value).toBe("BOOK");
  expect(voice.speak).toHaveBeenCalledExactlyOnceWith("BOOK", expect.objectContaining({ lang: "en-US", rate: 1.2 }));
  voice.speak.mockClear();
  click("Use camera");
  click("Start camera + read aloud");
  await flush();
  click("Record sign");
  now = 1800;
  click("Finish recording");
  await flush();
  expect(screen.getByLabelText("Editable text").value).toBe("BOOK");
  expect(voice.speak).toHaveBeenCalledExactlyOnceWith("BOOK", expect.objectContaining({ lang: "en-US", rate: 1.2 }));
});

test("unavailable model leaves typing and speech usable without enabling analysis", async () => {
  fetchMock.mockResolvedValue(response({ available: false })); await mount();
  expect(screen.getByText("Local ASL model unavailable")).toBeTruthy();
  select(); expect(screen.getByRole("button", { name: "Analyze video" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Editable text"), { target: { value: "Please help" } }); click("Speak this text"); await flush();
  expect(voice.speak).toHaveBeenCalledWith("Please help", expect.any(Object));
  fetchMock.mockResolvedValue(response(status)); click("Check model again"); await flush();
  expect(screen.getByText("Local ASL model ready")).toBeTruthy();
});

test("vocabulary uses the actual status labels and explains the ASL scope", async () => {
  await mount(); expect(screen.getByText(/not Indian Sign Language/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Find a supported word"), { target: { value: "hello" } });
  expect(screen.getByText("No supported word matches “hello”.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Find a supported word"), { target: { value: "comp" } });
  expect(screen.getByText("COMPUTER")).toBeTruthy(); expect(screen.queryByText("BOOK")).toBeNull();
});

test.each([.2, 12.5, Infinity, NaN])("a %s second upload cannot be analyzed", async (duration) => {
  await mount(); select(duration);
  expect(screen.getByRole("alert").textContent).toMatch(/between 0.35 and 12 seconds/);
  expect(screen.getByRole("button", { name: "Analyze video" }).disabled).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("empty, non-video and oversized files are rejected before opening an object URL", async () => {
  await mount();
  select(1, new File([], "empty.mp4", { type: "video/mp4" })); expect(screen.getByRole("alert").textContent).toMatch(/non-empty/);
  select(1, new File(["text"], "example.txt", { type: "text/plain" })); expect(screen.getByRole("alert").textContent).toMatch(/Choose a video/);
  const large = new File(["video"], "large.mp4", { type: "video/mp4" }); Object.defineProperty(large, "size", { value: 40 * 1024 * 1024 + 1 });
  select(1, large); expect(screen.getByRole("alert").textContent).toMatch(/40 MiB/);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test("cancel aborts inference and a late result cannot replace the text", async () => {
  await mount(); select(); let resolve;
  fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  click("Analyze video"); const signal = fetchMock.mock.calls[1][1].signal;
  fireEvent.change(screen.getByLabelText("Editable text"), { target: { value: "My message" } });
  click("Cancel"); expect(signal.aborted).toBe(true);
  await act(async () => resolve(response(prediction)));
  expect(screen.getByLabelText("Editable text").value).toBe("My message");
  expect(screen.queryByText("Model suggestion—check meaning")).toBeNull(); expect(voice.speak).not.toHaveBeenCalled();
});

test("changing sources revokes the video and ignores pending analysis", async () => {
  await mount(); select(); let resolve;
  fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; })); click("Analyze video");
  const signal = fetchMock.mock.calls[1][1].signal; click("Use camera");
  expect(signal.aborted).toBe(true); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:asl-1");
  await act(async () => resolve(response(prediction)));
  expect(screen.getByLabelText("Editable text").value).toBe(""); expect(screen.queryByLabelText("Selected ASL video preview")).toBeNull();
});

test("camera records RGB video without audio and requires Analyze after Finish", async () => {
  const view = await mount(); click("Start camera"); await flush();
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
  click("Record sign"); now = 1800; click("Finish recording"); await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(screen.getByText("1.8 second clip ready to analyze.")).toBeTruthy();
  expect(screen.getByLabelText("Selected ASL video preview").muted).toBe(true);
  click("Analyze video"); await flush(); expect(screen.getByLabelText("Editable text").value).toBe("BOOK");
  expect(fetchMock.mock.calls[1][1].body).toBeInstanceOf(Blob);
  expect(voice.speak).not.toHaveBeenCalled(); view.unmount();
  expect(track.stop).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:asl-1");
});

test("camera auto-finishes at 12 seconds and End session releases capture resources", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); await mount(); click("Start camera"); await flush(); click("Record sign"); now = 12000;
  act(() => vi.advanceTimersByTime(12000)); expect(recorders[0].state).toBe("inactive");
  expect(screen.getByText("12.0 second clip ready to analyze.")).toBeTruthy();
  click("End session"); expect(track.stop).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:asl-1"); expect(screen.queryByLabelText("Selected ASL video preview")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test("cancelled camera permission requests release late streams", async () => {
  await mount(); let resolve; getUserMedia.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  click("Start camera"); click("Cancel"); await act(async () => resolve(stream));
  expect(track.stop).toHaveBeenCalledOnce(); expect(screen.getByText("Your camera is off")).toBeTruthy();
});

test("cancelled recordings cannot make a clip and too-short recordings stay unanalyzed", async () => {
  await mount(); click("Start camera"); await flush(); click("Record sign");
  const staleStop = recorders[0].onstop; click("Cancel"); act(() => staleStop());
  expect(screen.queryByLabelText("Selected ASL video preview")).toBeNull();
  click("Record sign"); now = 100; click("Finish recording");
  expect(screen.getByRole("alert").textContent).toMatch(/between 0.35 and 12 seconds/);
  expect(screen.getByRole("button", { name: "Analyze video" }).disabled).toBe(true);
});

test("oversized camera recordings stop capture without retaining a clip", async () => {
  await mount(); click("Start camera"); await flush(); click("Record sign");
  act(() => recorders[0].ondataavailable({ data: { size: 40 * 1024 * 1024 + 1 } }));
  expect(track.stop).toHaveBeenCalledOnce(); expect(screen.getByRole("alert").textContent).toMatch(/exceeds 40 MiB/);
  expect(screen.queryByLabelText("Selected ASL video preview")).toBeNull();
});

test("unmount aborts pending inference and frees the selected video", async () => {
  const view = await mount(); select(); let resolve;
  fetchMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; })); click("Analyze video");
  const signal = fetchMock.mock.calls[1][1].signal; view.unmount();
  expect(signal.aborted).toBe(true); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:asl-1");
  await act(async () => resolve(response(prediction))); expect(voice.speak).not.toHaveBeenCalled();
});

test("unsupported suggestions and server errors do not fabricate a word", async () => {
  await mount(); select(); fetchMock.mockResolvedValueOnce(response({ ...prediction, suggestion: "HELLO" }));
  click("Analyze video"); await flush(); expect(screen.getByRole("alert").textContent).toMatch(/supported word/);
  expect(screen.getByLabelText("Editable text").value).toBe("");
  fetchMock.mockResolvedValueOnce(response({ error: "Local model is not running." }, false)); click("Analyze video"); await flush();
  expect(screen.getByRole("alert").textContent).toBe("Local model is not running."); expect(voice.speak).not.toHaveBeenCalled();
});

test("App routes #wlasl and Home exposes ASL video model navigation", async () => {
  window.history.replaceState(null, "", "/");
  render(<App />);
  await flush();
  click("ASL video model");
  await flush();
  expect(window.location.hash).toBe("#wlasl");
  expect(screen.getByRole("heading", { name: "ASL video to text & voice" })).toBeTruthy();
  window.history.replaceState(null, "", "/");
});
