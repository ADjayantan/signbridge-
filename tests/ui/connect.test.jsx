import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ConnectMode from "../../src/modes/ConnectMode.jsx";

const mocks = vi.hoisted(() => ({ room: null, media: null, speaker: null, recognitionCallbacks: null, captureProps: null, listen: vi.fn(), microphone: null }));
vi.mock("../../src/hooks/useRoom.js", () => ({ useRoom: () => mocks.room }));
vi.mock("../../src/hooks/useRoomMedia.js", () => ({ useRoomMedia: () => mocks.media }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], error: "" }) }));
vi.mock("../../src/lib/speech.js", () => ({ canListen: true, canSpeak: true, createSpeaker: () => mocks.speaker, listenOnce: (callbacks) => { mocks.recognitionCallbacks = callbacks; mocks.listen(callbacks); return mocks.microphone; }, listenErrorMessage: () => "Microphone permission denied. Keep typing.", speakErrorMessage: (code) => `Speech playback failed: ${code}. Check laptop audio and try again.` }));
vi.mock("../../src/components/RoomSignCapture.jsx", () => ({ default: (props) => { mocks.captureProps = props; return <button type="button" onClick={() => props.onAppend({ text: "THANK YOU", lang: "en", inputMethod: "sign", signLanguage: props.signLanguage })}>Add reviewed test sign</button>; } }));
vi.mock("../../src/components/SignVideoPlayer.jsx", () => ({ default: ({ text, signLanguage }) => <p>Saved video request: {text} ({signLanguage})</p> }));

const settings = { rate: 1 };
const back = vi.fn(); const tool = vi.fn();
const view = () => <ConnectMode settings={settings} onBack={back} onTool={tool} />;
const setup = (preferences = {}) => {
  localStorage.setItem("signbridge:communication-preferences", JSON.stringify({ inputMethod: "text", receive: "text", signVideos: false, signLanguage: "isl", lang: "en", ...preferences }));
  return render(view());
};
const draft = () => screen.getByLabelText("Your reviewed message");
const write = (text) => fireEvent.change(draft(), { target: { value: text } });
const send = () => fireEvent.submit(draft().closest("form"));
const showPreferences = () => { const details = document.querySelector(".room-preferences"); if (!details.open) fireEvent.click(details.querySelector("summary")); };
const partnerMessage = (id, text) => ({ id, text, inputMethod: "text", lang: "en", senderId: "guest", seq: Number(id.replace(/\D/g, "")) || 1, delivery: "sent" });
const updateMessages = (app, messages) => { mocks.room = { ...mocks.room, messages }; app.rerender(view()); };
const liveRegion = () => document.querySelector(".sr-only[aria-live]");

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); window.location.hash = "#connect";
  mocks.recognitionCallbacks = null; mocks.captureProps = null;
  mocks.microphone = { abort: vi.fn(), stop: vi.fn() };
  mocks.speaker = { speak: vi.fn().mockResolvedValue(), cancel: vi.fn() };
  mocks.room = { status: "connected", error: "", notice: "", roomId: "room1", participantId: "host", role: "host", inviteUrl: "https://demo.example/#connect?room=room1&invite=private", messages: [], participants: [{ id: "host", online: true }, { id: "guest", online: true }], create: vi.fn(), join: vi.fn(), send: vi.fn().mockResolvedValue({ ok: true, id: "message_1" }), leave: vi.fn(), end: vi.fn(), retry: vi.fn(), askAI: vi.fn().mockResolvedValue({ reply: "Suggested reply" }) };
  mocks.room.workflow = { events: [], clarifications: [], cards: [], references: [] };
  mocks.room.snapshotVersion = 1;
  mocks.room.sendAction = vi.fn().mockResolvedValue({ ok: true, id: "action_1" });
  mocks.room.pendingActions = [];
  mocks.media = { localVideoRef: { current: null }, remoteVideoRef: { current: null }, cameraOn: false, micOn: false, cameraStatus: "off", mediaStatus: "waiting", error: "", notice: "", remoteStream: null, localStream: null, enableCamera: vi.fn(), disableCamera: vi.fn(), enableMic: vi.fn(), disableMic: vi.fn(), retry: vi.fn(), stop: vi.fn(), forceRelay: false, setForceRelay: vi.fn(), remoteAudioEnabled: false, setRemoteAudioEnabled: vi.fn() };
  Object.assign(mocks.media, { playbackBlocked: false, playbackError: "", retryRemotePlayback: vi.fn(), routeStatus: "unknown", checkVideoRoute: vi.fn() });
});
afterEach(cleanup);

test("blocked partner playback exposes an explicit button without resending, reconnecting or enabling devices", () => {
  const app = setup(); expect(screen.queryByRole("button", { name: "Play partner video/audio" })).toBeNull();
  mocks.media = { ...mocks.media, playbackBlocked: true, playbackError: "Partner playback is paused. Choose Play partner video/audio to continue.", notice: "Video relay is unavailable." }; app.rerender(view());
  const play = screen.getByRole("button", { name: "Play partner video/audio" }); expect(play.type).toBe("button"); expect(play.disabled).toBe(false);
  fireEvent.click(play); expect(mocks.media.retryRemotePlayback).toHaveBeenCalledOnce(); expect(screen.getByText("Video relay is unavailable.")).toBeTruthy();
  expect(mocks.media.retry).not.toHaveBeenCalled(); expect(mocks.media.enableCamera).not.toHaveBeenCalled(); expect(mocks.media.enableMic).not.toHaveBeenCalled(); expect(mocks.room.send).not.toHaveBeenCalled();
  mocks.media = { ...mocks.media, playbackBlocked: false, playbackError: "" }; app.rerender(view()); expect(screen.queryByRole("button", { name: "Play partner video/audio" })).toBeNull();
});

