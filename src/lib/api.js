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
  const data = await res.json();
  return { meaning: String(data.meaning || ""), reply: String(data.reply || "") };
}

/** Voice mode: yields text pieces as the AI writes them. */
export async function* streamVoice({ lang, messages, image, signal }) {
  const res = await post({ mode: "voice", lang, messages, image: image || undefined }, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
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
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "delta" && event.text) yield event.text;
        else if (event.type === "error") throw new ApiError(event.message || "The AI stream failed.", { code: "stream" });
      }
    }
    finished = true;
  } finally {
    if (!finished) reader.cancel().catch(() => {});
  }
}
