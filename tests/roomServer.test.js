import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRoomServer } from "../server/roomServer.js";
import { ROOM_LIMITS } from "../server/rooms.js";

async function fixture(t, options = {}) {
  const app = createRoomServer({ env: {}, ...options });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, wsUrl: base.replace(/^http/, "ws") + "/ws" };
}

async function post(app, url, body = {}, headers = {}) {
  const response = await fetch(app.base + url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const authHeaders = (member) => ({ authorization: `Bearer ${member.token}`, "x-participant-id": member.participantId, "x-room-id": member.roomId });

async function roomPair(app) {
  const created = await post(app, "/api/rooms");
  assert.equal(created.status, 201);
  const host = created.body;
  const joined = await post(app, `/api/rooms/${host.roomId}/join`, { inviteToken: host.inviteToken });
  assert.equal(joined.status, 200);
  return { host, guest: joined.body };
}

async function socket(app, credentials, { authenticate = true, origin = "http://localhost:5173" } = {}) {
  const ws = new WebSocket(app.wsUrl, { origin });
  const queue = [];
  const all = [];
  const waiting = [];
  ws.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    all.push(event);
    const index = waiting.findIndex((pending) => pending.matches(event));
    if (index < 0) queue.push(event);
    else { const [pending] = waiting.splice(index, 1); clearTimeout(pending.timer); pending.resolve(event); }
  });
  ws.on("error", () => {});
  await once(ws, "open");
  const result = {
    ws, all,
    send: (value) => ws.send(JSON.stringify(value)),
    wait(type, predicate = () => true) {
      const matches = (event) => (Array.isArray(type) ? type.includes(event.type) : event.type === type) && predicate(event);
      const index = queue.findIndex(matches);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const pending = { matches, resolve, timer: setTimeout(() => { const index = waiting.indexOf(pending); if (index >= 0) waiting.splice(index, 1); reject(new Error(`Timed out waiting for ${type}`)); }, 3000) };
        waiting.push(pending);
      });
    },
    async disconnect() {
      if (ws.readyState === WebSocket.CLOSED) return;
      const closed = once(ws, "close"); ws.close(); await closed;
    },
  };
  if (authenticate) {
    result.send({ type: "join", roomId: credentials.roomId, participantId: credentials.participantId, token: credentials.token });
    result.snapshot = await result.wait("snapshot");
  }
  return result;
}
const msg = (id, text = `Message ${id}`) => ({ id, text, inputMethod: "text", lang: "en" });

test("real WebSockets exchange 20 alternating messages, server ordering, acknowledgements and receipts without AI", { timeout: 10000 }, async (t) => {
  let upstreamCalls = 0;
  let chatLoads = 0;
  const app = await fixture(t, { fetchImpl: async () => { upstreamCalls += 1; throw new Error("AI must not be invoked"); }, chatLoader: async () => { chatLoads += 1; throw new Error("AI must not be loaded"); } });
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host);
  const b = await socket(app, guest);
  await a.wait("presence", (event) => event.participants.every((p) => p.online));
  for (let index = 0; index < 20; index += 1) {
    const sender = index % 2 ? b : a;
    const receiver = index % 2 ? a : b;
    const senderId = index % 2 ? guest.participantId : host.participantId;
    const id = `message-${index}`;
    sender.send({ type: "message", message: { ...msg(id), senderId: "forged", seq: 700 } });
    const [local, remote, ack] = await Promise.all([sender.wait("message", (event) => event.message.id === id), receiver.wait("message", (event) => event.message.id === id), sender.wait("ack", (event) => event.id === id)]);
    assert.deepEqual(local, remote);
    assert.equal(remote.message.senderId, senderId);
    assert.equal(remote.message.seq, index + 1);
    assert.equal(ack.id, id);
    receiver.send({ type: "received", id });
    const receipt = await sender.wait("received", (event) => event.id === id);
    assert.equal(receipt.by, index % 2 ? host.participantId : guest.participantId);
  }
  assert.equal(a.all.filter((event) => event.type === "message").length, 20);
  assert.equal(b.all.filter((event) => event.type === "message").length, 20);
  const snapshot = app.rooms.snapshot(host.roomId, host.participantId);
  assert.equal(snapshot.messages.length, 20);
  assert.ok(snapshot.messages.every((message) => message.receivedBy.length === 1));
  assert.equal(upstreamCalls, 0);
  assert.equal(chatLoads, 0);
});

