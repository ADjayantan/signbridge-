import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SignVideoInput from "../../src/components/SignVideoInput.jsx";

const mock = vi.hoisted(() => ({ callbacks: null, start: vi.fn(), cancel: vi.fn() }));
vi.mock("../../src/hooks/useVideoPoseReplay.js", () => ({ useVideoPoseReplay: (callbacks) => { mock.callbacks = callbacks; return { start: mock.start, cancel: mock.cancel }; } }));
let props, nextBlob, fetchMock;
const metadataResponse = (metadata = {}) => ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ available: true, signLanguage: "isl", label: "HELLO", videoUrl: "/api/local-reference/isl-hello/video", ...metadata }) });
const videoResponse = ({ type = "video/quicktime", length = "5", chunks = [new Uint8Array(5)], ok = true } = {}) => {
  let index = 0;
  const reader = { read: vi.fn(async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }), cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
  return { ok, headers: new Headers({ "content-type": type, ...(length === null ? {} : { "content-length": length }) }), body: { getReader: () => reader }, reader };
};
const flush = () => act(async () => {});
const click = (name) => fireEvent.click(screen.getByRole("button", { name, exact: true }));
const select = (duration = 1.96, file = new File(["video"], "unknown.mov", { type: "video/quicktime" })) => {
  fireEvent.change(screen.getByLabelText(/^Local sign video/), { target: { files: [file] } });
  const video = screen.getByLabelText("Selected sign video preview");
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  fireEvent.loadedMetadata(video); return video;
};
beforeEach(() => {
  vi.clearAllMocks(); nextBlob = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => `blob:sign-${++nextBlob}`), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  mock.start.mockResolvedValue(true);
  fetchMock = vi.fn().mockResolvedValueOnce(metadataResponse()).mockResolvedValueOnce(videoResponse()); vi.stubGlobal("fetch", fetchMock);
  props = { modelReady: true, signLanguage: "isl", withVoiceAvailable: true, onReset: vi.fn(), onStart: vi.fn(), onComplete: vi.fn(), onCancel: vi.fn(), onBusyChange: vi.fn() };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("opening or choosing a video does not start recognition; only Read runs the fixed source-frame sampler", async () => {
  render(<SignVideoInput {...props} />); expect(mock.start).not.toHaveBeenCalled();
  select(); expect(mock.start).not.toHaveBeenCalled(); expect(props.onComplete).not.toHaveBeenCalled();
  click("Convert to text + voice"); await act(async () => {});
  expect(mock.start).toHaveBeenCalledExactlyOnceWith({ fps: 8, trackerBackend: "tasks-holistic" });
  expect(props.onStart).toHaveBeenCalledOnce(); expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
  act(() => { mock.callbacks.onFrame({}, null, 0); mock.callbacks.onFrame({}, null, 125); mock.callbacks.onComplete({ durationMs: 1960 }); });
  expect(props.onComplete).toHaveBeenCalledOnce();
  const [frames, duration, output] = props.onComplete.mock.calls[0];
  expect(frames.map((frame) => frame.atMs)).toEqual([0, 125]); expect(frames[0].keypoints).toHaveLength(75);
  expect(Object.keys(frames[0]).sort()).toEqual(["atMs", "confidences", "keypoints"]);
  expect(duration).toBe(1960); expect(output).toEqual({ withVoice: true });
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});

test("text-only runs keep their voice choice even when output availability later changes", async () => {
  const app = render(<SignVideoInput {...props} />); select(); click("Convert to text");
  await act(async () => {}); app.rerender(<SignVideoInput {...props} withVoiceAvailable={false} />);
  act(() => mock.callbacks.onComplete({ durationMs: 1960 }));
  expect(props.onComplete.mock.calls[0][2]).toEqual({ withVoice: false });
});

test.each([.2, 13, Infinity])("a %s-second video cannot be read", (duration) => {
  render(<SignVideoInput {...props} />); select(duration);
  expect(screen.getByRole("alert").textContent).toMatch(/0.35 and 12 seconds/);
  expect(screen.getByRole("button", { name: "Convert to text", exact: true }).disabled).toBe(true);
  expect(mock.start).not.toHaveBeenCalled();
});

test("non-video content is rejected before a blob is opened", () => {
  render(<SignVideoInput {...props} />);
  fireEvent.change(screen.getByLabelText(/^Local sign video/), { target: { files: [new File(["text"], "hello.txt", { type: "text/plain" })] } });
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(mock.start).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/Choose a video/);
});

