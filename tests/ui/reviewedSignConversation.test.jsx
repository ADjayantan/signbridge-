import React from "react";
import { once } from "node:events";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { createRoomServer } from "../../server/roomServer.js";
import { RoomClient } from "../../src/lib/roomClient.js";
import ConnectMode from "../../src/modes/ConnectMode.jsx";
import { legacyCameraFrame, legacyCameraModel } from "../helpers/legacyCamera.js";

// This tests reviewed-sign communication, not webcam/model accuracy. The
// landmark frames and deliberately biased model below are synthetic fixtures.
// ConnectMode, RoomSignCapture, camera-turn validation, GRU inference,
// RoomClient, HTTP room membership, and WebSocket delivery are real code.
const fixture = vi.hoisted(() => ({ context: null, media: new Map(), tracking: new Map(), model: null,
  speakers: [], speakerIndex: 0, requests: [], upstream: vi.fn(), chatLoader: vi.fn() }));

vi.mock("../../src/hooks/useRoom.js", async () => {
  const react = await import("react");
  fixture.context = react.createContext(null);
  return { useRoom: () => {
    const client = react.useContext(fixture.context);
    const state = react.useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
    const actions = react.useMemo(() => ({ create: client.create.bind(client), join: client.join.bind(client), send: client.send.bind(client),
      sendAction: client.sendAction.bind(client), leave: client.leave, end: client.end, retry: client.retry,
      askAI: client.askAI.bind(client) }), [client]);
    return { ...state, ...actions };
  } };
});
vi.mock("../../src/hooks/useRoomMedia.js", () => ({ useRoomMedia: (room) => fixture.media.get(room.participantId) }));
vi.mock("../../src/hooks/usePoseTracking.js", () => ({ usePoseTracking: ({ videoRef, active, onFrame }) => {
  fixture.tracking.set(videoRef, onFrame);
  return { status: active ? "ready" : "idle", error: "", retry: vi.fn() };
} }));
vi.mock("../../src/hooks/useTrainedModel.js", () => ({ useTrainedModel: () => ({ status: "ready", model: fixture.model, error: "", retry: vi.fn() }) }));
vi.mock("../../src/lib/trainedSignModel.js", async (original) => ({ ...await original(), poseFrameFromHolistic: (frame) => frame }));
vi.mock("../../src/hooks/useSignVideos.js", () => ({ useSignVideos: () => ({ clips: [], loading: false, error: "" }) }));
vi.mock("../../src/lib/speech.js", () => ({ canSpeak: true, canListen: false, createSpeaker: () => fixture.speakers[fixture.speakerIndex++],
  listenOnce: vi.fn(() => { throw new Error("This sign-only fixture must not dictate or type a replacement."); }),
  listenErrorMessage: () => "Dictation is unavailable in this fixture.", speakErrorMessage: () => "Speech hardware is not part of this fixture." }));

let server, sender, receiver, now;
const clients = [];
const settings = { rate: 1 };
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function whenClient(client, predicate) {
  if (predicate(client.getSnapshot())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const unsubscribe = client.subscribe(() => {
      if (!predicate(client.getSnapshot())) return;
      clearTimeout(timeout); unsubscribe(); resolve();
    });
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error("Local room fixture did not reach the expected state.")); }, 3000);
  });
}
function media() {
  return { localVideoRef: { current: null }, remoteVideoRef: { current: null }, cameraOn: false, cameraStatus: "off", micOn: false, micStatus: "off",
    mediaStatus: "waiting", remoteVideoOn: false, remoteAudioEnabled: false, forceRelay: false, routeStatus: "unknown",
    error: "", notice: "", playbackBlocked: false, playbackError: "", enableCamera: vi.fn(), disableCamera: vi.fn(), enableMic: vi.fn(), disableMic: vi.fn(),
    retry: vi.fn(), stop: vi.fn(), setRemoteAudioEnabled: vi.fn(), setForceRelay: vi.fn(), checkVideoRoute: vi.fn(), retryRemotePlayback: vi.fn() };
}
function mountParticipant(client, preferences) {
  // The real preferences hook initializes each UI's state separately. The two
  // logical participants share JSDOM storage; this is not a two-device test.
  localStorage.setItem("signbridge:communication-preferences", JSON.stringify({ inputMethod: "text", receive: "text", signVideos: false,
    signLanguage: fixture.model.signLanguage, lang: "en", ...preferences }));
  sessionStorage.removeItem("signbridge:conversation-draft");
  const view = render(<fixture.context.Provider value={client}><ConnectMode settings={settings} onBack={vi.fn()} onTool={vi.fn()} /></fixture.context.Provider>);
  return { ...view, ui: within(view.container), draft: () => view.container.querySelector("#room-draft"),
    history: () => within(view.container.querySelector(".room-message-list")) };
}
function poseSamples(count) {
  act(() => {
    for (let index = 0; index < count; index++) {
      now += 125;
      fixture.tracking.get(fixture.media.get(sender.getSnapshot().participantId).localVideoRef)(legacyCameraFrame());
    }
  });
}

beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); window.location.hash = "#connect";
  fixture.media.clear(); fixture.tracking.clear(); fixture.requests = []; fixture.speakerIndex = 0; clients.length = 0;
  fixture.speakers = [{ speak: vi.fn().mockResolvedValue({ status: "ended" }), cancel: vi.fn() }, { speak: vi.fn().mockResolvedValue({ status: "ended" }), cancel: vi.fn() }];
  fixture.upstream.mockImplementation(async () => { throw new Error("Human sign communication must not invoke AI or a relay provider."); });
  fixture.chatLoader.mockImplementation(async () => { throw new Error("The human conversation must not load its optional AI helper."); });
  // No website files are served. Vite rewrites import.meta.url in JSDOM, so
  // explicitly provide the unused static directory rather than its URL default.
  server = createRoomServer({ env: {}, staticDir: "unused-integration-build", fetchImpl: fixture.upstream, chatLoader: fixture.chatLoader });
  server.server.listen(0, "127.0.0.1"); await once(server.server, "listening");
  const baseUrl = `http://127.0.0.1:${server.server.address().port}`;
  const fetchImpl = (url, options) => {
    const destination = new URL(url);
    if (destination.origin !== baseUrl) throw new Error("This integration fixture may only contact its local room server.");
    fixture.requests.push(destination.pathname); return fetch(url, options);
  };
  sender = new RoomClient({ baseUrl, origin: baseUrl, fetchImpl, WebSocketImpl: WebSocket, storage: storage() });
  receiver = new RoomClient({ baseUrl, origin: baseUrl, fetchImpl, WebSocketImpl: WebSocket, storage: storage() });
  clients.push(sender, receiver);
  await sender.create(); await whenClient(sender, (state) => state.status === "connected");
  await receiver.join(sender.getSnapshot().inviteUrl); await whenClient(receiver, (state) => state.status === "connected");
  await whenClient(sender, (state) => state.participants.length === 2 && state.participants.every((member) => member.online));
  fixture.media.set(sender.getSnapshot().participantId, { ...media(), cameraOn: true, cameraStatus: "on" });
  fixture.media.set(receiver.getSnapshot().participantId, media());
  now = 1000; vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(async () => {
  cleanup(); clients.forEach((client) => client.dispose());
  if (server) await server.close();
  server = null; localStorage.clear(); sessionStorage.clear();
});

