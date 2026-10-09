import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeminiRequest, handleChat, LIMITS, parseVideoInterpretation, validateBody } from "../server/chat.js";

const ENV = { GEMINI_API_KEY: "test-key" };
const turn = (patch = {}) => ({ mode: "sign-video", lang: "ta", signLanguage: "isl", videoConsent: true, duration: 2, video: "data:video/webm;base64,AQIDBA==", messages: [{ role: "user", text: "Interpret this turn" }], ...patch });
const req = (body) => new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) });
const answer = (data) => Response.json({ candidates: [{ content: { parts: [{ text: typeof data === "string" ? data : JSON.stringify(data) }] } }] });

test("sign-video rejects missing consent, wrong language, invalid media and oversized/long clips", () => {
  for (const patch of [
    { videoConsent: false }, { signLanguage: "bsl" }, { video: undefined }, { video: "https://example.com/private.mp4" },
    { video: "data:video/mp4;base64,%%%%" }, { video: "data:video/mp4;base64,AAAAA" },
    { video: `data:video/mp4;base64,${"A".repeat(2_666_668)}` }, { duration: 0 }, { duration: 12.1 }, { duration: "2" },
  ]) assert.ok(validateBody(turn(patch)).error, JSON.stringify(patch).slice(0, 90));
  assert.ok(validateBody(turn()).value.video);
  assert.ok(validateBody(turn({ mode: "sign" })).error);
});

test("temporal video request preserves all data, uses 8 FPS and distinguishes ISL from ASL", () => {
  for (const dialect of ["isl", "asl"]) {
    const payload = buildGeminiRequest(validateBody(turn({ signLanguage: dialect })).value);
    assert.deepEqual(payload.contents[0].parts[0], { inlineData: { mimeType: "video/webm", data: "AQIDBA==" }, videoMetadata: { fps: 8 } });
    assert.match(payload.systemInstruction.parts[0].text, dialect === "isl" ? /Indian Sign Language/ : /American Sign Language/);
    assert.match(payload.systemInstruction.parts[0].text, /meaning in Tamil/);
    assert.match(payload.systemInstruction.parts[0].text, /Never invent/);
    assert.deepEqual(payload.generationConfig.responseSchema.required, ["status", "meaning", "glosses", "feedback"]);
  }
});

test("uncertain interpretations cannot leak speculative meanings or glosses into a confirmed turn", () => {
  assert.deepEqual(parseVideoInterpretation(JSON.stringify({ status: "unclear", meaning: "I need water", glosses: ["WATER"], feedback: "Record again" })), { status: "unclear", meaning: "", glosses: [], feedback: "Record again" });
  for (const value of ["Plain text", '{"status":"recognized","meaning":"","glosses":[],"feedback":""}', '{"status":"certain","meaning":"hi","glosses":[],"feedback":""}']) assert.throws(() => parseVideoInterpretation(value));
});

test("AI readiness reveals only capability settings and never a key; it does not call Gemini", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected upstream call"); });
  for (const env of [{}, ENV]) {
    const response = await handleChat(new Request("http://localhost/api/chat?status=1"), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json();
    assert.equal(data.configured, Boolean(env.GEMINI_API_KEY));
    assert.ok(!JSON.stringify(data).includes("test-key"));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("sign-video uses a dedicated configurable model and returns strict interpretations", async (t) => {
  let seen;
  t.mock.method(globalThis, "fetch", async (url, init) => { seen = { url, init }; return answer({ status: "recognized", meaning: "வணக்கம்", glosses: ["HELLO"], feedback: "Check the meaning" }); });
  let response = await handleChat(req(turn()), ENV);
  assert.equal(response.status, 200);
  assert.match(seen.url, /gemini-3\.5-flash:generateContent$/);
  assert.equal((await response.json()).meaning, "வணக்கம்");
  response = await handleChat(req(turn()), { ...ENV, GEMINI_MODEL: "text-model", GEMINI_SIGN_MODEL: "video-model" });
  assert.match(seen.url, /video-model:generateContent$/);
  assert.equal(seen.init.headers["x-goog-api-key"], "test-key");
  t.mock.method(globalThis, "fetch", async () => answer("This looks like hello"));
  assert.equal((await handleChat(req(turn()), ENV)).status, 502);
});

test("actual body size is enforced even without Content-Length", async () => {
  const response = await handleChat(req({ ...turn(), ignored: "x".repeat(LIMITS.maxBodyBytes) }), ENV);
  assert.equal(response.status, 413);
});
