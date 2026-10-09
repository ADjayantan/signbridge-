import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ApiError, askSign, streamVoice } from "../src/lib/api.js";

function ndjsonResponse(lines, chunkSize = 3) {
  const bytes = new TextEncoder().encode(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize));
        c.close();
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } },
  );
}

async function collect(gen) {
  const out = [];
  for await (const piece of gen) out.push(piece);
  return out;
}

describe("client api", () => {
  test("streamVoice yields deltas and sends the request body", async (t) => {
    let body;
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      body = JSON.parse(init.body);
      return ndjsonResponse([
        { type: "delta", text: "நான் " },
        { type: "delta", text: "உதவுகிறேன்." },
        { type: "done" },
      ]);
    });
    const pieces = await collect(streamVoice({ lang: "ta", messages: [{ role: "user", text: "hi" }] }));
    assert.equal(pieces.join(""), "நான் உதவுகிறேன்.");
    assert.equal(body.mode, "voice");
    assert.equal(body.lang, "ta");
    assert.equal("image" in body, false, "no image key when the camera is off");
    assert.equal(typeof body.clientTime, "string");
  });

  test("streamVoice throws on a stream error event", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      ndjsonResponse([{ type: "delta", text: "Hel" }, { type: "error", message: "The AI stream was interrupted." }]),
    );
    await assert.rejects(collect(streamVoice({ lang: "en", messages: [] })), {
      name: "ApiError",
      message: "The AI stream was interrupted.",
    });
  });

  test("server and network errors become ApiError with a readable message", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: "The AI is busy (rate limit reached).", code: "rate_limited" }, { status: 429 }),
    );
    await assert.rejects(askSign({ lang: "en", messages: [] }), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 429);
      assert.equal(err.code, "rate_limited");
      return true;
    });

    t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
    await assert.rejects(askSign({ lang: "en", messages: [] }), /server isn't running/);

    t.mock.method(globalThis, "fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await assert.rejects(askSign({ lang: "en", messages: [] }), { code: "network" });
  });

  test("askSign returns meaning and reply", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ meaning: "Hello!", reply: "Hi! How can I help?" }));
    assert.deepEqual(await askSign({ lang: "en", messages: [{ role: "user", text: "Signed: HELLO" }] }), {
      meaning: "Hello!",
      reply: "Hi! How can I help?",
    });
  });

  test("voice handles the last JSON event even when there is no trailing newline", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response('{"type":"delta","text":"Hello."}\n{"type":"done"}'));
    assert.equal((await collect(streamVoice({ lang: "en", messages: [] }))).join(""), "Hello.");
    t.mock.method(globalThis, "fetch", async () => new Response('{"type":"delta","text":"Hello."}\n{"type":"error","message":"Lost connection"}'));
    await assert.rejects(collect(streamVoice({ lang: "en", messages: [] })), /Lost connection/);
  });

  test("truncated voice streams never silently count as successful answers", async (t) => {
    t.mock.method(globalThis, "fetch", async () => ndjsonResponse([{ type: "delta", text: "Partial" }]));
    await assert.rejects(collect(streamVoice({ lang: "en", messages: [] })), { code: "incomplete_stream" });
  });

  test("malformed or empty sign responses produce a usable error", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
    await assert.rejects(askSign({ lang: "en", messages: [] }), { name: "ApiError", code: "bad_response" });
    t.mock.method(globalThis, "fetch", async () => Response.json({ reply: {} }));
    await assert.rejects(askSign({ lang: "en", messages: [] }), { code: "bad_response" });
  });
});
