import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TrainedSignMode from "../../src/modes/TrainedSignMode.jsx";
import { DEFAULT_SETTINGS } from "../../src/hooks/useSettings.js";
import { legacyCameraModel } from "../helpers/legacyCamera.js";

const mocks = vi.hoisted(() => ({
  active: false, frame: null, cameraStatus: "on", trackingStatus: "ready", trained: null,
  predict: vi.fn(), speak: vi.fn(), stopSpeech: vi.fn(), retry: vi.fn(), language: null,
  ask: vi.fn(), check: vi.fn(), save: vi.fn(), draw: vi.fn(),
}));
vi.mock("../../src/lib/drawHands.js", () => ({ drawHands: mocks.draw }));
vi.mock("../../src/lib/api.js", () => ({ askSign: mocks.ask, checkSignAI: mocks.check, interpretSignVideo: vi.fn() }));
vi.mock("../../src/hooks/useTrainingSamples.js", () => ({ useTrainingSamples: () => ({ samples: [], loading: false, error: "", add: mocks.save }) }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], loading: false, error: "" }) }));
vi.mock("../../src/hooks/useCamera.js", async () => {
  const { useRef } = await import("react");
  return { useCamera: ({ active }) => {
    mocks.active = active;
    return { videoRef: useRef(null), status: active ? mocks.cameraStatus : "off", devices: [], error: "Camera disconnected", retry: mocks.retry };
  } };
});
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ onFrame, active }) => {
  mocks.frame = onFrame;
  return { status: active ? mocks.trackingStatus : "idle", error: "Tracking unavailable", retry: mocks.retry };
} }));
vi.mock("../../src/hooks/useTrainedModel.js", () => ({ useTrainedModel: (language) => {
  mocks.language = language;
  return mocks.trained;
} }));
vi.mock("../../src/lib/trainedSignModel.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, poseFrameFromHolistic: (result) => result, predictTrainedSign: (...args) => {
    const next = mocks.predict(...args);
    return { ...next, diagnostics: next.diagnostics ?? real.predictTrainedSign(...args).diagnostics };
  } };
});
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, createSpeaker: () => ({ speak: mocks.speak, cancel: mocks.stopSpeech }) }));

const setup = (patch = {}, props = {}) => render(<TrainedSignMode settings={{ ...DEFAULT_SETTINGS, ...patch }} update={() => {}} onBack={() => {}} onLive={() => {}} {...props} />);
const button = (name) => screen.getByRole("button", { name });
const click = (name) => fireEvent.click(button(name));
const disclosure = (name) => screen.getByText(name, { selector: "summary", exact: true }).closest("details");
const openDisclosure = (name) => {
  const section = disclosure(name);
  if (!section.open) fireEvent.click(section.querySelector("summary"));
  expect(section.open).toBe(true);
  return section;
};
const enableAutoSpeech = () => { openDisclosure("Advanced settings"); fireEvent.click(screen.getByRole("switch", { name: /^Speak recognized words/ })); };
const pose = () => ({ keypoints: Array.from({ length: 75 }, () => [.5, .5, 0]), confidences: Array(75).fill(1) });
const emit = (count = 4) => act(() => {
  for (let i = 0; i < count; i++) { now += 125; mocks.frame(pose(), { videoWidth: 640, videoHeight: 480 }); }
});
const capture = () => { click("Start camera"); emit(1); click(/^Capture a sign/); emit(); };

let now;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active = false; mocks.frame = null; mocks.cameraStatus = "on"; mocks.trackingStatus = "ready";
  mocks.trained = { status: "ready", model: { ...legacyCameraModel(), signLanguage: "isl", labels: ["WATER", "HELP"], metrics: { test: { top1_accuracy: .8 } } }, error: "", retry: mocks.retry };
  mocks.predict.mockReturnValue({ status: "recognized", meaning: "WATER", glosses: ["WATER"], feedback: "Check this prediction" });
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
  mocks.check.mockImplementation(() => new Promise(() => {}));
  mocks.ask.mockResolvedValue({ reply: "I can help you." }); mocks.save.mockResolvedValue({ id: "saved" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("words are inferred only after Finish, never from an intermediate hand frame", () => {
  setup(); click("Start camera"); emit(2);
  expect(mocks.predict).not.toHaveBeenCalled();
  click(/^Capture a sign/); emit(4);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  click(/^Finish sign/);
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.predict.mock.calls[0][1]).toHaveLength(4);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
  expect(mocks.speak).not.toHaveBeenCalled();
});

test("Cancel discards the captured movement and the next turn starts from fresh frames", () => {
  setup(); capture(); click("Cancel turn"); emit(2);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  click(/^Capture a sign/); emit(5); click(/^Finish sign/);
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.predict.mock.calls[0][1]).toHaveLength(5);
});

