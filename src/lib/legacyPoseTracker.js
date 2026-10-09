// Local diagnostic experiment only. This does not replace the Tasks camera
// tracker or establish equality with the older Python training extractor.
export const LEGACY_POSE_TRACKER_VERSION = "0.5.1675471629";
export const LEGACY_POSE_TRACKER_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@${LEGACY_POSE_TRACKER_VERSION}/`;
export const LEGACY_POSE_TRACKER_OPTIONS = Object.freeze({ modelComplexity: 2, smoothLandmarks: true,
  enableSegmentation: false, refineFaceLandmarks: false, minDetectionConfidence: .5,
  minTrackingConfidence: .5, selfieMode: false });
const SCRIPT_TIMEOUT_MS = 30000;
let loadedConstructor = null, scriptRequest = null;

const error = (code, message) => Object.assign(new Error(message), { code });
const aborted = () => Object.assign(error("cancelled", "The experimental tracker was cancelled."), { name: "AbortError" });
const timeout = (value, fallback) => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60000) throw error("timeout-option", "Tracker timeouts must be between 1 and 60000 milliseconds.");
  return limit;
};

function waitWithSignal(promise, signal) {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => { clean(); reject(aborted()); };
    const clean = () => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    Promise.resolve(promise).then((value) => { clean(); resolve(value); }, (reason) => { clean(); reject(reason); });
  });
}

function requestScript() {
  const script = document.createElement("script");
  const request = { users: 0, pending: true, script, promise: null, cancel: null };
  request.promise = new Promise((resolve, reject) => {
    let timer;
    const finish = (reason) => {
      if (!request.pending) return;
      request.pending = false; clearTimeout(timer);
      script.onload = null; script.onerror = null; script.remove();
      if (scriptRequest === request) scriptRequest = null;
      if (reason) reject(reason);
      else if (typeof globalThis.Holistic !== "function") reject(error("script-api", "The experimental Holistic runtime did not expose its expected API."));
      else { loadedConstructor = globalThis.Holistic; resolve(loadedConstructor); }
    };
    request.cancel = () => finish(aborted());
    script.async = true; script.crossOrigin = "anonymous";
    script.src = `${LEGACY_POSE_TRACKER_BASE_URL}holistic.js`;
    script.onload = () => finish();
    script.onerror = () => finish(error("script-load", "The experimental Holistic runtime could not load. Retry when the network is available."));
    timer = setTimeout(() => finish(error("script-timeout", "The experimental Holistic runtime download timed out.")), SCRIPT_TIMEOUT_MS);
    try { document.head.appendChild(script); }
    catch { finish(error("script-load", "The experimental Holistic runtime could not be added to this page.")); }
  });
  return request;
}

async function loadConstructor(signal) {
  if (signal.aborted) throw aborted();
  if (loadedConstructor) return loadedConstructor;
  if (typeof document === "undefined") throw error("browser", "The experimental tracker requires a browser.");
  const request = scriptRequest ?? (scriptRequest = requestScript());
  request.users++;
  try { return await waitWithSignal(request.promise, signal); }
  finally {
    request.users--;
    if (request.pending && !request.users) request.cancel();
    else if (!request.pending && scriptRequest === request) scriptRequest = null;
  }
}

const landmarks = (points) => Array.isArray(points) ? points.map((point) => {
  const copy = {};
  for (const key of ["x", "y", "z", "visibility", "presence"]) if (typeof point?.[key] === "number") copy[key] = point[key];
  return copy;
}) : [];
const poseResult = (result) => ({ poseLandmarks: landmarks(result?.poseLandmarks),
  leftHandLandmarks: landmarks(result?.leftHandLandmarks), rightHandLandmarks: landmarks(result?.rightHandLandmarks) });

/** Explicitly create a pinned Solutions instance; every failure requires a fresh instance. */
export async function createLegacyPoseTracker({ signal, initializationTimeoutMs, frameTimeoutMs } = {}) {
  if (import.meta.env?.MODE === "public-demo") throw error("public-demo", "The legacy Holistic experiment is unavailable in the public demo.");
  const initializationLimit = timeout(initializationTimeoutMs, 60000), frameLimit = timeout(frameTimeoutMs, 15000);
  if (signal?.aborted) throw aborted();
  const initialization = new AbortController();
  let initializationExpired = false, instance = null, closed = false, pending = null, lastAtMs = -Infinity, closePromise = null;
  const close = () => {
    if (closed) return closePromise ?? Promise.resolve();
    closed = true;
    signal?.removeEventListener("abort", cancel);
    if (pending) { clearTimeout(pending.timer); pending.reject(aborted()); pending = null; }
    // Catch both synchronous and asynchronous SDK close errors. Hook cleanup
    // may intentionally fire-and-forget this idempotent operation.
    try { closePromise = Promise.resolve(instance?.close()).catch(() => {}); }
    catch { closePromise = Promise.resolve(); }
    return closePromise;
  };
  const cancel = () => { initialization.abort(); close(); };
  signal?.addEventListener("abort", cancel, { once: true });
  const initializationTimer = setTimeout(() => { initializationExpired = true; initialization.abort(); }, initializationLimit);
  try {
    const Holistic = await loadConstructor(initialization.signal);
    if (initialization.signal.aborted || closed) throw aborted();
    instance = new Holistic({ locateFile: (file) => `${LEGACY_POSE_TRACKER_BASE_URL}${file}` });
    const settle = () => {
      const current = pending;
      if (!current || !current.sent || !current.received || closed) return;
      pending = null; clearTimeout(current.timer); current.resolve(current.result);
    };
    instance.onResults((result) => {
      if (!pending || closed || pending.received) return;
      pending.result = poseResult(result); pending.received = true; settle();
    });
    instance.setOptions({ ...LEGACY_POSE_TRACKER_OPTIONS });
    await waitWithSignal(instance.initialize(), initialization.signal);
    if (closed || initialization.signal.aborted) throw aborted();
    return {
      backend: "solutions-holistic-experiment", version: LEGACY_POSE_TRACKER_VERSION,
      detectForVideo(video, atMs) {
        if (closed) return Promise.reject(error("closed", "The experimental tracker is closed. Create a new instance to retry."));
        if (pending) return Promise.reject(error("frame-pending", "Wait for the current experimental tracking frame to finish."));
        if (!video || typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0 || atMs <= lastAtMs) return Promise.reject(error("timestamp", "Experimental video frames need increasing finite timestamps."));
        lastAtMs = atMs;
        return new Promise((resolve, reject) => {
          const current = { resolve, reject, sent: false, received: false, result: null, timer: null };
          pending = current;
          current.timer = setTimeout(() => {
            if (pending !== current) return;
            pending = null; reject(error("frame-timeout", "An experimental tracking frame timed out. Create a new tracker to retry.")); close();
          }, frameLimit);
          // Solutions send() does not expose Tasks' timestamp parameter. atMs
          // only orders this adapter's requests; it cannot assert Python parity.
          Promise.resolve().then(() => {
            if (pending !== current || closed) return;
            return instance.send({ image: video });
          }).then(() => {
            if (pending !== current || closed) return;
            current.sent = true; settle();
          }, () => {
            if (pending !== current || closed) return;
            pending = null; clearTimeout(current.timer);
            reject(error("frame-send", "The experimental tracker could not process this frame. Create a new tracker to retry.")); close();
          });
        });
      },
      close,
    };
  } catch (reason) {
    close();
    if (initializationExpired) throw error("initialization-timeout", "The experimental Holistic tracker initialization timed out.");
    throw reason;
  } finally { clearTimeout(initializationTimer); }
}

/** Match the existing replay loader contract, including cancellable late setup. */
export async function loadLegacyPoseTracker(isCancelled = () => false) {
  const cancelled = () => { try { return Boolean(isCancelled()); } catch { return true; } };
  if (cancelled()) return null;
  const controller = new AbortController();
  const timer = setInterval(() => { if (cancelled()) controller.abort(); }, 50);
  try {
    const tracker = await createLegacyPoseTracker({ signal: controller.signal });
    if (cancelled()) { tracker.close(); return null; }
    return tracker;
  } catch (reason) {
    if (controller.signal.aborted && cancelled()) return null;
    throw reason;
  } finally { clearInterval(timer); }
}
