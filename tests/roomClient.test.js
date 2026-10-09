import assert from "node:assert/strict";
import { test } from "node:test";
import { RoomClient, parseRoomInvite } from "../src/lib/roomClient.js";
import { WebSocket } from "ws";
import { createRoomServer } from "../server/roomServer.js";

class FakeSocket {
  static sockets = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.sockets.push(this); }
  send(value) { this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
const credentials = { roomId: "room_123", participantId: "host_1", token: "private_1", inviteToken: "invite_1", role: "host" };
function setup(options = {}) {
  FakeSocket.sockets = [];
  const requests = []; const saved = new Map();
  const client = new RoomClient({ origin: "https://demo.example", fetchImpl: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => url.endsWith("/ice") ? { iceServers: [], relayAvailable: false } : credentials }; }, WebSocketImpl: FakeSocket, storage: { setItem: (k, v) => saved.set(k, v), getItem: (k) => saved.get(k), removeItem: (k) => saved.delete(k) }, ackTimeout: 20, reconnectDelay: 5, ...options });
  return { client, requests, saved };
}
async function connected(client) {
  await client.create(); const socket = FakeSocket.sockets.at(-1); socket.open();
  socket.receive({ type: "snapshot", roomId: credentials.roomId, participantId: credentials.participantId, role: "host", messages: [], participants: [{ id: "host_1", online: true }, { id: "guest_2", online: true }] }); return socket;
}

