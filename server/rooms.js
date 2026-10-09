import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ROOM_LIMITS = Object.freeze({
  emptyTimeoutMs: 30 * 60 * 1000,
  maxRooms: 100,
  maxMessages: 200,
  // Retain IDs separately from visible history. At the limit, start a fresh room
  // rather than forgetting an old ID and accepting a delayed duplicate.
  maxMessageIds: 2000,
  maxTextChars: 2000,
  maxWorkflowEvents: 200,
  maxActionIds: 2000,
  maxCards: 25,
  maxReferences: 25,
  maxRevisions: 20,
  maxClarifications: 100,
  maxWorkflowBytes: 256 * 1024,
  maxReferencesPerMessage: 8,
  maxMessageBytes: 16 * 1024,
});

export class RoomError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const opaque = (bytes = 24) => randomBytes(bytes).toString("base64url");
const digest = (text) => createHash("sha256").update(text).digest();
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
function matches(value, stored) {
  return typeof value === "string" && value.length <= 128 && timingSafeEqual(digest(value), stored);
}
function copyMessage(message) {
  return structuredClone(message);
}

const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function workflowFailure(message, code = "invalid-action", status = 400) {
  throw new RoomError(code, message, status);
}
function workflowLimit(what) { workflowFailure(`This room has reached its ${what} limit. Start a fresh conversation.`, "workflow-limit", 429); }
function languageValue(value, code = "invalid-message") {
  const lang = value ?? "en";
  if (typeof lang !== "string" || lang.length > 35 || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(lang)) {
    throw new RoomError(code, "Choose a valid language.");
  }
  return lang;
}
function workflowText(value, name, max, { required = false } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || Array.from(value).length > max || (required && !value.trim())) workflowFailure(`${name} must contain ${required ? "1" : "0"} to ${max} characters.`);
  return value.trim();
}
function actionId(value, name) {
  if (!validId(value)) workflowFailure(`Choose a valid ${name}.`);
  return value;
}
function revisionValue(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) workflowFailure(`Choose a valid ${name}.`);
  return value;
}
function assertKeys(value, keys) {
  if (!plainObject(value)) workflowFailure("The action must be a JSON object.");
  if (Object.keys(value).some((key) => !keys.includes(key))) workflowFailure("This action contains unsupported fields. Participant identities are assigned by the server.");
}

export function validateMeetingFields(value) {
  assertKeys(value, ["date", "time", "timeZone", "place", "note"]);
  const date = value.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) workflowFailure("Choose a complete meeting date in YYYY-MM-DD format.");
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (year < 1 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) workflowFailure("Choose a valid calendar date.");
  if (typeof value.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)) workflowFailure("Choose a meeting time in HH:MM format.");
  if (typeof value.timeZone !== "string" || !value.timeZone.trim() || value.timeZone.length > 100) workflowFailure("Choose a valid time zone.");
  const timeZone = value.timeZone.trim();
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { workflowFailure("Choose a valid time zone."); }
  return { date, time: value.time, timeZone, place: workflowText(value.place, "Meeting place", 200, { required: true }), note: workflowText(value.note, "Meeting note", 1000) };
}

export function validateWorkflowAction(value) {
  if (!plainObject(value) || !validId(value.id)) workflowFailure("Each action needs a unique ID.");
  const base = { id: value.id, kind: value.kind };
  switch (value.kind) {
    case "clarification.request":
      assertKeys(value, ["id", "kind", "messageId", "reason", "question", "lang"]);
      if (!["repeat", "time-place", "question"].includes(value.reason)) workflowFailure("Choose repeat, time-place or question as the clarification reason.");
      return { ...base, messageId: actionId(value.messageId, "message ID"), reason: value.reason,
        question: workflowText(value.question, "Clarification question", 1000, { required: value.reason === "question" }), lang: languageValue(value.lang, "invalid-action") };
    case "clarification.resolve":
      assertKeys(value, ["id", "kind", "clarificationId"]);
      return { ...base, clarificationId: actionId(value.clarificationId, "clarification ID") };
    case "meeting.create":
      assertKeys(value, ["id", "kind", "fields", "lang"]);
      return { ...base, fields: validateMeetingFields(value.fields), lang: languageValue(value.lang, "invalid-action") };
    case "meeting.revise":
      assertKeys(value, ["id", "kind", "cardId", "baseRevision", "fields", "lang"]);
      return { ...base, cardId: actionId(value.cardId, "meeting card ID"), baseRevision: revisionValue(value.baseRevision, "base revision"), fields: validateMeetingFields(value.fields), lang: languageValue(value.lang, "invalid-action") };
    case "meeting.approve":
      assertKeys(value, ["id", "kind", "cardId", "revision"]);
      return { ...base, cardId: actionId(value.cardId, "meeting card ID"), revision: revisionValue(value.revision, "revision") };
    case "reference.create":
      assertKeys(value, ["id", "kind", "label", "description", "lang"]);
      return { ...base, label: workflowText(value.label, "Reference label", 120, { required: true }), description: workflowText(value.description, "Reference description", 1000, { required: true }), lang: languageValue(value.lang, "invalid-action") };
    case "reference.revise":
      assertKeys(value, ["id", "kind", "referenceId", "baseRevision", "label", "description", "lang"]);
      return { ...base, referenceId: actionId(value.referenceId, "reference ID"), baseRevision: revisionValue(value.baseRevision, "base revision"), label: workflowText(value.label, "Reference label", 120, { required: true }), description: workflowText(value.description, "Reference description", 1000, { required: true }), lang: languageValue(value.lang, "invalid-action") };
    default: workflowFailure("This conversation action is unsupported.");
  }
}

