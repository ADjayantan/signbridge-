import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSentenceChunker, stripForSpeech } from "../src/lib/text.js";

function chunkAll(pieces, options) {
  const out = [];
  const chunker = createSentenceChunker((s) => out.push(s), options);
  for (const piece of pieces) chunker.push(piece);
  const beforeFlush = [...out];
  chunker.flush();
  return { beforeFlush, all: out };
}

describe("stripForSpeech", () => {
  test("removes markdown, links, urls and emoji", () => {
    const input = "## Steps\n- **Open** the [door](https://x.y) 👋\n1. Go *left* `now`\nSee https://example.com 🤟🏽";
    assert.equal(stripForSpeech(input), "Steps\nOpen the door\nGo left now\nSee");
  });

  test("keeps Indian scripts intact, including zero-width joiners inside words", () => {
    assert.equal(stripForSpeech("வணக்கம்! **நலமா?**"), "வணக்கம்! நலமா?");
    const malayalam = "അവന്‍ വന്നു"; // chillu written with ZWJ
    assert.equal(stripForSpeech(malayalam), malayalam);
    assert.equal(stripForSpeech("Family 👨‍👩‍👧 and flag 🇮🇳 done"), "Family and flag done");
  });
});

describe("createSentenceChunker", () => {
  test("emits sentences as soon as they end, even when streamed one character at a time", () => {
    const text = "Hello there. How are you? I'm fine";
    const { beforeFlush, all } = chunkAll([...text]);
    assert.deepEqual(beforeFlush, ["Hello there.", "How are you?"]);
    assert.deepEqual(all, ["Hello there.", "How are you?", "I'm fine"]);
  });

  test("does not split decimals", () => {
    const { all } = chunkAll(["It costs 3", ".5 rupees. Okay"]);
    assert.deepEqual(all, ["It costs 3.5 rupees.", "Okay"]);
  });

  test("splits on the Devanagari danda and on newlines", () => {
    assert.deepEqual(chunkAll(["नमस्ते। आप कैसे हैं?"]).all, ["नमस्ते।", "आप कैसे हैं?"]);
    assert.deepEqual(chunkAll(["first line\nsecond line"]).all, ["first line", "second line"]);
  });

  test("cuts very long sentences so speech can start early", () => {
    const long = `${"word ".repeat(30)}and then, ${"more ".repeat(40)}`;
    const { beforeFlush } = chunkAll([long], { maxChars: 120 });
    assert.ok(beforeFlush.length >= 1);
    for (const piece of beforeFlush) assert.ok(piece.length <= 120, piece);
  });
});
