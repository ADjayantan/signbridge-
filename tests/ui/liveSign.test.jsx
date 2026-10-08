import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LiveSignMode from "../../src/modes/LiveSignMode.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";

const mocks = vi.hoisted(() => ({ ask: vi.fn(), interpret: vi.fn(), check: vi.fn(), inspect: vi.fn(), record: vi.fn(), cancel: vi.fn(), finish: vi.fn(), speak: vi.fn(), stopSpeech: vi.fn(), active: false, callbacks: null, frame: null }));
vi.mock("../../src/lib/api.js", () => ({ askSign: mocks.ask, interpretSignVideo: mocks.interpret, checkSignAI: mocks.check }));
vi.mock("../../src/lib/signCapture.js", () => ({ recordSignTurn: (...args) => mocks.record(...args), inspectSignClip: (...args) => mocks.inspect(...args) }));
vi.mock("../../src/lib/drawHands.js", () => ({ drawHands() {} }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useRef } = await import("react");
  return { useCamera: ({ active }) => { mocks.active = active; return { videoRef: useRef(null), status: active ? "on" : "off", devices: [], retry() {} }; } };
});
vi.mock("../../src/hooks/useHandTracking.js", () => ({ useHandTracking: ({ onFrame }) => { mocks.frame = onFrame; return { status: "ready" }; } }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], error: "" }) }));
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, createSpeaker: () => ({ speak: mocks.speak, cancel: mocks.stopSpeech }) }));
const renderMode = (patch = {}) => render(<LiveSignMode settings={{ ...DEFAULT_SETTINGS, ...patch }} update={() => {}} onBack={() => {}} onLibrary={() => {}} onLocal={() => {}} />);
const flush = () => act(async () => {});
const button = (name) => screen.getByRole("button", { name });
const click = (name) => fireEvent.click(button(name));
const start = async () => { renderMode(); await flush(); click("Start sign session"); };
const recordClip = async () => {
  click(/^Sign your turn/);
  act(() => mocks.callbacks.onComplete({ blob: new Blob(["test-video"], { type: "video/webm" }), duration: 2 }));
  await flush();
  fireEvent.loadedData(screen.getByLabelText("Review your signed clip"));
};
const consent = () => fireEvent.click(screen.getByRole("checkbox", { name: /Send this clip to/ }));
const reviewField = () => screen.getByLabelText(/Is this what you meant|Type the meaning if needed/);
const recognized = { status: "recognized", meaning: "Hello", glosses: ["HELLO"], feedback: "Check this meaning" };