test("Escape cancels extraction and late completion cannot produce a result", async () => {
  render(<SignVideoInput {...props} />); select(); click("Convert to text + voice"); await act(async () => {});
  const stale = mock.callbacks;
  fireEvent.keyDown(window, { key: "Escape" });
  act(() => stale.onComplete({ durationMs: 1960 }));
  expect(props.onCancel).toHaveBeenCalledOnce(); expect(props.onComplete).not.toHaveBeenCalled();
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});

test("replacing a running video revokes the prior source, stops it and discards late callbacks", async () => {
  render(<SignVideoInput {...props} />); const oldVideo = select(); click("Convert to text"); await act(async () => {});
  const stale = mock.callbacks; select();
  act(() => { stale.onFrame({}, oldVideo, 500); stale.onComplete({ durationMs: 1960 }); });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sign-1"); expect(props.onCancel).toHaveBeenCalledOnce();
  expect(props.onComplete).not.toHaveBeenCalled(); expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});

test("model loss clears a source and interrupts extraction; unmount releases the new source", async () => {
  const app = render(<SignVideoInput {...props} />); select(); click("Convert to text"); await act(async () => {});
  app.rerender(<SignVideoInput {...props} modelReady={false} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sign-1"); expect(props.onComplete).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Clear video" })).toBeNull();
  app.rerender(<SignVideoInput {...props} />); select(); click("Convert to text"); await act(async () => {});
  const stale = mock.callbacks; app.unmount(); act(() => stale.onComplete({ durationMs: 1960 }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sign-2"); expect(props.onComplete).not.toHaveBeenCalled();
  expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
});

test("decoder and tracker errors leave a retryable file without a fabricated result", async () => {
  render(<SignVideoInput {...props} />); select(); click("Convert to text"); await act(async () => {});
  act(() => mock.callbacks.onError(new Error("Tracking unavailable")));
  expect(screen.getByRole("alert").textContent).toMatch(/Tracking unavailable/);
  expect(props.onComplete).not.toHaveBeenCalled(); expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  click("Convert to text"); await act(async () => {}); fireEvent.error(screen.getByLabelText("Selected sign video preview"));
  expect(screen.getByRole("alert").textContent).toMatch(/could not decode/);
  expect(screen.getByRole("button", { name: "Convert to text", exact: true }).disabled).toBe(true);
});

test("the local example loads actual video only on request, then needs metadata and an explicit Convert", async () => {
  render(<SignVideoInput {...props} />); expect(fetchMock).not.toHaveBeenCalled();
  click("Load local HELLO example"); await flush();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/local-reference/isl-hello/metadata", "/api/local-reference/isl-hello/video"]);
  expect(fetchMock.mock.calls.every(([, options]) => options.redirect === "error")).toBe(true);
  expect(mock.start).not.toHaveBeenCalled(); expect(props.onComplete).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Reference example context").textContent).toMatch(/previously tested.*not your camera.*unseen signs/);
  expect(screen.getByRole("link", { name: "Dataset and attribution" }).href).toBe("https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md");
  expect(screen.getByRole("button", { name: "Convert to text + voice" }).disabled).toBe(true);
  const video = screen.getByLabelText("Selected sign video preview");
  Object.defineProperty(video, "duration", { configurable: true, value: 1.96 }); fireEvent.loadedMetadata(video);
  click("Convert to text + voice"); await flush();
  expect(mock.start).toHaveBeenCalledExactlyOnceWith({ fps: 8, trackerBackend: "tasks-holistic" });
  act(() => { mock.callbacks.onFrame({}, null, 125); mock.callbacks.onComplete({ durationMs: 1960 }); });
  const [frames, duration, output] = props.onComplete.mock.calls[0];
  expect(Object.keys(frames[0]).sort()).toEqual(["atMs", "confidences", "keypoints"]);
  expect(duration).toBe(1960); expect(output).toEqual({ withVoice: true });
});