test("missing trained weights allow explicit local joint tracking while word inference stays unavailable", () => {
  mocks.trained = { status: "error", model: null, error: "The trained ASL model is not available here yet.", retry: mocks.retry };
  setup({ signLanguage: "asl" });
  expect(mocks.language).toBe("asl");
  expect(button("Start camera").disabled).toBe(false); expect(mocks.active).toBe(false);
  click("Start camera"); expect(mocks.active).toBe(true); emit(2);
  expect(screen.getByText("Tracking joints · word recognition unavailable")).toBeTruthy();
  expect(screen.getByText("42 hand joints tracked")).toBeTruthy(); expect(button(/^Capture a sign/).disabled).toBe(true);
  expect(mocks.draw).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([expect.objectContaining({ handedness: "Left" }), expect.objectContaining({ handedness: "Right" })]), 640, 480, { showLabels: true, showJointNumbers: false, mirrorText: true });
  fireEvent.keyDown(window, { code: "Space", key: " " }); expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  expect(screen.getByText("The trained ASL model is not available here yet.")).toBeTruthy();
  click("Reload trained model"); expect(mocks.retry).toHaveBeenCalledOnce();
  expect(mocks.predict).not.toHaveBeenCalled();
});

test("joint overlays count only complete detected hands and numbering never starts word recognition", () => {
  mocks.trained = { status: "error", model: null, error: "Word model unavailable", retry: mocks.retry };
  setup(); click("Start camera"); emit(2);
  openDisclosure("Advanced settings");
  fireEvent.click(screen.getByRole("switch", { name: /^Show hand-joint numbers/ })); emit(2);
  expect(mocks.draw.mock.calls.at(-1)[4]).toEqual({ showLabels: true, showJointNumbers: true, mirrorText: true });
  act(() => { now += 200; const partial = pose(); partial.confidences[50] = 0; mocks.frame(partial, { videoWidth: 640, videoHeight: 480 }); });
  expect(screen.getByText("21 hand joints tracked")).toBeTruthy(); expect(screen.getByText(/left 0\/21 · right 21\/21/)).toBeTruthy();
  expect(mocks.draw.mock.calls.at(-1)[1]).toHaveLength(1); expect(mocks.draw.mock.calls.at(-1)[1][0].handedness).toBe("Right");
  act(() => { now += 200; const absent = pose(); absent.confidences.fill(0); mocks.frame(absent, { videoWidth: 640, videoHeight: 480 }); });
  expect(screen.getByText("0 hand joints tracked")).toBeTruthy(); expect(mocks.draw.mock.calls.at(-1)[1]).toEqual([]);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("a loading word model does not prevent explicit camera tracking and tracked counts reset when the camera stops", () => {
  mocks.trained = { status: "loading", model: null, error: "", retry: mocks.retry };
  setup(); expect(mocks.active).toBe(false); click("Start camera"); emit(2);
  expect(screen.getByText("42 hand joints tracked")).toBeTruthy(); expect(button(/^Capture a sign/).disabled).toBe(true);
  click("End session"); expect(mocks.active).toBe(false); expect(screen.queryByText("42 hand joints tracked")).toBeNull();
  click("Start camera"); expect(screen.getByText("0 hand joints tracked")).toBeTruthy(); expect(mocks.predict).not.toHaveBeenCalled();
});

test("End clears the reviewed word and releases the session camera", () => {
  setup(); capture(); click(/^Finish sign/);
  expect(mocks.active).toBe(true);
  click("End session");
  expect(mocks.active).toBe(false);
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(button("Start camera")).toBeTruthy();
  expect(mocks.stopSpeech).toHaveBeenCalled();
});

test("a lost camera cancels capture and prevents a partial prediction", () => {
  const app = setup(); capture();
  mocks.cameraStatus = "error";
  app.rerender(<TrainedSignMode settings={DEFAULT_SETTINGS} update={() => {}} onBack={() => {}} onLive={() => {}} />);
  expect(screen.getByText("Tracking stopped during the turn. Reconnect the camera and try again.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Finish sign/ })).toBeNull();
  emit(2); expect(mocks.predict).not.toHaveBeenCalled();
  mocks.cameraStatus = "on";
  app.rerender(<TrainedSignMode settings={DEFAULT_SETTINGS} update={() => {}} onBack={() => {}} onLive={() => {}} />);
  emit(1);
  click(/^Capture a sign/); emit(4); click(/^Finish sign/);
  expect(mocks.predict.mock.calls[0][1]).toHaveLength(4);
});

test("a tracking failure cancels capture without speaking or predicting a partial turn", () => {
  const app = setup(); capture();
  mocks.trackingStatus = "error";
  app.rerender(<TrainedSignMode settings={DEFAULT_SETTINGS} update={() => {}} onBack={() => {}} onLive={() => {}} />);
  expect(button(/^Capture a sign/).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Cancel turn" })).toBeNull();
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
});

test("uncertain words stay silent with auto speech enabled; a reviewed correction can be spoken", () => {
  mocks.predict.mockReturnValue({ status: "unclear", meaning: "", glosses: [], feedback: "No vocabulary match" });
  setup(); enableAutoSpeech();
  capture(); click(/^Finish sign/);
  expect(screen.getByText("No reliable word match")).toBeTruthy();
  expect(button("Speak this word").disabled).toBe(true); expect(mocks.speak).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: " HELP " } });
  click("Speak this word");
  expect(mocks.speak).toHaveBeenCalledWith("HELP", expect.objectContaining({ lang: "en-IN" }));
});

test("recognized auto speech waits for the complete sign and speaks only that accepted word", () => {
  setup(); enableAutoSpeech();
  capture(); expect(mocks.speak).not.toHaveBeenCalled();
  click(/^Finish sign/);
  expect(mocks.speak).toHaveBeenCalledOnce(); expect(mocks.speak.mock.calls[0][0]).toBe("WATER");
});

test("Escape cancels a turn without inference or a stale recognized word", () => {
  setup(); capture(); fireEvent.keyDown(window, { key: "Escape" });
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(button(/^Capture a sign/).disabled).toBe(false);
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
});

test("a 12 second turn finishes once and stops collecting further frames", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  setup(); click("Start camera"); emit(1); click(/^Capture a sign/);
  act(() => { for (let i = 0; i < 96; i++) { now += 125; mocks.frame(pose(), { videoWidth: 640, videoHeight: 480 }); vi.advanceTimersByTime(125); } });
  expect(mocks.predict).toHaveBeenCalledOnce();
  emit(2); act(() => vi.advanceTimersByTime(12000));
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.predict.mock.calls[0][1]).toHaveLength(96);
});

