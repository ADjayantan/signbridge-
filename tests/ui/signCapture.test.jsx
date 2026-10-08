import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { recordSignTurn } from "../../src/lib/signCapture.js";

let recorder, track, clock;
beforeEach(() => {
  vi.useFakeTimers(); clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  track = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
  vi.stubGlobal("MediaStream", class { constructor(tracks) { this.tracks = tracks; } });
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported(type) { return type.startsWith("video/webm"); }
    constructor(stream, options) { recorder = this; this.stream = stream; this.mimeType = options.mimeType; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob(["video"]) }); this.onstop(); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const stream = () => ({ getVideoTracks: () => [track], getAudioTracks: () => [{ kind: "audio" }] });

test("recording uses only video, stops at 12 seconds and leaves the camera tracks alive", () => {
  const complete = vi.fn(); const error = vi.fn();
  recordSignTurn(stream(), { onComplete: complete, onError: error });
  expect(recorder.stream.tracks).toEqual([track]);
  clock = 12_000; vi.advanceTimersByTime(100);
  expect(complete).toHaveBeenCalledOnce(); expect(complete.mock.calls[0][0].duration).toBe(12);
  expect(error).not.toHaveBeenCalled(); expect(track.stop).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

test("cancel never produces a clip; camera loss produces a recoverable error once", () => {
  const complete = vi.fn(); const error = vi.fn();
  const capture = recordSignTurn(stream(), { onComplete: complete, onError: error });
  clock = 1000; capture.cancel(); expect(complete).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  recordSignTurn(stream(), { onComplete: complete, onError: error });
  track.dispatchEvent(new Event("ended")); track.dispatchEvent(new Event("ended"));
  expect(error).toHaveBeenCalledExactlyOnceWith("Camera disconnected. Reconnect it and record again."); expect(complete).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("too-short and oversized recordings are never sent as valid clips", () => {
  const complete = vi.fn(); const error = vi.fn();
  const capture = recordSignTurn(stream(), { onComplete: complete, onError: error });
  clock = 200; capture.finish(); expect(error).toHaveBeenCalledOnce(); expect(complete).not.toHaveBeenCalled();
  recordSignTurn(stream(), { onComplete: complete, onError: error });
  recorder.ondataavailable({ data: new Blob([new Uint8Array(2_000_001)]) });
  expect(error).toHaveBeenCalledTimes(2); expect(complete).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
