/**
 * SignBridge AI proxy: the only code that talks to Gemini.
 *
 * Runs on Vercel (api/chat.js) and inside the Vite dev/preview server (vite.config.js).
 * It uses Web-standard Request/Response, so the same code works in both places.
 * The Gemini API key stays on the server and never reaches the browser.
 *
 * POST /api/chat
 *   { mode: "voice" | "sign", lang, messages: [{ role: "user" | "assistant", text }], image?, clientTime? }
 *
 * voice → streams NDJSON lines: {"type":"delta","text":"..."} … {"type":"done"} (or {"type":"error"})
 * sign  → JSON: { meaning, reply }
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const UPSTREAM_TIMEOUT_MS = 30_000;

export const LANGUAGES = {
  en: "English",
  ta: "Tamil",
  hi: "Hindi",
  ml: "Malayalam",
  te: "Telugu",
  kn: "Kannada",
};

export const LIMITS = {
  maxMessages: 16,
  maxTextChars: 2000,
  maxImageChars: 1_500_000, // length of the base64 data URL (~1.1 MB image)
  maxBodyBytes: 2_000_000,
  maxClientTimeChars: 80,
};

const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

const SIGN_SCHEMA = {
  type: "OBJECT",
  properties: {
    meaning: { type: "STRING", description: "What the user most likely means, as one natural sentence." },
    reply: { type: "STRING", description: "The assistant's short reply to the user." },
  },
  required: ["meaning", "reply"],
  propertyOrdering: ["meaning", "reply"],
};

export function systemPrompt(mode, langName, { hasImage = false, clientTime = "" } = {}) {
  const time = clientTime
    ? `The user's local date and time right now: ${clientTime}.`
    : "You don't know the current date or time.";

  if (mode === "sign") {
    return [
      "You are SignBridge, an assistant for Deaf and hard-of-hearing people in India.",
      "The user talks to you in sign language. A camera recognizer turns each sign into a gloss: a word in CAPITALS, in sign-language word order, without small grammar words. The recognizer can add a wrong or repeated word.",
      "Each user message starts with \"Signed:\" (glosses from the recognizer) or \"Typed:\" (a sentence the user typed).",
      "",
      "Return JSON with two fields:",
      `- "meaning": what the user most likely means, as one natural sentence in ${langName}. For typed messages, copy their sentence, translated to ${langName} only if it is in another language.`,
      `- "reply": your answer in ${langName}. At most three short sentences with everyday words. Plain text, no markdown or emojis. Many Deaf readers use ${langName} as a second language, so keep it simple.`,
      "If the glosses don't make sense together, make the reply a short question that checks what they meant, offering one or two guesses.",
      "You cannot browse the internet or check live information such as news or weather.",
      time,
    ].join("\n");
  }

  const vision = hasImage
    ? [
        "- The user's camera is on. The attached photo is what it sees right now. Answer from it: say what matters most for their question first, then the key details. When reading text, read it exactly.",
        "- If the photo is blurry, dark, or doesn't show what they asked about, say so and tell them how to move the camera, for example \"move it a little to the left\" or \"hold it further away\".",
        "- Never tell the user that something is safe, such as crossing a road or taking a medicine. Describe what you see and suggest they confirm with someone they trust.",
      ]
    : [
        "- You can't see the user's surroundings. If they ask what is around them or to read something, tell them to turn on the camera with the C key and ask again.",
      ];

  return [
    "You are SignBridge, a friendly voice assistant for blind and low-vision people.",
    "Everything you write is read aloud by a speech synthesizer.",
    "",
    "Rules:",
    `- Reply in ${langName}, unless the user clearly speaks another language; then reply in theirs.`,
    "- Be brief and natural: one to three short sentences. Give more detail only when asked.",
    "- Write plain spoken sentences. No markdown, lists, headings, emojis, URLs, or symbols such as * or #.",
    "- Say numbers, times, money and units the way a person speaks them.",
    "- Don't mention the screen or anything visual in the app.",
    "- You cannot browse the internet or check live information such as news or weather. Say so if asked.",
    ...vision,
    time,
  ].join("\n");
}

function clip(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** Validates and normalizes the request body. Returns { value } or { error }. */
export function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const { mode } = body;
  if (mode !== "voice" && mode !== "sign") return { error: 'mode must be "voice" or "sign".' };
  const lang = Object.hasOwn(LANGUAGES, body.lang) ? body.lang : "en";

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { error: "messages must be a non-empty array." };
  }
  const messages = [];
  for (const m of body.messages.slice(-LIMITS.maxMessages)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) {
      return { error: 'Each message needs role "user" or "assistant".' };
    }
    if (typeof m.text !== "string") return { error: "Each message needs a text string." };
    const text = clip(m.text.trim(), LIMITS.maxTextChars);
    if (!text) continue;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === m.role) prev.text = clip(`${prev.text}\n${text}`, LIMITS.maxTextChars);
    else messages.push({ role: m.role, text });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { error: "The last message must be from the user." };
  }

  let image = null;
  if (body.image != null) {
    if (mode !== "voice") return { error: "Images are only supported in voice mode." };
    if (typeof body.image !== "string" || body.image.length > LIMITS.maxImageChars) {
      return { error: "The image is too large." };
    }
    const match = IMAGE_DATA_URL.exec(body.image);
    if (!match) return { error: "The image must be a base64 JPEG, PNG or WebP data URL." };
    image = { mimeType: match[1], data: match[2] };
  }

  const clientTime =
    typeof body.clientTime === "string" ? clip(body.clientTime.trim(), LIMITS.maxClientTimeChars) : "";

  return { value: { mode, lang, messages, image, clientTime } };
}