test("a dense complete capture bounds pose samples without losing their order", () => {
  setup(); click("Start camera"); emit(1); click(/^Capture a sign/);
  act(() => {
    for (let i = 0; i < 150; i++) { now += 5; mocks.frame(pose(), { videoWidth: 640, videoHeight: 480 }); }
  });
  expect(mocks.predict).not.toHaveBeenCalled();
  click(/^Finish sign/);
  expect(mocks.predict).toHaveBeenCalledOnce();
  const captured = mocks.predict.mock.calls[0][1];
  expect(captured).toHaveLength(100);
  expect(captured.map((frame) => frame.atMs)).toEqual(Array.from({ length: 100 }, (_, i) => (i + 1) * 5));
  emit(4); expect(mocks.predict).toHaveBeenCalledOnce();
});

const message = () => screen.getByLabelText("Review or edit your message");
const aiSetup = async () => { mocks.check.mockResolvedValue({ configured: true }); setup(); openDisclosure("AI replies (optional)"); await act(async () => {}); };

test("a recognized greeting needs one explicit word confirmation for an AI reply without an empty-draft dead end", async () => {
  mocks.predict.mockReturnValue({ status: "recognized", meaning: "HELLO", feedback: "Check the greeting" });
  await aiSetup(); capture(); click(/^Finish sign/);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELLO");
  expect(message().value).toBe(""); expect(mocks.ask).not.toHaveBeenCalled();
  expect(button("Confirm word & get AI reply").disabled).toBe(false);
  click("Confirm word & get AI reply"); await act(async () => {});
  expect(mocks.ask).toHaveBeenCalledOnce();
  expect(mocks.ask.mock.calls[0][0].messages.at(-1).text).toBe("Typed: HELLO");
  expect(screen.getByText("I can help you.")).toBeTruthy();
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "AI conversation" }));
  expect(mocks.speak).not.toHaveBeenCalled();
});

test("a longer draft must be reviewed as a whole rather than discarded by the word reply action", async () => {
  await aiSetup(); fireEvent.change(message(), { target: { value: "Please explain" } });
  capture(); click(/^Finish sign/);
  expect(screen.queryByRole("button", { name: "Confirm word & get AI reply" })).toBeNull();
  click("Add word to message"); expect(message().value).toBe("Please explain WATER");
  click("Send reviewed message"); await act(async () => {});
  expect(mocks.ask.mock.calls[0][0].messages.at(-1).text).toBe("Typed: Please explain WATER");
});

test("failed word replies retain the reviewed greeting for an explicit retry", async () => {
  mocks.ask.mockRejectedValueOnce(new Error("AI connection interrupted"));
  await aiSetup(); capture(); click(/^Finish sign/);
  click("Confirm word & get AI reply"); await act(async () => {});
  expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
  expect(button("Confirm word & get AI reply").disabled).toBe(false);
  expect(screen.getAllByText("AI connection interrupted").length).toBeGreaterThan(0);
  expect(mocks.ask).toHaveBeenCalledOnce();
});

test("a missing key is not advertised as available room AI and local word speech remains usable", async () => {
  mocks.check.mockResolvedValue({ configured: false, roomAuthRequired: true });
  setup({}, { initialDestination: "ai" }); await act(async () => {});
  capture(); click(/^Finish sign/);
  expect(screen.getByText("AI replies need setup")).toBeTruthy();
  expect(screen.queryByText("AI help is available inside rooms")).toBeNull();
  expect(screen.getByText(/AI cannot reply yet: the server has no Gemini key configured/)).toBeTruthy();
  expect(button("Confirm word & get AI reply").disabled).toBe(true);
  click("Confirm word & get AI reply"); expect(mocks.ask).not.toHaveBeenCalled();
  click("Speak this word"); await act(async () => {});
  expect(mocks.speak).toHaveBeenCalledWith("WATER", expect.objectContaining({ lang: "en-IN" }));
});

test("speech errors explain silence and retain both the reviewed word and draft", async () => {
  mocks.speak.mockResolvedValueOnce({ status: "error", error: "Speech playback was blocked. Press Speak again." });
  setup(); capture(); click(/^Finish sign/);
  fireEvent.change(message(), { target: { value: "Please help" } });
  click("Speak this word"); await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Speech playback was blocked");
  expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
  expect(message().value).toBe("Please help"); expect(mocks.ask).not.toHaveBeenCalled();
});