test("video-route control requires a connected peer, shows only route labels, and pauses while checking", () => {
  const app = setup(); const options = document.querySelector(".room-network-options"); fireEvent.click(options.querySelector("summary"));
  let check = screen.getByRole("button", { name: "Check video route" }); expect(check.disabled).toBe(true); fireEvent.click(check); expect(mocks.media.checkVideoRoute).not.toHaveBeenCalled();
  mocks.media = { ...mocks.media, mediaStatus: "connected" }; app.rerender(view()); check = screen.getByRole("button", { name: "Check video route" }); expect(check.disabled).toBe(false); fireEvent.click(check); expect(mocks.media.checkVideoRoute).toHaveBeenCalledOnce();
  mocks.media = { ...mocks.media, routeStatus: "checking" }; app.rerender(view()); expect(screen.getByRole("button", { name: "Check video route" }).disabled).toBe(true); expect(screen.getByText("Checking the current video route…")).toBeTruthy();
  for (const [routeStatus, label] of [["relay", "Relay is in use for the selected media connection."], ["direct", "Direct media connection; relay is not in use."], ["mixed", "Selected media connections use both relay and direct routes."], ["unknown", "Video route is not available yet. Connect, then check again."]]) {
    mocks.media = { ...mocks.media, routeStatus }; app.rerender(view()); expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.getByText("This checks the current connection route. It does not test video quality or sign recognition.")).toBeTruthy(); expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("reviewed text fills an empty room draft once as editable English text, without an automatic send, AI or speech", async () => {
  const text = "  WATER\nPlease help me.  ", consumed = vi.fn();
  const app = render(<ConnectMode settings={settings} onBack={back} onTool={tool} initialReviewedText={text} onReviewedTextConsumed={consumed} />);
  expect(draft().value).toBe(text); expect(consumed).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft"))).toEqual({ text, lang: "en", inputMethod: "text", referenceIds: [] });
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.speaker.speak).not.toHaveBeenCalled();
  expect(mocks.media.enableCamera).not.toHaveBeenCalled(); expect(mocks.room.create).not.toHaveBeenCalled();
  app.rerender(<ConnectMode settings={settings} onBack={back} onTool={tool} initialReviewedText={null} onReviewedTextConsumed={consumed} />);
  expect(draft().value).toBe(text); expect(consumed).toHaveBeenCalledOnce();
  await act(async () => send());
  expect(mocks.room.send).toHaveBeenCalledWith(expect.objectContaining({ text: text.trim(), lang: "en", inputMethod: "text" }));
});

test("a transferred draft is visible and retained before a room is created or joined", () => {
  mocks.room = { ...mocks.room, status: "idle", roomId: "", participants: [] };
  const consumed = vi.fn(); render(<ConnectMode settings={settings} onBack={back} onTool={tool} initialReviewedText="I would like water" onReviewedTextConsumed={consumed} />);
  expect(screen.getByText("I would like water")).toBeTruthy();
  expect(screen.getByText(/Create or join a conversation to review and send it/)).toBeTruthy();
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft")).text).toBe("I would like water");
  expect(consumed).toHaveBeenCalledOnce(); expect(mocks.room.create).not.toHaveBeenCalled(); expect(mocks.room.join).not.toHaveBeenCalled();
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.speaker.speak).not.toHaveBeenCalled();
});

test.each([false, true])("a nonempty room draft requires an explicit transferred-text choice (replace=%s)", (replace) => {
  const existing = { text: "Existing draft", inputMethod: "sign", signLanguage: "isl", lang: "ta", referenceIds: ["ref1"], relation: { kind: "correction", messageId: "old1" }, roomId: "room1" };
  sessionStorage.setItem("signbridge:conversation-draft", JSON.stringify(existing));
  const consumed = vi.fn(); render(<ConnectMode settings={settings} onBack={back} onTool={tool} initialReviewedText="New reviewed text" onReviewedTextConsumed={consumed} />);
  expect(draft().value).toBe(existing.text); expect(screen.getByText("New reviewed text")).toBeTruthy(); expect(consumed).not.toHaveBeenCalled();
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: replace ? "Use this message instead" : "Add to my draft" }));
  const saved = JSON.parse(sessionStorage.getItem("signbridge:conversation-draft"));
  expect(draft().value).toBe(replace ? "New reviewed text" : "Existing draft New reviewed text");
  expect(saved).toMatchObject({ inputMethod: "text", lang: "en", roomId: "room1" }); expect(saved).not.toHaveProperty("signLanguage");
  if (replace) { expect(saved.referenceIds).toEqual([]); expect(saved).not.toHaveProperty("relation"); }
  else { expect(saved.referenceIds).toEqual(["ref1"]); expect(saved.relation).toEqual(existing.relation); }
  expect(consumed).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: "Add to my draft" })).toBeNull();
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.speaker.speak).not.toHaveBeenCalled();
});