test.each(["asl", "isl"])("synthetic %s sign capture reaches a real partner room as exact visible text and one voice output after review and explicit send", async (signLanguage) => {
  fixture.model = { ...legacyCameraModel(), signLanguage, labels: ["HELLO", "HELP"] };
  const send = vi.spyOn(sender, "send"), senderSpeaker = fixture.speakers[0], receiverSpeaker = fixture.speakers[1];
  const senderView = mountParticipant(sender, { inputMethod: "sign" }), receiverView = mountParticipant(receiver, { receive: "speech" });
  fireEvent.click(senderView.ui.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  poseSamples(1); fireEvent.click(senderView.ui.getByRole("button", { name: "Capture a word" })); poseSamples(8);
  expect(senderView.draft().value).toBe(""); expect(send).not.toHaveBeenCalled();
  expect(receiver.getSnapshot().messages).toEqual([]); expect(receiverSpeaker.speak).not.toHaveBeenCalled();
  fireEvent.click(senderView.ui.getByRole("button", { name: /^Finish sign/ }));
  const reviewedWord = senderView.ui.getByLabelText("Review or correct the word");
  expect(reviewedWord.value).toBe("HELLO"); expect(senderView.ui.getByText("Tentative word — check the meaning")).toBeTruthy();
  // No text-entry event is used: the message originates from the captured
  // synthetic pose/model result and the user's explicit review/add action.
  expect(senderView.draft().value).toBe(""); expect(send).not.toHaveBeenCalled();
  expect(senderSpeaker.speak).not.toHaveBeenCalled(); expect(receiverSpeaker.speak).not.toHaveBeenCalled();
  fireEvent.click(senderView.ui.getByRole("button", { name: "Add reviewed word to message" }));
  expect(senderView.draft().value).toBe("HELLO"); expect(reviewedWord.value).toBe("");
  expect(send).not.toHaveBeenCalled(); expect(receiver.getSnapshot().messages).toEqual([]);
  await act(async () => {
    fireEvent.click(senderView.ui.getByRole("button", { name: "Send to partner" }));
    await whenClient(sender, (state) => state.messages.length === 1 && state.messages[0].delivery === "received");
  });
  expect(send).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "HELLO", inputMethod: "sign", signLanguage, lang: "en" }));
  const received = receiver.getSnapshot().messages[0];
  expect(received).toMatchObject({ text: "HELLO", inputMethod: "sign", signLanguage, lang: "en", senderId: sender.getSnapshot().participantId, seq: 1 });
  expect(receiverView.history().getByText("HELLO")).toBeTruthy();
  expect(receiverSpeaker.speak).toHaveBeenCalledOnce(); expect(receiverSpeaker.speak).toHaveBeenCalledWith("HELLO", expect.objectContaining({ lang: "en-IN", rate: 1 }));
  expect(senderSpeaker.speak).not.toHaveBeenCalled(); expect(senderView.draft().value).toBe("");
  expect(server.rooms.snapshot(sender.getSnapshot().roomId, sender.getSnapshot().participantId).messages).toHaveLength(1);
  // A receipt and unrelated rerender must not replay the same received sign.
  receiverView.rerender(<fixture.context.Provider value={receiver}><ConnectMode settings={settings} onBack={vi.fn()} onTool={vi.fn()} /></fixture.context.Provider>);
  expect(receiverSpeaker.speak).toHaveBeenCalledOnce(); expect(receiver.getSnapshot().messages).toHaveLength(1);
  expect(fixture.requests.every((path) => path.startsWith("/api/rooms"))).toBe(true);
  expect(fixture.upstream).not.toHaveBeenCalled(); expect(fixture.chatLoader).not.toHaveBeenCalled();
}, 10000);

test("an empty synthetic capture cannot add, send or speak a sign to the partner", () => {
  fixture.model = { ...legacyCameraModel(), labels: ["HELLO", "HELP"] };
  const send = vi.spyOn(sender, "send");
  const senderView = mountParticipant(sender, { inputMethod: "sign" }); mountParticipant(receiver, { receive: "speech" });
  fireEvent.click(senderView.ui.getByRole("switch", { name: "Enable hand-joint tracking and word recognition" }));
  poseSamples(1); fireEvent.click(senderView.ui.getByRole("button", { name: "Capture a word" }));
  fireEvent.click(senderView.ui.getByRole("button", { name: /^Finish sign/ }));
  expect(senderView.ui.getByText("No reliable word match")).toBeTruthy();
  expect(senderView.ui.getByLabelText("Review or correct the word").value).toBe("");
  const add = senderView.ui.getByRole("button", { name: "Add reviewed word to message" }), submit = senderView.ui.getByRole("button", { name: "Send to partner" });
  expect(add.disabled).toBe(true); expect(submit.disabled).toBe(true); fireEvent.click(add); fireEvent.click(submit);
  expect(send).not.toHaveBeenCalled(); expect(senderView.draft().value).toBe(""); expect(receiver.getSnapshot().messages).toEqual([]);
  expect(fixture.speakers.every((speaker) => speaker.speak.mock.calls.length === 0)).toBe(true);
  expect(fixture.upstream).not.toHaveBeenCalled(); expect(fixture.chatLoader).not.toHaveBeenCalled();
}, 10000);
