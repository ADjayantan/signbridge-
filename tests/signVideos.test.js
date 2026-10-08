import { test } from "node:test";
import assert from "node:assert/strict";
import { clipId, planSignVideos, wordsOf } from "../src/lib/signVideos.js";
import { indexedDB } from "fake-indexeddb";
import { saveSignVideo, listSignVideos, deleteSignVideo } from "../src/lib/signVideos.js";

const clip = (label, signLanguage = "isl", textLanguage = "en") => ({ label, signLanguage, textLanguage, id: label });
test("video replies select longest exact phrases and retain missing words in sequence", () => {
  const plan = planSignVideos("Hello! How can I help you today?", [clip("hello"), clip("how can I help you"), clip("help")], "isl", "en");
  assert.equal(plan.covered, 6); assert.equal(plan.total, 7);
  assert.deepEqual(plan.steps.map((s) => [s.kind, s.text]), [["video", "hello"], ["video", "how can i help you"], ["missing", "today"]]);
  assert.equal(plan.exactPhrase, false);
});
test("ISL, ASL and text languages never cross-match", () => {
  const clips = [clip("hello", "asl"), clip("hello", "isl", "ta")];
  assert.equal(planSignVideos("hello", clips, "isl", "en").covered, 0);
  assert.equal(planSignVideos("hello", clips, "asl", "en").covered, 1);
  assert.notEqual(clipId(clip("hello", "asl")), clipId(clip("hello")));
});
test("phrase clips preserve repeated words, negation and punctuation boundaries", () => {
  const plan = planSignVideos("No, no. I don't need help.", [clip("no"), clip("I don't need help")], "isl", "en");
  assert.deepEqual(plan.steps.map((s) => s.text), ["no", "no", "i don't need help"]);
  assert.equal(plan.covered, plan.total);
  assert.equal(planSignVideos("Don't", [clip("do")], "isl", "en").covered, 0);
});
test("Tamil combining marks and Unicode phrases survive lookup", () => {
  const text = "வணக்கம்! நான் நலமாக இருக்கிறேன்.";
  const plan = planSignVideos(text, [clip("வணக்கம்", "isl", "ta"), clip("நான் நலமாக இருக்கிறேன்", "isl", "ta")], "isl", "ta");
  assert.equal(plan.covered, 4);
  assert.deepEqual(wordsOf("வணக்கம்"), ["வணக்கம்"]);
});
test("empty text and invalid empty labels cannot cause loops or false coverage", () => {
  assert.equal(planSignVideos("...", [clip("")], "isl", "en").total, 0);
  assert.equal(planSignVideos("hello", [clip("")], "isl", "en").covered, 0);
  assert.equal(planSignVideos("Hello!", [clip("hello")], "isl", "en").exactPhrase, true);
});

test("video storage round-trips blobs, isolates languages, and refuses silent overwrites", async () => {
  globalThis.indexedDB = indexedDB;
  const blob = new Blob(["synthetic storage test"], { type: "video/webm" });
  const data = { label: "Hello", signLanguage: "isl", textLanguage: "en", blob };
  const first = await saveSignVideo(data);
  const second = await saveSignVideo({ ...data, signLanguage: "asl" });
  const all = await listSignVideos();
  assert.equal(all.length, 2);
  assert.equal(await all[0].blob.text(), "synthetic storage test");
  await assert.rejects(saveSignVideo({ ...data, label: "hello!" }), /already has a video/);
  await deleteSignVideo(first.id);
  assert.deepEqual((await listSignVideos()).map((c) => c.id), [second.id]);
  await deleteSignVideo(second.id);
});

test("storage rejects empty phrases, unsupported languages and oversized/non-video files", async () => {
  const data = { label: "Hello", signLanguage: "isl", textLanguage: "en", blob: new Blob(["x"], { type: "video/mp4" }) };
  await assert.rejects(saveSignVideo({ ...data, label: "..." }), /Enter a word/);
  await assert.rejects(saveSignVideo({ ...data, signLanguage: "bsl" }), /supported language/);
  await assert.rejects(saveSignVideo({ ...data, blob: new Blob(["x"], { type: "text/html" }) }), /MP4/);
  await assert.rejects(saveSignVideo({ ...data, blob: new Blob([new Uint8Array(21 * 1024 * 1024)], { type: "video/mp4" }) }), /20 MB/);
});