test("a transferred message and overflowing room draft are both kept until an explicit compatible choice", () => {
  const existing = "x".repeat(1999), incoming = "New message";
  sessionStorage.setItem("signbridge:conversation-draft", JSON.stringify({ text: existing, lang: "en", inputMethod: "text" }));
  const consumed = vi.fn(); render(<ConnectMode settings={settings} onBack={back} onTool={tool} initialReviewedText={incoming} onReviewedTextConsumed={consumed} />);
  expect(draft().value).toBe(existing); expect(screen.getByText(incoming)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add to my draft" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Use this message instead" }).disabled).toBe(false);
  expect(consumed).not.toHaveBeenCalled(); expect(mocks.room.send).not.toHaveBeenCalled();
  write("Shortened"); fireEvent.click(screen.getByRole("button", { name: "Add to my draft" }));
  expect(draft().value).toBe("Shortened New message"); expect(consumed).toHaveBeenCalledOnce();
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("placing transferred text aborts unfinished dictation before updating the draft and ignores its late transcript", () => {
  sessionStorage.setItem("signbridge:conversation-draft", JSON.stringify({ text: "Existing", lang: "en", inputMethod: "text" }));
  localStorage.setItem("signbridge:communication-preferences", JSON.stringify({ inputMethod: "speech", receive: "text", signVideos: false, signLanguage: "isl", lang: "en" }));
  render(<ConnectMode settings={settings} onBack={back} onTool={tool} initialReviewedText="Transferred" />);
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" })); const pending = mocks.recognitionCallbacks;
  fireEvent.click(screen.getByRole("button", { name: "Add to my draft" }));
  expect(mocks.microphone.abort).toHaveBeenCalled(); expect(draft().value).toBe("Existing Transferred");
  act(() => pending.onEnd("Late dictated words")); expect(draft().value).toBe("Existing Transferred");
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("voice can be tested locally before joining a room without sending text or calling AI", async () => {
  mocks.room = { ...mocks.room, status: "idle", roomId: "", participants: [] };
  setup();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test voice" })));
  expect(mocks.speaker.speak).toHaveBeenCalledWith("SignBridge voice is ready.", expect.objectContaining({ lang: "en-IN", rate: 1 }));
  expect(mocks.room.create).not.toHaveBeenCalled(); expect(mocks.room.join).not.toHaveBeenCalled();
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("camera sharing does not start word recognition; activation is explicit and keeps the draft", () => {
  mocks.media.cameraOn = true; mocks.media.cameraStatus = "on";
  setup({ inputMethod: "sign" }); write("Keep this reviewed draft");
  expect(screen.getByText(/Word recognition is off/)).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }).checked).toBe(false);
  expect(screen.queryByRole("button", { name: "Add reviewed test sign" })).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  expect(screen.queryByText(/Word recognition is off/)).toBeNull();
  expect(screen.getByRole("button", { name: "Add reviewed test sign" })).toBeTruthy();
  expect(mocks.captureProps.videoRef).toBe(mocks.media.localVideoRef);
  expect(mocks.captureProps.cameraStatus).toBe("on"); expect(draft().value).toBe("Keep this reviewed draft");
  expect(mocks.media.enableCamera).not.toHaveBeenCalled(); expect(mocks.media.stop).not.toHaveBeenCalled();
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("a reviewed sign that exceeds the message limit is rejected without changing the draft, then adds after shortening", () => {
  setup({ inputMethod: "sign" }); write("x".repeat(1995));
  fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  const word = { text: "THANK YOU", lang: "en", inputMethod: "sign", signLanguage: "isl" };
  const scroll = vi.fn(); draft().scrollIntoView = scroll;
  const action = screen.getByRole("button", { name: "Add reviewed test sign" }); action.focus();
  let accepted;
  act(() => { accepted = mocks.captureProps.onAppend(word); });
  expect(accepted).toBe(false); expect(draft().value).toBe("x".repeat(1995));
  expect(screen.getByRole("alert").textContent).toMatch(/2,000 characters/);
  expect(document.activeElement).toBe(action); expect(scroll).not.toHaveBeenCalled();
  expect(screen.queryByText(/Reviewed sign added to your draft/)).toBeNull();
  write("Hello"); act(() => { accepted = mocks.captureProps.onAppend(word); });
  expect(accepted).toBe(true); expect(draft().value).toBe("Hello THANK YOU");
  expect(document.activeElement).toBe(draft()); expect(scroll).toHaveBeenCalledWith({ block: "center" });
  expect(screen.getByText(/Reviewed sign added to your draft/)).toBeTruthy();
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft"))).toMatchObject({ inputMethod: "sign", signLanguage: "isl" });
  expect(mocks.room.send).not.toHaveBeenCalled();
});

test("adding a reviewed sign focuses its draft and explains the explicit send; review edits, captures and sending clear the old feedback", async () => {
  setup({ inputMethod: "sign", receive: "speech" });
  fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  expect(document.activeElement).toBe(draft());
  expect(screen.getByText(/Check the message, then choose Send to partner.*Nothing has been sent yet/)).toBeTruthy();
  expect(draft().getAttribute("aria-describedby")).toBe("room-sign-added");
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.speaker.speak).not.toHaveBeenCalled();
  act(() => mocks.captureProps.onReviewChange()); expect(screen.queryByText(/Reviewed sign added to your draft/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  act(() => mocks.captureProps.onActivityChange(true)); expect(screen.queryByText(/Reviewed sign added to your draft/)).toBeNull();
  act(() => mocks.captureProps.onActivityChange(false));
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  write("Edited reviewed message"); expect(screen.queryByText(/Reviewed sign added to your draft/)).toBeNull();
  expect(draft().getAttribute("aria-describedby")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  await act(async () => send());
  expect(screen.queryByText(/Reviewed sign added to your draft/)).toBeNull(); expect(mocks.captureProps.addedToDraft).toBe(false);
  expect(draft().value).toBe(""); expect(mocks.room.send).toHaveBeenCalledOnce();
});

test("a reviewed sign can be kept locally during reconnection without implying delivery or reading its own message", () => {
  mocks.room.status = "reconnecting"; setup({ inputMethod: "sign", receive: "speech" });
  fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  expect(draft().value).toBe("THANK YOU"); expect(document.activeElement).toBe(draft());
  expect(screen.getByText(/Your draft is kept. Reconnect before sending/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Send to partner" }).disabled).toBe(true);
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.speaker.speak).not.toHaveBeenCalled();
});

test("changing input/output and sign language preserves conversation history and the unsent draft", () => {
  mocks.room.messages = [partnerMessage("one1", "How are you?")]; const app = setup(); write("My reply is still being edited"); showPreferences();
  fireEvent.click(screen.getByRole("radio", { name: "Sign", exact: true })); fireEvent.click(screen.getByRole("radio", { name: "Screen reader", exact: true }));
  fireEvent.change(screen.getByLabelText("Sign language"), { target: { value: "asl" } });
  expect(draft().value).toBe("My reply is still being edited"); expect(screen.getByText("How are you?")).toBeTruthy(); expect(mocks.room.leave).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
  app.rerender(view()); expect(draft().value).toBe("My reply is still being edited");
  expect(JSON.parse(localStorage.getItem("signbridge:communication-preferences"))).toMatchObject({ inputMethod: "sign", receive: "screenreader", signLanguage: "asl" });
});
test("dictation silences remote audio and the broadcast microphone, then produces a reviewed draft without AI or automatic send", async () => {
  mocks.media.micOn = true; mocks.media.remoteAudioEnabled = true; setup({ inputMethod: "speech" });
  const remote = screen.getByLabelText("Partner’s live video"); remote.muted = false;
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  expect(remote.muted).toBe(true); expect(mocks.media.setRemoteAudioEnabled).toHaveBeenLastCalledWith(false); expect(mocks.media.disableMic).toHaveBeenCalledOnce(); expect(mocks.listen).toHaveBeenCalledOnce();
  act(() => mocks.recognitionCallbacks.onInterim("tentative words")); expect(screen.getByText("tentative words")).toBeTruthy(); expect(draft().value).toBe("");
  act(() => mocks.recognitionCallbacks.onEnd("I would like some water")); expect(draft().value).toBe("I would like some water");
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
  write("I would like water, please"); await act(async () => send()); expect(mocks.room.send).toHaveBeenCalledWith(expect.objectContaining({ text: "I would like water, please", inputMethod: "speech" })); expect(draft().value).toBe("");
});
test("cancelling dictation rejects late transcripts and permission failure leaves typing available", async () => {
  setup({ inputMethod: "speech" }); write("Existing draft"); fireEvent.click(screen.getByRole("button", { name: "Start dictation" })); const first = mocks.recognitionCallbacks;
  fireEvent.click(screen.getByRole("button", { name: "Cancel dictation" })); act(() => first.onEnd("late rejected words")); expect(draft().value).toBe("Existing draft");
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" })); act(() => mocks.recognitionCallbacks.onError("not-allowed"));
  expect(screen.getByRole("alert").textContent).toMatch(/permission denied/); write("Typing remains available"); await act(async () => send()); expect(mocks.room.send.mock.calls.at(-1)[0].text).toBe("Typing remains available");
});
test("failed sends preserve the draft and a retry reuses its unconfirmed message ID", async () => {
  mocks.room.send.mockResolvedValueOnce({ ok: false, id: "uncertain_1", error: "Delivery uncertain" }).mockResolvedValueOnce({ ok: true, id: "uncertain_1" });
  setup(); write("Keep this message"); await act(async () => send()); expect(draft().value).toBe("Keep this message"); expect(screen.getByRole("button", { name: "Retry reviewed message" })).toBeTruthy();
  await act(async () => send()); expect(mocks.room.send.mock.calls[1][0]).toMatchObject({ id: "uncertain_1", text: "Keep this message" }); expect(draft().value).toBe("");
});
test("an acknowledgement clears only the sent revision and preserves edits made while sending", async () => {
  let resolve; mocks.room.send.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  setup(); write("First version"); send(); expect(screen.getByRole("button", { name: "Sending…" }).disabled).toBe(true); write("My next message");
  await act(async () => resolve({ ok: true, id: "sent_first" })); expect(draft().value).toBe("My next message");
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft")).text).toBe("My next message");
});
test("disconnect disables send, preserves draft and reconnect restores the same composer", async () => {
  const app = setup(); write("Draft across reconnect"); mocks.room = { ...mocks.room, status: "reconnecting" }; app.rerender(view());
  expect(draft().value).toBe("Draft across reconnect"); expect(screen.getByRole("button", { name: "Send to partner" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "End for both" }).disabled).toBe(true); expect(screen.getByRole("button", { name: "Leave room" }).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" })); expect(mocks.room.retry).toHaveBeenCalledOnce();
  mocks.room = { ...mocks.room, status: "connected" }; app.rerender(view()); await act(async () => send()); expect(mocks.room.send).toHaveBeenCalledWith(expect.objectContaining({ text: "Draft across reconnect" }));
});
test("screen-reader output announces only new partner messages, with no synthesized or duplicate replay", () => {
  mocks.room.messages = [partnerMessage("old1", "Earlier message")]; const app = setup({ receive: "screenreader" });
  expect(liveRegion().textContent).toBe(""); expect(liveRegion().getAttribute("aria-live")).toBe("polite");
  const next = partnerMessage("new2", "A new partner message"); updateMessages(app, [...mocks.room.messages, next]); expect(liveRegion().textContent).toBe("Partner: A new partner message");
  updateMessages(app, mocks.room.messages.map((message) => ({ ...message, delivery: "received" }))); expect(liveRegion().textContent).toBe("Partner: A new partner message"); expect(mocks.speaker.speak).not.toHaveBeenCalled();
  showPreferences(); fireEvent.click(screen.getByRole("radio", { name: "Read aloud", exact: true })); expect(liveRegion().getAttribute("aria-live")).toBe("off"); expect(liveRegion().textContent).toBe(""); expect(mocks.speaker.speak).not.toHaveBeenCalled();
});
test("identical partner text from distinct IDs creates separate announcements while receipt updates preserve the latest announcement", () => {
  const app = setup({ receive: "screenreader" }); const before = liveRegion().firstElementChild;
  const first = partnerMessage("same1", "Yes"); updateMessages(app, [first]); const firstAnnouncement = liveRegion().firstElementChild;
  expect(firstAnnouncement).not.toBe(before); expect(firstAnnouncement.textContent).toBe("Partner: Yes");
  const second = partnerMessage("same2", "Yes"); updateMessages(app, [first, second]); const secondAnnouncement = liveRegion().firstElementChild;
  expect(secondAnnouncement).not.toBe(firstAnnouncement); expect(secondAnnouncement.textContent).toBe("Partner: Yes");
  updateMessages(app, [first, second].map((message) => ({ ...message, delivery: "received", receivedBy: ["host"] })));
  expect(liveRegion().firstElementChild).toBe(secondAnnouncement);
  app.rerender(view()); expect(liveRegion().firstElementChild).toBe(secondAnnouncement); expect(mocks.speaker.speak).not.toHaveBeenCalled();
});
test("delivery receipts identify the partner device for outgoing messages and this device for incoming messages", () => {
  mocks.room.messages = [{ ...partnerMessage("outgoing1", "Outgoing acknowledged"), senderId: "host", delivery: "received", receivedBy: ["guest"] }, { ...partnerMessage("incoming2", "Incoming acknowledged"), delivery: "received", receivedBy: ["host"] }]; setup();
  const outgoing = screen.getByText("Outgoing acknowledged").closest("article"); const incoming = screen.getByText("Incoming acknowledged").closest("article");
  expect(outgoing.textContent).toContain("Received on partner’s device"); expect(outgoing.textContent).not.toContain("Received on this device");
  expect(incoming.textContent).toContain("Received on this device"); expect(incoming.textContent).not.toContain("Received on partner’s device");
});
test("read-aloud output reads each new partner message once and silences live microphone/audio first", async () => {
  mocks.media.micOn = true; mocks.media.remoteAudioEnabled = true; const app = setup({ receive: "speech" });
  updateMessages(app, [partnerMessage("incoming1", "Read this partner turn")]); await act(async () => {});
  expect(mocks.speaker.speak).toHaveBeenCalledOnce(); expect(mocks.speaker.speak).toHaveBeenCalledWith("Read this partner turn", expect.objectContaining({ lang: "en-IN" }));
  expect(mocks.media.disableMic).toHaveBeenCalled(); expect(mocks.media.setRemoteAudioEnabled).toHaveBeenLastCalledWith(false); expect(liveRegion().getAttribute("aria-live")).toBe("off");
  updateMessages(app, mocks.room.messages.map((message) => ({ ...message, delivery: "received" }))); await act(async () => {}); expect(mocks.speaker.speak).toHaveBeenCalledOnce();
});
test.each(["speech", "screenreader"])("%s output cannot accidentally unmute remote live audio", (receive) => {
  setup({ receive }); const toggle = screen.getByRole("switch", { name: /^Listen to partner audio/ }); expect(toggle.disabled).toBe(true); fireEvent.click(toggle);
  expect(mocks.media.setRemoteAudioEnabled).toHaveBeenLastCalledWith(false); expect(screen.getByLabelText("Partner’s live video").muted).toBe(true);
});
test("queued read-aloud turns are delivered in order after dictation ends", async () => {
  let finishSpeech; mocks.speaker.speak.mockImplementation(() => new Promise((resolve) => { finishSpeech = resolve; }));
  const app = setup({ inputMethod: "speech", receive: "speech" }); fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  updateMessages(app, [partnerMessage("queue1", "First partner turn"), partnerMessage("queue2", "Second partner turn")]); expect(mocks.speaker.speak).not.toHaveBeenCalled();
  act(() => mocks.recognitionCallbacks.onEnd("My spoken draft")); expect(mocks.speaker.speak.mock.calls[0][0]).toBe("First partner turn");
  await act(async () => finishSpeech()); expect(mocks.speaker.speak.mock.calls[1][0]).toBe("Second partner turn"); await act(async () => finishSpeech());
  expect(draft().value).toBe("My spoken draft"); expect(mocks.room.askAI).not.toHaveBeenCalled();
});
test("camera denial leaves message entry and send usable", async () => {
  mocks.media.cameraStatus = "error"; mocks.media.error = "Camera access is blocked. Typing still works."; setup();
  expect(screen.getByRole("alert").textContent).toMatch(/Camera access is blocked/); write("I can type without a camera"); await act(async () => send());
  expect(mocks.room.send).toHaveBeenCalledWith(expect.objectContaining({ text: "I can type without a camera" })); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("pending microphone access has visible feedback and can be cancelled while typed messages remain usable", async () => {
  mocks.media.micStatus = "starting"; const app = setup();
  expect(screen.getByText("Waiting for microphone access. Respond to the browser permission prompt, or cancel.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Turn microphone on" })).toBeNull(); write("Typing while microphone permission is pending");
  expect(screen.getByRole("button", { name: "Send to partner" }).disabled).toBe(false); await act(async () => send());
  expect(mocks.room.send).toHaveBeenCalledWith(expect.objectContaining({ text: "Typing while microphone permission is pending", inputMethod: "text" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel microphone start" })); expect(mocks.media.disableMic).toHaveBeenCalledOnce(); expect(mocks.media.enableMic).not.toHaveBeenCalled();
  mocks.media = { ...mocks.media, micStatus: "off" }; app.rerender(view());
  expect(screen.queryByText(/Waiting for microphone access/)).toBeNull(); expect(screen.getByRole("button", { name: "Turn microphone on" })).toBeTruthy();
});
test("reviewed sign composer shares the live camera ref and does not automatically send", () => {
  setup({ inputMethod: "sign", signLanguage: "asl" }); showPreferences(); fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  expect(mocks.captureProps.videoRef).toBe(mocks.media.localVideoRef); expect(mocks.captureProps.signLanguage).toBe("asl");
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" })); expect(draft().value).toBe("THANK YOU"); expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("a reviewed sign can be explicitly spoken on this device in English under Tamil preferences without sending or AI", async () => {
  mocks.media.micOn = true; mocks.media.remoteAudioEnabled = true; setup({ inputMethod: "sign", lang: "ta" });
  showPreferences(); fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  const remote = screen.getByLabelText("Partner’s live video"); remote.muted = false;
  expect(mocks.captureProps.canRead).toBe(true); expect(mocks.speaker.speak).not.toHaveBeenCalled();
  await act(async () => mocks.captureProps.onRead({ text: "WATER PLEASE", lang: "en" }));
  expect(mocks.speaker.speak).toHaveBeenCalledWith("WATER PLEASE", expect.objectContaining({ lang: "en-IN" }));
  expect(remote.muted).toBe(true); expect(mocks.media.disableMic).toHaveBeenCalled(); expect(mocks.media.setRemoteAudioEnabled).toHaveBeenLastCalledWith(false);
  expect(draft().value).toBe(""); expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.listen).not.toHaveBeenCalled();
});

test("Read my draft aloud preserves reviewed sign text and uses its source language instead of selected Tamil", async () => {
  setup({ inputMethod: "sign", lang: "ta" }); showPreferences(); fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  expect(draft().value).toBe("THANK YOU"); expect(mocks.speaker.speak).not.toHaveBeenCalled(); expect(mocks.room.send).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read my draft aloud" })));
  expect(mocks.speaker.speak).toHaveBeenCalledWith("THANK YOU", expect.objectContaining({ lang: "en-IN" }));
  expect(draft().value).toBe("THANK YOU"); expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft"))).toMatchObject({ text: "THANK YOU", inputMethod: "sign", signLanguage: "isl", lang: "en" });
  expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled(); expect(mocks.media.disableMic).toHaveBeenCalled();
});

test("capture start interrupts existing word playback and disables draft speech only while capture is active", async () => {
  let finish; mocks.speaker.speak.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  setup({ inputMethod: "sign" }); showPreferences(); fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  act(() => { void mocks.captureProps.onRead({ text: "THANK YOU", lang: "en" }); });
  expect(mocks.captureProps.speaking).toBe(true); expect(screen.getByRole("button", { name: "Read my draft aloud" }).disabled).toBe(true);
  const cancels = mocks.speaker.cancel.mock.calls.length;
  act(() => mocks.captureProps.onActivityChange(true)); expect(mocks.speaker.cancel.mock.calls.length).toBeGreaterThan(cancels);
  expect(mocks.captureProps.speaking).toBe(false); expect(screen.getByRole("button", { name: "Read my draft aloud" }).disabled).toBe(true);
  await act(async () => finish({ status: "cancelled" }));
  act(() => mocks.captureProps.onActivityChange(false)); expect(screen.getByRole("button", { name: "Read my draft aloud" }).disabled).toBe(false);
  expect(draft().value).toBe("THANK YOU"); expect(mocks.room.send).not.toHaveBeenCalled();
});

test("speech failures are visible and a stopped playback rejects late error/start callbacks", async () => {
  let finish; mocks.speaker.speak.mockImplementationOnce((text, options) => { options.onError("synthesis-unavailable"); return Promise.resolve({ status: "error", code: "synthesis-unavailable" }); });
  setup(); write("My reviewed message"); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read my draft aloud" })));
  expect(screen.getByRole("alert").textContent).toContain("synthesis-unavailable"); expect(draft().value).toBe("My reviewed message");
  let callbacks; mocks.speaker.speak.mockImplementationOnce((text, options) => { callbacks = options; return new Promise((resolve) => { finish = resolve; }); });
  fireEvent.click(screen.getByRole("button", { name: "Read my draft aloud" }));
  act(() => callbacks.onStart()); expect(screen.getByText("Reading aloud on this device…")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop voice playback" }));
  act(() => { callbacks.onError("late-failure"); callbacks.onStart(); }); await act(async () => finish({ status: "error", code: "late-failure" }));
  expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByText("Reading aloud on this device…")).toBeNull();
  expect(screen.getByRole("button", { name: "Read my draft aloud" }).disabled).toBe(false); expect(draft().value).toBe("My reviewed message"); expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("manual typing under Sign preferences is attributed to text and keeps that metadata when retrying after preference changes", async () => {
  mocks.room.send.mockResolvedValueOnce({ ok: false, id: "typed_uncertain", error: "Delivery uncertain" }).mockResolvedValueOnce({ ok: true, id: "typed_uncertain" });
  setup({ inputMethod: "sign", signLanguage: "asl" }); write("Manually typed without camera or recognition");
  await act(async () => send());
  expect(mocks.room.send.mock.calls[0][0]).toMatchObject({ inputMethod: "text" }); expect(mocks.room.send.mock.calls[0][0]).not.toHaveProperty("signLanguage");
  expect(document.querySelector(".room-composer-meta").textContent).toContain("Typed");
  showPreferences(); fireEvent.click(screen.getByRole("radio", { name: "Speak", exact: true }));
  await act(async () => send()); expect(mocks.room.send.mock.calls[1][0]).toMatchObject({ id: "typed_uncertain", inputMethod: "text" }); expect(mocks.room.send.mock.calls[1][0]).not.toHaveProperty("signLanguage");
  expect(mocks.media.enableCamera).not.toHaveBeenCalled(); expect(mocks.listen).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("reviewed recognized signs retain the captured sign language through edits and retries, then a cleared draft starts as typed", async () => {
  mocks.room.send.mockResolvedValueOnce({ ok: false, id: "sign_uncertain", error: "Delivery uncertain" }).mockResolvedValueOnce({ ok: true, id: "sign_uncertain" }).mockResolvedValueOnce({ ok: true, id: "next_typed" });
  setup({ inputMethod: "sign", signLanguage: "asl" }); showPreferences(); fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" })); write("THANK YOU VERY MUCH");
  fireEvent.change(screen.getByLabelText("Sign language"), { target: { value: "isl" } });
  await act(async () => send()); expect(mocks.room.send.mock.calls[0][0]).toMatchObject({ text: "THANK YOU VERY MUCH", inputMethod: "sign", signLanguage: "asl" });
  fireEvent.click(screen.getByRole("radio", { name: "Type", exact: true }));
  await act(async () => send()); expect(mocks.room.send.mock.calls[1][0]).toMatchObject({ id: "sign_uncertain", inputMethod: "sign", signLanguage: "asl" });
  fireEvent.click(screen.getByRole("radio", { name: "Sign", exact: true })); write("Fresh keyboard message");
  await act(async () => send()); expect(mocks.room.send.mock.calls[2][0]).toMatchObject({ inputMethod: "text" }); expect(mocks.room.send.mock.calls[2][0]).not.toHaveProperty("signLanguage");
});

test("dictation uses its actual speech source after a sign draft and removes obsolete sign-language metadata", async () => {
  setup({ inputMethod: "sign", signLanguage: "asl" }); showPreferences(); fireEvent.click(screen.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" })); fireEvent.click(screen.getByRole("button", { name: "Add reviewed test sign" }));
  fireEvent.click(screen.getByRole("radio", { name: "Speak", exact: true })); fireEvent.click(screen.getByRole("button", { name: "Start dictation" })); act(() => mocks.recognitionCallbacks.onEnd("I need some water"));
  write("Thank you. I need water, please"); await act(async () => send());
  expect(mocks.room.send.mock.calls[0][0]).toMatchObject({ inputMethod: "speech", text: "Thank you. I need water, please" }); expect(mocks.room.send.mock.calls[0][0]).not.toHaveProperty("signLanguage");
});
test("AI help is explicit and its suggestion stays private until the user reviews and sends", async () => {
  setup(); write("Help me rephrase this"); expect(mocks.room.askAI).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Optional AI help")); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ask AI about this draft" })));
  expect(mocks.room.askAI).toHaveBeenCalledOnce(); expect(mocks.room.send).not.toHaveBeenCalled(); expect(draft().value).toBe("Help me rephrase this");
  fireEvent.click(screen.getByRole("button", { name: "Use suggestion as my draft" })); expect(draft().value).toBe("Suggested reply"); await act(async () => send()); expect(mocks.room.send.mock.calls.at(-1)[0].text).toBe("Suggested reply");
});
test("leave and end stop dictation, synthesized speech and all call resources while retaining draft", () => {
  setup({ inputMethod: "speech" }); write("Preserve this draft"); fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
  fireEvent.click(screen.getByRole("button", { name: "End for both" })); expect(mocks.microphone.abort).toHaveBeenCalled(); expect(mocks.speaker.cancel).toHaveBeenCalled(); expect(mocks.media.stop).toHaveBeenCalledOnce(); expect(mocks.room.end).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft")).text).toBe("Preserve this draft");
});
test("ending aborts explicit AI help and discards any late response without relaying it", async () => {
  let resolve; mocks.room.askAI.mockImplementation(() => new Promise((done) => { resolve = done; })); setup(); write("Private AI draft");
  fireEvent.click(screen.getByText("Optional AI help")); fireEvent.click(screen.getByRole("button", { name: "Ask AI about this draft" }));
  const signal = mocks.room.askAI.mock.calls[0][0].signal; expect(signal.aborted).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "End for both" })); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ reply: "Late response from the ended room" })); expect(screen.queryByText("Late response from the ended room")).toBe(null); expect(mocks.room.send).not.toHaveBeenCalled();
});
test.each(["create", "join"])("%s after a connection error aborts earlier AI help and rejects stale suggestions", async (action) => {
  let resolve; mocks.room.askAI.mockImplementation(() => new Promise((done) => { resolve = done; })); const app = setup(); write("Earlier private draft");
  fireEvent.click(screen.getByText("Optional AI help")); fireEvent.click(screen.getByRole("button", { name: "Ask AI about this draft" })); const signal = mocks.room.askAI.mock.calls[0][0].signal;
  mocks.room = { ...mocks.room, status: "error", error: "Connection lost" }; app.rerender(view());
  if (action === "create") fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
  else { fireEvent.click(screen.getByRole("button", { name: "Join conversation" })); fireEvent.change(screen.getByLabelText("Partner’s invite link"), { target: { value: "https://demo.example/#connect?room=new&invite=invite" } }); fireEvent.click(screen.getByRole("button", { name: "Join room" })); }
  expect(signal.aborted).toBe(true); expect(action === "create" ? mocks.room.create : mocks.room.join).toHaveBeenCalledOnce();
  await act(async () => resolve({ reply: "Stale previous-room suggestion" })); mocks.room = { ...mocks.room, roomId: "newroom", status: "connected", error: "" }; app.rerender(view());
  expect(screen.queryByText("Stale previous-room suggestion")).toBe(null); expect(draft().value).toBe("Earlier private draft"); expect(mocks.room.send).not.toHaveBeenCalled();
});

const meeting = (revision = 1, extra = {}) => ({ id: "meeting_1", revision, fields: { date: "2026-10-10", time: "15:00", timeZone: "Asia/Kolkata", place: "Library entrance B", note: "Bring your application" }, lang: "en", approvals: [], history: [], ...extra });
const updateWorkflow = (app, changes, extra = {}) => { mocks.room = { ...mocks.room, ...extra, workflow: { ...mocks.room.workflow, ...changes } }; app.rerender(view()); };

test("optional clarification targets one received message and keeps ordinary unsent text untouched", async () => {
  mocks.room.messages = [partnerMessage("target1", "Meet at the entrance")]; setup(); write("My ordinary draft");
  fireEvent.click(screen.getByRole("button", { name: "Clarify this" }));
  fireEvent.change(screen.getByLabelText("What needs clarification?"), { target: { value: "question" } });
  expect(screen.getByLabelText("Your clarification question").maxLength).toBe(1000);
  fireEvent.change(screen.getByLabelText("Your clarification question"), { target: { value: "Which entrance?" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send clarification request" })));
  expect(mocks.room.sendAction).toHaveBeenCalledWith({ kind: "clarification.request", messageId: "target1", reason: "question", question: "Which entrance?", lang: "en" });
  expect(draft().value).toBe("My ordinary draft"); expect(mocks.room.send).not.toHaveBeenCalled(); expect(mocks.room.askAI).not.toHaveBeenCalled();
  await act(async () => send()); expect(mocks.room.send.mock.calls[0][0]).not.toHaveProperty("relation");
});

test("answer and correction reuse explicit reviewed Send, preserve original wording and keep a pre-existing draft", async () => {
  const original = { ...partnerMessage("mine1", "Meet at 3 PM"), senderId: "host" };
  mocks.room.messages = [original]; mocks.room.workflow.clarifications = [{ id: "clarify1", messageId: original.id, requesterId: "guest", reason: "time-place", question: "Which time?", status: "open" }];
  const app = setup({ inputMethod: "speech" }); write("Existing draft that must be reviewed");
  fireEvent.click(screen.getByRole("button", { name: "Answer in reviewed draft" }));
  expect(draft().value).toBe("Existing draft that must be reviewed"); expect(mocks.room.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start dictation" })); act(() => mocks.recognitionCallbacks.onEnd("3 PM at entrance B"));
  await act(async () => send()); expect(mocks.room.send.mock.calls[0][0]).toMatchObject({ relation: { kind: "answer", messageId: "mine1", clarificationId: "clarify1" }, inputMethod: "speech" });
  expect(screen.getByText("Meet at 3 PM")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Correct message" })); write("Meet at 4 PM instead"); await act(async () => send());
  expect(mocks.room.send.mock.calls[1][0]).toMatchObject({ text: "Meet at 4 PM instead", relation: { kind: "correction", messageId: "mine1" } });
  updateMessages(app, [original, { ...original, id: "mine2", text: "Meet at 4 PM instead", relation: { kind: "correction", messageId: "mine1" } }]);
  expect(screen.getByText("Meet at 4 PM instead")).toBeTruthy(); expect(screen.getAllByText("Meet at 3 PM").length).toBe(2);
});

test("linked draft survives disconnect and same-room reload; a new room clears its relation while preserving text", () => {
  mocks.room.messages = [{ ...partnerMessage("mine1", "Original message"), senderId: "host" }];
  const app = setup(); write("Reviewed correction still being edited"); fireEvent.click(screen.getByRole("button", { name: "Correct message" }));
  mocks.room = { ...mocks.room, status: "reconnecting" }; app.rerender(view());
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft"))).toMatchObject({ roomId: "room1", relation: { kind: "correction", messageId: "mine1" } });
  app.unmount(); mocks.room = { ...mocks.room, status: "connected" }; const restored = render(view());
  expect(screen.getByText("Correction to your message")).toBeTruthy(); expect(draft().value).toBe("Reviewed correction still being edited");
  mocks.room = { ...mocks.room, roomId: "room2", messages: [] }; restored.rerender(view());
  expect(screen.queryByText("Correction to your message")).toBeNull(); expect(draft().value).toBe("Reviewed correction still being edited");
});

test("only the clarification requester can resolve it, with an action label that does not claim comprehension", async () => {
  mocks.room.messages = [partnerMessage("target1", "At the main entrance")]; mocks.room.workflow.clarifications = [{ id: "clarify1", messageId: "target1", requesterId: "host", reason: "repeat", status: "open" }];
  const app = setup(); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mark request resolved" })));
  expect(mocks.room.sendAction).toHaveBeenCalledWith({ kind: "clarification.resolve", clarificationId: "clarify1" });
  updateWorkflow(app, { clarifications: [{ ...mocks.room.workflow.clarifications[0], status: "resolved" }] }); expect(screen.getByText("You marked this resolved")).toBeTruthy();
  updateWorkflow(app, { clarifications: [{ ...mocks.room.workflow.clarifications[0], requesterId: "guest", status: "open" }] }); expect(screen.queryByRole("button", { name: "Mark request resolved" })).toBeNull();
});

test("meeting approvals target the visible revision, reset after edits and require explicit review after a stale response", async () => {
  mocks.room.workflow.cards = [meeting(1, { approvals: ["guest"] })];
  mocks.room.sendAction.mockResolvedValueOnce({ ok: false, code: "STALE_REVISION", error: "Meeting revision changed" }).mockResolvedValueOnce({ ok: true, id: "approval_2" });
  const app = setup(); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve revision 1" })));
  expect(mocks.room.sendAction.mock.calls[0][0]).toEqual({ kind: "meeting.approve", cardId: "meeting_1", revision: 1 });
  updateWorkflow(app, { cards: [meeting(2, { fields: { ...meeting().fields, time: "16:00" }, approvals: [] })] });
  expect(screen.queryByText("Both approved these details")).toBeNull(); expect(screen.getByRole("button", { name: "Approve revision 2" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Review current revision 2" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve revision 2" })));
  expect(mocks.room.sendAction.mock.calls[1][0]).toEqual({ kind: "meeting.approve", cardId: "meeting_1", revision: 2 });
  updateWorkflow(app, { cards: [meeting(2, { approvals: ["guest", "host"] })] }); expect(screen.getByText("Both approved these details")).toBeTruthy();
  updateWorkflow(app, { cards: [meeting(3)] }); expect(screen.queryByText("Both approved these details")).toBeNull(); expect(screen.getByRole("button", { name: "Approve revision 3" }).disabled).toBe(false);
});

test("offline cards cannot approve; editing retains its base revision when a concurrent revision arrives", async () => {
  mocks.room.workflow.cards = [meeting()]; const app = setup(); fireEvent.click(screen.getByRole("button", { name: "Propose an edit" }));
  fireEvent.change(screen.getByLabelText(/^Time required/), { target: { value: "17:00" } });
  updateWorkflow(app, { cards: [meeting(2)] }, { status: "reconnecting" });
  expect(screen.getByRole("button", { name: "Approve revision 2" }).disabled).toBe(true); expect(screen.getByRole("button", { name: "Save new revision" }).disabled).toBe(true);
  updateWorkflow(app, {}, { status: "connected" }); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save new revision" })));
  expect(mocks.room.sendAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "meeting.revise", cardId: "meeting_1", baseRevision: 1, fields: expect.objectContaining({ time: "17:00" }) }));
});

test("manual meeting creation sends only after review and read aloud contains all fields plus approval state", async () => {
  const app = setup(); fireEvent.click(screen.getByRole("button", { name: "Add meeting details" }));
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "2026-10-10" } });
  fireEvent.change(screen.getByLabelText(/^Time required/), { target: { value: "15:00" } });
  fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: "Library entrance B" } });
  expect(mocks.room.sendAction).not.toHaveBeenCalled(); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share meeting details" })));
  expect(mocks.room.sendAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "meeting.create", fields: expect.objectContaining({ place: "Library entrance B" }), lang: "en" }));
  updateWorkflow(app, { cards: [meeting(1, { approvals: ["guest", "host"] })] });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Read all meeting details aloud" })));
  const spoken = mocks.speaker.speak.mock.calls[0][0];
  for (const value of ["2026-10-10", "15:00", "Asia/Kolkata", "Library entrance B", "Bring your application", "Both approved these details"]) expect(spoken).toContain(value);
  expect(mocks.room.askAI).not.toHaveBeenCalled();
});