const emptyWorkflow = () => ({ events: [], clarifications: [], cards: [], references: [] });
const sameFields = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function cardEventSnapshot(card) {
  const { history, ...snapshot } = card;
  return structuredClone(snapshot);
}

/** Mutates only a private candidate; the room commits after its byte limit passes. */
function applyWorkflowCandidate(workflow, messages, participantId, clean, createdAt, seq, limits) {
  const event = { id: clean.id, kind: clean.kind, actorId: participantId, seq, createdAt };
  switch (clean.kind) {
    case "clarification.request": {
      const original = messages.find((message) => message.id === clean.messageId);
      if (!original) workflowFailure("The original message is no longer available. Ask your partner to send it again.", "original-unavailable", 409);
      if (original.senderId === participantId) workflowFailure("Only the recipient can request clarification of this message.", "forbidden-action", 403);
      if (workflow.clarifications.length >= limits.maxClarifications) workflowLimit("clarification");
      const clarification = { id: clean.id, messageId: clean.messageId, requesterId: participantId, reason: clean.reason, question: clean.question, lang: clean.lang, status: "open", createdAt };
      workflow.clarifications.push(clarification);
      Object.assign(event, { messageId: clean.messageId, clarificationId: clean.id, reason: clean.reason, question: clean.question, lang: clean.lang, clarification: structuredClone(clarification) });
      break;
    }
    case "clarification.resolve": {
      const clarification = workflow.clarifications.find((value) => value.id === clean.clarificationId);
      if (!clarification) workflowFailure("This clarification is unavailable.", "clarification-unavailable", 409);
      if (clarification.requesterId !== participantId) workflowFailure("Only the person who asked can mark the clarification resolved.", "forbidden-action", 403);
      if (clarification.status === "open") Object.assign(clarification, { status: "resolved", resolvedAt: createdAt, resolvedBy: participantId });
      Object.assign(event, { clarificationId: clarification.id, messageId: clarification.messageId, lang: clarification.lang, clarification: structuredClone(clarification) });
      break;
    }
    case "meeting.create": {
      if (workflow.cards.length >= limits.maxCards) workflowLimit("meeting card");
      const fields = structuredClone(clean.fields);
      const card = { id: clean.id, revision: 1, fields, lang: clean.lang, createdBy: participantId, updatedBy: participantId, approvals: [],
        history: [{ revision: 1, fields: structuredClone(fields), lang: clean.lang, updatedBy: participantId, createdAt }], createdAt, updatedAt: createdAt };
      workflow.cards.push(card);
      Object.assign(event, { cardId: card.id, revision: card.revision, lang: card.lang, card: cardEventSnapshot(card) });
      break;
    }
    case "meeting.revise": {
      const card = workflow.cards.find((value) => value.id === clean.cardId);
      if (!card) workflowFailure("This meeting card is unavailable.", "card-unavailable", 409);
      if (card.revision !== clean.baseRevision) workflowFailure("This meeting card changed. Review the latest revision before editing.", "stale-revision", 409);
      if (!sameFields(card.fields, clean.fields) || card.lang !== clean.lang) {
        if (card.revision >= limits.maxRevisions) workflowLimit("meeting revision");
        Object.assign(card, { revision: card.revision + 1, fields: structuredClone(clean.fields), lang: clean.lang, updatedBy: participantId, updatedAt: createdAt, approvals: [] });
        card.history.push({ revision: card.revision, fields: structuredClone(card.fields), lang: card.lang, updatedBy: participantId, createdAt });
      }
      Object.assign(event, { cardId: card.id, revision: card.revision, baseRevision: clean.baseRevision, lang: card.lang, card: cardEventSnapshot(card) });
      break;
    }
    case "meeting.approve": {
      const card = workflow.cards.find((value) => value.id === clean.cardId);
      if (!card) workflowFailure("This meeting card is unavailable.", "card-unavailable", 409);
      if (card.revision !== clean.revision) workflowFailure("This meeting card changed. Review the latest revision before approving.", "stale-revision", 409);
      if (!card.approvals.includes(participantId)) card.approvals.push(participantId);
      Object.assign(event, { cardId: card.id, revision: card.revision, lang: card.lang, card: cardEventSnapshot(card) });
      break;
    }
    case "reference.create": {
      if (workflow.references.length >= limits.maxReferences) workflowLimit("reference");
      const reference = { id: clean.id, revision: 1, label: clean.label, description: clean.description, lang: clean.lang, createdBy: participantId, updatedBy: participantId };
      workflow.references.push(reference);
      Object.assign(event, { referenceId: reference.id, revision: reference.revision, lang: reference.lang, reference: structuredClone(reference) });
      break;
    }
    case "reference.revise": {
      const reference = workflow.references.find((value) => value.id === clean.referenceId);
      if (!reference) workflowFailure("This reference is unavailable.", "reference-unavailable", 409);
      if (reference.revision !== clean.baseRevision) workflowFailure("This reference changed. Review the latest revision before editing.", "stale-revision", 409);
      if (reference.label !== clean.label || reference.description !== clean.description || reference.lang !== clean.lang) {
        if (reference.revision >= limits.maxRevisions) workflowLimit("reference revision");
        Object.assign(reference, { revision: reference.revision + 1, label: clean.label, description: clean.description, lang: clean.lang, updatedBy: participantId });
      }
      Object.assign(event, { referenceId: reference.id, revision: reference.revision, baseRevision: clean.baseRevision, lang: reference.lang, reference: structuredClone(reference) });
      break;
    }
  }
  workflow.events.push(event);
  if (workflow.events.length > limits.maxWorkflowEvents) workflow.events.shift();
  return event;
}