/** Builds the Gemini generateContent request body. */
export function buildGeminiRequest({ mode, lang, messages, image, clientTime }, { thinkingLevel } = {}) {
  const contents = messages.map((m, i) => {
    const parts = [{ text: m.text }];
    if (image && i === messages.length - 1) {
      parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  // Temperature is left at the model default, as Google recommends for Gemini 3 models.
  const generationConfig = { maxOutputTokens: mode === "sign" ? 1024 : 2048 };
  if (mode === "sign") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = SIGN_SCHEMA;
  }
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: String(thinkingLevel).toUpperCase() };

  return {
    systemInstruction: {
      parts: [{ text: systemPrompt(mode, LANGUAGES[lang], { hasImage: Boolean(image), clientTime }) }],
    },
    contents,
    generationConfig,
  };
}

/** Joins the answer text from one Gemini response chunk, skipping thought parts. */
export function extractText(chunk) {
  const parts = chunk?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => typeof p?.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

function dataFrom(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
}

/** Yields the data payload of each Server-Sent Event in a byte stream. */
export async function* sseData(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const data = dataFrom(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (data) yield data;
    }
  }
  buffer += decoder.decode();
  const data = dataFrom(buffer);
  if (data) yield data;
}

/** Parses the sign-mode JSON answer, falling back to plain text. */
export function parseSignJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const obj = JSON.parse(cleaned);
    const meaning = typeof obj?.meaning === "string" ? obj.meaning.trim() : "";
    const reply = typeof obj?.reply === "string" ? obj.reply.trim() : "";
    if (reply) return { meaning, reply };
  } catch {
    // Not JSON: use the raw text as the reply.
  }
  return { meaning: "", reply: text.trim() };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

async function upstreamError(res) {
  let detail = "";
  try {
    const data = await res.json();
    detail = data?.error?.message || "";
  } catch {
    // Body wasn't JSON.
  }
  if (res.status === 429) {
    return json({ error: "The AI is busy (rate limit reached). Wait a minute and try again.", code: "rate_limited" }, 429);
  }
  if (res.status === 401 || res.status === 403 || /api key/i.test(detail)) {
    return json({ error: "The Gemini API key was rejected. Check GEMINI_API_KEY.", code: "bad_key" }, 502);
  }
  if (res.status === 400 || res.status === 404) {
    return json({ error: `The AI rejected the request. ${detail}`.trim(), code: "bad_request" }, 502);
  }
  return json({ error: "The AI service had a problem. Try again.", code: "upstream_error" }, 502);
}

function streamVoice(upstream) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client went away; nothing to send to.
        }
      };
      let sentText = false;
      try {
        for await (const data of sseData(upstream.body)) {
          let chunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (chunk.error) {
            send({ type: "error", message: chunk.error.message || "The AI stream failed." });
            return;
          }
          if (chunk.promptFeedback?.blockReason) {
            send({ type: "error", message: "The AI declined to answer that." });
            return;
          }
          const text = extractText(chunk);
          if (text) {
            sentText = true;
            send({ type: "delta", text });
          }
        }
        send(sentText ? { type: "done" } : { type: "error", message: "The AI gave an empty answer. Try asking again." });
      } catch {
        send({ type: "error", message: "The AI stream was interrupted." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed or cancelled.
        }
      }
    },
    cancel() {
      upstream.body?.cancel().catch(() => {});
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

async function signReply(upstream) {
  let data;
  try {
    data = await upstream.json();
  } catch {
    return json({ error: "The AI sent an unreadable answer.", code: "bad_upstream" }, 502);
  }
  if (data?.promptFeedback?.blockReason) {
    return json({ error: "The AI declined to answer that.", code: "blocked" }, 422);
  }
  const text = extractText(data).trim();
  if (!text) return json({ error: "The AI gave an empty answer. Try again.", code: "empty" }, 502);
  return json(parseSignJson(text));
}

/**
 * Handles POST /api/chat.
 * @param {Request} request
 * @param {Record<string, string | undefined>} env  GEMINI_API_KEY, GEMINI_MODEL, GEMINI_THINKING_LEVEL,
 *   GEMINI_BASE_URL, ALLOWED_ORIGINS
 */
export async function handleChat(request, env = {}) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405, { allow: "POST" });

  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get("origin");
  if (allowed.length && origin && !allowed.includes(origin)) {
    return json({ error: "This website is not allowed to use the AI.", code: "origin" }, 403);
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(
      {
        error: "The server has no GEMINI_API_KEY. Add it to .env.local for local dev, or to the Vercel project's environment variables.",
        code: "no_key",
      },
      500,
    );
  }

  if (Number(request.headers.get("content-length") || 0) > LIMITS.maxBodyBytes) {
    return json({ error: "The request is too large." }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request body is not valid JSON." }, 400);
  }
  const { value, error } = validateBody(body);
  if (error) return json({ error }, 400);

  const baseUrl = (env.GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const method = value.mode === "voice" ? "streamGenerateContent?alt=sse" : "generateContent";
  const payload = buildGeminiRequest(value, { thinkingLevel: env.GEMINI_THINKING_LEVEL });

  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: anySignal([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
  } catch (err) {
    if (request.signal?.aborted) return json({ error: "Request cancelled." }, 400);
    const timedOut = err?.name === "TimeoutError";
    return json(
      {
        error: timedOut ? "The AI took too long to answer." : "Couldn't reach the AI service.",
        code: timedOut ? "timeout" : "upstream_unreachable",
      },
      502,
    );
  }
  if (!upstream.ok) return upstreamError(upstream);

  return value.mode === "voice" ? streamVoice(upstream) : signReply(upstream);
}