test("stopping speech suppresses a late start or error from the old utterance", async () => {
  let settle;
  mocks.speak.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  setup(); capture(); click(/^Finish sign/); click("Speak this word");
  const options = mocks.speak.mock.calls.at(-1)[1];
  expect(screen.getByLabelText("Voice playback status").textContent).toBe("Starting voice playback…");
  click("Stop speech");
  await act(async () => { options.onStart(); settle({ status: "error", error: "Late blocked voice" }); });
  expect(screen.queryByLabelText("Voice playback status")).toBeNull();
  expect(screen.queryByText(/Late blocked voice/)).toBeNull();
  expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
});

test("actual speech start and completion provide feedback without fabricating an AI response", async () => {
  let settle;
  mocks.speak.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  setup(); capture(); click(/^Finish sign/); click("Speak this word");
  act(() => mocks.speak.mock.calls.at(-1)[1].onStart());
  expect(screen.getByLabelText("Voice playback status").textContent).toBe("Speaking: WATER");
  await act(async () => settle({ status: "ended" }));
  expect(screen.getByLabelText("Voice playback status").textContent).toContain("Voice playback finished");
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("local purpose is the default and changing to AI preserves the camera, reviewed word and draft without sending", async () => {
  mocks.check.mockResolvedValue({ configured: true });
  setup(); capture(); click(/^Finish sign/);
  fireEvent.change(message(), { target: { value: "Explain this word" } });
  const preview = document.querySelector("video");
  const local = screen.getByRole("radio", { name: /^Text & voice/ });
  const ai = screen.getByRole("radio", { name: /^AI assistant/ });
  expect(local.checked).toBe(true); expect(ai.checked).toBe(false);
  expect(button("Send reviewed message").disabled).toBe(true);
  await act(async () => fireEvent.click(ai));
  expect(ai.checked).toBe(true); expect(disclosure("AI replies (optional)").open).toBe(true);
  expect(message().value).toBe("Explain this word"); expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
  expect(document.querySelector("video")).toBe(preview); expect(mocks.active).toBe(true);
  expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(local));
  expect(local.checked).toBe(true); expect(disclosure("AI replies (optional)").open).toBe(false);
  expect(message().value).toBe("Explain this word"); expect(document.querySelector("video")).toBe(preview);
  expect(button("Send reviewed message").disabled).toBe(true); expect(mocks.ask).not.toHaveBeenCalled();
});

test("an AI entry hint selects AI but still requires an explicit reviewed message send", async () => {
  mocks.check.mockResolvedValue({ configured: true });
  setup({}, { initialDestination: "ai" }); await act(async () => {});
  expect(screen.getByRole("radio", { name: /^AI assistant/ }).checked).toBe(true);
  expect(disclosure("AI replies (optional)").open).toBe(true);
  expect(mocks.active).toBe(false); expect(mocks.ask).not.toHaveBeenCalled();
  fireEvent.change(message(), { target: { value: "How can I practise?" } });
  expect(mocks.ask).not.toHaveBeenCalled();
  click("Send reviewed message"); await act(async () => {});
  expect(mocks.ask).toHaveBeenCalledOnce(); expect(screen.getByText("I can help you.")).toBeTruthy();
});

test("choosing local output interrupts a pending AI reply and rejects its stale answer without losing the camera or draft", async () => {
  let resolve; mocks.ask.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await aiSetup(); click("Start camera"); emit();
  fireEvent.change(message(), { target: { value: "Keep my reviewed message" } });
  click("Send reviewed message");
  const signal = mocks.ask.mock.calls[0][0].signal, preview = document.querySelector("video");
  await act(async () => fireEvent.click(screen.getByRole("radio", { name: /^Text & voice/ })));
  expect(signal.aborted).toBe(true); expect(disclosure("AI replies (optional)").open).toBe(false);
  await act(async () => resolve({ reply: "Answer from the old AI purpose" }));
  expect(screen.queryByText("Answer from the old AI purpose")).toBeNull();
  expect(message().value).toBe("Keep my reviewed message"); expect(document.querySelector("video")).toBe(preview);
  expect(mocks.active).toBe(true); expect(button("Send reviewed message").disabled).toBe(true);
  expect(mocks.speak).not.toHaveBeenCalled();
});

test("partner navigation transfers the reviewed draft without sending it or invoking AI", () => {
  const onConnect = vi.fn(); setup({}, { onConnect });
  fireEvent.change(message(), { target: { value: "  Please give me time.\nI will sign again.  " } });
  expect(screen.getByText(/Opening a room leaves this page and stops the camera/)).toBeTruthy();
  click("Talk to a partner");
  expect(onConnect).toHaveBeenCalledExactlyOnceWith("  Please give me time.\nI will sign again.  ");
  expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.predict).not.toHaveBeenCalled();
});