test("bad invite, third participant, invalid auth and unjoined signaling are rejected", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const host = (await post(app, "/api/rooms")).body;
  assert.equal((await post(app, `/api/rooms/${host.roomId}/join`, { inviteToken: "bad" })).status, 403);
  assert.equal((await post(app, `/api/rooms/${host.roomId}/join`, { inviteToken: host.inviteToken })).status, 200);
  assert.equal((await post(app, `/api/rooms/${host.roomId}/join`, { inviteToken: host.inviteToken })).status, 409);
  assert.equal((await post(app, "/api/rooms/missing/join", { inviteToken: "bad" })).body.code, "room-ended");
  const bad = await socket(app, {}, { authenticate: false });
  bad.send({ type: "join", ...host, token: "bad" });
  assert.equal((await bad.wait("error")).code, "invalid-auth");
  const unjoined = await socket(app, {}, { authenticate: false });
  unjoined.send({ type: "signal", data: { reset: true } });
  assert.equal((await unjoined.wait("error")).code, "not-joined");
});

test("retry IDs produce another ack without a duplicate; changed payload and foreign sender collisions fail", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host);
  const b = await socket(app, guest);
  a.send({ type: "message", message: msg("same") });
  await a.wait("ack"); await b.wait("message");
  a.send({ type: "message", message: msg("same") });
  await a.wait("ack");
  a.send({ type: "message", message: msg("same", "Changed") });
  assert.equal((await a.wait("error")).code, "message-id-conflict");
  b.send({ type: "message", message: msg("same") });
  assert.equal((await b.wait("error")).code, "message-id-conflict");
  assert.equal(a.all.filter((event) => event.type === "message").length, 1);
  assert.equal(b.all.filter((event) => event.type === "message").length, 1);
});

test("transport reconnect restores identity and history; replacing a socket cannot mark the resumed session offline", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host);
  const b = await socket(app, guest);
  a.send({ type: "message", message: msg("before-disconnect") });
  await a.wait("ack"); await b.wait("message");
  await b.disconnect();
  await a.wait("presence", (event) => event.participants.find((p) => p.id === guest.participantId)?.online === false);
  a.send({ type: "message", message: msg("while-offline") }); await a.wait("ack");
  const resumed = await socket(app, guest);
  assert.equal(resumed.snapshot.participantId, guest.participantId);
  assert.deepEqual(resumed.snapshot.messages.map((message) => message.id), ["before-disconnect", "while-offline"]);
  const replacement = await socket(app, guest);
  assert.equal((await resumed.wait("session-replaced")).type, "session-replaced");
  await delay(30);
  assert.equal(app.rooms.presence(host.roomId).find((p) => p.id === guest.participantId).online, true);
  replacement.send({ type: "message", message: msg("after-resume") });
  await replacement.wait("ack");
  await a.wait("message", (event) => event.message.id === "after-resume");
});

test("authenticated signals go only to the other member and malformed signaling is rejected", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host);
  const b = await socket(app, guest);
  const unrelated = (await post(app, "/api/rooms")).body;
  const c = await socket(app, unrelated);
  a.send({ type: "signal", data: { description: { type: "offer", sdp: "test-sdp" } }, roomId: unrelated.roomId, participantId: unrelated.participantId });
  const event = await b.wait("signal");
  assert.equal(event.from, host.participantId);
  assert.equal(event.data.description.sdp, "test-sdp");
  b.send({ type: "signal", data: { candidate: null } });
  assert.equal((await a.wait("signal")).data.candidate, null);
  a.send({ type: "signal", data: { description: { type: "bad", sdp: "test" } } });
  assert.equal((await a.wait("error")).code, "invalid-signal");
  assert.equal(c.all.filter((event) => event.type === "signal").length, 0);
});

test("a resumed participant can acknowledge the complete 200-message snapshot in a single burst", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const { host, guest } = await roomPair(app);
  for (let index = 0; index < 200; index += 1) app.rooms.addMessage(host.roomId, host.participantId, msg(`backlog-${index}`));
  const b = await socket(app, guest);
  assert.equal(b.snapshot.messages.length, 200);
  for (const message of b.snapshot.messages) b.send({ type: "received", id: message.id });
  await b.wait("received", (event) => event.id === "backlog-199");
  assert.equal(b.all.filter((event) => event.type === "error").length, 0);
  assert.ok(app.rooms.snapshot(host.roomId, host.participantId).messages.every((message) => message.receivedBy.includes(guest.participantId)));
});