test("room invites accept hash or query links and reject missing/malformed tokens", () => {
  assert.deepEqual(parseRoomInvite("https://demo.example/#connect?room=room_1&invite=invite_2"), { roomId: "room_1", inviteToken: "invite_2" });
  assert.deepEqual(parseRoomInvite("?room=room_1&invite=invite_2"), { roomId: "room_1", inviteToken: "invite_2" });
  assert.throws(() => parseRoomInvite("https://demo.example/#connect?room=room_1"), /incomplete/);
  assert.throws(() => parseRoomInvite("https://demo.example/#connect?room=..&invite=x"), /incomplete/);
});
test("room creation authenticates WebSocket and never calls an AI endpoint", async () => {
  const { client, requests, saved } = setup(); const socket = await connected(client);
  assert.equal(client.state.status, "connected"); assert.equal(socket.url, "wss://demo.example/ws");
  assert.deepEqual(socket.sent[0], { type: "join", roomId: "room_123", participantId: "host_1", token: "private_1" });
  assert.match(client.state.inviteUrl, /#connect\?room=room_123&invite=invite_1/);
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/rooms"); assert.equal(saved.size, 1); client.dispose();
});
test("default browser fetch retains the global receiver for creation, ICE and explicit AI requests", async (context) => {
  const paths = [];
  context.mock.method(globalThis, "fetch", async function (url) {
    assert.equal(this, globalThis, "native browser fetch must receive Window as its receiver"); paths.push(url);
    return { ok: true, json: async () => url.endsWith("/ice") ? { iceServers: [], relayAvailable: false } : url.endsWith("/chat") ? { reply: "Optional suggestion" } : credentials };
  });
  FakeSocket.sockets = [];
  const client = new RoomClient({ origin: "https://demo.example", WebSocketImpl: FakeSocket, storage: null });
  try {
    await connected(client); assert.equal(client.state.status, "connected"); await client.getIceServers(); assert.deepEqual(await client.askAI({ text: "Help with this draft" }), { reply: "Optional suggestion" });
    assert.deepEqual(paths, ["/api/rooms", "/api/rooms/room_123/ice", "/api/chat"]);
  } finally { client.dispose(); }
});
test("send retains pending draft identity until ack and deduplicates echoed messages", async () => {
  const { client } = setup(); const socket = await connected(client);
  let settled = false; const result = client.send({ id: "message_1", text: "Reviewed message", inputMethod: "sign", lang: "en", signLanguage: "ISL" }); result.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false); assert.equal(client.state.messages[0].delivery, "pending");
  const message = { ...socket.sent.at(-1).message, senderId: "host_1", seq: 1, createdAt: "2026-10-02" };
  socket.receive({ type: "message", message }); socket.receive({ type: "message", message }); assert.equal(client.state.messages.length, 1);
  socket.receive({ type: "ack", id: "message_1" }); assert.deepEqual(await result, { ok: true, id: "message_1" });
  socket.receive({ type: "received", id: "message_1", by: "guest_2" }); assert.equal(client.state.messages[0].delivery, "received"); client.dispose();
});
test("an uncertain send retries the original ID and text without automatic resend", async () => {
  const { client } = setup(); const socket = await connected(client);
  const result = await client.send({ id: "uncertain_1", text: "original", inputMethod: "text", lang: "en" });
  assert.equal(result.ok, false); assert.equal(client.state.messages[0].delivery, "uncertain");
  const pending = client.send({ id: "uncertain_1", text: "changed", inputMethod: "speech", lang: "ta" });
  assert.equal(socket.sent.at(-1).message.text, "original"); assert.equal(socket.sent.at(-1).message.id, "uncertain_1");
  socket.receive({ type: "ack", id: "uncertain_1" }); assert.equal((await pending).ok, true); client.dispose();
});
test("disconnect resolves pending send as uncertain and reconnect snapshot reconciles without duplication", async () => {
  const { client } = setup(); const socket = await connected(client);
  const pending = client.send({ id: "lost_1", text: "preserve", inputMethod: "text", lang: "en" }); socket.close();
  assert.equal((await pending).ok, false); assert.equal(client.state.status, "reconnecting");
  await new Promise((resolve) => setTimeout(resolve, 10)); const reconnected = FakeSocket.sockets.at(-1); reconnected.open();
  assert.equal(reconnected.sent.filter((entry) => entry.type === "message").length, 0);
  reconnected.receive({ type: "snapshot", messages: [{ id: "lost_1", text: "preserve", senderId: "host_1", seq: 1 }], participants: [] });
  assert.equal(client.state.messages.length, 1); assert.equal(client.state.messages[0].delivery, "sent"); client.dispose();
});
test("incoming message is acknowledged as received once per event, bounded and stable by server order", async () => {
  const { client } = setup(); const socket = await connected(client);
  socket.receive({ type: "message", message: { id: "partner_2", text: "second", senderId: "guest_2", seq: 2 } });
  socket.receive({ type: "message", message: { id: "partner_1", text: "first", senderId: "guest_2", seq: 1 } });
  assert.deepEqual(client.state.messages.map((message) => message.id), ["partner_1", "partner_2"]);
  assert.deepEqual(socket.sent.at(-1), { type: "received", id: "partner_1" }); client.dispose();
});
test("server restart/invalid credentials ends the room and clears reconnect credentials", async () => {
  const { client, saved } = setup(); const socket = await connected(client);
  socket.receive({ type: "error", code: "ROOM_NOT_FOUND", message: "Room ended after server restart." });
  assert.equal(client.state.status, "ended"); assert.equal(saved.size, 0); assert.equal(client.reconnectTimer, null); client.dispose();
});
test("ICE requests carry only room authentication and explicit AI request does not relay automatically", async () => {
  const { client, requests } = setup(); const socket = await connected(client); await client.getIceServers();
  assert.equal(requests.at(-1).init.headers.Authorization, "Bearer private_1"); assert.equal(requests.at(-1).init.headers["X-Participant-Id"], "host_1");
  await client.askAI({ text: "Rewrite my draft", lang: "en" });
  assert.equal(requests.at(-1).url, "/api/chat"); assert.equal(requests.at(-1).init.headers["X-Room-Id"], "room_123");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).messages, [{ role: "user", text: "Rewrite my draft" }]);
  assert.equal(socket.sent.filter((entry) => entry.type === "message").length, 0); client.dispose();
});
test("session credentials resume in a fresh transport without another room creation", async () => {
  const { client, saved } = setup(); await connected(client); client.dispose();
  const { client: restored, requests } = setup({ storage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) } });
  restored.resume(); assert.equal(restored.state.roomId, "room_123"); assert.equal(requests.length, 0); assert.equal(restored.state.status, "connecting"); restored.dispose();
});
test("ending while room HTTP creation is pending cannot reopen abandoned session", async () => {
  let resolve; const { client } = setup({ fetchImpl: () => new Promise((done) => { resolve = done; }) });
  const creating = client.create(); client.end(); resolve({ ok: true, json: async () => credentials }); await creating;
  assert.equal(client.state.status, "ended"); assert.equal(client.credentials, null); client.dispose();
});
test("hosted room server generates public invite links even when the developer UI uses localhost", async () => {
  const { client } = setup({ baseUrl: "https://signbridge.example", origin: "http://127.0.0.1:5173" }); await client.create();
  assert.match(client.state.inviteUrl, /^https:\/\/signbridge\.example\/#connect/); client.dispose();
});
test("snapshot restores received receipts and backend invalid-auth errors are terminal", async () => {
  const { client } = setup(); const socket = await connected(client);
  socket.receive({ type: "snapshot", messages: [{ id: "received_1", senderId: "host_1", seq: 1, receivedBy: ["guest_2"] }], participants: [] });
  assert.equal(client.state.messages[0].delivery, "received");
  socket.receive({ type: "error", code: "invalid-auth", message: "Your room credentials are invalid. Join using the invite link." });
  assert.equal(client.state.status, "ended"); assert.equal(client.credentials, null); client.dispose();
});
test("session replacement ends the old tab instead of competing in a reconnect loop", async () => {
  const { client } = setup(); const socket = await connected(client); socket.receive({ type: "session-replaced" });
  assert.equal(client.state.status, "ended"); assert.equal(client.reconnectTimer, null); assert.match(client.state.notice, /another tab/); client.dispose();
});
test("offline suspends the socket and queued retries, preserving unconfirmed messages and credentials until online", async () => {
  const { client, saved } = setup(); const socket = await connected(client);
  const pending = client.send({ id: "offline_pending", text: "Keep this reviewed turn", inputMethod: "text", lang: "en" });
  client.setNetworkOnline(false); assert.equal((await pending).ok, false); assert.equal(client.state.status, "reconnecting"); assert.equal(client.state.messages[0].delivery, "uncertain"); assert.equal(client.credentials.participantId, "host_1"); assert.equal(saved.size, 1); assert.equal(client.reconnectTimer, null); assert.equal(socket.readyState, 3);
  await new Promise((resolve) => setTimeout(resolve, 15)); assert.equal(FakeSocket.sockets.length, 1);
  assert.equal((await client.send({ text: "No send while offline" })).ok, false);
  client.setNetworkOnline(true); assert.equal(FakeSocket.sockets.length, 2); const restored = FakeSocket.sockets[1]; restored.open();
  assert.deepEqual(restored.sent[0], { type: "join", roomId: "room_123", participantId: "host_1", token: "private_1" });
  restored.receive({ type: "snapshot", messages: [], participants: [] }); assert.equal(client.state.messages[0].id, "offline_pending"); assert.equal(restored.sent.filter((entry) => entry.type === "message").length, 0);
  const retry = client.send({ id: "offline_pending", text: "Keep this reviewed turn", inputMethod: "text", lang: "en" }); restored.receive({ type: "ack", id: "offline_pending" }); assert.equal((await retry).ok, true); client.dispose();
});
test("initially offline session resume waits for online before opening its WebSocket", async () => {
  const saved = new Map([["signbridge.room.session.v1", JSON.stringify(credentials)]]);
  const { client } = setup({ online: false, storage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) } });
  client.resume(); assert.equal(client.state.status, "reconnecting"); assert.equal(FakeSocket.sockets.length, 0); client.setNetworkOnline(true); assert.equal(FakeSocket.sockets.length, 1); client.dispose();
});
test("normal partner-offline video errors do not persist in text chat, but text validation errors remain visible", async () => {
  const { client } = setup(); const socket = await connected(client); socket.receive({ type: "error", code: "partner-offline", message: "Your partner is not connected yet." }); assert.equal(client.state.error, ""); assert.equal(client.state.status, "connected");
  socket.receive({ type: "error", code: "invalid-message", id: "invalid1", message: "Write a message between 1 and 2000 characters." }); assert.match(client.state.error, /2000 characters/); client.dispose();
});
for (const action of ["leave", "end"]) test(`${action} while offline releases this device and clearly states that the partner could not be notified`, async () => {
  const { client, saved } = setup(); await connected(client); client.setNetworkOnline(false); client[action]();
  assert.equal(client.state.status, "ended"); assert.equal(client.credentials, null); assert.equal(saved.size, 0); assert.equal(client.reconnectTimer, null);
  assert.match(client.state.notice, /on this device/); assert.match(client.state.notice, /partner could not be notified/); assert.match(client.state.notice, /they can leave or end/); client.dispose();
});