test("beginners see the core three-step workflow while optional controls start closed", () => {
  setup();
  expect(screen.getByRole("combobox", { name: "Sign language", exact: true })).toBeTruthy();
  const workflow = screen.getByRole("navigation", { name: "Sign workflow" });
  expect(within(workflow).getAllByRole("button")).toHaveLength(3);
  for (const name of ["Supported words", "Advanced settings", "AI replies (optional)"]) expect(disclosure(name).open).toBe(false);
  expect(button("Start camera").disabled).toBe(false);
  expect(message().disabled).toBe(false);
  expect(button("Speak my message").disabled).toBe(true);
  // JSDOM role queries do not simulate native closed-details visibility.
  // Assert the controls' placement inside the closed disclosure instead.
  expect(disclosure("Advanced settings").contains(screen.getByRole("switch", { name: /^Speak recognized words/ }))).toBe(true);
  expect(disclosure("Advanced settings").contains(screen.getByRole("combobox", { name: /Word recognition model/ }))).toBe(true);
  expect(disclosure("AI replies (optional)").contains(button("Send reviewed message"))).toBe(true);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  capture(); click(/^Finish sign/);
  expect(disclosure("More result options").open).toBe(false);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
  expect(button("Add word to message").disabled).toBe(false);
  expect(button("Speak this word").disabled).toBe(false);
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("Finish focuses the result and Add focuses the message without automatic speech or AI", () => {
  setup(); capture(); click(/^Finish sign/);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "2 Check the result" }));
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "HELP" } });
  click("Add word to message");
  expect(message().value).toBe("HELP"); expect(document.activeElement).toBe(message());
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

test("Stop speech is beside the typed message and keeps the draft and camera when AI is closed", () => {
  setup(); click("Start camera"); emit();
  const text = "Please give me time to finish this message. ".repeat(12).trim();
  fireEvent.change(message(), { target: { value: text } });
  const preview = document.querySelector("video"), stop = button("Stop speech");
  expect(disclosure("AI replies (optional)").open).toBe(false);
  expect(stop.closest("details")).toBeNull();
  expect(stop.parentElement).toBe(button("Speak my message").parentElement);
  click("Speak my message");
  expect(mocks.speak).toHaveBeenCalledWith(text, expect.objectContaining({ lang: "en-IN" }));
  mocks.stopSpeech.mockClear();
  fireEvent.click(stop);
  expect(mocks.stopSpeech).toHaveBeenCalled();
  expect(message().value).toBe(text); expect(mocks.active).toBe(true);
  expect(document.querySelector("video")).toBe(preview);
  expect(button(/^Capture a sign/).disabled).toBe(false);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("workflow navigation focuses each section and returns to review after a rejected next turn", () => {
  setup();
  const workflow = screen.getByRole("navigation", { name: "Sign workflow" });
  const sign = within(workflow).getByRole("button", { name: /^Sign/ });
  const check = within(workflow).getByRole("button", { name: /^Check/ });
  const output = within(workflow).getByRole("button", { name: /^Text & voice/ });
  const current = () => within(workflow).getByRole("button", { current: "step" });
  expect(current()).toBe(sign);
  fireEvent.click(sign); expect(document.activeElement).toBe(screen.getByRole("heading", { name: "1 Sign with your camera" }));
  fireEvent.click(check); expect(document.activeElement).toBe(screen.getByRole("heading", { name: "2 Check the result" }));
  fireEvent.click(output); expect(document.activeElement).toBe(message());
  expect(mocks.active).toBe(false); expect(mocks.predict).not.toHaveBeenCalled();
  capture(); expect(current()).toBe(sign); click(/^Finish sign/); expect(current()).toBe(check);
  click("Add word to message"); expect(current()).toBe(output); expect(message().value).toBe("WATER");
  const preview = document.querySelector("video");
  mocks.predict.mockReturnValue({ status: "unclear", meaning: "", feedback: "No reliable match", candidates: [] });
  click(/^Capture a sign/); expect(current()).toBe(sign); expect(message().value).toBe("WATER");
  emit(); click(/^Finish sign/);
  expect(current()).toBe(check); expect(screen.getByText("No reliable word match")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "2 Check the result" }));
  expect(message().value).toBe("WATER"); expect(button("Add word to message").disabled).toBe(true);
  fireEvent.click(output); expect(document.activeElement).toBe(message());
  expect(document.querySelector("video")).toBe(preview); expect(mocks.active).toBe(true);
  expect(mocks.predict).toHaveBeenCalledTimes(2);
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("closing optional AI settings leaves the pending reply interrupt available without losing the draft", async () => {
  let resolve; mocks.ask.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  await aiSetup(); click("Start camera"); emit();
  fireEvent.change(message(), { target: { value: "Please explain this word" } });
  click("Send reviewed message");
  const signal = mocks.ask.mock.calls[0][0].signal, preview = document.querySelector("video");
  const options = disclosure("AI replies (optional)");
  fireEvent.click(options.querySelector("summary")); expect(options.open).toBe(false);
  const interrupt = button(/^Interrupt reply/);
  expect(interrupt.closest("details")).toBeNull(); expect(interrupt.disabled).toBe(false);
  fireEvent.click(interrupt); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ reply: "Stale response after interrupt" }));
  expect(screen.queryByText("Stale response after interrupt")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Interrupt reply/ })).toBeNull();
  expect(message().value).toBe("Please explain this word"); expect(mocks.active).toBe(true);
  expect(document.querySelector("video")).toBe(preview); expect(options.open).toBe(false);
  expect(button(/^Capture a sign/).disabled).toBe(false);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled();
});

