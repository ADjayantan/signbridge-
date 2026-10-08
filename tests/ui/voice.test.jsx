import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVoiceAssistant } from "../../src/hooks/useVoiceAssistant.js";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), listen: vi.fn(), cancel: vi.fn(), speak: vi.fn() }));
vi.mock("../../src/lib/api.js", () => ({ streamVoice: mocks.stream }));
vi.mock("../../src/lib/earcons.js", () => ({ earcon: { error() {}, listen() {}, stop() {}, send() {}, thinking() {} } }));
vi.mock("../../src/lib/speech.js", () => ({
  canListen: true, canSpeak: true, getVoices: async () => [], pickVoice: () => null,
  listenOnce: mocks.listen, listenErrorMessage: () => "Microphone blocked",
  createSpeaker: () => ({ speak: mocks.speak, cancel: mocks.cancel, busy: false, setIdleHandler() {} }),
}));
const options = { lang: "en", rate: 1, handsFree: true, voiceOutput: "screenreader" };
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

test("cancelled streams finish their pending row and cannot overwrite it when EOF arrives later", async () => {
  let end;
  mocks.stream.mockImplementation(async function* () { yield "Partial answer"; await new Promise((r) => { end = r; }); });
  const { result } = renderHook(() => useVoiceAssistant(options));
  let request;
  await act(async () => { request = result.current.ask("hello"); });
  act(() => result.current.cancel());
  expect(result.current.messages[1].pending).toBe(false);
  expect(result.current.messages[1].interrupted).toBe(true);
  await act(async () => { end(); await request; });
  expect(result.current.messages[1].interrupted).toBe(true);
  expect(result.current.announcement).toBe("");
  expect(result.current.status).toBe("idle");
});

test("failed voice requests show a readable error and do not restart hands-free listening", async () => {
  mocks.stream.mockImplementation(async function* () { throw new Error("Service unavailable"); });
  const { result } = renderHook(() => useVoiceAssistant({ ...options, voiceOutput: "voice" }));
  await act(async () => { await result.current.ask("hello"); });
  expect(result.current.messages[1]).toMatchObject({ pending: false, error: true, text: "Service unavailable" });
  expect(result.current.status).toBe("idle");
  expect(mocks.listen).not.toHaveBeenCalled();
});

test("a successful spoken answer restarts hands-free listening exactly once", async () => {
  mocks.stream.mockImplementation(async function* () { yield "Hello."; });
  mocks.listen.mockReturnValue({ stop() {}, abort() {} });
  const { result } = renderHook(() => useVoiceAssistant({ ...options, voiceOutput: "voice" }));
  await act(async () => { await result.current.ask("hello"); });
  expect(result.current.messages[1]).toMatchObject({ text: "Hello.", pending: false });
  expect(mocks.speak).toHaveBeenCalledWith("Hello.", expect.anything());
  expect(mocks.listen).toHaveBeenCalledOnce();
  expect(result.current.status).toBe("listening");
});

test("failed microphone sessions do not send their partial transcript to AI", async () => {
  let callbacks;
  mocks.listen.mockImplementation((value) => { callbacks = value; return { stop() {}, abort() {} }; });
  const { result } = renderHook(() => useVoiceAssistant(options));
  act(() => result.current.toggle());
  await act(async () => { callbacks.onError("not-allowed"); callbacks.onEnd("partial"); });
  expect(mocks.stream).not.toHaveBeenCalled();
  expect(result.current.error).toBe("Microphone blocked");
  expect(result.current.status).toBe("idle");
});