const workflow = (events = [], cards = [], clarifications = [], references = []) => ({ events, cards, clarifications, references });
test("workflow broadcasts confirm an action without its ACK and duplicate events do not repeat live changes", async () => {
  const { client, requests } = setup(); const socket = await connected(client);
  assert.deepEqual(client.state.workflow, workflow()); assert.equal(client.state.snapshotVersion, 1);
  const action = { id: "ask_1", kind: "clarification.request", messageId: "partner_1", reason: "repeat", question: "Please repeat the place", lang: "en" };
  const sending = client.sendAction(action); assert.equal(client.state.pendingActions[0].delivery, "pending");
  assert.deepEqual(socket.sent.at(-1), { type: "action", action });
  const clarification = { id: action.id, messageId: "partner_1", requesterId: "host_1", status: "open" };
  const event = { id: action.id, actorId: "host_1", kind: action.kind, seq: 1, clarification };
  socket.receive({ type: "workflow", event, workflow: workflow([event], [], [clarification]) });
  assert.deepEqual(await sending, { ok: true, id: action.id }); assert.equal(client.state.pendingActions.length, 0); assert.equal(client.state.workflowVersion, 1); assert.equal(client.state.workflowOrigin, "live");
  socket.receive({ type: "workflow", event, workflow: workflow([event], [], [clarification]) });
  assert.equal(client.state.workflowVersion, 1); assert.equal(client.state.workflow.events.length, 1); assert.equal(requests.length, 1); client.dispose();
});
test("lost action ACKs retain immutable nested details for explicit retry, never auto resend", async () => {
  const { client } = setup(); const socket = await connected(client);
  const action = { id: "card_1", kind: "meeting.create", fields: { date: "2026-10-03", time: "15:00", timeZone: "Asia/Kolkata", place: "Library", note: "Entrance" }, lang: "en" };
  const sending = client.sendAction(action); action.fields.place = "Wrong edited location";
  const result = await sending; assert.equal(result.uncertain, true); assert.equal(result.code, "delivery-unconfirmed");
  assert.equal(client.state.pendingActions[0].action.fields.place, "Library");
  assert.equal(socket.sent.filter((entry) => entry.type === "action").length, 1);
  const retry = client.sendAction({ ...action, fields: { ...action.fields, time: "16:00" } });
  assert.equal(socket.sent.at(-1).action.fields.place, "Library"); assert.equal(socket.sent.at(-1).action.fields.time, "15:00");
  socket.receive({ type: "action-ack", id: "card_1" }); assert.equal((await retry).ok, true); client.dispose();
});
test("offline approval retry preserves the reviewed revision and stale rejection is definite", async () => {
  const { client } = setup(); const socket = await connected(client);
  const approval = client.sendAction({ id: "approve_1", kind: "meeting.approve", cardId: "card_1", revision: 1 });
  client.setNetworkOnline(false); assert.equal((await approval).uncertain, true); assert.equal(client.state.pendingActions[0].delivery, "uncertain");
  const offlineNew = await client.sendAction({ id: "new_offline", kind: "meeting.approve", cardId: "card_1", revision: 2 });
  assert.equal(offlineNew.uncertain, false); assert.equal(client.state.pendingActions.length, 1);
  client.setNetworkOnline(true); const restored = FakeSocket.sockets.at(-1); restored.open();
  restored.receive({ type: "snapshot", messages: [], participants: [], workflow: workflow([], [{ id: "card_1", revision: 2, fields: { place: "Updated" }, approvals: [] }]), acceptedActionIds: [] });
  assert.equal(restored.sent.some((entry) => entry.type === "action"), false); assert.equal(client.state.snapshotVersion, 2); assert.equal(client.state.workflowOrigin, "snapshot");
  const retry = client.sendAction({ id: "approve_1", kind: "meeting.approve", cardId: "card_1", revision: 2 });
  assert.equal(restored.sent.at(-1).action.revision, 1);
  restored.receive({ type: "error", code: "stale-revision", actionId: "approve_1", message: "Details changed. Review the current revision." });
  assert.deepEqual(await retry, { ok: false, id: "approve_1", error: "Details changed. Review the current revision.", code: "stale-revision", uncertain: false });
  assert.equal(client.state.pendingActions.length, 0); assert.equal(client.state.workflow.cards[0].approvals.length, 0);
  assert.equal(socket.sent.filter((entry) => entry.type === "action").length, 1); client.dispose();
});
test("snapshot accepted action IDs reconcile lost ACKs after event history is pruned", async () => {
  const { client } = setup(); const socket = await connected(client);
  const pending = client.sendAction({ id: "approved_old", kind: "meeting.approve", cardId: "card_1", revision: 1 });
  const card = { id: "card_1", revision: 2, fields: { place: "Changed after approval" }, approvals: [] };
  socket.receive({ type: "snapshot", messages: [], participants: [], workflow: workflow([], [card]), acceptedActionIds: ["approved_old"] });
  assert.deepEqual(await pending, { ok: true, id: "approved_old" }); assert.equal(client.state.pendingActions.length, 0);
  const count = socket.sent.length; assert.deepEqual(await client.sendAction({ id: "approved_old", kind: "meeting.approve", cardId: "card_1", revision: 2 }), { ok: true, id: "approved_old" });
  assert.equal(socket.sent.length, count); assert.equal(client.state.workflow.cards[0].revision, 2); assert.equal(client.state.workflow.cards[0].approvals.length, 0); client.dispose();
});
test("definite rejection releases queued payloads and cannot be retried as an edited approval under the same ID", async () => {
  const { client } = setup(); const socket = await connected(client);
  const sending = client.sendAction({ id: "stale_approval", kind: "meeting.approve", cardId: "card_1", revision: 1 });
  socket.receive({ type: "error", actionId: "stale_approval", code: "stale-revision", message: "Review the new details." });
  const rejected = await sending;
  assert.equal(rejected.uncertain, false); assert.equal(client.pendingActionEntries.size, 0); assert.equal(client.state.pendingActions.length, 0);
  const sentCount = socket.sent.length;
  assert.deepEqual(await client.sendAction({ id: "stale_approval", kind: "meeting.approve", cardId: "card_1", revision: 2 }), rejected);
  assert.equal(socket.sent.length, sentCount, "edited details require a new action ID after definite rejection");
  rejected.ok = true;
  assert.equal((await client.sendAction({ id: "stale_approval", kind: "meeting.approve", cardId: "card_1", revision: 2 })).ok, false, "a caller cannot mutate the cached rejection through its result object");
  const reviewed = client.sendAction({ id: "reviewed_new_approval", kind: "meeting.approve", cardId: "card_1", revision: 2 });
  socket.receive({ type: "action-ack", id: "reviewed_new_approval" }); assert.equal((await reviewed).ok, true); client.dispose();
});
test("unconfirmed action bound blocks new actions without evicting original approvals or preventing explicit retries", async () => {
  const { client } = setup({ ackTimeout: 60000 }); const socket = await connected(client);
  const pending = Array.from({ length: 64 }, (_, index) => client.sendAction({ id: `waiting_${index}`, kind: "meeting.approve", cardId: "card_1", revision: 1 }));
  try {
    const blocked = await client.sendAction({ id: "over_limit", kind: "meeting.approve", cardId: "card_1", revision: 2 });
    assert.equal(blocked.code, "pending-action-limit"); assert.equal(blocked.uncertain, false); assert.equal(client.state.pendingActions.length, 64);
    assert.equal(socket.sent.filter((entry) => entry.type === "action").length, 64);
    assert.equal(client.sendAction({ id: "waiting_0", kind: "meeting.approve", cardId: "card_1", revision: 2 }), pending[0]);
    socket.receive({ type: "action-ack", id: "waiting_0" }); assert.equal((await pending[0]).ok, true);
    const next = client.sendAction({ id: "after_ack", kind: "meeting.approve", cardId: "card_1", revision: 2 });
    socket.receive({ type: "action-ack", id: "after_ack" }); assert.equal((await next).ok, true); assert.equal(client.pendingActionEntries.get("waiting_1").action.revision, 1);
  } finally { client.dispose(); await Promise.all(pending); }
});
test("repeated definite failures keep only bounded result tombstones and room reset clears them", async () => {
  const { client } = setup(); const socket = await connected(client);
  for (let index = 0; index < 140; index++) {
    const id = `invalid_${index}`; const sending = client.sendAction({ id, kind: "meeting.approve", cardId: "gone_card", revision: 1 });
    socket.receive({ type: "error", actionId: id, code: "card-unavailable", message: "The card is unavailable." });
    assert.equal((await sending).uncertain, false);
  }
  assert.equal(client.pendingActionEntries.size, 0); assert.equal(client.state.pendingActions.length, 0); assert.equal(client.rejectedActionResults.size, 128);
  client.end(); assert.equal(client.rejectedActionResults.size, 0); client.dispose();
});
test("older workflow replay cannot replace revised card state or revive an old approval", async () => {
  const { client } = setup(); const socket = await connected(client);
  const edited = { id: "edit_2", actorId: "guest_2", kind: "meeting.revise", seq: 9 };
  socket.receive({ type: "snapshot", messages: [], participants: [], workflow: workflow([edited], [{ id: "card_1", revision: 2, approvals: [] }]) });
  const old = { id: "approve_1", actorId: "guest_2", kind: "meeting.approve", seq: 8 };
  socket.receive({ type: "workflow", event: old, workflow: workflow([old], [{ id: "card_1", revision: 1, approvals: ["guest_2"] }]) });
  assert.equal(client.state.workflowVersion, 0); assert.equal(client.state.workflowOrigin, "snapshot"); assert.equal(client.state.workflow.cards[0].revision, 2); client.dispose();
});
test("message answer links and selected references are copied once and retry their original metadata", async () => {
  const { client } = setup(); const socket = await connected(client);
  const payload = { id: "answer_1", text: "At the east entrance", relation: { kind: "answer", messageId: "original_1", clarificationId: "ask_1" }, referenceIds: ["ref_1"], lang: "en" };
  const pending = client.send(payload); payload.relation.messageId = "another_message"; payload.referenceIds.push("ref_2");
  assert.equal((await pending).ok, false);
  const retry = client.send({ ...payload, relation: { kind: "correction", messageId: "wrong" }, referenceIds: ["wrong_ref"] });
  assert.deepEqual(socket.sent.at(-1).message.relation, { kind: "answer", messageId: "original_1", clarificationId: "ask_1" }); assert.deepEqual(socket.sent.at(-1).message.referenceIds, ["ref_1"]);
  socket.receive({ type: "ack", id: "answer_1" }); assert.equal((await retry).ok, true);
  socket.receive({ type: "message", message: { ...socket.sent.find((entry) => entry.type === "message").message, senderId: "host_1", seq: 2, references: [{ id: "ref_1", revision: 1, label: "East entrance", description: "Next to the stairs" }] } });
  assert.equal(client.state.messages[0].references[0].revision, 1); client.dispose();
});
test("ended rooms and new rooms clear workflow/pending actions rather than retrying abandoned approvals", async () => {
  const { client } = setup(); const socket = await connected(client);
  socket.receive({ type: "snapshot", messages: [], participants: [], workflow: workflow([], [{ id: "card_1", revision: 1 }]) });
  const pending = client.sendAction({ id: "abandoned", kind: "meeting.approve", cardId: "card_1", revision: 1 });
  socket.receive({ type: "room-ended", reason: "ended" }); assert.equal((await pending).ok, false);
  assert.equal(client.state.pendingActions.length, 0); assert.deepEqual(client.state.workflow, workflow()); assert.equal(client.pendingActionEntries.size, 0);
  const fresh = await connected(client); assert.equal(fresh.sent.filter((entry) => entry.type === "action").length, 0); assert.equal(client.acceptedActionIds.size, 0); client.dispose();
});