test("explicit leave ends both sessions and prevents another guest from seeing the prior transcript", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host);
  const b = await socket(app, guest);
  a.send({ type: "message", message: msg("private-history") }); await a.wait("ack");
  b.send({ type: "leave" });
  assert.equal((await a.wait("room-ended")).reason, "partner-left");
  assert.equal((await b.wait("room-ended")).reason, "partner-left");
  assert.equal((await post(app, `/api/rooms/${host.roomId}/join`, { inviteToken: host.inviteToken })).body.code, "room-ended");
  const stale = await socket(app, {}, { authenticate: false });
  stale.send({ type: "join", roomId: host.roomId, participantId: host.participantId, token: host.token });
  assert.equal((await stale.wait("error")).code, "room-ended");
});

test("empty expiry and graceful restart report an ended room; fresh processes do not retain room data", { timeout: 10000 }, async (t) => {
  let now = 1000;
  const app = await fixture(t, { clock: () => now });
  const expired = (await post(app, "/api/rooms")).body;
  now += ROOM_LIMITS.emptyTimeoutMs;
  assert.equal((await post(app, `/api/rooms/${expired.roomId}/ice`, {}, authHeaders(expired))).body.code, "room-ended");
  const host = (await post(app, "/api/rooms")).body;
  const a = await socket(app, host);
  const restarting = app.close();
  assert.equal((await a.wait("room-ended")).reason, "server-restart");
  await restarting;
  const fresh = await fixture(t);
  assert.equal((await post(fresh, `/api/rooms/${host.roomId}/ice`, {}, authHeaders(host))).body.code, "room-ended");
});

test("ICE configuration requires credentials, fails gracefully, and approved local development origins receive CORS", { timeout: 10000 }, async (t) => {
  const app = await fixture(t, { env: { ROOM_ALLOWED_ORIGINS: "https://trusted.example" } });
  const host = (await post(app, "/api/rooms")).body;
  assert.equal((await post(app, `/api/rooms/${host.roomId}/ice`)).status, 401);
  const fallback = await post(app, `/api/rooms/${host.roomId}/ice`, {}, { ...authHeaders(host), origin: "http://localhost:5173" });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.body.relayAvailable, false);
  assert.equal(fallback.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(fallback.body.notice, /Text remains available/);
  const allowed = await post(app, "/api/rooms", {}, { origin: "https://trusted.example" });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://trusted.example");
  assert.equal((await post(app, "/api/rooms", {}, { origin: "https://untrusted.example" })).status, 403);
  const preflight = await fetch(app.base + `/api/rooms/${host.roomId}/ice`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:5173", "access-control-request-headers": "Authorization,X-Participant-Id" } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/);
});

test("unapproved browser origins cannot open a WebSocket channel", { timeout: 5000 }, async (t) => {
  const app = await fixture(t);
  const ws = new WebSocket(app.wsUrl, { origin: "https://untrusted.example" });
  ws.on("error", () => {});
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Upgrade rejection timed out")), 3000);
    ws.on("unexpected-response", (_request, response) => { clearTimeout(timer); response.resume(); ws.terminate(); resolve(response.statusCode); });
  });
  assert.equal(response, 403);
});

test("optional AI POST requires valid room credentials, while status GET is readable", { timeout: 10000 }, async (t) => {
  let calls = 0;
  const app = await fixture(t, { chatLoader: async () => ({ LIMITS: { maxBodyBytes: 1000 }, handleChat: async (req) => { calls += 1; return Response.json(req.method === "GET" ? { configured: false } : { reply: "Explicit helper" }); } }) });
  assert.equal((await post(app, "/api/chat", { mode: "sign" })).status, 401);
  assert.equal(calls, 0);
  const status = await fetch(app.base + "/api/chat?status=1");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { configured: false, roomAuthRequired: true });
  assert.equal(calls, 1);
  const host = (await post(app, "/api/rooms")).body;
  assert.equal((await post(app, "/api/chat", { mode: "sign" }, authHeaders(host))).status, 200);
  assert.equal(calls, 2);
  assert.equal((await post(app, "/api/chat", { mode: "sign" }, { ...authHeaders(host), authorization: "Bearer bad" })).status, 401);
  assert.equal(calls, 2);
});

