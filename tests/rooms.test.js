import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoomStore, ROOM_LIMITS, validateRoomMessage } from "../server/rooms.js";
import { createIceProvider } from "../server/iceServers.js";

const message = (id, text = "Hello") => ({ id, text, inputMethod: "text", lang: "en" });
const errorCode = (code) => (error) => error.code === code;
function pair(options) {
  const store = createRoomStore(options);
  const host = store.createRoom();
  const guest = store.joinRoom(host.roomId, host.inviteToken);
  return { store, host, guest };
}

test("room credentials are opaque, independent, and snapshots never expose them", () => {
  const { store, host, guest } = pair();
  assert.notEqual(host.token, guest.token);
  assert.notEqual(host.inviteToken, host.token);
  assert.equal(store.authenticate(host.roomId, host.participantId, host.token).member.role, "host");
  assert.equal(store.authenticate(guest.roomId, guest.participantId, guest.token).member.role, "guest");
  assert.throws(() => store.authenticate(host.roomId, host.participantId, guest.token), errorCode("invalid-auth"));
  assert.throws(() => store.authenticate(host.roomId, "missing", host.token), errorCode("invalid-auth"));
  const serialized = JSON.stringify(store.snapshot(host.roomId, host.participantId));
  for (const secret of [host.token, host.inviteToken, guest.token]) assert.equal(serialized.includes(secret), false);
});

test("invalid invites and a third participant are rejected without recycling offline slots", () => {
  const store = createRoomStore();
  const host = store.createRoom();
  assert.throws(() => store.joinRoom(host.roomId, "wrong"), errorCode("invalid-invite"));
  const guest = store.joinRoom(host.roomId, host.inviteToken);
  store.setOnline(host.roomId, guest.participantId, false);
  assert.throws(() => store.joinRoom(host.roomId, host.inviteToken), errorCode("room-full"));
  assert.throws(() => store.joinRoom("missing", host.inviteToken), errorCode("room-ended"));
});

test("empty rooms expire after thirty minutes, including reservations that never connected", () => {
  let now = 1000;
  const store = createRoomStore({ clock: () => now });
  const host = store.createRoom();
  now += ROOM_LIMITS.emptyTimeoutMs - 1;
  store.authenticate(host.roomId, host.participantId, host.token);
  now += 1;
  assert.throws(() => store.authenticate(host.roomId, host.participantId, host.token), errorCode("room-ended"));
  assert.deepEqual(store.roomIds(), []);
});

test("the empty timeout starts on the last transport disconnect and does not reset on repeated offline events", () => {
  let now = 1000;
  const { store, host, guest } = pair({ clock: () => now });
  store.setOnline(host.roomId, host.participantId, true);
  store.setOnline(host.roomId, guest.participantId, true);
  now += ROOM_LIMITS.emptyTimeoutMs * 2;
  store.setOnline(host.roomId, host.participantId, false);
  now += 50;
  store.setOnline(host.roomId, guest.participantId, false);
  const emptyAt = now;
  now += 100;
  store.setOnline(host.roomId, host.participantId, false);
  now = emptyAt + ROOM_LIMITS.emptyTimeoutMs;
  assert.deepEqual(store.pruneExpired(), [host.roomId]);
});