test("camera access failure leaves the visible typed-message and voice fallback usable", () => {
  mocks.cameraStatus = "error";
  setup(); click("Start camera");
  expect(screen.getByText("Camera disconnected")).toBeTruthy();
  expect(button("Retry camera").disabled).toBe(false);
  expect(button(/^Capture a sign/).disabled).toBe(true);
  expect(message().disabled).toBe(false);
  fireEvent.change(message(), { target: { value: "Please help me" } }); click("Speak my message");
  expect(mocks.speak).toHaveBeenCalledOnce();
  expect(mocks.speak).toHaveBeenCalledWith("Please help me", expect.objectContaining({ lang: "en-IN" }));
  expect(message().value).toBe("Please help me");
  expect(disclosure("AI replies (optional)").open).toBe(false);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("opening and closing optional sections preserves the reviewed word, draft and live camera", () => {
  setup(); capture(); click(/^Finish sign/);
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "HELP" } });
  fireEvent.change(message(), { target: { value: "Keep this typed message" } });
  const preview = document.querySelector("video");
  for (const name of ["Supported words", "Advanced settings", "More result options", "AI replies (optional)"]) {
    const section = openDisclosure(name);
    fireEvent.click(section.querySelector("summary"));
    expect(section.open).toBe(false);
    expect(mocks.active).toBe(true);
    expect(document.querySelector("video")).toBe(preview);
    expect(message().value).toBe("Keep this typed message");
    expect(screen.getByLabelText("Review or correct the word").value).toBe("HELP");
  }
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  expect(button(/^Capture a sign/).disabled).toBe(false);
});

test("looking up DRINK cannot force a rejected ASL turn into text or speech", () => {
  const model = { ...legacyCameraModel(), signLanguage: "asl", labels: ["DRINK", "HELP"], metrics: {} };
  mocks.trained = { ...mocks.trained, model };
  mocks.predict.mockReturnValue({ status: "unclear", meaning: "", glosses: [], feedback: "No reliable match", candidates: [{ label: "HELP", score: .6 }],
    diagnostics: { inferenceRan: true, reasonCodes: ["low-score"], model: { signLanguage: "asl", threshold: .98, requiredMargin: .3 },
      capture: { inputFrames: 4, handFrames: 4, shoulderFrames: 4 }, posterior: { topLabel: "HELP", topScore: .6, runnerUpLabel: "DRINK", runnerUpScore: .4, margin: .2 } } });
  setup({ signLanguage: "asl" });
  fireEvent.change(message(), { target: { value: "Keep my message" } });
  openDisclosure("Supported words");
  fireEvent.change(screen.getByLabelText("Find a word in this model"), { target: { value: "DRINK" } });
  expect(screen.getByLabelText("Word vocabulary check").textContent).toMatch(/^DRINK is in this ASL/);
  enableAutoSpeech();
  capture(); click(/^Finish sign/);
  expect(mocks.predict).toHaveBeenCalledOnce();
  expect(mocks.predict.mock.calls[0]).toHaveLength(2);
  expect(mocks.predict.mock.calls[0][0]).toBe(model);
  expect(mocks.predict.mock.calls[0][1]).toHaveLength(4);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  expect(message().value).toBe("Keep my message");
  openDisclosure("More result options");
  expect(screen.getByText("Why this result?")).toBeTruthy();
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});

test("a supported-word lookup cannot replace a different accepted prediction", () => {
  mocks.trained = { ...mocks.trained, model: { ...legacyCameraModel(), signLanguage: "asl", labels: ["DRINK", "HELP"], metrics: {} } };
  mocks.predict.mockReturnValue({ status: "recognized", meaning: "HELP", glosses: ["HELP"], feedback: "Review this tentative word" });
  setup({ signLanguage: "asl" });
  openDisclosure("Supported words");
  fireEvent.change(screen.getByLabelText("Find a word in this model"), { target: { value: "DRINK" } });
  capture(); click(/^Finish sign/);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("HELP");
  expect(mocks.speak).not.toHaveBeenCalled(); expect(message().value).toBe("");
});

test("a failed prediction stays silent, preserves the message, and allows a fresh capture", () => {
  mocks.predict.mockImplementationOnce(() => { throw new Error("Invalid pose sequence"); });
  setup(); fireEvent.change(message(), { target: { value: "Keep my reviewed message" } });
  enableAutoSpeech();
  capture(); click(/^Finish sign/);
  expect(screen.getByText("Could not read this turn. Check the framing and sign again.")).toBeTruthy();
  expect(screen.queryByLabelText("Review or correct the word")).toBeNull();
  expect(message().value).toBe("Keep my reviewed message");
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  click(/^Capture a sign/); emit(4); click(/^Finish sign/);
  expect(mocks.predict).toHaveBeenCalledTimes(2);
  expect(mocks.predict.mock.calls[1][1].map((frame) => frame.atMs)).toEqual([125, 250, 375, 500]);
  expect(screen.getByLabelText("Review or correct the word").value).toBe("WATER");
  expect(message().value).toBe("Keep my reviewed message");
  expect(screen.queryByText("Could not read this turn. Check the framing and sign again.")).toBeNull();
});