test("standalone status advertises member authentication without changing shared Vite/Vercel status", { timeout: 5000 }, async (t) => {
  const env = { GEMINI_API_KEY: "test-placeholder-only" };
  const app = await fixture(t, { env });
  const response = await fetch(app.base + "/api/chat?status=1");
  const standalone = await response.json();
  assert.equal(standalone.configured, true);
  assert.equal(standalone.roomAuthRequired, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { handleChat } = await import("../server/chat.js");
  const shared = await (await handleChat(new Request("http://localhost/api/chat?status=1"), env)).json();
  assert.equal(shared.configured, true);
  assert.equal(Object.hasOwn(shared, "roomAuthRequired"), false);
  const { roomAuthRequired, ...withoutFlag } = standalone;
  assert.deepEqual(withoutFlag, shared);
});

test("standalone server serves the app but refuses local research models and missing assets", { timeout: 10000 }, async (t) => {
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "signbridge-room-test-"));
  t.after(() => rm(staticDir, { recursive: true, force: true }));
  await mkdir(path.join(staticDir, "models"));
  await mkdir(path.join(staticDir, "assets"));
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>Connect</title>");
  await writeFile(path.join(staticDir, "models", "isl.json"), "RESEARCH-ISL");
  await writeFile(path.join(staticDir, "models", "asl.json"), "RESEARCH-ASL");
  await writeFile(path.join(staticDir, "models", "graph.onnx"), "RESEARCH-GRAPH");
  await writeFile(path.join(staticDir, "models", "graph-manifest.json"), "RESEARCH-METADATA");
  await writeFile(path.join(staticDir, "assets", "main.js"), "console.log('app')");
  const app = await fixture(t, { staticDir });
  const index = await fetch(app.base + "/");
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Connect/);
  assert.equal((await fetch(app.base + "/connect")).status, 200);
  for (const file of ["/models/isl.json", "/models/asl.json", "/models/ISL.json", "/models%2Fisl.json", "/models/graph.onnx", "/models/graph-manifest.json", "/models%2Fgraph.onnx", "/missing.js", "/.env", "/api/missing"]) {
    const response = await fetch(app.base + file);
    assert.equal(response.status, 404, file);
    assert.equal((await response.text()).includes("RESEARCH"), false);
  }
  const asset = await fetch(app.base + "/assets/main.js", { method: "HEAD" });
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(asset.headers.get("cache-control"), /immutable/);
});

test("JSON body size, malformed events and request admission limits are enforced", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const malformed = await fetch(app.base + "/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await post(app, "/api/rooms", { large: "x".repeat(17000) })).status, 413);
  const host = (await post(app, "/api/rooms")).body;
  const a = await socket(app, host);
  a.ws.send("not-json");
  assert.equal((await a.wait("error")).code, "invalid-json");
  a.send({ type: "message", message: msg("too-large", "x".repeat(2001)) });
  assert.equal((await a.wait("error")).code, "invalid-message");
  for (let i = 0; i < 7; i += 1) await post(app, "/api/rooms");
  assert.equal((await post(app, "/api/rooms")).status, 429);
});

const meetingFields = { date: "2026-10-12", time: "09:30", timeZone: "Asia/Kolkata", place: "Library entrance", note: "Bring the notes." };
async function wsAction(sender, receiver, action) {
  sender.send({ type: "action", action });
  const [local, remote, ack] = await Promise.all([sender.wait("workflow", (value) => value.event.id === action.id), receiver.wait("workflow", (value) => value.event.id === action.id), sender.wait("action-ack", (value) => value.id === action.id)]);
  assert.deepEqual(local, remote);
  assert.equal(ack.id, action.id);
  return local;
}

