import http from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createRoomStore, RoomError } from "./rooms.js";
import { createIceProvider } from "./iceServers.js";
import { createChatMiddleware } from "./nodeChatMiddleware.js";

const MAX_BODY = 16_384;
const MAX_WS_PAYLOAD = 32_768;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".wasm": "application/wasm", ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2" };

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
function bearer(req) {
  const value = req.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7) : "";
}
function send(ws, value) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 4 * 1024 * 1024) { ws.close(1013, "Connection too slow"); return; }
  ws.send(JSON.stringify(value));
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) throw new RoomError("content-type", "Use a JSON request body.", 415);
  if (Number(req.headers["content-length"]) > MAX_BODY) throw new RoomError("too-large", "The request is too large.", 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RoomError("too-large", "The request is too large.", 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RoomError("invalid-json", "The request must contain valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError("invalid-json", "The request must be a JSON object.");
  return value;
}

function signalData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError("invalid-signal", "Invalid video connection signal.");
  const data = {};
  if (value.reset === true) data.reset = true;
  if (value.description != null) {
    const d = value.description;
    if (!d || typeof d !== "object" || !["offer", "answer", "pranswer", "rollback"].includes(d.type) || (d.sdp != null && (typeof d.sdp !== "string" || d.sdp.length > 24_000))) throw new RoomError("invalid-signal", "Invalid video description.");
    data.description = { type: d.type, ...(d.sdp != null ? { sdp: d.sdp } : {}) };
  }
  if (Object.hasOwn(value, "candidate")) {
    const c = value.candidate;
    if (c === null) data.candidate = null;
    else {
      if (!c || typeof c !== "object" || typeof c.candidate !== "string" || c.candidate.length > 2048 || (c.sdpMid != null && (typeof c.sdpMid !== "string" || c.sdpMid.length > 256)) || (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 255)) || (c.usernameFragment != null && (typeof c.usernameFragment !== "string" || c.usernameFragment.length > 256))) throw new RoomError("invalid-signal", "Invalid video candidate.");
      data.candidate = { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null,
        ...(c.usernameFragment != null ? { usernameFragment: c.usernameFragment } : {}) };
    }
  }
  if (!Object.keys(data).length) throw new RoomError("invalid-signal", "Empty video connection signal.");
  return data;
}

function createLimiter(clock) {
  const buckets = new Map();
  return (key, max, windowMs = 60_000) => {
    const now = clock();
    if (buckets.size > 2000) for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
    const bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 10_000) throw new RoomError("rate-limited", "The server is busy. Try again shortly.", 429);
      buckets.set(key, { count: 1, until: now + windowMs }); return;
    }
    if (++bucket.count > max) throw new RoomError("rate-limited", "Too many requests. Wait a moment and try again.", 429);
  };
}