test("reviewed words compose a message across captures and undo removes one complete addition", () => {
  setup(); capture(); click(/^Finish sign/); click("Add word to message");
  expect(message().value).toBe("WATER");
  click(/^Capture a sign/); expect(message().value).toBe("WATER");
  mocks.predict.mockReturnValue({ status: "recognized", meaning: "HELP", feedback: "Review" });
  emit(); click(/^Finish sign/); click("Add word to message");
  expect(message().value).toBe("WATER HELP");
  click("Undo last edit"); expect(message().value).toBe("WATER");
  expect(mocks.ask).not.toHaveBeenCalled();
});

test("uncertain suggestions require selection and review; they never speak or add automatically", () => {
  mocks.predict.mockReturnValue({ status: "unclear", meaning: "", feedback: "Review", candidates: [{ label: "HELP", score: .2 }] });
  setup(); enableAutoSpeech();
  capture(); click(/^Finish sign/);
  expect(message().value).toBe(""); expect(button("Add word to message").disabled).toBe(true);
  openDisclosure("More result options");
  click("Choose HELP"); expect(message().value).toBe(""); expect(mocks.speak).not.toHaveBeenCalled();
  click("None of these"); expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  click("Choose HELP"); click("Add word to message"); expect(message().value).toBe("HELP");
});

test("local message speech works without AI setup and no network answer is attempted", async () => {
  mocks.check.mockResolvedValue({ configured: false }); setup(); await act(async () => {});
  fireEvent.change(message(), { target: { value: "I need water" } }); click("Speak my message");
  expect(mocks.speak).toHaveBeenCalledWith("I need water", expect.objectContaining({ lang: "en-IN" }));
  openDisclosure("AI replies (optional)");
  expect(button("Send reviewed message").disabled).toBe(true); expect(mocks.ask).not.toHaveBeenCalled();
  expect(screen.getByText("AI replies need setup")).toBeTruthy();
});

test("AI only receives the reviewed message, keeps context, and preserves a failed draft for retry", async () => {
  await aiSetup(); capture(); click(/^Finish sign/); click("Add word to message");
  click("Send reviewed message"); await act(async () => {});
  expect(mocks.ask.mock.calls[0][0].messages).toEqual([{ role: "user", text: "Typed: WATER" }]);
  expect(message().value).toBe(""); expect(screen.getByText("I can help you.")).toBeTruthy();
  mocks.ask.mockRejectedValueOnce(new Error("Connection lost"));
  fireEvent.change(message(), { target: { value: "What should I do?" } }); click("Send reviewed message"); await act(async () => {});
  expect(message().value).toBe("What should I do?");
  click("Send reviewed message"); await act(async () => {});
  expect(mocks.ask.mock.calls[2][0].messages).toEqual([{ role: "user", text: "Typed: WATER" }, { role: "assistant", text: "I can help you." }, { role: "user", text: "Typed: What should I do?" }]);
});

test("pending AI blocks camera shortcuts and interrupt ignores late replies while preserving draft", async () => {
  let resolve; mocks.ask.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  await aiSetup(); click("Start camera"); fireEvent.change(message(), { target: { value: "Can you help?" } }); click("Send reviewed message");
  expect(button(/^Capture a sign/).disabled).toBe(true);
  fireEvent.keyDown(window, { code: "Space", key: " " }); emit(); expect(mocks.predict).not.toHaveBeenCalled();
  const signal = mocks.ask.mock.calls[0][0].signal;
  fireEvent.keyDown(window, { key: "Escape" }); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ reply: "Late answer" }));
  expect(screen.queryByText("Late answer")).toBeNull(); expect(message().value).toBe("Can you help?");
  expect(mocks.speak).not.toHaveBeenCalled();
});

test("New conversation clears prior context and ending during an answer cannot affect the next draft", async () => {
  await aiSetup(); fireEvent.change(message(), { target: { value: "First" } }); click("Send reviewed message"); await act(async () => {});
  click("New conversation"); expect(screen.queryByText("I can help you.")).toBeNull();
  click("Start camera");
  let resolve; mocks.ask.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  fireEvent.change(message(), { target: { value: "Second" } }); click("Send reviewed message");
  expect(mocks.ask.mock.calls[1][0].messages).toEqual([{ role: "user", text: "Typed: Second" }]);
  click("End session"); fireEvent.change(message(), { target: { value: "Fresh draft" } });
  await act(async () => resolve({ reply: "Stale answer" }));
  expect(message().value).toBe("Fresh draft"); expect(screen.queryByText("Stale answer")).toBeNull();
});

test("training storage waits for explicit consent, uses the corrected label, and records ordered timing", async () => {
  setup(); capture(); click(/^Finish sign/);
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Review or correct the word"), { target: { value: "HELP" } });
  openDisclosure("More result options");
  fireEvent.click(screen.getByText("Save this turn for model training"));
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-01" } });
  expect(button("Save training sample").disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to save this pose sequence/ }));
  click("Save training sample"); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ label: "HELP", signerId: "anon-01", signLanguage: "isl", kind: "known", consent: true });
  expect(mocks.save.mock.calls[0][0].frames.map((f) => f.atMs)).toEqual([125, 250, 375, 500]);
  expect(screen.getByText(/Your model has not been retrained/)).toBeTruthy();
});