test("message and card outputs share sequence order, announce event IDs once and do not replay reconnect snapshots", () => {
  const app = setup({ receive: "screenreader" });
  const card = meeting(2, { approvals: ["guest"] });
  mocks.room = { ...mocks.room, messages: [partnerMessage("new3", "Meet there")], workflow: { ...mocks.room.workflow, cards: [card], events: [{ id: "event2", kind: "meeting.revise", actorId: "guest", seq: 2, lang: "en", card }] } }; app.rerender(view());
  expect(liveRegion().textContent.indexOf("Meeting details")).toBeLessThan(liveRegion().textContent.indexOf("Meet there"));
  const announced = liveRegion().firstElementChild; app.rerender(view()); expect(liveRegion().firstElementChild).toBe(announced);
  mocks.room = { ...mocks.room, status: "reconnecting" }; app.rerender(view());
  mocks.room = { ...mocks.room, status: "connected", snapshotVersion: 2, workflow: { ...mocks.room.workflow, events: [...mocks.room.workflow.events, { id: "missed4", kind: "meeting.approve", actorId: "guest", seq: 4, card }] } }; app.rerender(view());
  expect(liveRegion().firstElementChild).toBe(announced);
  updateWorkflow(app, { events: [...mocks.room.workflow.events, { id: "fresh5", kind: "meeting.approve", actorId: "guest", seq: 5, card: { ...card, approvals: ["host", "guest"] } }] });
  expect(liveRegion().textContent).toContain("Both approved these details");
});

