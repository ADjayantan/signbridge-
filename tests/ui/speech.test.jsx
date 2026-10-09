import { afterEach, beforeEach, expect, test, vi } from "vitest";
let speech;
let synth;
let lastRecognition;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  synth = { speak: vi.fn(), resume: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
  window.speechSynthesis = synth;
  window.SpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  window.SpeechRecognition = class {
    constructor() { lastRecognition = this; }
    start() {}
    abort() {}
    stop() {}
  };
  speech = await import("../../src/lib/speech.js");
});
afterEach(() => { vi.useRealTimers(); });

test("cancel settles queued speech immediately and clears watchdogs without restarting listening", async () => {
  const speaker = speech.createSpeaker();
  const idle = vi.fn(); speaker.setIdleHandler(idle);
  let finished = 0;
  const a = speaker.speak("hello").then(() => finished++);
  const b = speaker.speak("world").then(() => finished++);
  speaker.cancel();
  await Promise.resolve(); await Promise.resolve();
  expect(finished).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
  expect(idle).not.toHaveBeenCalled();
  await Promise.all([a, b]);
});

test("speech callbacks from an aborted microphone session are ignored", () => {
  const interim = vi.fn(); const error = vi.fn(); const ended = vi.fn();
  const recording = speech.listenOnce({ lang: "en-IN", onInterim: interim, onError: error, onEnd: ended });
  recording.abort();
  lastRecognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "stale" }], { isFinal: true })] });
  lastRecognition.onerror({ error: "network" });
  lastRecognition.onend();
  expect(interim).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(ended).not.toHaveBeenCalled();
});

test("a synchronous browser speech failure releases the queue and watchdog", async () => {
  synth.speak.mockImplementation(() => { throw new Error("Speech service unavailable"); });
  const speaker = speech.createSpeaker(); const onError = vi.fn();
  const result = await speaker.speak("hello", { onError });
  expect(result).toMatchObject({ status: "error", code: "synthesis-failed" }); expect(onError).toHaveBeenCalledWith("synthesis-failed");
  expect(speaker.busy).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
test("browser audio activation failure is reported once and a late end event cannot turn it into success", async () => {
  const speaker = speech.createSpeaker(); const onError = vi.fn(); const pending = speaker.speak("Reviewed sign", { lang: "en-IN", onError }); const utterance = synth.speak.mock.calls[0][0];
  utterance.onerror({ error: "not-allowed" }); utterance.onend();
  expect(await pending).toMatchObject({ status: "error", code: "not-allowed" }); expect(onError).toHaveBeenCalledOnce(); expect(speech.speakErrorMessage("not-allowed")).toMatch(/blocked/); expect(speaker.busy).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
test("missing language voice errors stay explicit while an empty voice inventory does not prevent a user-initiated speech request", async () => {
  const speaker = speech.createSpeaker(); const onError = vi.fn(); const pending = speaker.speak("Vanakkam", { lang: "ta-IN", onError });
  expect(synth.speak).toHaveBeenCalledOnce(); const utterance = synth.speak.mock.calls[0][0]; expect(utterance.lang).toBe("ta-IN"); utterance.onerror({ error: "language-unavailable" });
  expect(await pending).toMatchObject({ status: "error", code: "language-unavailable" }); expect(onError).toHaveBeenCalledWith("language-unavailable"); expect(speech.speakErrorMessage("language-unavailable")).toMatch(/voice.*unavailable/);
});
test("a speech request that never starts reports timeout rather than successful playback", async () => {
  const speaker = speech.createSpeaker(); const onError = vi.fn(); const onStart = vi.fn(); const pending = speaker.speak("hello", { onError, onStart });
  await vi.advanceTimersByTimeAsync(8600);
  expect(await pending).toMatchObject({ status: "error", code: "timeout" }); expect(onError).toHaveBeenCalledWith("timeout"); expect(onStart).not.toHaveBeenCalled(); expect(speaker.busy).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
test("explicit cancellation settles silently and ignores delayed browser cancellation errors", async () => {
  const speaker = speech.createSpeaker(); const onError = vi.fn(); const onStart = vi.fn(); const pending = speaker.speak("cancel this request", { onError, onStart }); const utterance = synth.speak.mock.calls[0][0];
  speaker.cancel(); utterance.onerror({ error: "canceled" }); utterance.onstart(); expect(await pending).toEqual({ status: "cancelled" }); expect(onError).not.toHaveBeenCalled(); expect(onStart).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
test("short queued speech waits for a longer preceding turn without a false timeout", async () => {
  const speaker = speech.createSpeaker(); const onError = vi.fn(); const first = speaker.speak("a".repeat(300), { onError }); const second = speaker.speak("x", { onError });
  const firstUtterance = synth.speak.mock.calls[0][0]; const secondUtterance = synth.speak.mock.calls[1][0]; let secondSettled = false; second.then(() => { secondSettled = true; });
  await vi.advanceTimersByTimeAsync(20000); expect(onError).not.toHaveBeenCalled(); expect(secondSettled).toBe(false);
  firstUtterance.onend(); secondUtterance.onstart(); secondUtterance.onend(); expect(await first).toEqual({ status: "ended" }); expect(await second).toEqual({ status: "ended" }); expect(vi.getTimerCount()).toBe(0);
});
