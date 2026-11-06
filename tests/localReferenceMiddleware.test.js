import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLocalReferenceMiddleware, localReferencePlugin, parseLocalReferenceRange } from "../server/localReferenceMiddleware.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "signbridge-local-reference-test-"));
  const handler = createLocalReferenceMiddleware({ root });
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, () => { res.writeHead(418); res.end("next"); })).catch(() => { res.writeHead(500); res.end("unexpected"); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, url: `http://127.0.0.1:${server.address().port}` };
}
const request = (url, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, options, (res) => {
    const chunks = []; res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  req.on("error", reject); req.end();
});
const metadataPath = "/api/local-reference/isl-hello/metadata";

test("missing permitted reference reports unavailable without exposing filesystem paths", async (t) => {
  const app = await fixture(t), response = await request(app.url + metadataPath);
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).available, false);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.body.includes(app.root), false);
});
test("HEAD reports the same availability headers without sending a body", async (t) => {
  const app = await fixture(t), response = await request(app.url + metadataPath, { method: "HEAD" });
  assert.equal(response.status, 200); assert.equal(response.body, ""); assert.ok(Number(response.headers["content-length"]) > 0);
});
test("only fixed allowlisted paths without query strings are accepted", async (t) => {
  const app = await fixture(t);
  for (const route of [metadataPath + "?file=.env.local", metadataPath + "?", "/api/local-reference/isl-hello/other", "/api/local-reference/isl-hello/../baseline", "/api/local-reference/%2e%2e/.env.local"]) {
    const result = await request(app.url, { path: route }); assert.equal(result.status, 404, route); assert.equal(result.body.includes("GEMINI"), false);
  }
  assert.equal((await request(app.url + "/unrelated")).status, 418);
});
test("remote host and cross-origin requests cannot read local reference metadata", async (t) => {
  const app = await fixture(t);
  for (const headers of [{ host: "example.com" }, { origin: "https://example.com" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await request(app.url + metadataPath, { headers })).status, 403);
  }
});
test("non-loopback socket is rejected before inspecting local files", async () => {
  const headers = new Map(); let status, body;
  const res = { setHeader: (key, value) => headers.set(key, value), writeHead: (code) => { status = code; }, end: (value) => { body = value; } };
  await createLocalReferenceMiddleware()({ url: metadataPath, method: "GET", socket: { remoteAddress: "192.168.1.3" }, headers: { host: "localhost:5174" } }, res, () => assert.fail("not a passthrough"));
  assert.equal(status, 403); assert.match(body, /only on this laptop/);
});
test("mutating methods are rejected with Allow header", async (t) => {
  const app = await fixture(t), result = await request(app.url + metadataPath, { method: "POST" });
  assert.equal(result.status, 405); assert.equal(result.headers.allow, "GET, HEAD");
});
test("unverified byte content cannot be served as the permitted clip", async (t) => {
  const app = await fixture(t), directory = path.join(app.root, ".training-data", "replay");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "isl-hello-validation-MVI_9917.MOV"), Buffer.alloc(10892712));
  assert.equal(JSON.parse((await request(app.url + metadataPath)).body).available, false);
  for (const kind of ["video", "baseline"]) assert.equal((await request(app.url + "/api/local-reference/isl-hello/" + kind)).status, 404);
});
test("single byte ranges allow bounded, open-ended and suffix selection", () => {
  assert.deepEqual(parseLocalReferenceRange("bytes=0-3", 10), { start: 0, end: 3 });
  assert.deepEqual(parseLocalReferenceRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseLocalReferenceRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseLocalReferenceRange("bytes=0-99", 10), { start: 0, end: 9 });
  assert.deepEqual(parseLocalReferenceRange("bytes=-100", 10), { start: 0, end: 9 });
});
test("invalid, multipart and out-of-file ranges are rejected", () => {
  for (const value of ["bytes=-", "bytes=-0", "bytes=10-", "bytes=6-3", "bytes=0-1,3-4", "items=0-1", "bytes=0-1 ", "bytes=0-999999999999999999999", "bytes=999999999999999999999-"]) assert.equal(parseLocalReferenceRange(value, 10), null, value);
  assert.equal(parseLocalReferenceRange("bytes=0-1", 0), null);
});
test("plugin is development-server only and absent from public-demo mode", () => {
  assert.equal(localReferencePlugin("public-demo"), null);
  const plugin = localReferencePlugin("development");
  assert.equal(plugin.apply, "serve"); assert.equal(plugin.configurePreviewServer, undefined);
  const registered = []; plugin.configureServer({ config: { root: process.cwd() }, middlewares: { use: (handler) => registered.push(handler) } });
  assert.equal(registered.length, 1);
});