beforeEach(() => {
  vi.clearAllMocks(); mocks.callbacks = null;
  mocks.check.mockResolvedValue({ configured: true }); mocks.ask.mockResolvedValue({ reply: "Hello friend" }); mocks.interpret.mockResolvedValue(recognized);
  mocks.inspect.mockResolvedValue(1);
  mocks.record.mockImplementation((_stream, callbacks) => { mocks.callbacks = callbacks; return { cancel: mocks.cancel, finish: mocks.finish }; });
  URL.createObjectURL = vi.fn(() => "blob:turn"); URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

test("turning reply speech off during a pending request suppresses its eventual playback", async () => {
  let resolve; mocks.ask.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  await start(); fireEvent.click(screen.getByText("Session options"));
  fireEvent.click(screen.getByRole("switch", { name: "Speak AI replies aloud" }));
  const typed = screen.getByLabelText("Or type a turn");
  fireEvent.change(typed, { target: { value: "Hello" } }); fireEvent.submit(typed.closest("form"));
  fireEvent.click(screen.getByRole("switch", { name: "Speak AI replies aloud" }));
  await act(async () => resolve({ reply: "I should stay silent" }));
  expect(screen.getByText("I should stay silent")).toBeTruthy(); expect(mocks.speak).not.toHaveBeenCalled();
});

test("the camera starts with the session; ending cancels capture and ignores late recording callbacks", async () => {
  await start(); expect(mocks.active).toBe(true);
  click(/^Sign your turn/); const callbacks = mocks.callbacks;
  click("End session"); expect(mocks.active).toBe(false); expect(mocks.cancel).toHaveBeenCalledOnce();
  act(() => callbacks.onComplete({ blob: new Blob(["late"]), duration: 2 }));
  expect(screen.queryByLabelText("Review your signed clip")).toBeNull(); expect(mocks.interpret).not.toHaveBeenCalled();
});

test("video interpretation requires explicit consent and a playable preview; AI replies wait for meaning confirmation", async () => {
  await start(); await recordClip();
  expect(button("Interpret my signs").disabled).toBe(true); expect(mocks.interpret).not.toHaveBeenCalled();
  consent(); click("Interpret my signs"); await flush();
  expect(mocks.interpret).toHaveBeenCalledOnce(); expect(mocks.interpret.mock.calls[0][0]).toMatchObject({ signLanguage: "isl", lang: "en", consent: true, duration: 2 });
  expect(reviewField().value).toBe("Hello"); expect(mocks.ask).not.toHaveBeenCalled();
  fireEvent.change(reviewField(), { target: { value: "Hello, what can you do?" } });
  click("Confirm meaning & get reply"); await flush();
  expect(mocks.ask.mock.calls[0][0].messages.at(-1).text).toBe("Typed: Hello, what can you do?");
  expect(screen.getByText("Hello friend")).toBeTruthy(); expect(screen.getByText("No matching sign videos yet")).toBeTruthy();
});

test("unclear video results leave meaning blank and let the signer type a correction", async () => {
  mocks.interpret.mockResolvedValue({ status: "unclear", meaning: "", glosses: [], feedback: "Keep both hands visible" });
  await start(); await recordClip(); consent(); click("Interpret my signs"); await flush();
  expect(reviewField().value).toBe(""); expect(button("Confirm meaning & get reply").disabled).toBe(true);
  expect(screen.getByText("I couldn't read this turn reliably")).toBeTruthy(); expect(mocks.ask).not.toHaveBeenCalled();
  fireEvent.change(reviewField(), { target: { value: "I need help" } }); click("Confirm meaning & get reply"); await flush();
  expect(mocks.ask).toHaveBeenCalledOnce();
});

test("interrupt aborts interpretation and suppresses a late response even if the service ignores abort", async () => {
  let resolve; mocks.interpret.mockImplementation(() => new Promise((r) => { resolve = r; }));
  await start(); await recordClip(); consent(); click("Interpret my signs");
  const signal = mocks.interpret.mock.calls[0][0].signal;
  click(/^Interrupt/); expect(signal.aborted).toBe(true);
  await act(async () => resolve(recognized));
  expect(screen.queryByText("Tentative meaning — please check")).toBeNull(); expect(button(/^Sign your turn/).disabled).toBe(false);
});

test("interrupted answers do not speak or enter subsequent conversation history", async () => {
  let resolve; mocks.ask.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  await start(); const typed = screen.getByLabelText("Or type a turn");
  fireEvent.change(typed, { target: { value: "First turn" } }); fireEvent.submit(typed.closest("form"));
  click(/^Interrupt/); await act(async () => resolve({ reply: "Late answer" }));
  expect(screen.queryByText("Late answer")).toBeNull(); expect(mocks.speak).not.toHaveBeenCalled();
  fireEvent.change(typed, { target: { value: "Second turn" } }); fireEvent.submit(typed.closest("form")); await flush();
  expect(mocks.ask.mock.calls[1][0].messages).toEqual([{ role: "user", text: "Typed: Second turn" }]);
  expect(screen.getByText("Interrupted. You can sign again.")).toBeTruthy();
});

test("completed turns preserve conversation context and failed sends preserve reviewed meaning for retry", async () => {
  await start(); const typed = screen.getByLabelText("Or type a turn");
  fireEvent.change(typed, { target: { value: "Hello" } }); fireEvent.submit(typed.closest("form")); await flush();
  mocks.ask.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.change(typed, { target: { value: "How are you?" } }); fireEvent.submit(typed.closest("form")); await flush();
  expect(reviewField().value).toBe("How are you?");
  click("Confirm meaning & get reply"); await flush();
  expect(mocks.ask.mock.calls[2][0].messages).toEqual([{ role: "user", text: "Typed: Hello" }, { role: "assistant", text: "Hello friend" }, { role: "user", text: "Typed: How are you?" }]);
});

test("missing AI configuration explains the blocker but still permits local camera recording", async () => {
  mocks.check.mockResolvedValue({ configured: false }); await start(); await recordClip(); consent();
  expect(screen.getByText("AI setup needed")).toBeTruthy(); expect(button("Interpret my signs").disabled).toBe(true);
  expect(mocks.record).toHaveBeenCalledOnce(); expect(mocks.interpret).not.toHaveBeenCalled();
});

test("sending a replacement recording requires fresh consent and reviewed text can be spoken locally", async () => {
  await start(); await recordClip(); consent();
  fireEvent.change(reviewField(), { target: { value: "Hello there" } }); click("Speak my message");
  expect(mocks.speak).toHaveBeenCalledWith("Hello there", expect.objectContaining({ lang: "en-IN" }));
  click(/^Record again/); act(() => mocks.callbacks.onComplete({ blob: new Blob(["second"], { type: "video/mp4" }), duration: 1 })); await flush();
  expect(screen.getByRole("checkbox", { name: /Send this clip to/ }).checked).toBe(false);
  expect(reviewField().value).toBe(""); expect(button("Interpret my signs").disabled).toBe(true);
});

test("optional hands-down finishing waits for a signing turn and ignores an empty frame at the beginning", async () => {
  let now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
  await start(); fireEvent.click(screen.getByText("Session options"));
  fireEvent.click(screen.getByRole("switch", { name: /^Finish when hands lower/ })); click(/^Sign your turn/);
  const frame = (at, present) => {
    now = at;
    act(() => mocks.frame({ landmarks: present ? [Array.from({ length: 21 }, () => ({ x: .5, y: .5, z: 0 }))] : [] }, { videoWidth: 640, videoHeight: 480 }));
  };
  act(() => mocks.callbacks.onElapsed(2200)); frame(2000, false); expect(mocks.finish).not.toHaveBeenCalled();
  frame(2100, true); frame(3000, false); expect(mocks.finish).not.toHaveBeenCalled();
  frame(3400, false); expect(mocks.finish).toHaveBeenCalledOnce();
});

test("recording errors recover to a new turn and unmount cancels owned work", async () => {
  await start(); click(/^Sign your turn/); act(() => mocks.callbacks.onError("Camera disconnected"));
  expect(screen.getByRole("alert").textContent).toBe("Camera disconnected");
  click(/^Sign your turn/); cleanup(); expect(mocks.cancel).toHaveBeenCalledOnce(); expect(mocks.stopSpeech).toHaveBeenCalled();
});

test("Space cannot start a camera turn while an imported video is still being inspected", async () => {
  let resolve;
  mocks.inspect.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await start();
  const imported = new File(["imported-video"], "signed-turn.mp4", { type: "video/mp4" });
  fireEvent.change(screen.getByLabelText("Import a live sign turn"), { target: { files: [imported] } });
  expect(button(/^Sign your turn/).disabled).toBe(true);
  fireEvent.keyDown(window, { key: " ", code: "Space" });
  expect(mocks.record).not.toHaveBeenCalled();
  await act(async () => resolve(6));
  expect(screen.getByText("6.0 seconds")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Send this clip to/ }).checked).toBe(false);
  expect(mocks.interpret).not.toHaveBeenCalled();
});

