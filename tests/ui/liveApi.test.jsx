import { afterEach, expect, test, vi } from "vitest";
import { checkSignAI, interpretSignVideo } from "../../src/lib/api.js";

afterEach(() => vi.unstubAllGlobals());
const result = { status: "recognized", meaning: "Hello", glosses: ["HELLO"], feedback: "Review this" };
const clip = () => ({ blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/webm;codecs=vp8" }), duration: 1, signLanguage: "asl", lang: "en", consent: true });

test("the real FileReader encodes video bytes, strips codec parameters and sends explicit consent", async () => {
  let body;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => result }; }));
  expect(await interpretSignVideo(clip())).toEqual(result);
  expect(body.video).toBe("data:video/webm;base64,AQIDBA==");
  expect(body).toMatchObject({ mode: "sign-video", duration: 1, signLanguage: "asl", videoConsent: true });
  expect(body.messages).toHaveLength(1);
});

test("missing consent, oversized media and an already-cancelled read never contact the server", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(interpretSignVideo({ ...clip(), consent: false })).rejects.toMatchObject({ code: "consent" });
  await expect(interpretSignVideo({ ...clip(), blob: new Blob([new Uint8Array(2_000_001)], { type: "video/mp4" }) })).rejects.toThrow(/under 2 MB/);
  const controller = new AbortController(); controller.abort();
  await expect(interpretSignVideo({ ...clip(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

test("unclear video responses discard guesses; malformed video responses report a failure", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ...result, status: "unclear", meaning: "Guess" }) })); vi.stubGlobal("fetch", fetch);
  expect(await interpretSignVideo(clip())).toMatchObject({ status: "unclear", meaning: "", glosses: [] });
  fetch.mockResolvedValue({ ok: true, json: async () => ({ reply: "not an interpretation" }) });
  await expect(interpretSignVideo(clip())).rejects.toMatchObject({ code: "bad_response" });
});

test("readiness uses no-store and reports unavailable status responses", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ configured: false }) })); vi.stubGlobal("fetch", fetch);
  expect(await checkSignAI()).toMatchObject({ configured: false });
  expect(fetch.mock.calls[0][0]).toBe("/api/chat?status=1"); expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  fetch.mockResolvedValue({ ok: false }); await expect(checkSignAI()).rejects.toThrow(/check the AI server/);
});
