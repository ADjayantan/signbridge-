import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { createChatMiddleware } from "../server/nodeChatMiddleware.js";

const deferred = () => Promise.withResolvers();
const moduleFor = (handleChat, maxBodyBytes = 1024) => ({ handleChat, LIMITS: { maxBodyBytes } });

async function fixture(t, loadHandler, env = {}) {
  const incoming = deferred();
  const handled = deferred();
  const errors = [];
  const middleware = createChatMiddleware(loadHandler, env);
  const server = http.createServer((req, res) => {
    req.originalUrl = req.url;
    incoming.resolve({ req, res });
    Promise.resolve(middleware(req, res, (error) => {
      errors.push(error);
      if (!res.destroyed && !res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("Unexpected server error");
      }
    })).then(handled.resolve, handled.reject);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}/api/chat`, incoming: incoming.promise, handled: handled.promise, errors };
}

function localRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("healthy GET status requests preserve URL, environment and response headers", { timeout: 5000 }, async (t) => {
  const env = { configuredForTest: true };
  let received;
  const server = await fixture(t, async () => moduleFor(async (request, handlerEnv) => {
    received = { method: request.method, url: request.url, body: await request.text(), env: handlerEnv };
    return Response.json({ configured: false }, { headers: { "cache-control": "no-store" } });
  }), env);
  const response = await localRequest(`${server.url}?status=1`);
  await server.handled;
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { configured: false });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(received.method, "GET");
  assert.equal(new URL(received.url).searchParams.get("status"), "1");
  assert.equal(received.body, "");
  assert.equal(received.env, env);
  assert.deepEqual(server.errors, []);
});

test("healthy POST reads the actual uploaded JSON and streams response chunks", { timeout: 5000 }, async (t) => {
  const uploaded = JSON.stringify({ mode: "sign", text: "WATER" });
  let received;
  const server = await fixture(t, async () => moduleFor(async (request) => {
    received = { method: request.method, body: await request.text(), type: request.headers.get("content-type"), connection: request.headers.get("connection") };
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("first\n"));
      controller.enqueue(new TextEncoder().encode("second\n"));
      controller.close();
    } }), { headers: { "content-type": "application/x-ndjson" } });
  }));
  const response = await localRequest(server.url, { method: "POST", headers: { "content-type": "application/json" } }, uploaded);
  await server.handled;
  assert.equal(response.status, 200);
  assert.equal(response.body, "first\nsecond\n");
  assert.deepEqual(received, { method: "POST", body: uploaded, type: "application/json", connection: null });
  assert.deepEqual(server.errors, []);
});

test("closing a GET during handler loading cannot invoke AI or Vite error middleware", { timeout: 5000 }, async (t) => {
  const load = deferred();
  let calls = 0;
  const server = await fixture(t, () => load.promise);
  const client = http.get(`${server.url}?status=1`);
  client.on("error", () => {});
  const { res } = await server.incoming;
  const closed = new Promise((resolve) => res.once("close", resolve));
  client.destroy(); await closed;
  load.resolve(moduleFor(async () => { calls += 1; return Response.json({ configured: false }); }));
  await server.handled;
  assert.equal(calls, 0);
  assert.deepEqual(server.errors, []);
});

test("aborting a partial POST upload does not start inference or trigger Vite's overlay", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const server = await fixture(t, async () => moduleFor(async () => { calls += 1; return Response.json({ reply: "unused" }); }));
  const client = http.request(server.url, { method: "POST", headers: { "content-type": "application/json", "content-length": "1000" } });
  client.on("error", () => {});
  client.write('{"mode":"');
  const { req } = await server.incoming;
  const closed = new Promise((resolve) => req.once("close", resolve));
  client.destroy(); await closed; await server.handled;
  assert.equal(req.aborted, true);
  assert.equal(calls, 0);
  assert.deepEqual(server.errors, []);
});

test("disconnecting during a response aborts its request signal and suppresses abort errors", { timeout: 5000 }, async (t) => {
  let signal;
  const server = await fixture(t, async () => moduleFor(async (request) => {
    signal = request.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode("first response chunk\n"));
      request.signal.addEventListener("abort", () => controller.error(new DOMException("Disconnected", "AbortError")), { once: true });
    } }), { headers: { "content-type": "application/x-ndjson" } });
  }));
  await new Promise((resolve, reject) => {
    const client = http.get(server.url, (response) => {
      response.on("error", () => {});
      response.once("data", () => { response.destroy(); client.destroy(); resolve(); });
    });
    client.on("error", reject);
  });
  await server.handled;
  assert.equal(signal.aborted, true);
  assert.deepEqual(server.errors, []);
});

test("a connected request's unexpected handler error still reaches next(error)", { timeout: 5000 }, async (t) => {
  const failure = new Error("Handler implementation failed");
  const server = await fixture(t, async () => moduleFor(async () => { throw failure; }));
  const response = await localRequest(server.url);
  await server.handled;
  assert.equal(response.status, 500);
  assert.deepEqual(server.errors, [failure]);
});

test("unexpected module-loading errors still reach next(error)", { timeout: 5000 }, async (t) => {
  const failure = new Error("Handler import failed");
  const server = await fixture(t, async () => { throw failure; });
  const response = await localRequest(server.url);
  await server.handled;
  assert.equal(response.status, 500);
  assert.deepEqual(server.errors, [failure]);
});

test("a declared oversized upload returns JSON413 and never invokes inference", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const server = await fixture(t, async () => moduleFor(async () => { calls += 1; return Response.json({ reply: "unused" }); }, 16));
  const body = "x".repeat(32);
  const response = await localRequest(server.url, { method: "POST", headers: { "content-length": String(Buffer.byteLength(body)) } }, body);
  await server.handled;
  assert.equal(response.status, 413);
  assert.equal(typeof JSON.parse(response.body).error, "string");
  assert.equal(calls, 0); assert.deepEqual(server.errors, []);
});

test("an oversized chunked upload also returns JSON413 without a content-length", { timeout: 5000 }, async (t) => {
  let calls = 0;
  const server = await fixture(t, async () => moduleFor(async () => { calls += 1; return Response.json({ reply: "unused" }); }, 16));
  const response = await localRequest(server.url, { method: "POST", headers: { "transfer-encoding": "chunked" } }, "x".repeat(32));
  await server.handled;
  assert.equal(response.status, 413);
  assert.equal(typeof JSON.parse(response.body).error, "string");
  assert.equal(calls, 0); assert.deepEqual(server.errors, []);
});
