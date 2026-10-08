export const MAX_TURN_MS = 12_000;
export const MAX_TURN_BYTES = 2_000_000;

export async function inspectSignClip(blob) {
  if (!blob?.size || blob.size > MAX_TURN_BYTES || !/^video\/(mp4|webm)(;|$)/.test(blob.type)) throw new Error("Choose a nonempty MP4 or WebM under 2 MB and 12 seconds.");
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const clean = () => { clearTimeout(timer); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); };
    const fail = (message) => { video.onloadeddata = video.onerror = null; clean(); reject(new Error(message)); };
    const timer = setTimeout(() => fail("Couldn't read this video. Try a short MP4."), 10_000);
    video.muted = true; video.preload = "auto";
    video.onloadeddata = () => {
      if (!Number.isFinite(video.duration) || video.duration < .5 || video.duration > MAX_TURN_MS / 1000 || !video.videoWidth) { fail("Choose a playable sign clip between 0.5 and 12 seconds."); return; }
      const duration = video.duration;
      video.onloadeddata = video.onerror = null; clean(); resolve(duration);
    };
    video.onerror = () => fail("This video can't be decoded. Try a short MP4.");
    video.src = url;
  });
}

/** Records only video from an existing camera. Never owns or stops its tracks. */
export function recordSignTurn(stream, { onComplete, onError, onElapsed } = {}) {
  if (typeof MediaRecorder === "undefined") throw new Error("Video recording is unavailable. Use Chrome or Edge, or import a short MP4.");
  const tracks = stream?.getVideoTracks().filter((t) => t.readyState === "live");
  if (!tracks?.length) throw new Error("Wait for your camera to connect, then try again.");
  const videoOnly = new MediaStream(tracks);
  const mimeType = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot record MP4 or WebM. Import a short MP4 instead.");
  const recorder = new MediaRecorder(videoOnly, { mimeType, videoBitsPerSecond: 700_000 });
  const chunks = [];
  const startedAt = performance.now();
  let bytes = 0;
  let cancelled = false;
  let settled = false;
  let elapsed = 0;
  let timer;
  const clean = () => { clearInterval(timer); tracks.forEach((t) => t.removeEventListener("ended", lostCamera)); };
  const fail = (message) => {
    if (settled || cancelled) return;
    settled = true; cancelled = true; clean();
    if (recorder.state !== "inactive") { try { recorder.stop(); } catch { /* Already stopped. */ } }
    onError?.(message);
  };
  const lostCamera = () => fail("Camera disconnected. Reconnect it and record again.");
  const finish = () => {
    if (settled || cancelled || recorder.state === "inactive") return;
    elapsed = Math.min(MAX_TURN_MS, performance.now() - startedAt);
    clean(); recorder.stop();
  };
  recorder.ondataavailable = (event) => {
    if (cancelled || settled || !event.data?.size) return;
    bytes += event.data.size;
    if (bytes > MAX_TURN_BYTES) { fail("This clip is too large. Try a shorter signed message (under 2 MB)."); return; }
    chunks.push(event.data);
  };
  recorder.onerror = () => fail("Video recording failed. Reconnect the camera and try again.");
  recorder.onstop = () => {
    clean();
    if (cancelled || settled) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
    if (!blob.size || elapsed < 500) { fail("Sign for at least half a second, then finish your turn."); return; }
    settled = true;
    onComplete?.({ blob, duration: elapsed / 1000 });
  };
  tracks.forEach((t) => t.addEventListener("ended", lostCamera, { once: true }));
  try { recorder.start(250); }
  catch (error) { clean(); throw error; }
  timer = setInterval(() => {
    const ms = Math.min(MAX_TURN_MS, performance.now() - startedAt);
    onElapsed?.(ms);
    if (ms >= MAX_TURN_MS) finish();
  }, 100);
  return {
    finish,
    cancel() {
      cancelled = true; clean();
      if (recorder.state !== "inactive") { try { recorder.stop(); } catch { /* Already stopped. */ } }
    },
  };
}
