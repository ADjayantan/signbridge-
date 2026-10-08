import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoomStore, ROOM_LIMITS, validateMeetingFields, validateWorkflowAction } from "../server/rooms.js";

const fields = { date: "2026-10-12", time: "09:30", timeZone: "Asia/Kolkata", place: "Library entrance", note: "Bring the notes." };
const msg = (id, text = "Meet at nine") => ({ id, text, inputMethod: "text", lang: "en" });
const code = (expected) => (error) => error.code === expected;
function fixture(options = {}) {
  const store = createRoomStore({ clock: () => 1800000000000, ...options });
  const host = store.createRoom();
  const guest = store.joinRoom(host.roomId, host.inviteToken);
  return { store, host, guest, action: (participant, action) => store.applyAction(host.roomId, participant.participantId, action),
    message: (participant, message) => store.addMessage(host.roomId, participant.participantId, message),
    snapshot: (participant = host) => store.snapshot(host.roomId, participant.participantId) };
}
const createCard = (id = "meeting") => ({ id, kind: "meeting.create", fields, lang: "en" });
const reference = (id = "red-door", label = "Red door") => ({ id, kind: "reference.create", label, description: "The door beside the library desk.", lang: "en" });

test("recipient requests clarification; only that requester resolves it and event copies remain immutable", () => {
  const f = fixture();
  f.message(f.host, msg("original"));
  assert.throws(() => f.action(f.host, { id: "self", kind: "clarification.request", messageId: "original", reason: "repeat", question: "", lang: "en" }), code("forbidden-action"));
  const requested = f.action(f.guest, { id: "clarify", kind: "clarification.request", messageId: "original", reason: "question", question: "Which entrance?", lang: "en" });
  assert.equal(requested.event.seq, 2);
  assert.equal(requested.event.actorId, f.guest.participantId);
  assert.equal(requested.workflow.clarifications[0].requesterId, f.guest.participantId);
  assert.equal(requested.event.clarification.status, "open");
  assert.throws(() => f.action(f.host, { id: "bad-resolve", kind: "clarification.resolve", clarificationId: "clarify" }), code("forbidden-action"));
  const resolved = f.action(f.guest, { id: "resolve", kind: "clarification.resolve", clarificationId: "clarify" });
  assert.equal(resolved.event.clarification.status, "resolved");
  assert.equal(resolved.event.clarification.resolvedBy, f.guest.participantId);
  assert.equal(resolved.event.lang, "en");
  assert.equal(f.snapshot().workflow.events[0].clarification.status, "open");
  assert.equal(f.snapshot().messages[0].text, "Meet at nine");
});

test("corrections and clarification answers are new immutable messages owned by the original sender", () => {
  const f = fixture();
  f.message(f.host, msg("original"));
  f.action(f.guest, { id: "clarify", kind: "clarification.request", messageId: "original", reason: "time-place", question: "", lang: "en" });
  const correction = { ...msg("correction", "Meet at ten"), relation: { kind: "correction", messageId: "original" } };
  assert.throws(() => f.message(f.guest, correction), code("forbidden-action"));
  const corrected = f.message(f.host, correction).message;
  assert.equal(corrected.seq, 3);
  assert.deepEqual(corrected.relation, correction.relation);
  const answer = { ...msg("answer", "The library entrance, at ten"), relation: { kind: "answer", messageId: "original", clarificationId: "clarify" } };
  assert.throws(() => f.message(f.guest, answer), code("forbidden-action"));
  assert.throws(() => f.message(f.host, { ...answer, relation: { ...answer.relation, clarificationId: "missing" } }), code("clarification-unavailable"));
  f.message(f.host, answer);
  f.action(f.guest, { id: "resolve", kind: "clarification.resolve", clarificationId: "clarify" });
  assert.equal(f.message(f.host, answer).duplicate, true);
  assert.throws(() => f.message(f.host, { ...answer, id: "late-answer" }), code("clarification-unavailable"));
  const snapshot = f.snapshot();
  assert.equal(snapshot.messages[0].text, "Meet at nine");
  snapshot.messages[1].relation.messageId = "tampered";
  assert.equal(f.snapshot().messages[1].relation.messageId, "original");
});

