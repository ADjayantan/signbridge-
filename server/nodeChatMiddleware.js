const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade"]);

async function toWebRequest(req, signal, maxBytes) {
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const chunks = [];
  let size = 0;
  if (hasBody) {
    // Preserve the socket on a size-limit rejection so it can receive HTTP 413.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error("The request is too large."), { status: 413 });
      chunks.push(chunk);
    }
  } else {
    req.resume();
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key) || value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  const url = new URL(req.originalUrl || req.url, `http://${req.headers.host || "localhost"}`);
  return new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined, signal });
}

function waitForDrain(res, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", done); res.off("close", done); res.off("error", fail);
      signal.removeEventListener("abort", done);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = (error) => { cleanup(); reject(error); };
    res.once("drain", done); res.once("close", done); res.once("error", fail);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted || res.destroyed) done();
  });
}

async function sendWebResponse(res, response, signal) {
  if (signal.aborted || res.destroyed) {
    await response.body?.cancel().catch(() => {});
    return;
  }
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) { res.end(); return; }
  const reader = response.body.getReader();
  // A disconnected client must also release a pending Web stream read.
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted && !res.destroyed) {
      const { value, done } = await reader.read();
      if (done || signal.aborted || res.destroyed) break;
      if (!res.write(value)) await waitForDrain(res, signal);
    }
    if (!signal.aborted && !res.destroyed) res.end();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Node HTTP adapter shared by Vite dev and preview. Client cancellation is normal. */
export function createChatMiddleware(loadHandler, env) {
  return async (req, res, next) => {
    const controller = new AbortController();
    const abortUpload = () => controller.abort();
    const abortResponse = () => { if (!res.writableEnded) controller.abort(); };
    const disconnected = () => controller.signal.aborted || req.aborted || res.destroyed;
    req.once("aborted", abortUpload);
    res.once("close", abortResponse);
    try {
      if (disconnected()) return;
      const { handleChat, LIMITS } = await loadHandler();
      if (disconnected()) return;
      const request = await toWebRequest(req, controller.signal, LIMITS.maxBodyBytes);
      if (disconnected()) return;
      const response = await handleChat(request, env);
      await sendWebResponse(res, response, controller.signal);
    } catch (error) {
      // Node rejects an interrupted upload with ECONNRESET / "aborted".
      // Forwarding it to Vite broadcasts an error overlay to every open app tab.
      if (disconnected()) return;
      if (res.headersSent) res.end();
      else if (error.status === 413) {
        // Close after the response rather than buffering an oversized remainder.
        res.writeHead(413, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ error: error.message }));
      } else next(error);
    } finally {
      req.off("aborted", abortUpload);
      res.off("close", abortResponse);
    }
  };
}
