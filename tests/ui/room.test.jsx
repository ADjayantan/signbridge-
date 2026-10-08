import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRoom } from "../../src/hooks/useRoom.js";

class FakeSocket {
  static sockets = [];
  constructor() { this.readyState = 0; this.sent = []; FakeSocket.sockets.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const credentials = { roomId: "room1", participantId: "host", token: "private", inviteToken: "invite", role: "host" };
beforeEach(() => { sessionStorage.clear(); FakeSocket.sockets = []; vi.stubGlobal("WebSocket", FakeSocket); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => credentials })); });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

test("room hook keeps action functions stable and acknowledged sends update accessible history", async () => {
  const { result, rerender } = renderHook(() => useRoom()); const create = result.current.create;
  await act(async () => result.current.create()); const socket = FakeSocket.sockets[0];
  act(() => { socket.open(); socket.receive({ type: "snapshot", messages: [], participants: [{ id: "host", online: true }] }); });
  expect(result.current.status).toBe("connected"); expect(result.current.create).toBe(create); const signals = result.current.subscribeSignal;
  let sending; act(() => { sending = result.current.send({ id: "one", text: "hello", inputMethod: "text", lang: "en" }); });
  await act(async () => { socket.receive({ type: "ack", id: "one" }); await sending; }); expect(result.current.messages[0].delivery).toBe("sent");
  rerender(); expect(result.current.subscribeSignal).toBe(signals); expect(fetch).toHaveBeenCalledTimes(1);
});
test("StrictMode restores the session connection and unmount closes it without ending room", async () => {
  sessionStorage.setItem("signbridge.room.session.v1", JSON.stringify(credentials));
  const wrapper = ({ children }) => <React.StrictMode>{children}</React.StrictMode>;
  const { result, unmount } = renderHook(() => useRoom(), { wrapper });
  const socket = FakeSocket.sockets.at(-1); act(() => { socket.open(); socket.receive({ type: "snapshot", messages: [], participants: [] }); });
  expect(result.current.status).toBe("connected"); unmount(); expect(socket.readyState).toBe(3); expect(sessionStorage.getItem("signbridge.room.session.v1")).toBeTruthy();
  expect(socket.sent.some((message) => message.type === "leave" || message.type === "end")).toBe(false);
});
test("browser offline suspends an acknowledged room immediately and online resumes the same participant", async () => {
  const { result } = renderHook(() => useRoom()); await act(async () => result.current.create()); const first = FakeSocket.sockets[0];
  act(() => { first.open(); first.receive({ type: "snapshot", messages: [{ id: "one", text: "History survives", senderId: "guest", seq: 1 }], participants: [{ id: "host", online: true }, { id: "guest", online: true }] }); });
  act(() => window.dispatchEvent(new Event("offline"))); expect(result.current.status).toBe("reconnecting"); expect(result.current.messages[0].text).toBe("History survives"); expect(first.readyState).toBe(3); expect(sessionStorage.getItem("signbridge.room.session.v1")).toBeTruthy();
  act(() => window.dispatchEvent(new Event("online"))); const second = FakeSocket.sockets[1]; act(() => { second.open(); second.receive({ type: "snapshot", messages: result.current.messages, participants: [] }); });
  expect(result.current.status).toBe("connected"); expect(second.sent[0]).toMatchObject({ participantId: "host", token: "private" }); expect(fetch).toHaveBeenCalledTimes(1);
});
test("initially offline browser never opens a resume socket until online and unmount removes network listeners", () => {
  const remove = vi.spyOn(window, "removeEventListener"); const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  sessionStorage.setItem("signbridge.room.session.v1", JSON.stringify(credentials)); const { result, unmount } = renderHook(() => useRoom());
  expect(result.current.status).toBe("reconnecting"); expect(FakeSocket.sockets).toHaveLength(0);
  onLine.mockReturnValue(true); act(() => window.dispatchEvent(new Event("online"))); expect(FakeSocket.sockets).toHaveLength(1); unmount();
  expect(remove.mock.calls.some(([type]) => type === "offline")).toBe(true); expect(remove.mock.calls.some(([type]) => type === "online")).toBe(true);
  act(() => window.dispatchEvent(new Event("online"))); expect(FakeSocket.sockets).toHaveLength(1);
});
test("room hook exposes stable reviewed workflow actions and snapshot origin for announcement suppression", async () => {
  const { result, rerender } = renderHook(() => useRoom()); const sendAction = result.current.sendAction;
  expect(result.current.workflow).toEqual({ events: [], clarifications: [], cards: [], references: [] }); expect(result.current.pendingActions).toEqual([]);
  await act(async () => result.current.create()); const socket = FakeSocket.sockets[0];
  const workflow = { events: [], cards: [{ id: "card1", revision: 1, fields: { place: "Library" }, approvals: [] }], clarifications: [], references: [] };
  act(() => { socket.open(); socket.receive({ type: "snapshot", messages: [], participants: [], workflow }); });
  expect(result.current.snapshotVersion).toBe(1); expect(result.current.workflowOrigin).toBe("snapshot");
  let approving; act(() => { approving = result.current.sendAction({ id: "approve1", kind: "meeting.approve", cardId: "card1", revision: 1 }); });
  expect(result.current.pendingActions[0].delivery).toBe("pending");
  const event = { id: "approve1", actorId: "host", kind: "meeting.approve", seq: 1 };
  await act(async () => { socket.receive({ type: "workflow", event, workflow: { ...workflow, events: [event], cards: [{ ...workflow.cards[0], approvals: ["host"] }] } }); await approving; });
  expect(result.current.pendingActions).toEqual([]); expect(result.current.workflowVersion).toBe(1); expect(result.current.workflowOrigin).toBe("live");
  act(() => socket.receive({ type: "snapshot", messages: [], participants: [], workflow: result.current.workflow, acceptedActionIds: ["approve1"] }));
  expect(result.current.snapshotVersion).toBe(2); expect(result.current.workflowOrigin).toBe("snapshot"); rerender(); expect(result.current.sendAction).toBe(sendAction); expect(fetch).toHaveBeenCalledTimes(1);
});
