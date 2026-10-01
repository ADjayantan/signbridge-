import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  LANGUAGES,
  LIMITS,
  buildGeminiRequest,
  extractText,
  handleChat,
  parseSignJson,
  sseData,
  validateBody,
} from "../server/chat.js";
import { LANGUAGES as CLIENT_LANGUAGES } from "../src/lib/languages.js";

const ENV = { GEMINI_API_KEY: "test-key" };
const user = (text) => ({ role: "user", text });
const assistant = (text) => ({ role: "assistant", text });

function request(body, headers = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Gemini-style SSE body, optionally CRLF-separated and split into tiny byte chunks. */
function sseBody(events, { crlf = false, chunkSize = 0 } = {}) {
  const sep = crlf ? "\r\n\r\n" : "\n\n";
  const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}${sep}`).join(""));
  const size = chunkSize || bytes.length;
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}

const textChunk = (text, extra = {}) => ({ candidates: [{ content: { role: "model", parts: [{ text }] } }], ...extra });

async function ndjson(res) {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("languages", () => {
  test("client and server support the same language codes", () => {
    assert.deepEqual(
      CLIENT_LANGUAGES.map((l) => l.code).sort(),
      Object.keys(LANGUAGES).sort(),
    );
  });
});

describe("validateBody", () => {
  test("rejects bad shapes", () => {
    assert.ok(validateBody(null).error);
    assert.ok(validateBody([]).error);
    assert.ok(validateBody({ mode: "chat", messages: [user("hi")] }).error);
    assert.ok(validateBody({ mode: "voice", messages: [] }).error);
    assert.ok(validateBody({ mode: "voice", messages: [{ role: "system", text: "x" }] }).error);
    assert.ok(validateBody({ mode: "voice", messages: [{ role: "user", text: 5 }] }).error);
    assert.ok(validateBody({ mode: "voice", messages: [user("hi"), assistant("hello")] }).error);
  });

  test("normalizes messages", () => {
    const { value } = validateBody({
      mode: "voice",
      lang: "xx",
      messages: [assistant("intro"), user(" hi "), user("there"), assistant("hey"), user("  "), user("bye")],
    });
    assert.equal(value.lang, "en", "unknown language falls back to English");
    assert.deepEqual(value.messages, [user("hi\nthere"), assistant("hey"), user("bye")]);
  });

  test("keeps only the latest messages and clips long text", () => {
    const many = Array.from({ length: 40 }, (_, i) => (i % 2 ? assistant(`a${i}`) : user(`u${i}`)));
    many.push(user("x".repeat(LIMITS.maxTextChars + 50)));
    const { value } = validateBody({ mode: "voice", messages: many });
    assert.ok(value.messages.length <= LIMITS.maxMessages);
    assert.equal(value.messages[0].role, "user");
    assert.equal(value.messages.at(-1).text.length, LIMITS.maxTextChars);
  });

  test("accepts images only in voice mode and only as image data URLs", () => {
    const image = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    assert.deepEqual(validateBody({ mode: "voice", messages: [user("what is this")], image }).value.image, {
      mimeType: "image/jpeg",
      data: "/9j/4AAQSkZJRg==",
    });
    assert.ok(validateBody({ mode: "sign", messages: [user("x")], image }).error);
    assert.ok(validateBody({ mode: "voice", messages: [user("x")], image: "data:text/html;base64,PGI+" }).error);
    assert.ok(validateBody({ mode: "voice", messages: [user("x")], image: "https://example.com/a.jpg" }).error);
    const huge = `data:image/png;base64,${"A".repeat(LIMITS.maxImageChars)}`;
    assert.ok(validateBody({ mode: "voice", messages: [user("x")], image: huge }).error);
  });
});

describe("buildGeminiRequest", () => {
  test("voice: plain text, roles mapped, image on the last user turn", () => {
    const { value } = validateBody({
      mode: "voice",
      lang: "ta",
      messages: [user("hi"), assistant("hello"), user("read this")],
      image: "data:image/png;base64,iVBORw0KGgo=",
      clientTime: "Thursday, 1 October 2026 at 9:46 am",
    });
    const req = buildGeminiRequest(value);
    assert.deepEqual(
      req.contents.map((c) => c.role),
      ["user", "model", "user"],
    );
    assert.deepEqual(req.contents[2].parts[0], { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } });
    assert.deepEqual(req.contents[2].parts[1], { text: "read this" });
    assert.equal(req.generationConfig.responseMimeType, undefined);
    assert.equal(req.generationConfig.thinkingConfig, undefined, "no thinking config unless asked");
    const system = req.systemInstruction.parts[0].text;
    assert.match(system, /Reply in Tamil/);
    assert.match(system, /camera is on/);
    assert.match(system, /9:46 am/);
  });

  test("sign: JSON schema output and optional thinking level", () => {
    const { value } = validateBody({ mode: "sign", lang: "hi", messages: [user("Signed: HELLO WATER WHERE")] });
    const req = buildGeminiRequest(value, { thinkingLevel: "minimal" });
    assert.equal(req.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(req.generationConfig.responseSchema.required, ["meaning", "reply"]);
    assert.deepEqual(req.generationConfig.thinkingConfig, { thinkingLevel: "MINIMAL" });
    assert.match(req.systemInstruction.parts[0].text, /answer in Hindi/);
  });
});

describe("stream helpers", () => {
  test("extractText skips thought parts", () => {
    const chunk = { candidates: [{ content: { parts: [{ text: "plan", thought: true }, { text: "Hi" }, { text: "!" }] } }] };
    assert.equal(extractText(chunk), "Hi!");
    assert.equal(extractText({}), "");
  });

  test("sseData handles CRLF and events split across chunks, including inside multi-byte characters", async () => {
    const events = [textChunk("வணக்கம்! "), textChunk("நலமா?")];
    const out = [];
    for await (const data of sseData(sseBody(events, { crlf: true, chunkSize: 5 }))) out.push(JSON.parse(data));
    assert.equal(out.map(extractText).join(""), "வணக்கம்! நலமா?");
  });

  test("parseSignJson reads JSON, code fences, and falls back to text", () => {
    assert.deepEqual(parseSignJson('{"meaning":"Where is water?","reply":"Ask at the front desk."}'), {
      meaning: "Where is water?",
      reply: "Ask at the front desk.",
    });
    assert.deepEqual(parseSignJson('```json\n{"meaning":"a","reply":"b"}\n```'), { meaning: "a", reply: "b" });
    assert.deepEqual(parseSignJson("Just text"), { meaning: "", reply: "Just text" });
  });
});

describe("handleChat", () => {
  test("rejects GET, missing key, bad JSON, bad body, other origins, huge bodies", async () => {
    assert.equal((await handleChat(new Request("http://localhost/api/chat"), ENV)).status, 405);
    const noKey = await handleChat(request({ mode: "voice", messages: [user("hi")] }), {});
    assert.equal(noKey.status, 500);
    assert.equal((await noKey.json()).code, "no_key");
    assert.equal((await handleChat(request("{oops"), ENV)).status, 400);
    assert.equal((await handleChat(request({ mode: "voice", messages: [] }), ENV)).status, 400);
    const blocked = await handleChat(request({ mode: "voice", messages: [user("hi")] }, { origin: "https://evil.example" }), {
      ...ENV,
      ALLOWED_ORIGINS: "https://signbridge.vercel.app, http://localhost:5173",
    });
    assert.equal(blocked.status, 403);
    const big = await handleChat(request({ mode: "voice", messages: [user("hi")] }, { "content-length": "9999999" }), ENV);
    assert.equal(big.status, 413);
  });

  test("voice: streams Gemini SSE as NDJSON deltas", async (t) => {
    let seen;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      seen = { url: String(url), init };
      return new Response(
        sseBody(
          [
            { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }] } }] },
            textChunk("Hello there. "),
            textChunk("How can I help?", { usageMetadata: { totalTokenCount: 12 } }),
          ],
          { chunkSize: 7 },
        ),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const res = await handleChat(request({ mode: "voice", lang: "en", messages: [user("hi")] }), ENV);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /ndjson/);
    const events = await ndjson(res);
    assert.equal(
      events
        .filter((e) => e.type === "delta")
        .map((e) => e.text)
        .join(""),
      "Hello there. How can I help?",
    );
    assert.deepEqual(events.at(-1), { type: "done" });
    assert.equal(
      seen.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse",
    );
    assert.equal(seen.init.headers["x-goog-api-key"], "test-key");
    const sent = JSON.parse(seen.init.body);
    assert.equal(sent.contents[0].parts[0].text, "hi");
  });

  test("voice: honours GEMINI_MODEL and GEMINI_BASE_URL", async (t) => {
    let url;
    t.mock.method(globalThis, "fetch", async (u) => {
      url = String(u);
      return new Response(sseBody([textChunk("ok")]));
    });
    await (await handleChat(request({ mode: "voice", messages: [user("hi")] }), {
      ...ENV,
      GEMINI_MODEL: "gemini-3.8-flash",
      GEMINI_BASE_URL: "http://127.0.0.1:9999/v1beta/",
    })).text();
    assert.equal(url, "http://127.0.0.1:9999/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  });

  test("voice: blocked prompts and empty answers become error events", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(sseBody([{ promptFeedback: { blockReason: "SAFETY" } }])));
    let events = await ndjson(await handleChat(request({ mode: "voice", messages: [user("x")] }), ENV));
    assert.equal(events.at(-1).type, "error");

    t.mock.method(globalThis, "fetch", async () => new Response(sseBody([{ candidates: [{ finishReason: "STOP" }] }])));
    events = await ndjson(await handleChat(request({ mode: "voice", messages: [user("x")] }), ENV));
    assert.deepEqual(events.map((e) => e.type), ["error"]);
  });

  test("maps upstream failures to clear errors", async (t) => {
    const cases = [
      [new Response(JSON.stringify({ error: { message: "Resource exhausted" } }), { status: 429 }), 429, "rate_limited"],
      [new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), { status: 400 }), 502, "bad_key"],
      [new Response(JSON.stringify({ error: { message: "models/x is not found" } }), { status: 404 }), 502, "bad_request"],
      [new Response("oops", { status: 500 }), 502, "upstream_error"],
    ];
    for (const [upstream, status, code] of cases) {
      t.mock.method(globalThis, "fetch", async () => upstream);
      const res = await handleChat(request({ mode: "voice", messages: [user("x")] }), ENV);
      assert.equal(res.status, status);
      assert.equal((await res.json()).code, code);
    }
    t.mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const res = await handleChat(request({ mode: "sign", messages: [user("Signed: HELLO")] }), ENV);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, "upstream_unreachable");
  });

  test("sign: returns meaning and reply from generateContent", async (t) => {
    let url;
    t.mock.method(globalThis, "fetch", async (u) => {
      url = String(u);
      return Response.json(textChunk('{"meaning":"Hello, where is the water?","reply":"Water is near the door."}'));
    });
    const res = await handleChat(request({ mode: "sign", messages: [user("Signed: HELLO WATER WHERE")] }), ENV);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { meaning: "Hello, where is the water?", reply: "Water is near the door." });
    assert.match(url, /:generateContent$/);
  });
});
