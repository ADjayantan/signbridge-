// Client for the SignBridge server (/api/chat). The browser never sees the Gemini key.
const ENDPOINT = "/api/chat";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function clientTime() {
  try {
    return new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" });
  } catch {
    return "";
  }
}

async function post(body, signal) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, clientTime: clientTime() }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("Can't reach the SignBridge server. Check your internet connection.", { code: "network" });
  }
  if (!res.ok) {
    let message = "";
    let code = "";
    try {
      const data = await res.json();
      message = data.error || "";
      code = data.code || "";
      if (res.status === 401 && code === "invalid-auth") message = "AI help on this server is available inside conversation rooms. Open Connect from Home. Local speech, recognition and saved videos still work.";
    } catch {
      // Not a JSON error body.
    }
    if (!message && (res.status === 404 || res.status === 405)) {
      message = "The AI server isn't running here. Use npm run dev locally, or deploy to Vercel.";
    }
    throw new ApiError(message || `Server error (${res.status}).`, { status: res.status, code });
  }
  return res;
}

/** Sign mode: one JSON answer → { meaning, reply }. */
export async function askSign({ lang, messages, signal }) {
  const res = await post({ mode: "sign", lang, messages }, signal);
  let data;
  try { data = await res.json(); } catch { throw new ApiError("The AI sent an unreadable reply. Try again.", { code: "bad_response" }); }
  if (!data || typeof data.reply !== "string" || !data.reply.trim() || (data.meaning != null && typeof data.meaning !== "string")) {
    throw new ApiError("The AI sent an empty or invalid reply. Try again.", { code: "bad_response" });
  }
  return { meaning: data.meaning || "", reply: data.reply };
}

export async function checkSignAI({ signal } = {}) {
  const response = await fetch(`${ENDPOINT}?status=1`, { signal, cache: "no-store" });
  if (!response.ok) throw new ApiError("Couldn't check the AI server.");
  const data = await response.json();
  if (typeof data?.configured !== "boolean") throw new ApiError("Couldn't check the AI server.");
  return data;
}

function videoDataURL(blob, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException("Cancelled", "AbortError")); };
    const clean = () => signal?.removeEventListener("abort", abort);
    reader.onload = () => { clean(); resolve(`data:${blob.type.split(";")[0]};base64,${String(reader.result).split(",")[1]}`); };
    reader.onerror = () => { clean(); reject(new ApiError("Couldn't read this video.")); };
    reader.onabort = clean;
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });
}

/** A tentative interpretation only; a reviewed text turn is sent separately. */
export async function interpretSignVideo({ blob, duration, signLanguage, lang, consent, signal }) {
  if (consent !== true) throw new ApiError("Allow this clip to be sent to Google Gemini first.", { code: "consent" });
  if (!(blob instanceof Blob) || !blob.size || blob.size > 2_000_000 || !/^video\/(mp4|webm)(;|$)/.test(blob.type)) throw new ApiError("Choose an MP4 or WebM sign clip under 2 MB.");
  const video = await videoDataURL(blob, signal);
  const res = await post({ mode: "sign-video", lang, signLanguage, video, duration, videoConsent: true, messages: [{ role: "user", text: "Interpret this signed turn. Return its tentative meaning, not an answer." }] }, signal);
  let data;
  try { data = await res.json(); } catch { throw new ApiError("The AI sent an unreadable sign interpretation."); }
  if (!data || !["recognized", "unclear", "no_sign"].includes(data.status) || typeof data.meaning !== "string" || typeof data.feedback !== "string" || !Array.isArray(data.glosses) || data.glosses.some((g) => typeof g !== "string") || (data.status === "recognized" && !data.meaning.trim())) throw new ApiError("The AI sent an invalid sign interpretation.", { code: "bad_response" });
  return { ...data, meaning: data.status === "recognized" ? data.meaning : "", glosses: data.status === "recognized" ? data.glosses : [] };
}

/** Voice mode: yields text pieces as the AI writes them. */
export async function* streamVoice({ lang, messages, image, signal }) {
  const res = await post({ mode: "voice", lang, messages, image: image || undefined }, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  let receivedDone = false;
  const parseEvent = (line) => {
    let event;
    try { event = JSON.parse(line); } catch { throw new ApiError("The AI sent an unreadable voice response. Try again.", { code: "bad_response" }); }
    if (event?.type === "done") receivedDone = true;
    else if (event?.type === "error") throw new ApiError(event.message || "The AI stream failed.", { code: "stream" });
    else if (event?.type === "delta" && typeof event.text === "string") return event.text;
    return "";
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const text = parseEvent(line);
        if (text) yield text;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const text = parseEvent(buffer.trim());
      if (text) yield text;
    }
    if (!receivedDone) throw new ApiError("The AI reply was interrupted before it finished. Try again.", { code: "incomplete_stream" });
    finished = true;
  } finally {
    if (!finished) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
