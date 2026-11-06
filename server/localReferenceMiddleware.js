import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";

const PREFIX = "/api/local-reference/";
const BASE = `${PREFIX}isl-hello`;
const VIDEO_NAME = "isl-hello-validation-MVI_9917.MOV";
const BASELINE_NAME = "isl-hello-validation-MVI_9917.camera-v2.baseline.json";
const VIDEO_HASH = "61a50323776fe04f732aba8668a1ea8fac09c17d387af26c78a94412f003e7ff";

const loopback = (address = "") => address === "::1" || (isIP(address.replace(/^::ffff:/, "")) === 4 && address.replace(/^::ffff:/, "").startsWith("127."));
const json = (res, status, value, head = false) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(head ? undefined : body);
};

/** Single HTTP byte range only; null means unsatisfiable or malformed. */
export function parseLocalReferenceRange(range, size) {
  if (!Number.isSafeInteger(size) || size < 1 || typeof range !== "string") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  let start = 0, end = size - 1;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    start = Math.max(0, size - suffix);
  } else {
    start = Number(match[1]);
    if (match[2]) {
      const requestedEnd = Number(match[2]);
      if (!Number.isSafeInteger(requestedEnd)) return null;
      end = Math.min(requestedEnd, end);
    }
  }
  return Number.isSafeInteger(start) && start <= end && start < size ? { start, end } : null;
}

/** Exactly one local, hash-checked reference. Never mount this on a public server. */
export function createLocalReferenceMiddleware({ root = process.cwd() } = {}) {
  const directory = path.resolve(root, ".training-data", "replay");
  const videoPath = path.join(directory, VIDEO_NAME);
  const baselinePath = path.join(directory, BASELINE_NAME);
  let cached;
  const checkVideo = async () => {
    const [resolvedDirectory, resolvedVideo, info] = await Promise.all([realpath(directory), realpath(videoPath), stat(videoPath)]);
    if (path.dirname(resolvedVideo) !== resolvedDirectory || !info.isFile() || info.size !== 10892712) throw new Error("unavailable");
    const identity = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (cached?.identity !== identity) {
      const digest = createHash("sha256").update(await readFile(resolvedVideo)).digest("hex");
      if (digest !== VIDEO_HASH) throw new Error("unavailable");
      cached = { identity };
    }
    return { resolvedVideo, size: info.size };
  };
  return async (req, res, next) => {
    if (!req.url?.startsWith(PREFIX)) return next();
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cross-origin-resource-policy", "same-origin");
    res.setHeader("referrer-policy", "no-referrer");
    const head = req.method === "HEAD";
    const host = req.headers.host || "";
    let hostname;
    try { hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, ""); } catch { /* Reject malformed host names. */ }
    if (!loopback(req.socket?.remoteAddress) || !(hostname === "localhost" || loopback(hostname)) || req.headers["sec-fetch-site"] === "cross-site") return json(res, 403, { error: "Local reference is available only on this laptop." }, head);
    if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return json(res, 403, { error: "Open this reference from the local SignBridge app." }, head);
    if (!["GET", "HEAD"].includes(req.method)) { res.setHeader("allow", "GET, HEAD"); return json(res, 405, { error: "Use GET or HEAD." }); }
    if (![`${BASE}/metadata`, `${BASE}/video`, `${BASE}/baseline`].includes(req.url)) return json(res, 404, { error: "Local reference not found." }, head);
    let video;
    try { video = await checkVideo(); } catch {
      return json(res, req.url === `${BASE}/metadata` ? 200 : 404, { available: false, error: "The permitted HELLO reference is not available on this laptop." }, head);
    }
    if (req.url === `${BASE}/metadata`) return json(res, 200, {
      available: true, signLanguage: "isl", label: "HELLO", source: "INCLUDE validation reference",
      videoUrl: `${BASE}/video`, baselineUrl: `${BASE}/baseline`, videoSha256: VIDEO_HASH,
      attribution: "Sridhar, Ganesan, Kumar and Khapra · INCLUDE (2020)", license: "CC BY 4.0",
      sourceUrl: "https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md",
      durationSeconds: 1.96,
    }, head);
    if (req.url === `${BASE}/baseline`) {
      try {
        const [resolvedDirectory, resolvedBaseline, info] = await Promise.all([realpath(directory), realpath(baselinePath), stat(baselinePath)]);
        if (path.dirname(resolvedBaseline) !== resolvedDirectory || !info.isFile() || info.size > 16384) throw new Error("unavailable");
        const value = JSON.parse(await readFile(resolvedBaseline, "utf8"));
        if (value.format !== "signbridge-recognition-baseline-v1" || value.signLanguage !== "isl" || value.expectedLabel !== "HELLO" || value.videoSha256 !== VIDEO_HASH || !/^[a-f0-9]{64}$/.test(value.modelSha256) || !["recognized", "unclear", "no_sign"].includes(value.prediction?.status) || typeof value.prediction?.topLabel !== "string" || value.prediction.topLabel.length > 80 || !Number.isFinite(value.prediction.topScore) || value.prediction.topScore < 0 || value.prediction.topScore > 1) throw new Error("unavailable");
        return json(res, 200, { format: value.format, signLanguage: value.signLanguage, expectedLabel: value.expectedLabel,
          modelSha256: value.modelSha256, videoSha256: value.videoSha256,
          prediction: { status: value.prediction.status, topLabel: value.prediction.topLabel, topScore: value.prediction.topScore } }, head);
      } catch { return json(res, 404, { error: "The matching local reference baseline is unavailable." }, head); }
    }
    const range = req.headers.range;
    let start = 0, end = video.size - 1;
    if (range) {
      const selected = parseLocalReferenceRange(range, video.size);
      if (!selected) { res.setHeader("content-range", `bytes */${video.size}`); return json(res, 416, { error: "Requested byte range is unavailable." }, head); }
      ({ start, end } = selected);
      res.setHeader("content-range", `bytes ${start}-${end}/${video.size}`);
    }
    res.writeHead(range ? 206 : 200, { "content-type": "video/quicktime", "accept-ranges": "bytes", "content-length": end - start + 1 });
    if (head) return res.end();
    const stream = createReadStream(video.resolvedVideo, { start, end });
    res.once("close", () => stream.destroy());
    stream.once("error", () => { if (!res.destroyed) res.destroy(); });
    stream.pipe(res);
  };
}

export function localReferencePlugin(mode) {
  if (mode === "public-demo") return null;
  return {
    name: "signbridge-local-reference", apply: "serve",
    configureServer(server) { server.middlewares.use(createLocalReferenceMiddleware({ root: server.config.root })); },
  };
}