/** Standalone API/WebSocket server; accepts a port-0 listener in integration tests. */
export function createRoomServer({ env = process.env, staticDir = fileURLToPath(new URL("../dist", import.meta.url)), clock = Date.now,
  fetchImpl = globalThis.fetch, roomOptions = {}, chatLoader = () => import("./chat.js") } = {}) {
  const rooms = createRoomStore({ ...roomOptions, clock });
  const getIceConfig = createIceProvider({ env, clock, fetchImpl });
  const connections = new Map();
  const limit = createLimiter(clock);
  let closing = false;
  let closePromise;
  const allowedOrigins = new Set(String(env.ROOM_ALLOWED_ORIGINS || "").split(",").map((entry) => entry.trim()).filter(Boolean));

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // Non-browser clients still need room credentials.
    if (allowedOrigins.has(origin)) return true;
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return false;
      if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
      return url.host.toLowerCase() === String(req.headers.host || "").toLowerCase();
    } catch { return false; }
  }

  function cors(req, res) {
    if (!originAllowed(req)) throw new RoomError("origin", "This website is not allowed to access this conversation server.", 403);
    res.setHeader("vary", "Origin");
    if (req.headers.origin) res.setHeader("access-control-allow-origin", req.headers.origin);
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "Content-Type, Authorization, X-Participant-Id, X-Room-Id");
  }

  function broadcast(roomId, value) {
    for (const ws of connections.get(roomId)?.values() || []) send(ws, value);
  }

  function endRoom(roomId, reason) {
    broadcast(roomId, { type: "room-ended", reason });
    rooms.endRoom(roomId);
    const members = connections.get(roomId);
    connections.delete(roomId);
    for (const ws of members?.values() || []) ws.close(1000, "Room ended");
  }

  function memberForRequest(req, roomId) {
    const participantId = req.headers["x-participant-id"];
    if (typeof participantId !== "string" || typeof roomId !== "string") throw new RoomError("invalid-auth", "Room credentials are required.", 401);
    const result = rooms.authenticate(roomId, participantId, bearer(req));
    return result.member;
  }

  const chat = createChatMiddleware(async () => {
    const module = await chatLoader();
    return { ...module, handleChat: async (request, handlerEnv) => {
      const response = await module.handleChat(request, handlerEnv);
      if (request.method === "GET" && new URL(request.url).searchParams.get("status") === "1" && response.ok) {
        return Response.json({ ...await response.json(), roomAuthRequired: true }, { status: response.status, headers: response.headers });
      }
      return response;
    } };
  }, env);

  async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("allow", "GET, HEAD"); json(res, 405, { error: "Use GET or HEAD.", code: "method" }); return; }
    // Research weights must remain local even when dist was built in local mode.
    const clean = path.posix.normalize(pathname.replaceAll("\\", "/"));
    if (/^\/models(?:\/|$)/i.test(clean) || clean.split("/").some((part) => part.startsWith("."))) { json(res, 404, { error: "This resource is unavailable.", code: "not-found" }); return; }
    let root;
    try { root = await realpath(path.resolve(staticDir)); }
    catch { json(res, 503, { error: "The website build is not available. Build the app before starting the server.", code: "build-missing" }); return; }
    let candidate = path.resolve(root, `.${clean === "/" ? "/index.html" : clean}`);
    let info;
    try { info = await stat(candidate); }
    catch {
      if (path.extname(clean) || clean.startsWith("/api/")) { json(res, 404, { error: "This resource is unavailable.", code: "not-found" }); return; }
      candidate = path.join(root, "index.html");
      try { info = await stat(candidate); } catch { json(res, 503, { error: "The website build is not available.", code: "build-missing" }); return; }
    }
    const actual = await realpath(candidate);
    if (!actual.startsWith(`${root}${path.sep}`) || !info.isFile()) { json(res, 404, { error: "This resource is unavailable.", code: "not-found" }); return; }
    const ext = path.extname(actual).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "content-length": info.size,
      "cache-control": clean.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
    if (req.method === "HEAD") { res.end(); return; }
    const stream = createReadStream(actual);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    try {
      if (closing) throw new RoomError("server-restarting", "The server is restarting. Reconnect shortly.", 503);
      const url = new URL(req.url, "http://localhost");
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new RoomError("invalid-url", "Invalid request URL."); }
      if (pathname.startsWith("/api/")) cors(req, res);
      if (req.method === "OPTIONS" && pathname.startsWith("/api/")) { res.writeHead(204); res.end(); return; }
      const ip = req.socket.remoteAddress || "unknown";
      if (pathname === "/api/health" && req.method === "GET") { json(res, 200, { ok: true }); return; }
      if (pathname === "/api/chat") {
        if (req.method === "POST") {
          memberForRequest(req, req.headers["x-room-id"]);
          limit(`ai:${req.headers["x-room-id"]}:${req.headers["x-participant-id"]}`, 10);
        }
        await chat(req, res, () => json(res, 500, { error: "The optional AI helper failed. Conversation messages remain available.", code: "ai-error" }));
        return;
      }
      if (pathname === "/api/rooms" && req.method === "POST") {
        limit(`create:${ip}`, 10);
        await readJson(req);
        json(res, 201, rooms.createRoom()); return;
      }
      const route = /^\/api\/rooms\/([A-Za-z0-9_-]{1,128})\/(join|ice)$/.exec(pathname);
      if (route && req.method === "POST") {
        const [, roomId, operation] = route;
        if (operation === "join") {
          limit(`join:${ip}`, 40);
          const body = await readJson(req);
          json(res, 200, rooms.joinRoom(roomId, body.inviteToken));
        } else {
          const member = memberForRequest(req, roomId);
          limit(`ice:${roomId}:${member.id}`, 20);
          req.resume();
          json(res, 200, await getIceConfig());
        }
        return;
      }
      if (pathname.startsWith("/api/")) { json(res, 404, { error: "This API route is unavailable.", code: "not-found" }); return; }
      await serveStatic(req, res, pathname);
    } catch (error) {
      if (req.aborted || res.destroyed) return;
      if (res.headersSent) { res.end(); return; }
      if (error.status === 413) res.setHeader("connection", "close");
      json(res, error instanceof RoomError ? error.status : 500, { error: error instanceof RoomError ? error.message : "The server could not complete this request.", code: error instanceof RoomError ? error.code : "server-error" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });
  const upgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; } catch { pathname = ""; }
    if (closing || pathname !== "/ws" || !originAllowed(req) || wss.clients.size >= 400) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  server.on("upgrade", upgrade);

  wss.on("connection", (ws) => {
    let joined;
    let alive = true;
    let requests = 0;
    let windowStart = clock();
    const authTimeout = setTimeout(() => ws.close(1008, "Room authentication required"), 10_000);
    authTimeout.unref?.();
    ws.on("pong", () => { alive = true; });
    ws.on("error", () => {}); // Connection failures carry no transcript logging.
    ws.on("message", (raw, isBinary) => {
      let value;
      try {
        if (isBinary) throw new RoomError("invalid-json", "Send JSON text messages.");
        if (clock() - windowStart >= 10_000) { requests = 0; windowStart = clock(); }
        // A resumed participant can acknowledge all 200 snapshot messages at
        // once while ICE candidates are arriving. Keep that valid burst usable.
        if (++requests > 500) throw new RoomError("rate-limited", "Too many messages. Wait a moment and try again.", 429);
        try { value = JSON.parse(raw.toString()); } catch { throw new RoomError("invalid-json", "Send a valid JSON message."); }
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError("invalid-json", "Send a JSON object.");
        if (!joined) {
          if (value.type !== "join") throw new RoomError("not-joined", "Join a room before sending messages.", 401);
          const { member } = rooms.authenticate(value.roomId, value.participantId, value.token);
          joined = { roomId: value.roomId, participantId: member.id };
          clearTimeout(authTimeout);
          let members = connections.get(joined.roomId);
          if (!members) { members = new Map(); connections.set(joined.roomId, members); }
          const previous = members.get(member.id);
          members.set(member.id, ws);
          if (previous && previous !== ws) { send(previous, { type: "session-replaced" }); previous.close(1008, "Session replaced"); }
          rooms.setOnline(joined.roomId, member.id, true);
          send(ws, rooms.snapshot(joined.roomId, member.id));
          broadcast(joined.roomId, { type: "presence", participants: rooms.presence(joined.roomId) });
          return;
        }
        const { roomId, participantId } = joined;
        if (connections.get(roomId)?.get(participantId) !== ws) throw new RoomError("session-replaced", "This session was opened in another tab.", 401);
        if (value.type === "message") {
          limit(`message:${roomId}:${participantId}`, 120);
          const result = rooms.addMessage(roomId, participantId, value.message);
          if (!result.duplicate) broadcast(roomId, { type: "message", message: result.message });
          send(ws, { type: "ack", id: value.message.id });
        } else if (value.type === "action") {
          limit(`action:${roomId}:${participantId}`, 120);
          const result = rooms.applyAction(roomId, participantId, value.action);
          if (!result.duplicate) broadcast(roomId, { type: "workflow", event: result.event, workflow: result.workflow });
          send(ws, { type: "action-ack", id: value.action.id });
        } else if (value.type === "received") {
          const result = rooms.markReceived(roomId, participantId, value.id);
          if (!result.duplicate) { const { duplicate, ...receipt } = result; broadcast(roomId, receipt); }
        } else if (value.type === "signal") {
          const data = signalData(value.data);
          const partner = [...(connections.get(roomId)?.entries() || [])].find(([id]) => id !== participantId)?.[1];
          if (!partner || partner.readyState !== WebSocket.OPEN) throw new RoomError("partner-offline", "Your partner is not connected yet.");
          send(partner, { type: "signal", from: participantId, data });
        } else if (value.type === "leave" || value.type === "end") endRoom(roomId, value.type === "leave" ? "partner-left" : "ended");
        else throw new RoomError("unknown-event", "This conversation event is unsupported.");
      } catch (error) {
        send(ws, { type: "error", code: error instanceof RoomError ? error.code : "server-error",
          message: error instanceof RoomError ? error.message : "The server could not process this event.",
          ...(value?.type === "message" && typeof value?.message?.id === "string" && value.message.id.length <= 128 ? { id: value.message.id } : {}),
          ...(value?.type === "action" && typeof value?.action?.id === "string" && value.action.id.length <= 128 ? { actionId: value.action.id } : {}) });
        if (!joined || error.code === "rate-limited") ws.close(1008, "Request rejected");
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (!joined) return;
      const { roomId, participantId } = joined;
      const members = connections.get(roomId);
      if (members?.get(participantId) !== ws) return;
      members.delete(participantId);
      if (!members.size) connections.delete(roomId);
      try { rooms.setOnline(roomId, participantId, false); broadcast(roomId, { type: "presence", participants: rooms.presence(roomId) }); }
      catch { /* Room already ended or expired. */ }
    });
    ws.isAlive = () => alive;
    ws.markPing = () => { alive = false; };
  });

  const maintenance = setInterval(() => {
    for (const id of rooms.pruneExpired()) endRoom(id, "expired");
    for (const ws of wss.clients) {
      if (!ws.isAlive?.()) { ws.terminate(); continue; }
      ws.markPing(); ws.ping();
    }
  }, 30_000);
  maintenance.unref?.();

  function close(reason = "server-restart") {
    if (closePromise) return closePromise;
    closing = true;
    clearInterval(maintenance);
    for (const id of rooms.roomIds()) endRoom(id, reason);
    for (const ws of wss.clients) ws.close(1001, "Server restarting");
    closePromise = new Promise((resolve) => {
      const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); server.closeAllConnections(); }, 500);
      force.unref?.();
      wss.close(() => {
        server.closeAllConnections();
        server.close(() => { clearTimeout(force); server.off("upgrade", upgrade); resolve(); });
      });
    });
    return closePromise;
  }

  return { server, wss, rooms, close };
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const app = createRoomServer();
  const port = Number(process.env.PORT || 3001);
  app.server.listen(port, "0.0.0.0", () => console.log(`SignBridge conversation server listening on port ${port}`));
  for (const event of ["SIGTERM", "SIGINT"]) process.once(event, () => { void app.close().then(() => process.exit(0)); });
}
