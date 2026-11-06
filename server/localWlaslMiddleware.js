import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";

const PREFIX = "/api/local-wlasl/";
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 120_000;
const PRIVATE_DIRECTORY = ".training-data/wlasl-requests";

class BridgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const loopback = (address = "") => address === "::1" || (isIP(address.replace(/^::ffff:/i, "")) === 4 && address.replace(/^::ffff:/i, "").startsWith("127."));
const json = (res, status, value, req = null) => {
  if (res.destroyed || res.writableEnded) return;
  if (status >= 400 && req && !req.readableEnded) req.resume?.();
  const body = JSON.stringify(value);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...(status >= 400 ? { connection: "close" } : {}),
  };
  res.writeHead(status, headers);
  res.end(body);
};
const privacyHeaders = (res) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("referrer-policy", "no-referrer");
};

function localRequest(req) {
  const host = req.headers.host;
  if (!loopback(req.socket?.remoteAddress) || typeof host !== "string" || !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i.test(host)) return false;
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.hostname.toLowerCase() !== "localhost" && !loopback(parsed.hostname.replace(/^\[|\]$/g, ""))) return false;
  } catch { return false; }
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return !req.headers.origin || req.headers.origin === `${req.socket?.encrypted ? "https" : "http"}://${host}`;
}

// Deny direct Vite /@fs and project-relative access, including encoded URLs.
function privateRequest(url, directory) {
  let decoded = url || "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { break; }
  }
  const normalized = decoded.replaceAll("\\", "/").toLowerCase();
  return normalized.includes(PRIVATE_DIRECTORY) || normalized.includes(directory.replaceAll("\\", "/").toLowerCase());
}

/** Fixed executable and arguments; the only file argument is created by this bridge. */
export function runLocalWlasl({ root, scriptPath, videoPath, signal, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new BridgeError("aborted"));
    const executable = path.join(root, ".venv", "Scripts", "python.exe");
    const args = ["-u", scriptPath, "--root", root, ...(videoPath ? ["--video", videoPath] : ["--status"])];
    let child;
    try {
      child = spawnProcess(executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch { return reject(new BridgeError("unavailable")); }
    let outputSize = 0;
    const chunks = [];
    let failure;
    const stop = (reason) => {
      failure ||= reason;
      // This handle belongs only to the Python process started above.
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const abort = () => stop(signal.reason || new BridgeError("aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      outputSize += chunk.length;
      if (outputSize > MAX_OUTPUT_BYTES) return stop(new BridgeError("output"));
      if (!failure) chunks.push(chunk);
    });
    child.once("error", () => { failure ||= new BridgeError("unavailable"); });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new BridgeError("inference"));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new BridgeError("output")); }
    });
    if (signal?.aborted) abort();
  });
}

const label = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9 '()_.-]{0,79}$/i.test(value);
const modelName = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9 ._()+\u00b7-]{0,119}$/i.test(value);
const boundedNumber = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit;

function statusResponse(value) {
  if (typeof value?.available !== "boolean") throw new BridgeError("output");
  if (!value.available) return { available: false, signLanguage: "asl", engine: "wlasl-i3d", labels: [], calibrated: false, error: "The local WLASL model is unavailable on this laptop." };
  if (value.signLanguage !== "asl" || value.engine !== "wlasl-i3d" || value.calibrated !== false || !modelName(value.modelName) || !Array.isArray(value.labels) || !value.labels.length || value.labels.length > 2000 || !value.labels.every(label)) throw new BridgeError("output");
  return { available: true, signLanguage: "asl", engine: "wlasl-i3d", labels: value.labels, modelName: value.modelName, calibrated: false };
}

function predictionResponse(value, metadata) {
  if (value?.status !== "review" || value.calibrated !== false || !Array.isArray(value.candidates) || !value.candidates.length || value.candidates.length > 10 || !modelName(value.modelName) || !Number.isSafeInteger(value.frames) || value.frames < 1 || value.frames > 100_000 || !boundedNumber(value.durationMs, 86_400_000) || !boundedNumber(value.elapsedMs, 86_400_000)) throw new BridgeError("output");
  const vocabulary = new Set(metadata.labels);
  const candidates = value.candidates.map((candidate) => {
    if (!label(candidate?.label) || !vocabulary.has(candidate.label) || !boundedNumber(candidate.score, 1)) throw new BridgeError("output");
    return { label: candidate.label, score: candidate.score };
  });
  if (!candidates.some((candidate) => candidate.label === value.suggestion)) throw new BridgeError("output");
  return { status: "review", candidates, suggestion: value.suggestion, frames: value.frames, durationMs: value.durationMs, modelName: value.modelName, calibrated: false, elapsedMs: value.elapsedMs };
}