test("real WebSockets carry clarification/answer/resolve, immutable corrections, meeting approval and pinned references without AI", { timeout: 10000 }, async (t) => {
  let chatCalls = 0;
  const app = await fixture(t, { chatLoader: async () => { chatCalls += 1; throw new Error("Unexpected AI call"); } });
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host), b = await socket(app, guest);
  assert.deepEqual(a.snapshot.workflow, { events: [], clarifications: [], cards: [], references: [] });
  a.send({ type: "message", message: msg("original", "Meet at nine") }); await a.wait("ack"); await b.wait("message");
  const clarification = await wsAction(b, a, { id: "clarify", kind: "clarification.request", messageId: "original", reason: "question", question: "Which entrance?", lang: "en" });
  assert.equal(clarification.event.actorId, guest.participantId);
  assert.equal(clarification.event.seq, 2);
  a.send({ type: "message", message: { ...msg("answer", "The library entrance"), relation: { kind: "answer", messageId: "original", clarificationId: "clarify" } } });
  await a.wait("ack");
  assert.equal((await b.wait("message", (value) => value.message.id === "answer")).message.relation.clarificationId, "clarify");
  const resolved = await wsAction(b, a, { id: "resolved", kind: "clarification.resolve", clarificationId: "clarify" });
  assert.equal(resolved.workflow.clarifications[0].status, "resolved");
  a.send({ type: "message", message: { ...msg("correction", "Meet at ten"), relation: { kind: "correction", messageId: "original" } } });
  await a.wait("ack"); await b.wait("message", (value) => value.message.id === "correction");
  await wsAction(a, b, { id: "card", kind: "meeting.create", fields: meetingFields, lang: "en" });
  await wsAction(a, b, { id: "approved-a", kind: "meeting.approve", cardId: "card", revision: 1 });
  const both = await wsAction(b, a, { id: "approved-b", kind: "meeting.approve", cardId: "card", revision: 1 });
  assert.equal(both.workflow.cards[0].approvals.length, 2);
  const revised = await wsAction(b, a, { id: "revised", kind: "meeting.revise", cardId: "card", baseRevision: 1, fields: { ...meetingFields, time: "10:00" }, lang: "en" });
  assert.deepEqual(revised.workflow.cards[0].approvals, []);
  await wsAction(a, b, { id: "door", kind: "reference.create", label: "Red door", description: "The door beside the library desk.", lang: "en" });
  a.send({ type: "message", message: { ...msg("with-reference"), referenceIds: ["door"] } }); await a.wait("ack");
  const pinned = (await b.wait("message", (value) => value.message.id === "with-reference")).message.references[0];
  await wsAction(b, a, { id: "rename-door", kind: "reference.revise", referenceId: "door", baseRevision: 1, label: "Side door", description: "The green door to the left.", lang: "en" });
  assert.equal(pinned.label, "Red door");
  const snapshot = app.rooms.snapshot(host.roomId, host.participantId);
  assert.equal(snapshot.messages[0].text, "Meet at nine");
  assert.equal(snapshot.messages.at(-1).references[0].revision, 1);
  assert.equal(snapshot.workflow.references[0].revision, 2);
  const seqs = [...snapshot.messages, ...snapshot.workflow.events].map((value) => value.seq).sort((x, y) => x - y);
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, index) => index + 1));
  assert.equal(chatCalls, 0);
});

test("lost action ACK retries are idempotent after revision changes/event pruning and reconnect confirms only owned IDs", { timeout: 10000 }, async (t) => {
  const app = await fixture(t, { roomOptions: { maxWorkflowEvents: 2 } });
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host), b = await socket(app, guest);
  const created = { id: "card", kind: "meeting.create", fields: meetingFields, lang: "en" };
  await wsAction(a, b, created);
  const approved = { id: "approved", kind: "meeting.approve", cardId: "card", revision: 1 };
  await wsAction(a, b, approved);
  await wsAction(b, a, { id: "revised", kind: "meeting.revise", cardId: "card", baseRevision: 1, fields: { ...meetingFields, place: "Main gate" }, lang: "en" });
  const broadcastCount = b.all.filter((value) => value.type === "workflow").length;
  a.send({ type: "action", action: created }); await a.wait("action-ack", (value) => value.id === "card");
  a.send({ type: "action", action: approved }); await a.wait("action-ack", (value) => value.id === "approved");
  assert.equal(b.all.filter((value) => value.type === "workflow").length, broadcastCount);
  a.send({ type: "action", action: { ...created, fields: { ...meetingFields, time: "12:00" } } });
  const conflict = await a.wait("error", (value) => value.actionId === "card");
  assert.equal(conflict.code, "action-id-conflict"); assert.equal(Object.hasOwn(conflict, "id"), false);
  await a.disconnect();
  const resumed = await socket(app, host);
  assert.deepEqual(resumed.snapshot.acceptedActionIds, ["card", "approved"]);
  assert.equal(resumed.snapshot.workflow.events.length, 2);
  assert.equal(resumed.snapshot.workflow.cards[0].revision, 2);
  assert.deepEqual(app.rooms.snapshot(host.roomId, guest.participantId).acceptedActionIds, ["revised"]);
});