test("ending during a slow import prevents its late result from replacing a new camera turn", async () => {
  let resolve;
  mocks.inspect.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await start();
  fireEvent.change(screen.getByLabelText("Import a live sign turn"), {
    target: { files: [new File(["old-import"], "old-turn.mp4", { type: "video/mp4" })] },
  });
  click("End session"); click("Start sign session");
  await recordClip();
  expect(screen.getByText("2.0 seconds")).toBeTruthy();
  await act(async () => resolve(6));
  expect(screen.getByText("2.0 seconds")).toBeTruthy();
  expect(screen.queryByText("6.0 seconds")).toBeNull();
  expect(mocks.interpret).not.toHaveBeenCalled();
});

test("a typed submit during video inspection keeps the typed draft and waits for the imported clip", async () => {
  let resolve;
  mocks.inspect.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await start();
  const typed = screen.getByLabelText("Or type a turn");
  fireEvent.change(typed, { target: { value: "Can you help me?" } });
  fireEvent.change(screen.getByLabelText("Import a live sign turn"), {
    target: { files: [new File(["new-import"], "new-turn.mp4", { type: "video/mp4" })] },
  });
  fireEvent.submit(typed.closest("form"));
  expect(mocks.ask).not.toHaveBeenCalled();
  expect(typed.value).toBe("Can you help me?");
  await act(async () => resolve(6));
  expect(screen.getByText("6.0 seconds")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Send this clip to/ }).checked).toBe(false);
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("a replacement video inspection blocks interpretation of the prior clip and resets its consent", async () => {
  let resolve;
  await start(); await recordClip(); consent();
  expect(button("Interpret my signs").disabled).toBe(false);
  mocks.inspect.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  fireEvent.change(screen.getByLabelText("Import a live sign turn"), {
    target: { files: [new File(["new-import"], "new-turn.mp4", { type: "video/mp4" })] },
  });
  click("Interpret my signs");
  expect(mocks.interpret).not.toHaveBeenCalled();
  await act(async () => resolve(6));
  expect(screen.getByText("6.0 seconds")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Send this clip to/ }).checked).toBe(false);
  expect(button("Interpret my signs").disabled).toBe(true);
  expect(mocks.ask).not.toHaveBeenCalled();
});