test("reference attachments retain session draft context and historical snapshots after a later rename", async () => {
  const reference = { id: "reference1", revision: 1, label: "Entrance B", description: "Beside the main road", lang: "en" };
  mocks.room.workflow.references = [reference]; const app = setup(); write("Meet here");
  fireEvent.click(screen.getByText(/Attach shared references/)); fireEvent.click(screen.getByRole("checkbox", { name: /Entrance B/ }));
  expect(JSON.parse(sessionStorage.getItem("signbridge:conversation-draft"))).toMatchObject({ roomId: "room1", referenceIds: ["reference1"] });
  await act(async () => send()); expect(mocks.room.send.mock.calls[0][0]).toMatchObject({ text: "Meet here", referenceIds: ["reference1"] });
  updateMessages(app, [{ ...partnerMessage("refMessage1", "Historical referenced message"), references: [reference] }]);
  updateWorkflow(app, { references: [{ ...reference, revision: 2, label: "Entrance C", description: "Opposite the bus stop" }] });
  const message = screen.getByText("Historical referenced message").closest("article"); expect(message.textContent).toContain("Entrance B"); expect(message.textContent).toContain("Beside the main road"); expect(message.textContent).not.toContain("Entrance C");
  await act(async () => fireEvent.click(within(message).getByRole("button", { name: /^Read message aloud/ })));
  expect(mocks.speaker.speak.mock.calls[0][0]).toContain("Beside the main road");
});