export function validateRoomMessage(value, maxTextChars = ROOM_LIMITS.maxTextChars) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !validId(value.id)) {
    throw new RoomError("invalid-message", "Each message needs a unique ID.");
  }
  if (typeof value.text !== "string" || !value.text.trim() || Array.from(value.text).length > maxTextChars) {
    throw new RoomError("invalid-message", `Write a message between 1 and ${maxTextChars} characters.`);
  }
  if (!["text", "speech", "sign"].includes(value.inputMethod)) {
    throw new RoomError("invalid-message", "Choose text, speech or sign as the input method.");
  }
  const lang = languageValue(value.lang);
  if (value.signLanguage != null && !["isl", "asl"].includes(value.signLanguage)) {
    throw new RoomError("invalid-message", "Choose ISL or ASL as the sign language.");
  }
  let relation;
  if (value.relation != null) {
    const raw = value.relation;
    if (!plainObject(raw) || !["answer", "correction"].includes(raw.kind) || !validId(raw.messageId) || (raw.clarificationId != null && !validId(raw.clarificationId)) || (raw.kind === "answer" && !validId(raw.clarificationId)) || Object.keys(raw).some((key) => !["kind", "messageId", "clarificationId"].includes(key))) {
      throw new RoomError("invalid-message", "Choose a valid correction or clarification answer link.");
    }
    relation = { kind: raw.kind, messageId: raw.messageId, ...(raw.clarificationId != null ? { clarificationId: raw.clarificationId } : {}) };
  }
  if (value.referenceIds != null && (!Array.isArray(value.referenceIds) || value.referenceIds.length > ROOM_LIMITS.maxReferencesPerMessage || value.referenceIds.some((id) => !validId(id)) || new Set(value.referenceIds).size !== value.referenceIds.length)) {
    throw new RoomError("invalid-message", `Choose up to ${ROOM_LIMITS.maxReferencesPerMessage} distinct reference IDs.`);
  }
  return { id: value.id, text: value.text.trim(), inputMethod: value.inputMethod, lang,
    ...(value.signLanguage != null ? { signLanguage: value.signLanguage } : {}), ...(relation ? { relation } : {}),
    ...(value.referenceIds?.length ? { referenceIds: [...value.referenceIds] } : {}) };
}

