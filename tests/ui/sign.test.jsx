import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SignMode from "../../src/modes/SignMode.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";
import { toFeatures } from "../../src/lib/features.js";
import { SignClassifier } from "../../src/lib/knn.js";
import { SHAPES, handPixels, makeHand } from "../helpers/hands.js";

const mocks = vi.hoisted(() => ({ ask: vi.fn(), speak: vi.fn(), frame: null, mic: null }));
vi.mock("../../src/lib/api.js", () => ({ askSign: mocks.ask }));
vi.mock("../../src/lib/drawHands.js", () => ({ drawHands() {} }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useRef } = await import("react");
  return { useCamera: ({ active }) => ({ videoRef: useRef(null), status: active ? "on" : "off", retry() {} }) };
});
vi.mock("../../src/hooks/useHandTracking.js", () => ({ useHandTracking: ({ onFrame }) => { mocks.frame = onFrame; return { status: "ready", fps: 30, delegate: "CPU" }; } }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], add() {}, remove() {} }) }));
vi.mock("../../src/lib/speech.js", () => ({
  canListen: true, canSpeak: true, getVoices: async () => [], pickVoice: () => null,
  createSpeaker: () => ({ speak: mocks.speak, cancel() {} }),
  listenOnce: (callbacks) => { mocks.mic = callbacks; return { abort() {}, stop() {} }; },
  listenErrorMessage: () => "Microphone blocked",
}));
let now;
const setup = (patch = {}) => render(<SignMode settings={{ ...DEFAULT_SETTINGS, ...patch }} update={() => {}} onBack={() => {}} />);
const result = (score = .9, x = .5, gesture = "Open_Palm") => ({ landmarks: [Array.from({ length: 21 }, () => ({ x, y: .5, z: 0 }))], gestures: [[{ categoryName: gesture, score }]] });
const frame = (at, hands = result()) => { now = at; act(() => mocks.frame(hands, { videoWidth: 640, videoHeight: 480, currentTime: at / 1000, paused: false })); };
const hold = (at, hands) => { for (let t = at; t <= at + 1400; t += 100) frame(t, hands); };
const review = () => screen.getByLabelText("Review / correct recognized words");
beforeEach(() => {
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.clearAllMocks(); localStorage.clear(); mocks.mic = null;
  URL.createObjectURL = vi.fn(() => "blob:test"); URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

test("a held sign commits once and speaks once even if held for several more seconds", () => {
  setup({ speakSigns: true, gestureShortcuts: true }); frame(1000); frame(1800); frame(5000);
  expect(review().value).toBe("HELLO");
  expect(mocks.speak).toHaveBeenCalledTimes(1);
  expect(mocks.speak.mock.calls[0][0]).toBe("HELLO");
});

test("careful recognition rejects low confidence and frame-edge hands", () => {
  setup({ recognitionProfile: "careful", gestureShortcuts: true });
  frame(1000, result(.6)); frame(2500, result(.6));
  frame(3000, result(.9, .005)); frame(4500, result(.9, .005));
  expect(review().value).toBe("");
});

test("correcting a transcript disarms automatic sending", () => {
  setup({ autoSendMs: 1500, gestureShortcuts: true }); frame(1000); frame(1800);
  fireEvent.focus(review()); fireEvent.change(review(), { target: { value: "HELLO FRIEND" } }); fireEvent.blur(review());
  frame(4000, { landmarks: [] });
  expect(review().value).toBe("HELLO FRIEND"); expect(mocks.ask).not.toHaveBeenCalled();
});

test("automatic send waits for the configured hands-down interval and sends once", async () => {
  mocks.ask.mockResolvedValue({ reply: "Hello" }); setup({ autoSendMs: 1500, gestureShortcuts: true });
  frame(1000); frame(1800); frame(2800, { landmarks: [] });
  expect(mocks.ask).not.toHaveBeenCalled();
  frame(3400, { landmarks: [] }); frame(6000, { landmarks: [] });
  await act(async () => {});
  expect(mocks.ask).toHaveBeenCalledOnce();
  expect(mocks.ask.mock.calls[0][0].messages[0].text).toBe("Signed: HELLO");
});

test("careful mode commits a fully framed confident sign only after its longer hold", () => {
  setup({ recognitionProfile: "careful", gestureShortcuts: true }); frame(1000); frame(1800);
  expect(review().value).toBe(""); frame(2200); expect(review().value).toBe("HELLO");
});

test("failed AI sends restore reviewed words for retry", async () => {
  mocks.ask.mockRejectedValue(new Error("API key missing")); setup();
  fireEvent.change(review(), { target: { value: "HELP ME" } });
  fireEvent.click(screen.getByRole("button", { name: /^Send Enter/ }));
  await act(async () => {});
  expect(review().value).toBe("HELP ME"); expect(screen.getAllByText("API key missing")).toHaveLength(2);
});

test("face-to-face typed replies and sending reviewed signs work without calling AI", async () => {
  setup(); fireEvent.click(screen.getByRole("switch", { name: /^Face-to-face bridge/ }));
  fireEvent.change(review(), { target: { value: "THANK YOU" } });
  fireEvent.click(screen.getByRole("button", { name: /^Send Enter/ }));
  const typed = screen.getByLabelText("Type a message instead");
  fireEvent.change(typed, { target: { value: "Welcome" } }); fireEvent.submit(typed.closest("form"));
  await act(async () => {});
  expect(screen.getByText("Partner said")).toBeTruthy(); expect(review().value).toBe("");
  expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.speak).toHaveBeenCalledWith("THANK YOU", expect.anything());
});

test("replaying an older reply preserves its original spoken language", async () => {
  mocks.ask.mockResolvedValue({ meaning: "hello", reply: "Hello there" });
  const app = setup(); const typed = screen.getByLabelText("Type a message instead");
  fireEvent.change(typed, { target: { value: "Hello" } }); fireEvent.submit(typed.closest("form"));
  await act(async () => {});
  app.rerender(<SignMode settings={{ ...DEFAULT_SETTINGS, lang: "ta" }} update={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Speak reply" }));
  expect(mocks.speak.mock.calls.at(-1)[1].lang).toBe("en-IN");
});

test("partial microphone results after an error never enter the conversation", () => {
  setup(); fireEvent.click(screen.getByRole("switch", { name: /^Face-to-face bridge/ }));
  fireEvent.click(screen.getByRole("button", { name: "Listen to partner" }));
  act(() => { mocks.mic.onError("not-allowed"); mocks.mic.onEnd("unreliable partial words"); });
  expect(screen.queryByText("Partner said")).toBeNull();
  expect(screen.getByText("Microphone blocked")).toBeTruthy();
});

test("an unknown open palm does not invent or speak HELLO with default settings", () => {
  setup({ speakSigns: true }); hold(1000, result());
  expect(review().value).toBe("");
  expect(mocks.speak).not.toHaveBeenCalled();
  expect(screen.getByText("0 saved static signs · ISL")).toBeTruthy();
  expect(screen.getByText(/No known sign matched/)).toBeTruthy();
  expect(screen.getByRole("switch", { name: /^Use gesture shortcuts/ }).checked).toBe(false);
});

test("opted-in gestures append and speak distinct HELLO, YES, NO and WAIT words", () => {
  setup({ speakSigns: true, gestureShortcuts: true });
  hold(1000, result()); hold(2500, result(.9, .5, "Thumb_Up"));
  hold(4000, result(.9, .5, "Thumb_Down")); hold(5500, result(.9, .5, "Pointing_Up"));
  expect(review().value).toBe("HELLO YES NO WAIT");
  expect(mocks.speak.mock.calls.map(([text]) => text)).toEqual(["HELLO", "YES", "NO", "WAIT"]);
});

test("saved personal words speak without gesture shortcuts or an AI key", () => {
  const water = makeHand(handPixels({ curl: SHAPES.call }));
  const help = makeHand(handPixels({ curl: SHAPES.point }));
  const c = new SignClassifier();
  c.addSamples("WATER", [toFeatures([water], 4 / 3)]);
  c.addSamples("HELP", [toFeatures([help], 4 / 3)]);
  localStorage.setItem("signbridge:signs:isl", JSON.stringify(c.toJSON()));
  const asResult = (hand) => ({ landmarks: [hand.landmarks], worldLandmarks: [hand.world], handedness: [[{ categoryName: "Right", score: .95 }]], gestures: [[{ categoryName: "Open_Palm", score: .95 }]] });
  setup({ speakSigns: true }); hold(1000, asResult(water)); hold(2500, asResult(help));
  expect(review().value).toBe("WATER HELP");
  expect(mocks.speak.mock.calls.map(([text]) => text)).toEqual(["WATER", "HELP"]);
  expect(mocks.ask).not.toHaveBeenCalled();
  expect(screen.getByText("2 saved static signs · ISL")).toBeTruthy();
});

test("turning shortcuts off clears a partly held word and disarms pending auto-send", () => {
  const app = setup({ gestureShortcuts: true, speakSigns: true, autoSendMs: 1500 });
  frame(1000); frame(1400);
  app.rerender(<SignMode settings={{ ...DEFAULT_SETTINGS, speakSigns: true, autoSendMs: 1500 }} update={() => {}} onBack={() => {}} />);
  hold(1500, result());
  expect(review().value).toBe(""); expect(mocks.speak).not.toHaveBeenCalled();
  app.rerender(<SignMode settings={{ ...DEFAULT_SETTINGS, gestureShortcuts: true, speakSigns: true, autoSendMs: 1500 }} update={() => {}} onBack={() => {}} />);
  hold(3000, result()); expect(review().value).toBe("HELLO");
  app.rerender(<SignMode settings={{ ...DEFAULT_SETTINGS, autoSendMs: 1500 }} update={() => {}} onBack={() => {}} />);
  frame(7000, { landmarks: [] });
  expect(mocks.ask).not.toHaveBeenCalled(); expect(review().value).toBe("HELLO");
});