test("unavailable originals reject new relations/clarifications while accepted retries survive message pruning", () => {
  const f = fixture({ maxMessages: 1 });
  f.message(f.host, msg("original"));
  const request = { id: "clarify", kind: "clarification.request", messageId: "original", reason: "repeat", question: "", lang: "en" };
  f.action(f.guest, request);
  const correction = { ...msg("corrected", "Meet at ten"), relation: { kind: "correction", messageId: "original" } };
  f.message(f.host, correction);
  assert.equal(f.message(f.host, correction).duplicate, true);
  assert.equal(f.action(f.guest, request).duplicate, true);
  assert.throws(() => f.action(f.guest, { ...request, id: "new-request" }), code("original-unavailable"));
  assert.throws(() => f.message(f.host, { ...correction, id: "new-correction" }), code("original-unavailable"));
});

test("meeting approval is per person and latest revision; changed fields reset both approvals", () => {
  const f = fixture();
  f.action(f.host, createCard());
  assert.deepEqual(f.snapshot().workflow.cards[0].approvals, []);
  f.action(f.host, { id: "host-approval", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  f.action(f.guest, { id: "guest-approval", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  const approved = f.snapshot().workflow.cards[0];
  assert.deepEqual(approved.approvals, [f.host.participantId, f.guest.participantId]);
  const revised = f.action(f.guest, { id: "revision-2", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields, time: "10:00" }, lang: "en" });
  assert.equal(revised.event.card.revision, 2);
  assert.deepEqual(revised.event.card.approvals, []);
  assert.equal(Object.hasOwn(revised.event.card, "history"), false);
  const card = f.snapshot().workflow.cards[0];
  assert.equal(card.updatedBy, f.guest.participantId);
  assert.equal(card.history.length, 2);
  assert.equal(card.history[0].fields.time, "09:30");
  assert.equal(card.history[1].fields.time, "10:00");
  assert.throws(() => f.action(f.host, { id: "stale-approval", kind: "meeting.approve", cardId: "meeting", revision: 1 }), code("stale-revision"));
  assert.throws(() => f.action(f.host, { id: "stale-revise", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields, lang: "en" }), code("stale-revision"));
  assert.equal(f.action(f.host, { id: "host-approval", kind: "meeting.approve", cardId: "meeting", revision: 1 }).duplicate, true);
  assert.equal(f.snapshot().workflow.events[1].card.revision, 1);
  assert.deepEqual(f.snapshot().workflow.events[1].card.approvals, [f.host.participantId]);
});

test("unchanged meeting revisions preserve approvals; changing language requires new approval", () => {
  const f = fixture();
  f.action(f.host, createCard());
  f.action(f.host, { id: "approved", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  f.action(f.guest, { id: "same", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields }, lang: "en" });
  assert.equal(f.snapshot().workflow.cards[0].revision, 1);
  assert.equal(f.snapshot().workflow.cards[0].history.length, 1);
  assert.deepEqual(f.snapshot().workflow.cards[0].approvals, [f.host.participantId]);
  f.action(f.guest, { id: "language", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields, lang: "ta" });
  assert.equal(f.snapshot().workflow.cards[0].revision, 2);
  assert.deepEqual(f.snapshot().workflow.cards[0].approvals, []);
});

test("simultaneous base revisions accept one writer and reject the stale edit without changing state", () => {
  const f = fixture();
  f.action(f.host, createCard());
  f.action(f.host, { id: "winner", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields, place: "Main gate" }, lang: "en" });
  const before = f.snapshot();
  assert.throws(() => f.action(f.guest, { id: "loser", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields, place: "Back gate" }, lang: "en" }), code("stale-revision"));
  assert.deepEqual(f.snapshot(), before);
});

test("human reference snapshots in messages stay pinned when either person renames a reference", () => {
  const f = fixture();
  f.action(f.host, reference());
  const payload = { ...msg("first", "Wait beside this door"), referenceIds: ["red-door"], references: [{ id: "forged", description: "fake" }] };
  f.message(f.host, payload);
  f.action(f.guest, { id: "rename", kind: "reference.revise", referenceId: "red-door", baseRevision: 1, label: "Library side door", description: "The green door to the left of the desk.", lang: "ta" });
  assert.equal(f.message(f.host, payload).duplicate, true);
  f.message(f.guest, { ...msg("second"), referenceIds: ["red-door"] });
  const snapshot = f.snapshot();
  assert.deepEqual(snapshot.messages[0].references, [{ id: "red-door", revision: 1, label: "Red door", description: "The door beside the library desk.", lang: "en" }]);
  assert.equal(snapshot.messages[1].references[0].revision, 2);
  assert.equal(snapshot.messages[1].references[0].label, "Library side door");
  assert.equal(snapshot.workflow.references[0].updatedBy, f.guest.participantId);
  assert.equal(Object.hasOwn(snapshot.messages[0], "referenceIds"), false);
  assert.throws(() => f.message(f.host, { ...msg("missing"), referenceIds: ["absent"] }), code("reference-unavailable"));
  assert.throws(() => f.message(f.host, { ...msg("duplicate-ref"), referenceIds: ["red-door", "red-door"] }), code("invalid-message"));
  snapshot.messages[0].references[0].description = "Changed";
  assert.equal(f.snapshot().messages[0].references[0].description, "The door beside the library desk.");
});

test("action IDs are participant-owned, survive event pruning and reject changed/foreign collisions", () => {
  const f = fixture({ maxWorkflowEvents: 2 });
  const original = createCard();
  f.action(f.host, original);
  f.action(f.host, { id: "approve-a", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  f.action(f.guest, { id: "approve-b", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  assert.equal(f.snapshot().workflow.events.length, 2);
  assert.equal(f.action(f.host, original).duplicate, true);
  assert.throws(() => f.action(f.host, { ...original, fields: { ...fields, time: "12:00" } }), code("action-id-conflict"));
  assert.throws(() => f.action(f.guest, original), code("action-id-conflict"));
  assert.deepEqual(f.snapshot(f.host).acceptedActionIds, ["meeting", "approve-a"]);
  assert.deepEqual(f.snapshot(f.guest).acceptedActionIds, ["approve-b"]);
  assert.throws(() => f.message(f.host, msg("meeting")), code("message-id-conflict"));
  f.message(f.host, msg("message-id"));
  assert.throws(() => f.action(f.host, reference("message-id")), code("action-id-conflict"));
});

test("calendar/timezone and action fields are strictly validated without trusting client identities", () => {
  assert.equal(validateMeetingFields({ ...fields, date: "2024-02-29", timeZone: "UTC" }).date, "2024-02-29");
  for (const changed of [{ date: "2026-02-29" }, { date: "2026-04-31" }, { date: "0000-01-01" }, { date: "26-10-01" }, { time: "24:00" }, { time: "12:60" }, { timeZone: "Not/A-TimeZone" }, { place: " " }, { note: "x".repeat(1001) }, { extra: "field" }]) assert.throws(() => validateMeetingFields({ ...fields, ...changed }), code("invalid-action"));
  for (const invalid of [null, [], { ...createCard(), actorId: "forged" }, { ...createCard(), approvals: ["partner"] }, { ...reference(), description: " " }, { ...reference(), label: "x".repeat(121) }, { ...reference(), description: "x".repeat(1001) }, { id: "a", kind: "clarification.request", messageId: "m", reason: "question", question: "", lang: "en" }, { id: "a", kind: "meeting.approve", cardId: "m", revision: 1.5 }, { id: "a", kind: "reference.revise", referenceId: "m", baseRevision: 0 }]) assert.throws(() => validateWorkflowAction(invalid), code("invalid-action"));
  const f = fixture();
  assert.throws(() => f.store.applyAction(f.host.roomId, "outsider", createCard()), code("invalid-auth"));
  assert.throws(() => f.message(f.host, { ...msg("bad-answer"), relation: { kind: "answer", messageId: "m" } }), code("invalid-message"));
});

test("object, revision and accepted-ID limits fail clearly without evicting old objects or IDs", () => {
  const f = fixture({ maxCards: 1, maxReferences: 1, maxClarifications: 1, maxRevisions: 2 });
  f.message(f.host, msg("original"));
  f.action(f.host, createCard());
  f.action(f.host, reference());
  f.action(f.guest, { id: "clarify", kind: "clarification.request", messageId: "original", reason: "repeat", question: "", lang: "en" });
  for (const action of [createCard("second-card"), reference("second-ref"), { id: "second-clarify", kind: "clarification.request", messageId: "original", reason: "repeat", question: "", lang: "en" }]) {
    const before = f.snapshot();
    assert.throws(() => f.action(f.guest, action), code("workflow-limit"));
    assert.deepEqual(f.snapshot(), before);
  }
  f.action(f.host, { id: "rev2", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields, time: "10:00" }, lang: "en" });
  assert.throws(() => f.action(f.guest, { id: "rev3", kind: "meeting.revise", cardId: "meeting", baseRevision: 2, fields: { ...fields, time: "11:00" }, lang: "en" }), code("workflow-limit"));
  f.action(f.host, { id: "ref2", kind: "reference.revise", referenceId: "red-door", baseRevision: 1, label: "Door two", description: "Another description.", lang: "en" });
  assert.throws(() => f.action(f.guest, { id: "ref3", kind: "reference.revise", referenceId: "red-door", baseRevision: 2, label: "Door three", description: "Yet another description.", lang: "en" }), code("workflow-limit"));
  const bounded = fixture({ maxActionIds: 1 });
  bounded.action(bounded.host, createCard());
  assert.throws(() => bounded.action(bounded.guest, reference()), code("workflow-limit"));
  assert.equal(bounded.action(bounded.host, createCard()).duplicate, true);
  assert.equal(ROOM_LIMITS.maxActionIds, 2000);
  assert.equal(ROOM_LIMITS.maxWorkflowEvents, 200);
  assert.equal(ROOM_LIMITS.maxRevisions, 20);
});

test("serialized workflow limit rejects atomically, preserving approvals, revisions, IDs, events and sequence", () => {
  const f = fixture({ maxWorkflowBytes: 4000 });
  f.action(f.host, createCard());
  f.action(f.host, { id: "approved-a", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  f.action(f.guest, { id: "approved-b", kind: "meeting.approve", cardId: "meeting", revision: 1 });
  const before = f.snapshot();
  assert.throws(() => f.action(f.guest, { id: "too-big", kind: "meeting.revise", cardId: "meeting", baseRevision: 1, fields: { ...fields, note: "😀".repeat(1000) }, lang: "en" }), code("workflow-limit"));
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.message(f.host, msg("next-message")).message.seq, before.workflow.events.at(-1).seq + 1);
  const small = fixture({ maxWorkflowBytes: 100 });
  assert.throws(() => small.action(small.host, createCard()), code("workflow-limit"));
  assert.deepEqual(small.snapshot().workflow, { events: [], clarifications: [], cards: [], references: [] });
  assert.deepEqual(small.snapshot().acceptedActionIds, []);
  assert.equal(small.message(small.host, msg("first-message")).message.seq, 1);
});

test("oversized reference attachments reject a message atomically and same ID can be reused for a smaller draft", () => {
  const f = fixture({ maxMessageBytes: 700 });
  f.action(f.host, { ...reference(), description: "Long description ".repeat(35) });
  const before = f.snapshot();
  assert.throws(() => f.message(f.host, { ...msg("attachment", "x".repeat(300)), referenceIds: ["red-door"] }), code("invalid-message"));
  assert.deepEqual(f.snapshot(), before);
  const accepted = f.message(f.host, msg("attachment", "Shorter message"));
  assert.equal(accepted.message.seq, 2);
});

test("end, expiry and a new room remove workflow state and accepted-action identity", () => {
  let now = 0;
  const f = fixture({ clock: () => now });
  f.action(f.host, createCard());
  f.store.endRoom(f.host.roomId);
  assert.throws(() => f.action(f.host, createCard()), code("room-ended"));
  const fresh = f.store.createRoom();
  assert.deepEqual(f.store.snapshot(fresh.roomId, fresh.participantId).workflow, { events: [], clarifications: [], cards: [], references: [] });
  now += ROOM_LIMITS.emptyTimeoutMs;
  assert.throws(() => f.store.applyAction(fresh.roomId, fresh.participantId, createCard()), code("room-ended"));
});
