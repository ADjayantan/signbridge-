const STORAGE_KEY = "signbridge.room.session.v1";
const emptyWorkflow = () => ({ events: [], clarifications: [], cards: [], references: [] });
const emptyState = () => ({ status: "idle", error: "", notice: "", roomId: "", participantId: "", role: "", inviteUrl: "", messages: [], participants: [], workflow: emptyWorkflow(), pendingActions: [], snapshotVersion: 0, workflowVersion: 0, workflowOrigin: "reset" });
const actionKinds = new Set(["clarification.request", "clarification.resolve", "meeting.create", "meeting.revise", "meeting.approve", "reference.create", "reference.revise"]);
const MAX_PENDING_ACTIONS = 64;
const MAX_REJECTED_ACTIONS = 128;
function normalizeWorkflow(value) { return Object.fromEntries(Object.keys(emptyWorkflow()).map((key) => [key, Array.isArray(value?.[key]) ? value[key] : []])); }
function immutableCopy(value) {
  const copy = JSON.parse(JSON.stringify(value));
  const freeze = (item) => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } return item; };
  return freeze(copy);
}
function optionalSessionStorage() { try { return globalThis.sessionStorage; } catch { return null; } }

export function parseRoomInvite(value, origin = globalThis.location?.origin || "http://localhost") {
  const input = String(value || "").trim();
  if (!input) throw new Error("Paste a conversation invite link.");
  const url = new URL(input, origin);
  const hashParams = new URLSearchParams((url.hash.split("?")[1] || ""));
  const roomId = hashParams.get("room") || url.searchParams.get("room");
  const inviteToken = hashParams.get("invite") || url.searchParams.get("invite");
  if (!roomId || !inviteToken || !/^[a-zA-Z0-9_-]+$/.test(roomId) || !/^[a-zA-Z0-9_-]+$/.test(inviteToken)) throw new Error("This invite link is incomplete. Ask your partner for a fresh link.");
  return { roomId, inviteToken };
}