test("reviewed messages receive server identity, sequence and timestamp", () => {
  const { store, host, guest } = pair({ clock: () => 1700000000000 });
  const first = store.addMessage(host.roomId, host.participantId, { ...message("first", " Reviewed message "), senderId: guest.participantId, seq: 8000 });
  const second = store.addMessage(host.roomId, guest.participantId, { ...message("second"), inputMethod: "sign", signLanguage: "isl", lang: "ta" });
  assert.equal(first.message.senderId, host.participantId);
  assert.equal(first.message.seq, 1);
  assert.equal(second.message.seq, 2);
  assert.equal(first.message.text, "Reviewed message");
  assert.equal(first.message.createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(second.message.signLanguage, "isl");
});

test("message retry acknowledgements are idempotent and reject payload or sender collisions", () => {
  const { store, host, guest } = pair();
  const payload = message("same-id");
  assert.equal(store.addMessage(host.roomId, host.participantId, payload).duplicate, false);
  assert.equal(store.addMessage(host.roomId, host.participantId, payload).duplicate, true);
  assert.throws(() => store.addMessage(host.roomId, host.participantId, message("same-id", "Changed")), errorCode("message-id-conflict"));
  assert.throws(() => store.addMessage(host.roomId, guest.participantId, payload), errorCode("message-id-conflict"));
  assert.equal(store.snapshot(host.roomId, guest.participantId).messages.length, 1);
});

test("latest 200 messages remain visible while old IDs still suppress delayed retries", () => {
  const { store, host } = pair();
  for (let i = 0; i < 205; i += 1) store.addMessage(host.roomId, host.participantId, message(`msg-${i}`));
  const snapshot = store.snapshot(host.roomId, host.participantId);
  assert.equal(snapshot.messages.length, 200);
  assert.equal(snapshot.messages[0].id, "msg-5");
  assert.equal(store.addMessage(host.roomId, host.participantId, message("msg-0")).duplicate, true);
  assert.equal(store.snapshot(host.roomId, host.participantId).messages.length, 200);
});

test("bounded ID memory refuses new messages rather than forgetting deduplication", () => {
  const { store, host } = pair({ maxMessageIds: 2 });
  store.addMessage(host.roomId, host.participantId, message("one"));
  store.addMessage(host.roomId, host.participantId, message("two"));
  assert.throws(() => store.addMessage(host.roomId, host.participantId, message("three")), errorCode("conversation-limit"));
  assert.equal(store.addMessage(host.roomId, host.participantId, message("one")).duplicate, true);
});

test("only the receiving participant can acknowledge a message, and receipts survive resume", () => {
  const { store, host, guest } = pair();
  store.addMessage(host.roomId, host.participantId, message("one"));
  assert.throws(() => store.markReceived(host.roomId, host.participantId, "one"), errorCode("invalid-receipt"));
  assert.throws(() => store.markReceived(host.roomId, guest.participantId, "missing"), errorCode("invalid-receipt"));
  assert.equal(store.markReceived(host.roomId, guest.participantId, "one").duplicate, false);
  assert.equal(store.markReceived(host.roomId, guest.participantId, "one").duplicate, true);
  assert.deepEqual(store.snapshot(host.roomId, host.participantId).messages[0].receivedBy, [guest.participantId]);
});

test("snapshot mutations do not alter retained history or receipt state", () => {
  const { store, host } = pair();
  store.addMessage(host.roomId, host.participantId, message("one"));
  const snapshot = store.snapshot(host.roomId, host.participantId);
  snapshot.messages[0].text = "Changed";
  snapshot.messages[0].receivedBy.push("other");
  snapshot.participants[0].online = true;
  const fresh = store.snapshot(host.roomId, host.participantId);
  assert.equal(fresh.messages[0].text, "Hello");
  assert.deepEqual(fresh.messages[0].receivedBy, []);
  assert.equal(fresh.participants[0].online, false);
});

test("ended rooms and a new process cannot reuse invites or transcripts", () => {
  const { store, host } = pair();
  store.addMessage(host.roomId, host.participantId, message("one"));
  store.endRoom(host.roomId);
  assert.throws(() => store.joinRoom(host.roomId, host.inviteToken), errorCode("room-ended"));
  const restarted = createRoomStore();
  assert.throws(() => restarted.authenticate(host.roomId, host.participantId, host.token), errorCode("room-ended"));
});

test("room admission and message validation are bounded", () => {
  const store = createRoomStore({ maxRooms: 1 });
  store.createRoom();
  assert.throws(() => store.createRoom(), errorCode("server-busy"));
  for (const invalid of [null, [], { ...message("ok"), id: "bad id" }, message("ok", "  "), message("ok", "x".repeat(2001)), { ...message("ok"), inputMethod: "ai" }, { ...message("ok"), lang: "bad language" }, { ...message("ok"), signLanguage: "random" }]) {
    assert.throws(() => validateRoomMessage(invalid), errorCode("invalid-message"));
  }
  assert.equal(validateRoomMessage(message("ok", "😀".repeat(2000))).text.length, 4000);
});

test("unconfigured relay needs no upstream request and provides a usable text fallback", async () => {
  let calls = 0;
  const provider = createIceProvider({ fetchImpl: () => { calls += 1; throw new Error("Unexpected upstream"); } });
  const result = await provider();
  assert.equal(result.relayAvailable, false);
  assert.deepEqual(result.iceServers, []);
  assert.match(result.notice, /Text remains available/);
  assert.equal(calls, 0);
});

test("Metered credentials are fetched once, cached and refreshed without returning the API key", async () => {
  let now = 0;
  let calls = 0;
  const provider = createIceProvider({ env: { METERED_DOMAIN: "test-app", METERED_TURN_API_KEY: "secret-api-key" }, clock: () => now,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url.hostname, "test-app.metered.live");
      assert.equal(url.searchParams.get("apiKey"), "secret-api-key");
      assert.ok(options.signal);
      return Response.json([{ urls: "stun:relay.example:80" }, { urls: ["turn:relay.example:80", "turns:relay.example:443"], username: "user", credential: "temporary-secret" }]);
    } });
  const [a, b] = await Promise.all([provider(), provider()]);
  assert.equal(calls, 1);
  assert.equal(a.relayAvailable, true);
  assert.equal(b.iceServers.length, 2);
  assert.equal(JSON.stringify(a).includes("secret-api-key"), false);
  a.iceServers[1].credential = "changed";
  assert.equal((await provider()).iceServers[1].credential, "temporary-secret");
  now += 5 * 60_000;
  await provider();
  assert.equal(calls, 2);
});

test("failed, malformed and timed-out relay responses are cached failures without leaked details", async () => {
  for (const fetchImpl of [async () => new Response("secret error", { status: 429 }), async () => Response.json([{ urls: "https://malicious.example" }]), async () => Response.json([{ urls: "turn:relay.example:80" }]), async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("secret-api-key")), { once: true }))]) {
    const provider = createIceProvider({ env: { METERED_DOMAIN: "test-app.metered.live", METERED_TURN_API_KEY: "secret-api-key" }, fetchImpl, timeoutMs: 10 });
    const result = await provider();
    assert.equal(result.relayAvailable, false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.deepEqual(await provider(), result);
  }
});
