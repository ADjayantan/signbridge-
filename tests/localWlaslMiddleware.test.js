import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLocalWlaslMiddleware, localWlaslPlugin, runLocalWlasl } from "../server/localWlaslMiddleware.js";

const statusPath = "/api/local-wlasl/status";
const predictPath = "/api/local-wlasl/predict";
const metadata = { available: true, signLanguage: "asl", engine: "wlasl-i3d", labels: ["book", "drink"], modelName: "WLASL I3D 100", calibrated: false };
const prediction = { status: "review", candidates: [{ label: "book", score: 0.82 }, { label: "drink", score: 0.18 }], suggestion: "book", frames: 64, durationMs: 2_000, modelName: metadata.modelName, calibrated: false, elapsedMs: 50 };
const localHeaders = { "content-type": "video/mp4", "x-signbridge-local": "1" };
const request = (url, { body, ...options } = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, options, (res) => {
    const chunks = []; res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  req.on("error", reject); req.end(body);
});
const post = (url, body = "private video bytes", headers = {}) => request(url + predictPath, { method: "POST", headers: { ...localHeaders, ...headers }, body });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check) {
  for (let count = 0; count < 80; count += 1) {
    if (await check()) return;
    await delay(10);
  }
  assert.fail("Expected cleanup did not finish.");
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "signbridge-wlasl-test-"));
  const tempDir = path.join(root, ".training-data", "wlasl-requests");
  const runner = options.runner || (async ({ videoPath }) => videoPath ? prediction : metadata);
  const handler = createLocalWlaslMiddleware({ root, tempDir, wlaslRoot: path.join(root, "private-model"), runner, ...options });
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, () => { res.writeHead(418); res.end("next"); })).catch(() => { if (!res.headersSent) res.writeHead(500); res.end("unexpected"); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, tempDir, url: `http://127.0.0.1:${server.address().port}` };
}
const files = async (directory) => readdir(directory).catch((error) => { if (error.code === "ENOENT") return []; throw error; });

test("status exposes only bounded ASL model metadata with private response headers", async (t) => {
  const app = await fixture(t, { runner: async () => ({ ...metadata, checkpoint: "C:/private/model.pth", token: "secret" }) });
  const result = await request(app.url + statusPath);
  assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body), metadata);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(result.headers["access-control-allow-origin"], undefined);
  assert.equal(result.body.includes("private"), false); assert.equal(result.body.includes("secret"), false);
});

test("missing model reports 503 without exposing model or executable paths", async (t) => {
  let predictions = 0;
  const app = await fixture(t, { runner: async ({ videoPath }) => { if (videoPath) predictions += 1; return { available: false, error: "C:/private/missing-checkpoint.pth" }; } });
  for (const result of [await request(app.url + statusPath), await post(app.url)]) {
    assert.equal(result.status, 503); assert.equal(JSON.parse(result.body).available, false);
    assert.equal(result.body.includes("C:/"), false); assert.equal(result.body.includes(app.root), false);
  }
  assert.equal(predictions, 0); assert.deepEqual(await files(app.tempDir), []);
});