/** In-memory, two-person conversations. Only credential digests are retained. */
export function createRoomStore({ clock = Date.now, ...overrides } = {}) {
  const limits = { ...ROOM_LIMITS, ...overrides };
  const rooms = new Map();

  function getRoom(roomId) {
    const room = rooms.get(roomId);
    if (room && room.emptySince != null && clock() - room.emptySince >= limits.emptyTimeoutMs) rooms.delete(roomId);
    const active = rooms.get(roomId);
    if (!active) throw new RoomError("room-ended", "This room has ended or the invite is invalid. Start a new conversation.", 404);
    return active;
  }

  function authenticate(roomId, participantId, token) {
    const room = getRoom(roomId);
    const member = room.members.get(participantId);
    if (!member || !matches(token, member.tokenDigest)) {
      throw new RoomError("invalid-auth", "Your room credentials are invalid. Join using the invite link.", 401);
    }
    return { room, member };
  }

  function newMember(room, role) {
    const participantId = opaque(18);
    const token = opaque(32);
    room.members.set(participantId, { id: participantId, role, tokenDigest: digest(token), online: false });
    return { roomId: room.id, participantId, token, role };
  }

  function pruneExpired() {
    const expired = [];
    for (const [id, room] of rooms) {
      if (room.emptySince != null && clock() - room.emptySince >= limits.emptyTimeoutMs) {
        rooms.delete(id); expired.push(id);
      }
    }
    return expired;
  }

  function createRoom() {
    pruneExpired();
    if (rooms.size >= limits.maxRooms) throw new RoomError("server-busy", "The room server is busy. Try again later.", 503);
    const roomId = opaque(18);
    const inviteToken = opaque(32);
    const room = { id: roomId, inviteDigest: digest(inviteToken), members: new Map(), messages: [], ids: new Map(), actionIds: new Map(), workflow: emptyWorkflow(), nextSeq: 1, emptySince: clock() };
    rooms.set(roomId, room);
    return { ...newMember(room, "host"), inviteToken };
  }

  function joinRoom(roomId, inviteToken) {
    const room = getRoom(roomId);
    if (!matches(inviteToken, room.inviteDigest)) throw new RoomError("invalid-invite", "This invite is invalid. Ask your partner for a new link.", 403);
    if (room.members.size >= 2) throw new RoomError("room-full", "This conversation already has two participants.", 409);
    return newMember(room, "guest");
  }

  function presence(roomId) {
    return [...getRoom(roomId).members.values()].map(({ id, online }) => ({ id, online }));
  }

  function snapshot(roomId, participantId) {
    const room = getRoom(roomId);
    const member = room.members.get(participantId);
    if (!member) throw new RoomError("invalid-auth", "Participant not found.", 401);
    return { type: "snapshot", roomId, participantId, role: member.role,
      messages: room.messages.map(copyMessage), participants: presence(roomId), workflow: structuredClone(room.workflow),
      acceptedActionIds: [...room.actionIds].filter(([, action]) => action.actorId === participantId).map(([id]) => id) };
  }

  function setOnline(roomId, participantId, online) {
    const room = getRoom(roomId);
    const member = room.members.get(participantId);
    if (!member) throw new RoomError("invalid-auth", "Participant not found.", 401);
    member.online = Boolean(online);
    if ([...room.members.values()].some((m) => m.online)) room.emptySince = null;
    else if (room.emptySince == null) room.emptySince = clock();
  }

  function addMessage(roomId, participantId, value) {
    const room = getRoom(roomId);
    if (!room.members.has(participantId)) throw new RoomError("invalid-auth", "Participant not found.", 401);
    const clean = validateRoomMessage(value, limits.maxTextChars);
    const fingerprint = digest(JSON.stringify(clean)).toString("hex");
    const previous = room.ids.get(clean.id);
    if (previous) {
      if (previous.senderId !== participantId || previous.fingerprint !== fingerprint) {
        throw new RoomError("message-id-conflict", "This message ID was already used for a different message.", 409);
      }
      return { duplicate: true, message: room.messages.find((m) => m.id === clean.id) ? copyMessage(room.messages.find((m) => m.id === clean.id)) : null };
    }
    if (room.actionIds.has(clean.id)) throw new RoomError("message-id-conflict", "This ID was already used for a conversation action.", 409);
    if (room.ids.size >= limits.maxMessageIds) {
      throw new RoomError("conversation-limit", "This room has reached its message limit. Start a fresh conversation.", 429);
    }
    if (clean.relation) {
      const original = room.messages.find((message) => message.id === clean.relation.messageId);
      if (!original) throw new RoomError("original-unavailable", "The original message is no longer available. Ask your partner to send it again.", 409);
      if (original.senderId !== participantId) throw new RoomError("forbidden-action", "Only the original sender can correct or answer this message.", 403);
      if (clean.relation.clarificationId) {
        const clarification = room.workflow.clarifications.find((value) => value.id === clean.relation.clarificationId);
        if (!clarification || clarification.messageId !== original.id || clarification.requesterId === participantId || (clean.relation.kind === "answer" && clarification.status !== "open")) {
          throw new RoomError("clarification-unavailable", "Choose the matching open clarification request.", 409);
        }
      }
    }
    const references = (clean.referenceIds || []).map((id) => {
      const reference = room.workflow.references.find((value) => value.id === id);
      if (!reference) throw new RoomError("reference-unavailable", "One of these references is unavailable. Review the draft before sending.", 409);
      const { revision, label, description, lang } = reference;
      return { id, revision, label, description, lang };
    });
    const { referenceIds, ...content } = clean;
    const message = { ...content, ...(references.length ? { references } : {}), senderId: participantId, seq: room.nextSeq, createdAt: new Date(clock()).toISOString(), receivedBy: [] };
    if (Buffer.byteLength(JSON.stringify(message), "utf8") > limits.maxMessageBytes) throw new RoomError("invalid-message", "This message and its reference descriptions are too large. Attach fewer references or shorten their descriptions.", 413);
    room.nextSeq += 1;
    room.ids.set(clean.id, { senderId: participantId, fingerprint, receivedBy: new Set() });
    room.messages.push(message);
    if (room.messages.length > limits.maxMessages) room.messages.shift();
    return { duplicate: false, message: copyMessage(message) };
  }

  function applyAction(roomId, participantId, value) {
    const room = getRoom(roomId);
    if (!room.members.has(participantId)) throw new RoomError("invalid-auth", "Participant not found.", 401);
    const clean = validateWorkflowAction(value);
    const fingerprint = digest(JSON.stringify(clean)).toString("hex");
    const previous = room.actionIds.get(clean.id);
    // Accepted retries do not depend on the current card revision, clarification
    // status or whether the original message/event has since left visible history.
    if (previous) {
      if (previous.actorId !== participantId || previous.fingerprint !== fingerprint) throw new RoomError("action-id-conflict", "This action ID was already used for a different action.", 409);
      return { duplicate: true, event: null, workflow: structuredClone(room.workflow) };
    }
    if (room.ids.has(clean.id)) throw new RoomError("action-id-conflict", "This ID was already used for a message.", 409);
    if (room.actionIds.size >= limits.maxActionIds) workflowLimit("conversation action");
    const candidate = structuredClone(room.workflow);
    const event = applyWorkflowCandidate(candidate, room.messages, participantId, clean, new Date(clock()).toISOString(), room.nextSeq, limits);
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > limits.maxWorkflowBytes) workflowLimit("workflow storage");
    // All checks pass before committing objects, approvals, events, sequence or ID.
    room.workflow = candidate;
    room.actionIds.set(clean.id, { actorId: participantId, fingerprint });
    room.nextSeq += 1;
    return { duplicate: false, event: structuredClone(event), workflow: structuredClone(candidate) };
  }

  function markReceived(roomId, participantId, id) {
    const room = getRoom(roomId);
    const stored = validId(id) ? room.ids.get(id) : null;
    if (!room.members.has(participantId) || !stored || stored.senderId === participantId) {
      throw new RoomError("invalid-receipt", "Only the recipient can acknowledge an existing message.");
    }
    const duplicate = stored.receivedBy.has(participantId);
    stored.receivedBy.add(participantId);
    const message = room.messages.find((m) => m.id === id);
    if (message && !message.receivedBy.includes(participantId)) message.receivedBy.push(participantId);
    return { type: "received", id, by: participantId, duplicate };
  }

  return { limits, createRoom, joinRoom, authenticate, presence, snapshot, setOnline, addMessage, applyAction, markReceived,
    pruneExpired, endRoom: (roomId) => rooms.delete(roomId), roomIds: () => [...rooms.keys()] };
}