test("training consent resets when metadata changes and saving cannot reuse a cancelled turn", () => {
  setup(); capture(); click(/^Finish sign/); openDisclosure("More result options"); fireEvent.click(screen.getByText("Save this turn for model training"));
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-01" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to save this pose sequence/ }));
  fireEvent.change(screen.getByLabelText("Verified training label"), { target: { value: "WATER" } });
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-02" } });
  expect(button("Save training sample").disabled).toBe(true);
  click(/^Capture a sign/); click("Cancel turn");
  expect(screen.queryByRole("button", { name: "Save training sample" })).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
});

test("late and duplicate tracking timestamps are excluded from the saved sequence and the stale capture is not inferred", async () => {
  setup(); capture();
  act(() => { mocks.frame(pose(), { videoWidth: 640, videoHeight: 480 }); now += 13000; mocks.frame(pose(), { videoWidth: 640, videoHeight: 480 }); });
  click(/^Finish sign/);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(screen.getByLabelText("Review or correct the word").value).toBe("");
  openDisclosure("More result options"); fireEvent.click(screen.getByText("Save this turn for model training"));
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-01" } });
  fireEvent.change(screen.getByLabelText("Sample type"), { target: { value: "unknown" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to save this pose sequence/ }));
  click("Save training sample"); await act(async () => {});
  expect(mocks.save.mock.calls[0][0].frames.map((f) => f.atMs)).toEqual([125, 250, 375, 500]);
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("Finish rejects a trailing tracking gap before inference while the editable draft and explicit voice output remain usable", () => {
  setup(); enableAutoSpeech(); capture(); fireEvent.change(message(), { target: { value: "Keep my draft" } });
  now += 1500; click(/^Finish sign/);
  expect(mocks.predict).not.toHaveBeenCalled(); expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
  expect(screen.getByText("Could not read this capture")).toBeTruthy();
  expect(screen.getByText(/Tracking paused for over one second/)).toBeTruthy();
  expect(screen.getByLabelText("Review or correct the word").value).toBe(""); expect(message().value).toBe("Keep my draft");
  expect(button("Add word to message").disabled).toBe(true);
  click("Speak my message"); expect(mocks.speak).toHaveBeenCalledWith("Keep my draft", expect.objectContaining({ lang: "en-IN" }));
});

test("background captures save only as explicitly labelled unknown examples", async () => {
  mocks.predict.mockReturnValue({ status: "no_sign", meaning: "", feedback: "No hands" });
  setup(); click("Start camera"); emit(1); click(/^Capture a sign/);
  act(() => { for (let i = 0; i < 4; i++) { now += 125; const background = pose(); background.confidences.fill(0); mocks.frame(background, { videoWidth: 640, videoHeight: 480 }); } });
  click(/^Finish sign/); openDisclosure("More result options"); fireEvent.click(screen.getByText("Save this turn for model training"));
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-01" } });
  expect(button("Save training sample").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Sample type"), { target: { value: "unknown" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to save this pose sequence/ }));
  click("Save training sample"); await act(async () => {});
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ kind: "unknown", label: "__unknown__", negativeType: "unspecified", prediction: { status: "no_sign", meaning: "" } });
  expect(mocks.speak).not.toHaveBeenCalled();
});

test("rejection subtype is explicit and changing it requires renewed sample consent", async () => {
  setup(); capture(); click(/^Finish sign/); openDisclosure("More result options"); fireEvent.click(screen.getByText("Save this turn for model training"));
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-01" } });
  expect(screen.queryByLabelText("Rejection example type")).toBeNull();
  fireEvent.change(screen.getByLabelText("Sample type"), { target: { value: "unknown" } });
  const subtype = screen.getByLabelText("Rejection example type");
  expect(subtype.value).toBe("unspecified");
  const consent = screen.getByRole("checkbox", { name: /agree to save this pose sequence/ });
  fireEvent.click(consent); expect(button("Save training sample").disabled).toBe(false);
  fireEvent.change(subtype, { target: { value: "nonsigning" } });
  expect(consent.checked).toBe(false); expect(button("Save training sample").disabled).toBe(true);
  fireEvent.change(subtype, { target: { value: "unsupported-sign" } });
  fireEvent.click(consent); click("Save training sample"); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ kind: "unknown", label: "__unknown__", negativeType: "unsupported-sign" });
  expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.ask).not.toHaveBeenCalled();
});

test("pending sample saves suppress duplicate submissions and stale notices after ending", async () => {
  let resolve; mocks.save.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  setup(); capture(); click(/^Finish sign/); openDisclosure("More result options"); fireEvent.click(screen.getByText("Save this turn for model training"));
  fireEvent.change(screen.getByLabelText("Signer code"), { target: { value: "anon-01" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /agree to save this pose sequence/ }));
  const form = button("Save training sample").closest("form");
  fireEvent.submit(form); fireEvent.submit(form); expect(mocks.save).toHaveBeenCalledOnce();
  expect(button(/^Capture a sign/).disabled).toBe(true);
  click("End session"); await act(async () => resolve({ id: "saved" }));
  expect(screen.queryByText(/Saved this pose sequence locally/)).toBeNull();
  expect(button("Start camera").disabled).toBe(false); expect(mocks.active).toBe(false);
});