test.each([{}, { available: false }, { signLanguage: "asl" }, { videoUrl: "https://example.com/video.mov" }])("unavailable or invalid reference metadata cannot choose a video: %j", async (metadata) => {
  fetchMock.mockReset().mockResolvedValueOnce(Object.keys(metadata).length ? metadataResponse(metadata) : { ok: false, headers: new Headers() });
  render(<SignVideoInput {...props} />); click("Load local HELLO example"); await flush();
  expect(fetchMock).toHaveBeenCalledOnce(); expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toMatch(/unavailable on this laptop/);
  expect(screen.getByRole("button", { name: "Load local HELLO example" }).disabled).toBe(false);
});

test.each([{ type: "text/html" }, { length: "104857601" }, { length: "0" }, { length: null, chunks: [] }])("reference video size and content type are validated: %j", async (options) => {
  fetchMock.mockReset().mockResolvedValueOnce(metadataResponse()).mockResolvedValueOnce(videoResponse(options));
  render(<SignVideoInput {...props} />); click("Load local HELLO example"); await flush();
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(mock.start).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeTruthy();
});

test("a streamed response over the limit is cancelled before constructing a file", async () => {
  const response = videoResponse({ length: null, chunks: [{ byteLength: 104857601 }] });
  fetchMock.mockReset().mockResolvedValueOnce(metadataResponse()).mockResolvedValueOnce(response);
  render(<SignVideoInput {...props} />); click("Load local HELLO example"); await flush();
  expect(response.reader.cancel).toHaveBeenCalledOnce(); expect(response.reader.releaseLock).toHaveBeenCalledOnce();
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toMatch(/100 MiB/);
});

test("choosing a local file aborts a pending example and ignores its late response", async () => {
  let resolve;
  fetchMock.mockReset().mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  render(<SignVideoInput {...props} />); click("Load local HELLO example");
  const signal = fetchMock.mock.calls[0][1].signal;
  select(); expect(signal.aborted).toBe(true);
  await act(async () => resolve(metadataResponse()));
  expect(fetchMock).toHaveBeenCalledOnce(); expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(screen.getByText("Selected: unknown.mov")).toBeTruthy(); expect(screen.queryByLabelText("Reference example context")).toBeNull();
});

test.each(["cancel", "escape", "model-loss", "disabled", "language", "unmount"])("%s cancels a pending reference request and prevents a late source", async (action) => {
  let resolve;
  fetchMock.mockReset().mockResolvedValueOnce(metadataResponse()).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const app = render(<SignVideoInput {...props} />); click("Load local HELLO example"); await flush();
  const signal = fetchMock.mock.calls[1][1].signal;
  if (action === "cancel") click("Cancel example loading");
  else if (action === "escape") fireEvent.keyDown(window, { key: "Escape" });
  else if (action === "model-loss") app.rerender(<SignVideoInput {...props} modelReady={false} />);
  else if (action === "disabled") app.rerender(<SignVideoInput {...props} disabled />);
  else if (action === "language") app.rerender(<SignVideoInput {...props} signLanguage="asl" />);
  else app.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(videoResponse()));
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(mock.start).not.toHaveBeenCalled(); expect(props.onComplete).not.toHaveBeenCalled();
});

test("changing source revokes a loaded example and clears its reference label", async () => {
  const app = render(<SignVideoInput {...props} />); click("Load local HELLO example"); await flush();
  select(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sign-1");
  expect(screen.queryByLabelText("Reference example context")).toBeNull();
  app.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sign-2");
});

test("ASL, an unspecified language and public-demo cannot load a local reference", async () => {
  const app = render(<SignVideoInput {...props} signLanguage="asl" />);
  expect(screen.queryByRole("button", { name: "Load local HELLO example" })).toBeNull();
  app.rerender(<SignVideoInput {...props} signLanguage={undefined} />);
  expect(screen.queryByRole("button", { name: "Load local HELLO example" })).toBeNull();
  vi.stubEnv("MODE", "public-demo"); app.rerender(<SignVideoInput {...props} />); await flush();
  expect(screen.queryByRole("button", { name: "Load local HELLO example" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