/** Human-to-human transport. No AI endpoints are used by this client. */
export class RoomClient {
  constructor({ baseUrl = "", origin = globalThis.location?.origin || "http://localhost", fetchImpl = (...args) => globalThis.fetch(...args), WebSocketImpl = globalThis.WebSocket, storage = optionalSessionStorage(), requestTimeout = 70000, ackTimeout = 12000, reconnectDelay = 1000, online = globalThis.navigator?.onLine !== false } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); this.origin = origin; this.fetchImpl = fetchImpl; this.WebSocketImpl = WebSocketImpl; this.storage = storage;
    this.requestTimeout = requestTimeout; this.ackTimeout = ackTimeout; this.reconnectDelay = reconnectDelay;
    this.state = emptyState(); this.listeners = new Set(); this.signalListeners = new Set(); this.pending = new Map(); this.pendingActionEntries = new Map(); this.rejectedActionResults = new Map(); this.acceptedActionIds = new Set(); this.credentials = null;
    this.socket = null; this.reconnectTimer = null; this.reconnectCount = 0; this.generation = 0; this.closed = false;
    this.networkOnline = Boolean(online);
  }
  subscribe = (handler) => { this.listeners.add(handler); return () => this.listeners.delete(handler); };
  subscribeSignal = (handler) => { this.signalListeners.add(handler); return () => this.signalListeners.delete(handler); };
  getSnapshot = () => this.state;
  update(patch) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  saveCredentials(value) { this.credentials = value; try { value ? this.storage?.setItem(STORAGE_KEY, JSON.stringify(value)) : this.storage?.removeItem(STORAGE_KEY); } catch { /* Room still works if session storage is unavailable. */ } }
  async request(path, options = {}) {
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), this.requestTimeout);
    const warmup = setTimeout(() => this.update({ notice: "The free server may be waking up. Keep this page open." }), 8000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, signal: aborter.signal, headers: { "Content-Type": "application/json", ...options.headers } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(body.error || body.message || "The conversation server could not complete this request."); error.status = response.status; error.code = body.code; throw error; }
      return body;
    } catch (error) { if (error.name === "AbortError") throw new Error("The server did not respond. Try again; free hosting may need time to start."); throw error; }
    finally { clearTimeout(timer); clearTimeout(warmup); }
  }
  resetTransport() {
    this.generation += 1; clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    const socket = this.socket; this.socket = null; socket?.close();
    this.pending.forEach((entry, id) => { clearTimeout(entry.timer); entry.resolve?.({ ok: false, id, error: "Connection interrupted. Retry this message when connected." }); entry.resolve = null; });
    this.interruptActions("Delivery is unconfirmed. Reconnect before retrying this action.");
  }
  clearWorkflow() { this.pendingActionEntries.clear(); this.rejectedActionResults.clear(); this.acceptedActionIds.clear(); }
  updatePendingActions() { this.update({ pendingActions: [...this.pendingActionEntries].map(([id, entry]) => ({ id, action: entry.action, delivery: entry.delivery, error: entry.error || "", code: entry.code || "" })) }); }
  interruptActions(error) {
    this.pendingActionEntries.forEach((entry, id) => { if (entry.delivery === "rejected") return; clearTimeout(entry.timer); entry.delivery = "uncertain"; entry.error = error; entry.resolve?.({ ok: false, id, error, code: "delivery-unconfirmed", uncertain: true }); entry.resolve = null; });
    if (this.pendingActionEntries.size) this.updatePendingActions();
  }
  async create() {
    if (!this.networkOnline) { this.update({ status: this.credentials ? "reconnecting" : "error", error: "You are offline. Connect to the internet before starting a room.", notice: "Your draft is kept on this device." }); return; }
    this.resetTransport(); this.closed = false; this.saveCredentials(null); this.pending.clear(); this.clearWorkflow(); this.update({ ...emptyState(), snapshotVersion: this.state.snapshotVersion, status: "creating" });
    const operation = this.generation;
    try { const credentials = await this.request("/api/rooms", { method: "POST", body: "{}" }); if (operation !== this.generation || this.closed) return; this.activate(credentials); }
    catch (error) { if (operation === this.generation && !this.closed) this.update({ status: "error", error: error.message }); }
  }
  async join(value) {
    if (!this.networkOnline) { this.update({ status: this.credentials ? "reconnecting" : "error", error: "You are offline. Connect to the internet before joining a room.", notice: "Your draft is kept on this device." }); return; }
    let invite; try { invite = parseRoomInvite(value, this.origin); } catch (error) { this.update({ error: error.message }); return; }
    this.resetTransport(); this.closed = false; this.saveCredentials(null); this.pending.clear(); this.clearWorkflow(); this.update({ ...emptyState(), snapshotVersion: this.state.snapshotVersion, status: "joining" });
    const operation = this.generation;
    try { const credentials = await this.request(`/api/rooms/${encodeURIComponent(invite.roomId)}/join`, { method: "POST", body: JSON.stringify({ inviteToken: invite.inviteToken }) }); if (operation !== this.generation || this.closed) return; this.activate({ ...credentials, inviteToken: credentials.inviteToken || invite.inviteToken }); }
    catch (error) { if (operation === this.generation && !this.closed) this.update({ status: "error", error: error.message }); }
  }
  activate(credentials) {
    this.saveCredentials(credentials); this.closed = false;
    const inviteOrigin = this.baseUrl ? new URL(this.baseUrl, this.origin).origin : this.origin;
    this.update({ roomId: credentials.roomId, participantId: credentials.participantId, role: credentials.role, error: "", notice: "", inviteUrl: `${inviteOrigin}/#connect?room=${encodeURIComponent(credentials.roomId)}&invite=${encodeURIComponent(credentials.inviteToken || "")}` });
    this.connect();
  }
  resume() {
    if (this.closed) return;
    if (this.credentials) { if (!this.socket) this.connect(); return; }
    try { const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || "null"); if (saved?.roomId && saved.participantId && saved.token) this.activate(saved); } catch { this.saveCredentials(null); }
  }
  connect() {
    if (!this.credentials || this.closed) return;
    if (!this.networkOnline) { this.update({ status: "reconnecting", error: "", participants: this.state.participants.map((participant) => ({ ...participant, online: false })), notice: "You are offline. Your room and draft are kept; reconnection resumes when the network returns." }); return; }
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    const generation = this.generation;
    this.update({ status: this.reconnectCount ? "reconnecting" : "connecting", error: "", notice: this.reconnectCount ? "Connection lost. Reconnecting; your draft stays on this device." : "Connecting to the conversation…" });
    let socket;
    try { const url = new URL(`${this.baseUrl}/ws`, this.origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; socket = new this.WebSocketImpl(url.href); }
    catch (error) { this.update({ status: "error", error: error.message || "This browser cannot connect to conversations." }); return; }
    this.socket = socket;
    const current = () => this.socket === socket && generation === this.generation && !this.closed;
    socket.onopen = () => { if (current()) socket.send(JSON.stringify({ type: "join", roomId: this.credentials.roomId, participantId: this.credentials.participantId, token: this.credentials.token })); };
    socket.onmessage = (event) => { if (!current()) return; let data; try { data = JSON.parse(event.data); } catch { return; } this.receive(data); };
    socket.onerror = () => { if (current()) this.update({ notice: "The server connection was interrupted. Your draft is preserved." }); };
    socket.onclose = () => {
      if (!current()) return; this.socket = null;
      this.pending.forEach((entry, id) => { clearTimeout(entry.timer); entry.resolve?.({ ok: false, id, error: "Delivery is unconfirmed. Retry using the same message ID." }); entry.resolve = null; });
      this.interruptActions("Delivery is unconfirmed. Reconnect before retrying this action.");
      this.update({ status: "reconnecting", participants: this.state.participants.map((p) => ({ ...p, online: false })), messages: this.state.messages.map((m) => m.delivery === "pending" ? { ...m, delivery: "uncertain" } : m), notice: "Connection lost. Reconnecting; your draft stays on this device." });
      const delay = Math.min(15000, this.reconnectDelay * (2 ** Math.min(this.reconnectCount++, 4)));
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }
  finish(reason = "This room ended. Start a new conversation.") {
    this.closed = true; this.resetTransport(); this.saveCredentials(null); this.pending.clear(); this.clearWorkflow();
    this.update({ status: "ended", error: "", notice: reason, participants: [], workflow: emptyWorkflow(), pendingActions: [], workflowVersion: 0, workflowOrigin: "reset" });
  }
  setNetworkOnline = (online) => {
    const wasOnline = this.networkOnline; this.networkOnline = Boolean(online);
    if (this.closed) return;
    if (!this.networkOnline) {
      this.resetTransport();
      this.update({ status: this.credentials ? "reconnecting" : ["creating", "joining", "connecting"].includes(this.state.status) ? "error" : this.state.status,
        error: "", participants: this.state.participants.map((participant) => ({ ...participant, online: false })),
        messages: this.state.messages.map((message) => message.delivery === "pending" ? { ...message, delivery: "uncertain" } : message),
        notice: "You are offline. Your room and draft are kept; reconnection resumes when the network returns." });
    } else if (this.credentials && (!wasOnline || (this.state.status === "reconnecting" && !this.socket))) {
      this.reconnectCount = 0; this.connect();
    } else if (!wasOnline) this.update({ error: "", notice: "You are back online. Start a room or join your partner's invite." });
  };
  mergeMessage(message) {
    const index = this.state.messages.findIndex((m) => m.id === message.id);
    const previous = index >= 0 ? this.state.messages[index] : null;
    const incoming = { ...previous, ...message, delivery: previous?.delivery === "received" || message.receivedBy?.some((id) => id !== message.senderId) ? "received" : "sent" };
    const messages = index >= 0 ? this.state.messages.map((m, i) => i === index ? incoming : m) : [...this.state.messages, incoming];
    this.update({ messages: messages.sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER)).slice(-200) });
  }
  receive(data) {
    if (data.type === "snapshot") {
      this.reconnectCount = 0;
      const unsent = this.state.messages.filter((m) => !m.seq && !data.messages?.some((server) => server.id === m.id));
      this.update({ status: "connected", error: "", notice: "", role: data.role || this.state.role, participants: data.participants || [], messages: [...(data.messages || []).map((m) => ({ ...m, delivery: m.receivedBy?.some((id) => id !== m.senderId) ? "received" : "sent" })), ...unsent].slice(-200), workflow: normalizeWorkflow(data.workflow), snapshotVersion: this.state.snapshotVersion + 1, workflowOrigin: "snapshot" });
      (data.messages || []).forEach((m) => { this.ack(m.id); if (m.senderId !== this.state.participantId) this.write({ type: "received", id: m.id }); });
      const confirmedIds = new Set([...(data.actionIds || data.acceptedActionIds || []), ...this.state.workflow.events.filter((event) => event.actorId === this.state.participantId).map((event) => event.id)]);
      confirmedIds.forEach((id) => this.ackAction(id));
    } else if (data.type === "presence") this.update({ participants: data.participants || [] });
    else if (data.type === "message" && data.message) { this.mergeMessage(data.message); if (data.message.senderId !== this.state.participantId) this.write({ type: "received", id: data.message.id }); }
    else if (data.type === "ack") this.ack(data.id);
    else if (data.type === "workflow" && data.event) this.receiveWorkflow(data);
    else if (data.type === "action-ack") this.ackAction(data.id);
    else if (data.type === "received") this.update({ messages: this.state.messages.map((m) => m.id === data.id ? { ...m, delivery: "received" } : m) });
    else if (data.type === "signal") this.signalListeners.forEach((fn) => fn(data.data));
    else if (data.type === "room-ended") this.finish({ "partner-left": "Your partner left the conversation. Start a new room to reconnect.", "server-restart": "The free server restarted and this room ended. Start a new conversation.", expired: "This room expired after being empty. Start a new conversation.", ended: "The conversation ended. Start a new room to reconnect." }[data.reason] || data.reason || "This room ended. Start a new conversation.");
    else if (data.type === "session-replaced") this.finish("This conversation was opened in another tab. Continue there or join a fresh room.");
    else if (data.type === "error") {
      const message = data.message || data.error || "The server rejected this request.";
      if (data.code === "partner-offline" && !data.id) return; // Presence already explains normal video reconnect races.
      if (/ROOM_NOT_FOUND|ROOM_ENDED|ROOM_EXPIRED|UNAUTHORIZED|INVALID_TOKEN|INVALID_AUTH|AUTH_FAILED|SESSION_REPLACED/i.test(String(data.code || "").replaceAll("-", "_")) || /room.*(ended|expired|not found)|invalid.*(participant|token)|unauthoriz/i.test(message)) this.finish(message);
      else { if (data.actionId) this.rejectAction(data.actionId, message, data.code || "action-rejected", false); else if (data.id) this.rejectMessage(data.id, message); this.update({ error: message }); }
    }
  }
  receiveWorkflow(data) {
    const { event } = data;
    if (event.actorId === this.state.participantId) this.ackAction(event.id);
    // A replayed event must not replace a newer card or repeat an announcement.
    if (this.state.workflow.events.some((existing) => existing.id === event.id)) return;
    const lastSequence = Math.max(0, ...this.state.workflow.events.map((existing) => existing.seq || 0));
    if (event.seq && event.seq <= lastSequence) return;
    let workflow;
    if (data.workflow) workflow = normalizeWorkflow(data.workflow);
    else {
      workflow = { ...this.state.workflow, events: [...this.state.workflow.events, event].slice(-200) };
      for (const [property, collection] of [["clarification", "clarifications"], ["card", "cards"], ["reference", "references"]]) {
        if (!event[property]?.id) continue;
        const item = event[property]; const previous = workflow[collection].find((value) => value.id === item.id);
        workflow[collection] = previous ? workflow[collection].map((value) => value.id === item.id ? item : value) : [...workflow[collection], item];
      }
    }
    this.update({ workflow, workflowVersion: this.state.workflowVersion + 1, workflowOrigin: "live" });
  }
  ackAction(id) {
    if (!id) return;
    this.acceptedActionIds.add(id); this.rejectedActionResults.delete(id);
    const entry = this.pendingActionEntries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer); entry.resolve?.({ ok: true, id }); this.pendingActionEntries.delete(id); this.updatePendingActions();
  }
  rejectAction(id, error, code = "delivery-unconfirmed", uncertain = true) {
    const entry = this.pendingActionEntries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer); entry.delivery = uncertain ? "uncertain" : "rejected"; entry.error = error; entry.code = code;
    const result = { ok: false, id, error, code, uncertain };
    entry.resolve?.(result); entry.resolve = null;
    if (!uncertain) {
      // Definite failures are finished, not queued work. Keep only bounded outcomes
      // so reusing a recently rejected ID cannot silently change an old approval.
      this.pendingActionEntries.delete(id); this.rejectedActionResults.set(id, { ...result });
      if (this.rejectedActionResults.size > MAX_REJECTED_ACTIONS) this.rejectedActionResults.delete(this.rejectedActionResults.keys().next().value);
    }
    this.updatePendingActions();
  }
  ack(id) {
    const entry = this.pending.get(id); if (entry) { clearTimeout(entry.timer); entry.resolve?.({ ok: true, id }); this.pending.delete(id); }
    this.update({ messages: this.state.messages.map((m) => m.id === id && m.delivery !== "received" ? { ...m, delivery: "sent" } : m) });
  }
  rejectMessage(id, error) {
    const entry = this.pending.get(id); if (entry) { clearTimeout(entry.timer); entry.resolve?.({ ok: false, id, error }); entry.resolve = null; }
    this.update({ messages: this.state.messages.map((m) => m.id === id ? { ...m, delivery: "uncertain" } : m) });
  }
  write(payload) { if (this.socket?.readyState !== 1) return false; try { this.socket.send(JSON.stringify(payload)); return true; } catch { return false; } }
  send(payload) {
    const id = payload.id || globalThis.crypto.randomUUID();
    const text = String(payload.text || "").trim();
    if (!text) return Promise.resolve({ ok: false, id, error: "Write or review a message before sending." });
    if (this.state.status !== "connected") return Promise.resolve({ ok: false, id, error: "Reconnect before sending. Your draft is preserved." });
    const previous = this.state.messages.find((m) => m.id === id);
    if (previous?.delivery === "sent" || previous?.delivery === "received") return Promise.resolve({ ok: true, id });
    const existing = this.pending.get(id); if (existing?.promise && existing.resolve) return existing.promise;
    // An uncertain retry sends the original payload: editing it requires a new ID.
    const message = existing?.message || immutableCopy({ id, text, inputMethod: payload.inputMethod || "text", lang: payload.lang || "en", ...(payload.signLanguage ? { signLanguage: String(payload.signLanguage).toLowerCase() } : {}), ...(payload.relation ? { relation: payload.relation } : {}), ...(payload.referenceIds?.length ? { referenceIds: payload.referenceIds } : {}) });
    let resolve; const promise = new Promise((r) => { resolve = r; });
    const entry = { message, promise, resolve, timer: setTimeout(() => this.rejectMessage(id, "Delivery is unconfirmed. Retry this message when connected."), this.ackTimeout) };
    this.pending.set(id, entry);
    const optimistic = { ...message, senderId: this.state.participantId, delivery: "pending" };
    this.update({ error: "", messages: previous ? this.state.messages.map((m) => m.id === id ? optimistic : m) : [...this.state.messages, optimistic].slice(-200) });
    if (!this.write({ type: "message", message })) this.rejectMessage(id, "The connection closed. Retry after reconnecting.");
    return promise;
  }
  sendAction(payload = {}) {
    const id = payload.id || globalThis.crypto.randomUUID();
    const existing = this.pendingActionEntries.get(id);
    if (this.acceptedActionIds.has(id)) return Promise.resolve({ ok: true, id });
    if (this.rejectedActionResults.has(id)) return Promise.resolve({ ...this.rejectedActionResults.get(id) });
    if (this.state.status !== "connected") return Promise.resolve({ ok: false, id, error: "Reconnect before sending this action.", code: "disconnected", uncertain: Boolean(existing && existing.delivery !== "rejected") });
    if (existing?.resolve) return existing.promise;
    if (!actionKinds.has(existing?.action.kind || payload.kind)) return Promise.resolve({ ok: false, id, error: "This conversation action is not supported.", code: "invalid-action", uncertain: false });
    if (!existing && this.pendingActionEntries.size >= MAX_PENDING_ACTIONS) return Promise.resolve({ ok: false, id, error: "There are too many unconfirmed actions. Reconnect and confirm or retry existing actions before adding another.", code: "pending-action-limit", uncertain: false });
    let action;
    try { action = existing?.action || immutableCopy({ ...payload, id }); }
    catch { return Promise.resolve({ ok: false, id, error: "This action could not be prepared. Review its details and try again.", code: "invalid-action", uncertain: false }); }
    let resolve; const promise = new Promise((done) => { resolve = done; });
    const entry = { action, promise, resolve, delivery: "pending", error: "", code: "", timer: setTimeout(() => this.rejectAction(id, "Delivery is unconfirmed. Reconnect and retry the same action."), this.ackTimeout) };
    this.pendingActionEntries.set(id, entry); this.update({ error: "" }); this.updatePendingActions();
    if (!this.write({ type: "action", action })) this.rejectAction(id, "The connection closed. Reconnect before retrying this action.");
    return promise;
  }
  sendSignal = (data) => this.state.status === "connected" && this.write({ type: "signal", data });
  async getIceServers() {
    if (!this.credentials) throw new Error("Join a conversation before connecting video.");
    const credentials = this.credentials;
    try { return await this.request(`/api/rooms/${encodeURIComponent(credentials.roomId)}/ice`, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${credentials.token}`, "X-Participant-Id": credentials.participantId } }); }
    catch (error) { if ([401, 404, 410].includes(error.status)) this.finish("This room ended. Start a new conversation."); throw error; }
  }
  async askAI({ text, lang = "en", signal } = {}) {
    if (!this.credentials || this.state.status !== "connected") throw new Error("Reconnect before asking AI for help.");
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.credentials.token}`, "X-Room-Id": this.credentials.roomId, "X-Participant-Id": this.credentials.participantId },
      body: JSON.stringify({ mode: "sign", lang, messages: [{ role: "user", text: String(text || "").trim() }] }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || "AI help is unavailable. You can continue talking with your partner.");
    return body;
  }
  retry = () => { if (!this.credentials) { this.update({ error: "Start a conversation or paste an invite link to try again." }); return; } this.resetTransport(); this.closed = false; this.connect(); };
  leave = () => { const notified = this.write({ type: "leave" }); this.finish(notified ? "You left the conversation. Start a new room to reconnect." : "You left on this device. Your partner could not be notified; they can leave or end the room on their device."); };
  end = () => { const notified = this.write({ type: "end" }); this.finish(notified ? "You ended the conversation. Start a new room to reconnect." : "The conversation ended on this device. Your partner could not be notified; they can leave or end the room on their device."); };
  dispose() { this.closed = true; this.resetTransport(); this.pending.clear(); this.clearWorkflow(); this.update({ workflow: emptyWorkflow(), pendingActions: [], workflowVersion: 0, workflowOrigin: "reset" }); this.listeners.clear(); this.signalListeners.clear(); }
}