test("concurrent WebSocket revisions accept one winner; stale approvals and unauthorized workflow links reject correlated IDs", { timeout: 10000 }, async (t) => {
  const app = await fixture(t);
  const { host, guest } = await roomPair(app);
  const a = await socket(app, host), b = await socket(app, guest);
  await wsAction(a, b, { id: "card", kind: "meeting.create", fields: meetingFields, lang: "en" });
  a.send({ type: "action", action: { id: "revision-a", kind: "meeting.revise", cardId: "card", baseRevision: 1, fields: { ...meetingFields, time: "10:00" }, lang: "en" } });
  b.send({ type: "action", action: { id: "revision-b", kind: "meeting.revise", cardId: "card", baseRevision: 1, fields: { ...meetingFields, time: "11:00" }, lang: "en" } });
  const results = await Promise.all([a.wait(["action-ack", "error"], (value) => value.id === "revision-a" || value.actionId === "revision-a"), b.wait(["action-ack", "error"], (value) => value.id === "revision-b" || value.actionId === "revision-b")]);
  assert.equal(results.filter((value) => value.type === "action-ack").length, 1);
  assert.equal(results.find((value) => value.type === "error").code, "stale-revision");
  assert.equal(app.rooms.snapshot(host.roomId, host.participantId).workflow.cards[0].revision, 2);
  b.send({ type: "action", action: { id: "stale-approve", kind: "meeting.approve", cardId: "card", revision: 1 } });
  assert.equal((await b.wait("error", (value) => value.actionId === "stale-approve")).code, "stale-revision");
  a.send({ type: "message", message: msg("original") }); await a.wait("ack"); await b.wait("message");
  await wsAction(b, a, { id: "clarify", kind: "clarification.request", messageId: "original", reason: "repeat", question: "", lang: "en" });
  a.send({ type: "action", action: { id: "wrong-resolve", kind: "clarification.resolve", clarificationId: "clarify" } });
  assert.equal((await a.wait("error", (value) => value.actionId === "wrong-resolve")).code, "forbidden-action");
  b.send({ type: "message", message: { ...msg("wrong-correction"), senderId: host.participantId, relation: { kind: "correction", messageId: "original" } } });
  assert.equal((await b.wait("error", (value) => value.id === "wrong-correction")).code, "forbidden-action");
  b.send({ type: "action", action: { id: "forged-approval", kind: "meeting.approve", cardId: "card", revision: 2, actorId: host.participantId } });
  assert.equal((await b.wait("error", (value) => value.actionId === "forged-approval")).code, "invalid-action");
  assert.deepEqual(app.rooms.snapshot(host.roomId, host.participantId).workflow.cards[0].approvals, []);
});

test("large valid history snapshots do not trigger slow-connection closure and workflow byte rejection remains atomic over WS", { timeout: 10000 }, async (t) => {
  const app = await fixture(t, { roomOptions: { maxWorkflowBytes: 100 } });
  const { host, guest } = await roomPair(app);
  for (let index = 0; index < 200; index += 1) app.rooms.addMessage(host.roomId, host.participantId, msg(`long-${index}`, "x".repeat(2000)));
  const a = await socket(app, host), b = await socket(app, guest);
  assert.equal(b.snapshot.messages.length, 200);
  await a.wait("presence", (value) => value.participants.every((p) => p.online));
  const before = app.rooms.snapshot(host.roomId, host.participantId);
  a.send({ type: "action", action: { id: "too-large", kind: "meeting.create", fields: meetingFields, lang: "en" } });
  assert.equal((await a.wait("error", (value) => value.actionId === "too-large")).code, "workflow-limit");
  assert.deepEqual(app.rooms.snapshot(host.roomId, host.participantId), before);
  assert.equal(a.ws.readyState, WebSocket.OPEN);
  assert.equal(b.ws.readyState, WebSocket.OPEN);
  b.send({ type: "message", message: msg("after-large-snapshot") }); await b.wait("ack");
  assert.equal((await a.wait("message", (value) => value.message.id === "after-large-snapshot")).message.seq, 201);
});