test("uncertain action retries use original IDs and stale pending approvals never become a newer approval", async () => {
  const original = { id: "approval_old", kind: "meeting.approve", cardId: "meeting_1", revision: 1 };
  mocks.room.workflow.cards = [meeting(2)]; mocks.room.pendingActions = [{ id: original.id, action: original, delivery: "uncertain" }];
  const app = setup(); expect(screen.queryByRole("button", { name: "Retry original action" })).toBeNull(); expect(screen.getByText(/this older approval will not be retried/)).toBeTruthy();
  const request = { id: "request_retry", kind: "clarification.request", messageId: "message1", reason: "repeat", question: "Repeat", lang: "en" };
  mocks.room = { ...mocks.room, pendingActions: [{ id: request.id, action: request, delivery: "uncertain" }] }; app.rerender(view());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry original action" }))); expect(mocks.room.sendAction).toHaveBeenCalledWith(request);
});

test("uncertain form retries reuse the action ID while changed meeting fields create a new action", async () => {
  mocks.room.sendAction.mockResolvedValueOnce({ ok: false, id: "details_uncertain", uncertain: true, error: "Confirmation uncertain" }).mockResolvedValueOnce({ ok: false, id: "details_uncertain", uncertain: true, error: "Confirmation uncertain" }).mockResolvedValueOnce({ ok: true, id: "details_changed" });
  setup(); fireEvent.click(screen.getByRole("button", { name: "Add meeting details" })); fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: "Entrance B" } });
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "2026-10-10" } }); fireEvent.change(screen.getByLabelText(/^Time required/), { target: { value: "15:00" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share meeting details" }))); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share meeting details" })));
  expect(mocks.room.sendAction.mock.calls[1][0].id).toBe("details_uncertain");
  fireEvent.change(screen.getByLabelText(/^Place/), { target: { value: "Entrance C" } }); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share meeting details" })));
  expect(mocks.room.sendAction.mock.calls[2][0]).not.toHaveProperty("id"); expect(mocks.room.sendAction.mock.calls[2][0].fields.place).toBe("Entrance C");
});