test("local origin, host, fetch metadata and explicit POST authorization are required", async (t) => {
  let calls = 0;
  const app = await fixture(t, { runner: async () => { calls += 1; return metadata; } });
  for (const headers of [{ host: "example.com" }, { host: "example.com@localhost" }, { origin: "https://example.com" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
    assert.equal((await request(app.url + statusPath, { headers })).status, 403);
    assert.equal((await post(app.url, "video", headers)).status, 403);
  }
  assert.equal((await request(app.url + predictPath, { method: "POST", headers: { "content-type": "video/mp4" }, body: "video" })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await request(app.url + statusPath, { headers: { origin: app.url, "sec-fetch-site": "same-origin" } })).status, 200);
});

test("non-loopback peers are rejected before running local code", async () => {
  let code, response;
  const res = { setHeader() {}, writeHead(value) { code = value; }, end(value) { response = value; } };
  await createLocalWlaslMiddleware({ runner: () => assert.fail("must not run") })({ url: statusPath, method: "GET", socket: { remoteAddress: "192.168.1.3" }, headers: { host: "localhost:5173" } }, res, () => assert.fail("must not pass through"));
  assert.equal(code, 403); assert.match(response, /only from the app/);
});

test("fixed routes and methods reject user-controlled file arguments and raw video reads", async (t) => {
  const app = await fixture(t);
  for (const route of [statusPath + "?root=C:/secret", predictPath + "?video=secret.mp4", "/api/local-wlasl/video", "/api/local-wlasl/../secret", "/.training-data/wlasl-requests/private.mp4", "/.training-data%2fwlasl-requests/private.mp4", "/@fs/" + app.tempDir.replaceAll("\\", "/") + "/private.mp4"]) {
    assert.equal((await request(app.url, { path: route })).status, 404, route);
  }
  assert.equal((await request(app.url + "/unrelated")).status, 418);
  const invalidGet = await request(app.url + predictPath);
  assert.equal(invalidGet.status, 405); assert.equal(invalidGet.headers.allow, "POST");
  const invalidPost = await request(app.url + statusPath, { method: "POST" });
  assert.equal(invalidPost.status, 405); assert.equal(invalidPost.headers.allow, "GET");
});

test("video content type, declared size, streamed size and empty bodies are bounded", async (t) => {
  let calls = 0;
  const app = await fixture(t, { maxVideoBytes: 8, runner: async () => { calls += 1; return metadata; } });
  assert.equal((await post(app.url, "data", { "content-type": "application/json" })).status, 415);
  assert.equal((await post(app.url, "", { "content-length": String(40 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await post(app.url, "more than eight bytes", { "transfer-encoding": "chunked" })).status, 413);
  assert.equal((await post(app.url, "")).status, 400);
  assert.equal(calls, 0); assert.deepEqual(await files(app.tempDir), []);
});

test("prediction uses only a random private temporary path, returns review candidates, and deletes input", async (t) => {
  let inputPath;
  const app = await fixture(t, { runner: async ({ videoPath, root, scriptPath }) => {
    assert.equal(root, path.join(app.root, "private-model"));
    assert.equal(scriptPath, path.join(app.root, "scripts", "wlasl_infer.py"));
    if (!videoPath) return metadata;
    inputPath = videoPath;
    assert.equal(path.dirname(videoPath), app.tempDir);
    assert.match(path.basename(videoPath), /^[a-f0-9-]{36}\.mp4$/);
    assert.equal(await readFile(videoPath, "utf8"), "private video bytes");
    const exposed = await request(app.url, { path: "/@fs/" + videoPath.replaceAll("\\", "/") });
    assert.equal(exposed.status, 404); assert.equal(exposed.body.includes("private video bytes"), false);
    return { ...prediction, videoPath, raw: "private video bytes" };
  } });
  const result = await post(app.url);
  assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.body), prediction);
  assert.equal(result.body.includes(inputPath), false);
  await eventually(async () => (await files(app.tempDir)).length === 0);
});

test("malformed or path-bearing metadata and predictions never reach the browser", async (t) => {
  const app = await fixture(t, { runner: async ({ videoPath }) => videoPath ? { ...prediction, suggestion: "C:/private/input.mp4" } : metadata });
  const result = await post(app.url);
  assert.equal(result.status, 502); assert.equal(result.body.includes("private"), false);
  await eventually(async () => (await files(app.tempDir)).length === 0);
  const statusApp = await fixture(t, { runner: async () => ({ ...metadata, modelName: "C:/private/model.pth" }) });
  assert.equal((await request(statusApp.url + statusPath)).status, 502);
});

test("one prediction runs at a time, while status remains available", async (t) => {
  let release, started;
  const running = new Promise((resolve) => { started = resolve; });
  const app = await fixture(t, { runner: async ({ videoPath }) => {
    if (!videoPath) return metadata;
    started(); await new Promise((resolve) => { release = resolve; }); return prediction;
  } });
  const first = post(app.url); await running;
  assert.equal((await post(app.url)).status, 409);
  assert.equal((await request(app.url + statusPath)).status, 200);
  release(); assert.equal((await first).status, 200);
});

test("timeout aborts the owned runner, removes input and releases the prediction slot", async (t) => {
  let aborted = false, attempts = 0;
  const app = await fixture(t, { timeoutMs: 60, runner: async ({ videoPath, signal }) => {
    if (!videoPath) return metadata;
    if (++attempts > 1) return prediction;
    await new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }));
  } });
  assert.equal((await post(app.url)).status, 504); assert.equal(aborted, true);
  await eventually(async () => (await files(app.tempDir)).length === 0);
  assert.equal((await post(app.url)).status, 200);
});

test("disconnected clients abort inference and delete the private clip", async (t) => {
  let started, aborted = false;
  const running = new Promise((resolve) => { started = resolve; });
  const app = await fixture(t, { runner: async ({ videoPath, signal }) => {
    if (!videoPath) return metadata;
    started(); return new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }));
  } });
  const client = http.request(app.url + predictPath, { method: "POST", headers: localHeaders });
  client.on("error", () => {}); client.end("private video bytes");
  await running; client.destroy();
  await eventually(async () => aborted && (await files(app.tempDir)).length === 0);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.exitCode = null; child.signalCode = null; child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit("close", null)); return true; };
  return child;
}