test("two real transports exchange 20 ordered messages and reconnect without duplicates or AI requests", async () => {
  const app = createRoomServer({ env: {}, fetchImpl: () => { throw new Error("Human chat must not contact AI or relay providers."); } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const options = { baseUrl: origin, origin, WebSocketImpl: WebSocket, storage: null, reconnectDelay: 5 };
  const host = new RoomClient(options); const guest = new RoomClient(options);
  const waitFor = async (predicate) => { const deadline = Date.now() + 2000; while (!predicate()) { if (Date.now() > deadline) throw new Error("Room did not reach expected state."); await new Promise((resolve) => setTimeout(resolve, 5)); } };
  try {
    await host.create(); await waitFor(() => host.state.status === "connected"); await guest.join(host.state.inviteUrl); await waitFor(() => guest.state.status === "connected");
    for (let index = 0; index < 20; index++) {
      const result = await (index % 2 ? guest : host).send({ id: `integration_${index}`, text: `Message ${index + 1}`, inputMethod: "text", lang: "en" }); assert.equal(result.ok, true);
    }
    await waitFor(() => host.state.messages.length === 20 && guest.state.messages.length === 20 && host.state.messages.every((message) => message.delivery === "received"));
    assert.deepEqual(host.state.messages.map((message) => message.seq), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.equal(new Set(guest.state.messages.map((message) => message.id)).size, 20);
    host.socket.close(); await waitFor(() => host.state.status === "reconnecting"); await waitFor(() => host.state.status === "connected");
    assert.equal(host.state.messages.length, 20); assert.equal(host.state.messages[0].delivery, "received");
    host.end(); await waitFor(() => guest.state.status === "ended"); assert.match(guest.state.notice, /conversation ended/i);
  } finally { host.dispose(); guest.dispose(); await app.close(); }
});