test("clarification announcements identify original messages, report resolution without replay, and explain pruned context", () => {
  const original = { ...partnerMessage("original1", "Meet beside the library main entrance"), senderId: "host" };
  mocks.room.messages = [original]; const app = setup({ receive: "screenreader" });
  const request = { id: "clarify1", messageId: original.id, requesterId: "guest", reason: "question", question: "Which entrance?", lang: "en", status: "open" };
  const event = { id: "clarify1", kind: "clarification.request", actorId: "guest", seq: 2, clarification: request };
  updateWorkflow(app, { clarifications: [request], events: [event] });
  expect(liveRegion().textContent).toContain("Which entrance?"); expect(liveRegion().textContent).toContain("About the message: Meet beside the library main entrance");
  const first = liveRegion().firstElementChild;
  updateWorkflow(app, { events: [{ ...event }] }); expect(liveRegion().firstElementChild).toBe(first);
  const resolved = { ...request, status: "resolved" }; updateWorkflow(app, { clarifications: [resolved], events: [event, { id: "resolve1", kind: "clarification.resolve", actorId: "guest", seq: 3, clarification: resolved }] });
  expect(liveRegion().textContent).toContain("Partner marked the clarification request resolved"); expect(liveRegion().textContent).toContain("Request: Which entrance?"); expect(liveRegion().textContent).toContain("Meet beside the library main entrance");
  const last = liveRegion().firstElementChild;
  updateWorkflow(app, {}, { snapshotVersion: 2 }); expect(liveRegion().firstElementChild).toBe(last);
  updateMessages(app, []); updateWorkflow(app, { events: [...mocks.room.workflow.events, { ...event, id: "pruned4", seq: 4 }] });
  expect(liveRegion().textContent).toContain("The original message is no longer in the retained history");
});