test("Python runner uses a fixed venv executable without a shell and parses one JSON response", async () => {
  const child = fakeChild();
  const result = runLocalWlasl({ root: "C:/private/WLASL", scriptPath: "F:/app/scripts/wlasl_infer.py", videoPath: "F:/app/private/random.mp4", spawnProcess: (executable, args, options) => {
    assert.equal(executable, path.join("C:/private/WLASL", ".venv", "Scripts", "python.exe"));
    assert.deepEqual(args, ["-u", "F:/app/scripts/wlasl_infer.py", "--root", "C:/private/WLASL", "--video", "F:/app/private/random.mp4"]);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
    return child;
  } });
  child.stdout.write(JSON.stringify(prediction)); child.emit("close", 0);
  assert.deepEqual(await result, prediction);
});

test("runner kills only its owned child on cancellation or stdout overflow", async () => {
  const cancelledChild = fakeChild(), controller = new AbortController();
  const cancelled = runLocalWlasl({ root: "local", scriptPath: "script.py", signal: controller.signal, spawnProcess: () => cancelledChild });
  const expectedAbort = assert.rejects(cancelled, /cancelled/);
  controller.abort(new Error("cancelled")); await expectedAbort;
  assert.deepEqual(cancelledChild.kills, ["SIGKILL"]);
  const oversizedChild = fakeChild();
  const oversized = runLocalWlasl({ root: "local", scriptPath: "script.py", spawnProcess: () => oversizedChild });
  const expectedOverflow = assert.rejects(oversized, /output/);
  oversizedChild.stdout.write(Buffer.alloc(1024 * 1024 + 1)); await expectedOverflow;
  assert.deepEqual(oversizedChild.kills, ["SIGKILL"]);
});

test("status and prediction accept the real wlasl_infer.py payload contract including middle-dot modelName", async (t) => {
  const realStatus = {
    available: true,
    signLanguage: "asl",
    engine: "wlasl-i3d",
    modelName: "Official WLASL100 I3D · local research",
    checkpointSha256: "a61d7dda5f875ce5ebd9d407c56874f77d1cd2aeb4bc7cd0d98a6e1ca4669a0c",
    calibrated: false,
    labels: ["ACCIDENT", "AFRICA", "ALL", "BOOK", "DRINK", "FAMILY", "PAPER", "READ", "SCHOOL"],
    preprocessing: { resize: 256, crop: 224, frames: 64, pixelRange: "[-1, 1]", channelOrder: "BGR_as_OpenCV_dataset_loader", pooling: "temporal_max" },
  };
  const realPrediction = {
    status: "review",
    signLanguage: "asl",
    engine: "wlasl-i3d",
    modelName: "Official WLASL100 I3D · local research",
    calibrated: false,
    suggestion: "BOOK",
    candidates: [
      { label: "BOOK", score: 0.902114 },
      { label: "READ", score: 0.015432 },
      { label: "PAPER", score: 0.008123 },
      { label: "SCHOOL", score: 0.006541 },
      { label: "FAMILY", score: 0.005988 },
    ],
    frames: 100,
    sampledFrames: 100,
    durationMs: 4000,
    elapsedMs: 412,
  };
  const app = await fixture(t, { runner: async ({ videoPath }) => (videoPath ? realPrediction : realStatus) });
  const statusRes = await request(app.url + statusPath);
  assert.equal(statusRes.status, 200);
  assert.deepEqual(JSON.parse(statusRes.body), {
    available: true,
    signLanguage: "asl",
    engine: "wlasl-i3d",
    labels: realStatus.labels,
    modelName: realStatus.modelName,
    calibrated: false,
  });
  const predictRes = await post(app.url);
  assert.equal(predictRes.status, 200);
  assert.deepEqual(JSON.parse(predictRes.body), {
    status: "review",
    candidates: realPrediction.candidates,
    suggestion: "BOOK",
    frames: 100,
    durationMs: 4000,
    modelName: realPrediction.modelName,
    calibrated: false,
    elapsedMs: 412,
  });
});

test("plugin exists only for dev serve, blocks private files, and is absent from public-demo", () => {
  assert.equal(localWlaslPlugin("public-demo"), null);
  const plugin = localWlaslPlugin("development");
  assert.equal(plugin.apply, "serve"); assert.equal(plugin.configurePreviewServer, undefined);
  assert.ok(plugin.config().server.fs.deny.includes("**/.training-data/wlasl-requests/**"));
  const registered = []; plugin.configureServer({ config: { root: process.cwd() }, middlewares: { use: (handler) => registered.push(handler) } });
  assert.equal(registered.length, 1);
});
