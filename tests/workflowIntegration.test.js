import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createRoomServer } from "../server/roomServer.js";
import { RoomClient } from "../src/lib/roomClient.js";

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
async function until(check, description) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`Timed out: ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("real clients repair messages, approve exact meeting revisions and retain historical references without AI", { timeout: 25000 }, async (t) => {
  const app = createRoomServer({ env: { NODE_ENV: "test" } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const requests = [];
  const fetchImpl = (url, options) => { requests.push(new URL(url).pathname); return fetch(url, options); };
  const options = { baseUrl: origin, origin, WebSocketImpl: WebSocket, fetchImpl, ackTimeout: 1500, reconnectDelay: 20 };
  const host = new RoomClient({ ...options, storage: memoryStorage() });
  const guest = new RoomClient({ ...options, storage: memoryStorage() });
  t.after(async () => { host.dispose(); guest.dispose(); await app.close(); });
  await host.create(); await until(() => host.state.status === "connected", "host joins");
  await guest.join(host.state.inviteUrl); await until(() => guest.state.status === "connected", "guest joins");

  const original = { id: "original", text: "Meet at the library at 3 PM", inputMethod: "text", lang: "en" };
  assert.equal((await host.send(original)).ok, true);
  await until(() => guest.state.messages.some((message) => message.id === original.id), "partner receives original");
  assert.equal((await guest.sendAction({ id: "request_entrance", kind: "clarification.request", messageId: original.id, reason: "question", question: "Which entrance?", lang: "en" })).ok, true);
  await until(() => host.state.workflow.clarifications.length === 1, "clarification received");
  assert.equal((await host.send({ id: "answer_entrance", text: "The entrance beside the main road", inputMethod: "text", lang: "en", relation: { kind: "answer", messageId: original.id, clarificationId: "request_entrance" } })).ok, true);
  assert.equal((await host.send({ id: "correct_time", text: "Correction: meet at 4 PM", inputMethod: "text", lang: "en", relation: { kind: "correction", messageId: original.id } })).ok, true);
  await until(() => guest.state.messages.some((message) => message.id === "correct_time"), "correction received");
  assert.equal(guest.state.messages.find((message) => message.id === original.id).text, original.text);
  assert.deepEqual(guest.state.messages.find((message) => message.id === "answer_entrance").relation, { kind: "answer", messageId: original.id, clarificationId: "request_entrance" });
  assert.equal((await guest.sendAction({ id: "resolve_entrance", kind: "clarification.resolve", clarificationId: "request_entrance" })).ok, true);

  const fields = { date: "2026-10-05", time: "16:00", timeZone: "Asia/Kolkata", place: "Library entrance beside the main road", note: "Study meeting" };
  assert.equal((await host.sendAction({ id: "meeting", kind: "meeting.create", fields, lang: "en" })).ok, true);
  await until(() => guest.state.workflow.cards.length === 1, "meeting received");
  const firstApproval = { id: "host_approve_1", kind: "meeting.approve", cardId: "meeting", revision: 1 };
  assert.equal((await host.sendAction(firstApproval)).ok, true);
  assert.equal((await guest.sendAction({ id: "guest_approve_1", kind: "meeting.approve", cardId: "meeting", revision: 1 })).ok, true);
  await until(() => host.state.workflow.cards[0].approvals.length === 2, "both approve revision one");
  assert.equal((await guest.sendAction({ id: "edit_meeting", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields, time: "17:00" }, lang: "en" })).ok, true);
  await until(() => host.state.workflow.cards[0].revision === 2, "new revision received");
  assert.deepEqual(host.state.workflow.cards[0].approvals, []);
  assert.equal(host.state.workflow.cards[0].history[0].fields.time, "16:00");
  const stale = await host.sendAction({ id: "late_old_approval", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /revision|review|changed/i);
  assert.equal((await host.sendAction(firstApproval)).ok, true);
  assert.deepEqual(host.state.workflow.cards[0].approvals, [], "old accepted action does not approve the new revision");

  assert.equal((await host.sendAction({ id: "entrance_reference", kind: "reference.create", label: "Entrance A", description: "Library entrance beside the main road", lang: "en" })).ok, true);
  assert.equal((await host.send({ id: "referenced_message", text: "Meet here", inputMethod: "text", lang: "en", referenceIds: ["entrance_reference"] })).ok, true);
  await until(() => guest.state.messages.some((message) => message.id === "referenced_message"), "referenced message received");
  assert.equal((await guest.sendAction({ id: "rename_reference", kind: "reference.revise", referenceId: "entrance_reference", baseRevision: 1, label: "Entrance B", description: "Renamed reference; original messages retain their description", lang: "en" })).ok, true);
  const sentReference = guest.state.messages.find((message) => message.id === "referenced_message").references[0];
  assert.equal(sentReference.label, "Entrance A"); assert.equal(sentReference.revision, 1);

  const snapshotVersion = guest.state.snapshotVersion;
  guest.retry();
  await until(() => guest.state.status === "connected" && guest.state.snapshotVersion > snapshotVersion, "guest resumes");
  assert.equal(guest.state.workflow.clarifications[0].status, "resolved");
  assert.equal(guest.state.workflow.cards[0].revision, 2);
  assert.deepEqual(guest.state.workflow.cards[0].approvals, []);
  assert.equal(guest.state.messages.find((message) => message.id === "referenced_message").references[0].label, "Entrance A");

  for (let index = 0; index < 20; index++) {
    const client = index % 2 ? guest : host;
    assert.equal((await client.send({ id: `ordinary_${index}`, text: `Ordinary turn ${index}`, inputMethod: "text", lang: "en" })).ok, true);
  }
  await until(() => guest.state.messages.filter((message) => message.id.startsWith("ordinary_")).length === 20 && host.state.messages.filter((message) => message.id.startsWith("ordinary_")).length === 20, "all alternating turns received");
  assert.deepEqual(host.state.messages.map((message) => message.id), guest.state.messages.map((message) => message.id));
  assert.equal(new Set(host.state.messages.map((message) => message.id)).size, host.state.messages.length);
  assert.equal(requests.some((pathname) => pathname === "/api/chat"), false, "human workflows never request AI");
  host.end(); await until(() => guest.state.status === "ended", "end reaches partner");
  assert.deepEqual(guest.state.workflow.cards, []); assert.deepEqual(guest.state.workflow.clarifications, []);
});