function readVideo(req, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      req.off("data", data); req.off("end", end); req.off("error", error);
      signal.removeEventListener("abort", abort);
    };
    const fail = (reason) => { cleanup(); req.resume(); reject(reason); };
    const abort = () => fail(signal.reason || new BridgeError("aborted"));
    const error = () => fail(new BridgeError("aborted"));
    const data = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return fail(new BridgeError("too-large"));
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      if (!size) return reject(new BridgeError("empty"));
      resolve(Buffer.concat(chunks, size));
    };
    req.on("data", data); req.once("end", end); req.once("error", error);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Local development only. Dependencies are injectable so tests need no model or Python. */
export function createLocalWlaslMiddleware({
  root = process.cwd(),
  wlaslRoot = process.env.SIGNBRIDGE_WLASL_ROOT || path.join(os.homedir(), "Projects", "WLASL"),
  tempDir = path.resolve(root, PRIVATE_DIRECTORY),
  runner = runLocalWlasl,
  timeoutMs = TIMEOUT_MS,
  maxVideoBytes = MAX_VIDEO_BYTES,
} = {}) {
  const directory = path.resolve(tempDir);
  const scriptPath = path.resolve(root, "scripts", "wlasl_infer.py");
  let predicting = false;
  return async (req, res, next) => {
    if (privateRequest(req.url, directory)) { privacyHeaders(res); return json(res, 404, { error: "Not found." }, req); }
    if (!req.url?.startsWith(PREFIX)) return next();
    privacyHeaders(res);
    if (!localRequest(req)) return json(res, 403, { error: "Local WLASL is available only from the app on this laptop." }, req);
    const isStatus = req.url === `${PREFIX}status`;
    const isPrediction = req.url === `${PREFIX}predict`;
    if (!isStatus && !isPrediction) return json(res, 404, { error: "Local WLASL endpoint not found." }, req);
    const method = isStatus ? "GET" : "POST";
    if (req.method !== method) { res.setHeader("allow", method); return json(res, 405, { error: `Use ${method}.` }, req); }
    if (isPrediction) {
      if (req.headers["x-signbridge-local"] !== "1") return json(res, 403, { error: "Open this request from the local SignBridge app." }, req);
      if (typeof req.headers["content-type"] !== "string" || !/^video\/[a-z0-9][a-z0-9.+-]*(?:\s*;[^\r\n]*)?$/i.test(req.headers["content-type"])) return json(res, 415, { error: "Send a video clip." }, req);
      const length = req.headers["content-length"];
      if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxVideoBytes)) return json(res, 413, { error: "Video clips must be no larger than 40 MiB." }, req);
      if (predicting) return json(res, 409, { error: "A local prediction is already running. Please wait." }, req);
      predicting = true;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(new BridgeError("aborted"));
    const closed = () => { if (!res.writableEnded) abort(); };
    req.once("aborted", abort); req.once("error", abort); res.once("close", closed);
    const timer = setTimeout(() => controller.abort(new BridgeError("timeout")), timeoutMs);
    timer.unref?.();
    let videoPath;
    try {
      let bytes;
      if (isPrediction) bytes = await readVideo(req, controller.signal, maxVideoBytes);
      const metadata = statusResponse(await runner({ root: wlaslRoot, scriptPath, signal: controller.signal }));
      if (isStatus) return json(res, metadata.available ? 200 : 503, metadata);
      if (!metadata.available) throw new BridgeError("unavailable");
      if (controller.signal.aborted) throw controller.signal.reason;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      videoPath = path.join(directory, `${randomUUID()}.mp4`);
      await writeFile(videoPath, bytes, { flag: "wx", mode: 0o600, signal: controller.signal });
      bytes = undefined;
      const result = await runner({ root: wlaslRoot, scriptPath, videoPath, signal: controller.signal });
      return json(res, 200, predictionResponse(result, metadata));
    } catch (error) {
      const code = controller.signal.aborted ? controller.signal.reason?.code : error.code;
      const failures = {
        "too-large": [413, "Video clips must be no larger than 40 MiB."],
        empty: [400, "Send a nonempty video clip."],
        timeout: [504, "Local WLASL took too long. Try a shorter clip."],
        aborted: [499, "Local prediction was cancelled."],
        output: [502, "Local WLASL returned an invalid response."],
        inference: [422, "Local WLASL could not read or classify this clip."],
      };
      const [status, message] = failures[code] || [503, "The local WLASL model is unavailable on this laptop."];
      return json(res, status, { available: false, error: message });
    } finally {
      clearTimeout(timer);
      req.off("aborted", abort); req.off("error", abort); res.off("close", closed);
      if (videoPath) await unlink(videoPath).catch(() => {});
      if (isPrediction) predicting = false;
    }
  };
}

export function localWlaslPlugin(mode) {
  if (mode === "public-demo") return null;
  return {
    name: "signbridge-local-wlasl", apply: "serve",
    config() { return { server: { fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", `**/${PRIVATE_DIRECTORY}/**`] } } }; },
    configureServer(server) { server.middlewares.use(createLocalWlaslMiddleware({ root: server.config.root })); },
  };
}
