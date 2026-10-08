import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { deleteTrainingSample, exportTrainingDataset, listTrainingSamples, MAX_TRAINING_BYTES, MAX_TRAINING_SAMPLES, MAX_TRAINING_STORAGE_BYTES, saveTrainingSample, summarizeTrainingSamples, TRAINING_DB_NAME, TRAINING_EXPORT_RESERVE_BYTES, validateTrainingSample } from "../src/lib/trainingSamples.js";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const frame = (atMs) => {
  const keypoints = Array.from({ length: 75 }, () => [.5, .5, 0]);
  keypoints[11] = [.3, .5, 0]; keypoints[12] = [.7, .5, 0];
  return { keypoints, confidences: Array(75).fill(1), atMs };
};
const data = (patch = {}) => ({ signLanguage: "isl", label: "WATER", signerId: "signer-a", sessionId: "session-1", kind: "known", consent: true, frames: [0, 125, 250, 375].map(frame), ...patch });
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

async function seed(rows) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(TRAINING_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("samples", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("samples", "readwrite");
    for (const row of rows) tx.objectStore("samples").add(row);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
}

test("pose storage requires explicit consent before opening a database", async () => {
  for (const consent of [false, undefined, "true", 1]) await assert.rejects(saveTrainingSample(data({ consent })), /Choose to save/);
  assert.deepEqual(await listTrainingSamples(), []);
});

test("whole pose round trip snapshots caller data and returns exact byte accounting", async () => {
  const input = data({ prediction: { status: "recognized", meaning: "HELP" }, video: new Blob(["not stored"]) });
  const saving = saveTrainingSample(input);
  input.frames[0].keypoints[33][0] = 9;
  input.frames[0].confidences[33] = 0;
  input.label = "changed";
  const saved = await saving;
  assert.equal(saved.frameCount, 4); assert.equal(saved.durationMs, 375); assert.equal(saved.byteSize, bytes(saved));
  assert.equal(saved.label, "WATER"); assert.equal(saved.frames[0].keypoints[33][0], .5);
  assert.equal(saved.frames[0].confidences[33], 1); assert.equal("video" in saved, false);
  assert.deepEqual(saved.prediction, { status: "recognized", meaning: "HELP" });
  saved.frames[0].keypoints[33][0] = 8;
  const all = await listTrainingSamples();
  assert.equal(all[0].frames[0].keypoints[33][0], .5);
  all[0].frames[0].keypoints[33][0] = 7;
  assert.equal((await listTrainingSamples())[0].frames[0].keypoints[33][0], .5);
});

test("separate languages and unknown backgrounds survive export and deletion", async () => {
  const first = await saveTrainingSample(data());
  const second = await saveTrainingSample(data({ signLanguage: "asl", signerId: "signer-b", sessionId: "session-2" }));
  const background = data({ kind: "unknown", label: undefined });
  background.frames.forEach((pose) => pose.confidences.fill(0));
  const third = await saveTrainingSample(background);
  const all = await listTrainingSamples();
  const exported = exportTrainingDataset(all);
  assert.equal(exported.format, "signbridge-pose-dataset-v1"); assert.equal(exported.samples.length, 3);
  assert.equal(exported.samples.find((row) => row.id === second.id).signLanguage, "asl");
  assert.equal(exported.samples.find((row) => row.id === third.id).label, "__unknown__");
  all[0].frames[0].keypoints[0][0] = 9;
  assert.equal(exported.samples.find((row) => row.id === first.id).frames[0].keypoints[0][0], .5);
  assert.deepEqual(summarizeTrainingSamples(exported.samples), {
    total: 3, known: 2, unknown: 1, negativeTypes: { nonsigning: 0, "unsupported-sign": 0, unspecified: 1 }, signers: 2, sessions: 2, bytes: exported.samples.reduce((total, row) => total + bytes(row), 0),
    languages: { isl: { total: 2, known: 1, unknown: 1, negativeTypes: { nonsigning: 0, "unsupported-sign": 0, unspecified: 1 }, signers: 1, sessions: 1 }, asl: { total: 1, known: 1, unknown: 0, negativeTypes: { nonsigning: 0, "unsupported-sign": 0, unspecified: 0 }, signers: 1, sessions: 1 } },
  });
  await deleteTrainingSample(first.id); await deleteTrainingSample(first.id);
  assert.deepEqual(new Set((await listTrainingSamples()).map((row) => row.id)), new Set([second.id, third.id]));
});

test("bounded coordinates and confidence cannot silently become valid training poses", async () => {
  for (const corrupt of [
    (input) => { input.frames[0].keypoints[0][0] = NaN; },
    (input) => { input.frames[0].keypoints[0][2] = Infinity; },
    (input) => { input.frames[0].keypoints[0][1] = 10.01; },
    (input) => { input.frames[0].keypoints[0] = [.5, .5]; },
    (input) => { input.frames[0].keypoints[0][0] = ".5"; },
    (input) => { input.frames[0].keypoints = Array(75); },
    (input) => { input.frames[0].confidences[0] = -1; },
    (input) => { input.frames[0].confidences[0] = 1.01; },
    (input) => { input.frames[0].confidences = Array(75); },
  ]) { const input = data(); corrupt(input); await assert.rejects(saveTrainingSample(input), /Pose|landmarks/); }
  assert.deepEqual(await listTrainingSamples(), []);
});

test("timestamps must be strict, nonnegative and bounded with 4-100 frames", async () => {
  for (const times of [[0, 125, 125, 375], [-1, 125, 250, 375], [0, 125, 250, 12001], [0, 250, 125, 375], [0, 125, 250, NaN]]) {
    await assert.rejects(saveTrainingSample(data({ frames: times.map(frame) })), /timestamps/);
  }
  await assert.rejects(saveTrainingSample(data({ frames: [frame(0), frame(125), frame(250)] })), /4–100/);
  await assert.rejects(saveTrainingSample(data({ frames: Array.from({ length: 101 }, (_, i) => frame(i * 100)) })), /4–100/);
});

test("known samples require hands and both shoulders visible together", async () => {
  const input = data({ frames: Array.from({ length: 8 }, (_, i) => frame(i * 125)) });
  input.frames.slice(0, 4).forEach((pose) => { pose.confidences[33] = 0; pose.confidences[54] = 0; });
  input.frames.slice(4).forEach((pose) => { pose.confidences[11] = 0; pose.confidences[12] = 0; });
  await assert.rejects(saveTrainingSample(input), /signing interval/);
  const missing = data(); missing.frames.forEach((pose) => pose.confidences.fill(0));
  await assert.rejects(saveTrainingSample(missing), /visible hands and both shoulders together/);
  assert.equal((await saveTrainingSample({ ...missing, kind: "unknown" })).kind, "unknown");
});

test("interleaved hand-only and shoulder-only frames cannot become known samples", async () => {
  // Four hand frames and four shoulder frames share an interval but never a frame.
  const input = data({ frames: Array.from({ length: 8 }, (_, i) => frame(i * 125)) });
  input.frames.forEach((pose, i) => {
    pose.confidences.fill(0);
    if ([0, 2, 5, 7].includes(i)) pose.confidences[33] = 1;
    else pose.confidences[11] = pose.confidences[12] = 1;
  });
  await assert.rejects(saveTrainingSample(input), /Recapture.*together/);
  assert.equal((await saveTrainingSample({ ...input, kind: "unknown" })).kind, "unknown");
  const simultaneous = data({ frames: Array.from({ length: 8 }, (_, i) => frame(i * 125)) });
  simultaneous.frames.slice(4).forEach((pose) => { pose.confidences[11] = 0; });
  assert.equal((await saveTrainingSample(simultaneous)).kind, "known");
});

test("old disjoint known samples explain recapture without rewriting saved poses", async () => {
  const original = await saveTrainingSample(data({ frames: Array.from({ length: 8 }, (_, i) => frame(i * 125)) }));
  await deleteTrainingSample(original.id);
  original.frames.forEach((pose, i) => {
    pose.confidences.fill(0);
    if ([0, 2, 5, 7].includes(i)) pose.confidences[54] = 1;
    else pose.confidences[11] = pose.confidences[12] = 1;
  });
  await seed([original]);
  const before = await listTrainingSamples();
  assert.throws(() => exportTrainingDataset(before), /Recapture.*together/);
  assert.deepEqual(await listTrainingSamples(), before);
});

test("explicit negative types survive save and export without a model prediction", async () => {
  const inputs = ["nonsigning", "unsupported-sign", "unspecified"].map((negativeType) => data({ kind: "unknown", negativeType }));
  inputs[0].frames.forEach((pose) => pose.confidences.fill(0));
  const saving = saveTrainingSample(inputs[0]);
  inputs[0].negativeType = "unsupported-sign";
  const first = await saving;
  for (const input of inputs.slice(1)) await saveTrainingSample(input);
  const legacy = await saveTrainingSample(data({ kind: "unknown", prediction: { status: "no_sign", meaning: "" } }));
  const exported = exportTrainingDataset(await listTrainingSamples());
  assert.equal(exported.format, "signbridge-pose-dataset-v1");
  assert.equal(exported.samples.find((row) => row.id === first.id).negativeType, "nonsigning");
  assert.equal("prediction" in first, false);
  assert.equal("negativeType" in legacy, false);
  assert.equal("negativeType" in exported.samples.find((row) => row.id === legacy.id), false);
  assert.deepEqual(summarizeTrainingSamples(exported.samples).negativeTypes, { nonsigning: 1, "unsupported-sign": 1, unspecified: 2 });
  assert.deepEqual(summarizeTrainingSamples(exported.samples).languages.isl.negativeTypes, { nonsigning: 1, "unsupported-sign": 1, unspecified: 2 });
});

test("negative type metadata requires an explicit unknown sample and supported value", async () => {
  for (const negativeType of ["nonsigning", "unsupported-sign", "unspecified"]) {
    await assert.rejects(saveTrainingSample(data({ negativeType })), /Only unknown/);
  }
  for (const negativeType of [null, undefined, "idle", "", 1, true, ["nonsigning"], { type: "nonsigning" }]) {
    await assert.rejects(saveTrainingSample(data({ kind: "unknown", negativeType })), /Only unknown/);
  }
  assert.deepEqual(await listTrainingSamples(), []);
});

test("measured capture duration survives save and export separately from the pose span", async () => {
  const input = data({ kind: "unknown", negativeType: "nonsigning", frames: [125, 250, 375, 500].map(frame), captureDurationMs: 900.5 });
  const saving = saveTrainingSample(input);
  input.captureDurationMs = 12000;
  const saved = await saving;
  assert.equal(saved.captureDurationMs, 900.5);
  assert.equal(saved.durationMs, 375);
  assert.equal(saved.byteSize, bytes(saved));
  const exported = exportTrainingDataset(await listTrainingSamples());
  const roundTrip = validateTrainingSample(JSON.parse(JSON.stringify(exported.samples[0])), { stored: true });
  assert.equal(roundTrip.captureDurationMs, 900.5);
  assert.equal(roundTrip.durationMs, 375);
  assert.equal(roundTrip.negativeType, "nonsigning");
  assert.deepEqual(roundTrip.frames, saved.frames);
});

test("capture duration accepts inclusive measured boundaries and is never guessed for old samples", async () => {
  for (const [times, captureDurationMs] of [[[0, 100, 200, 350], 350], [[11625, 11750, 11875, 12000], 12000]]) {
    const saved = await saveTrainingSample(data({ frames: times.map(frame), captureDurationMs }));
    assert.equal(saved.captureDurationMs, captureDurationMs);
    assert.equal(saved.durationMs, times.at(-1) - times[0]);
  }
  const legacy = await saveTrainingSample(data({ frames: [125, 250, 375, 500].map(frame) }));
  assert.equal("captureDurationMs" in legacy, false);
  const exported = exportTrainingDataset(await listTrainingSamples());
  assert.equal("captureDurationMs" in exported.samples.find((row) => row.id === legacy.id), false);
});

test("capture duration rejects nonnumeric values and windows ending before the last pose", async () => {
  for (const captureDurationMs of [NaN, Infinity, -Infinity, null, undefined, "900", true, false, [], {}, new Number(900), 349.99, -1, 12000.01, 499.99]) {
    await assert.rejects(saveTrainingSample(data({ frames: [125, 250, 375, 500].map(frame), captureDurationMs })), /Capture duration/);
  }
  assert.deepEqual(await listTrainingSamples(), []);
  const row = await saveTrainingSample(data({ captureDurationMs: 500 }));
  assert.throws(() => exportTrainingDataset([{ ...row, captureDurationMs: 374 }]), /Capture duration/);
  assert.deepEqual(await listTrainingSamples(), [row]);
});

test("capture duration metadata does not weaken simultaneous visibility or negative-type gates", () => {
  const input = data({ captureDurationMs: 1000 });
  input.frames.forEach((pose) => pose.confidences.fill(0));
  assert.throws(() => validateTrainingSample(input), /Recapture.*together/);
  assert.throws(() => validateTrainingSample(data({ captureDurationMs: 1000, negativeType: "nonsigning" })), /Only unknown/);
  assert.equal(validateTrainingSample({ ...input, kind: "unknown", negativeType: "nonsigning" }).captureDurationMs, 1000);
});

test("metadata validation preserves explicit language, label and signer codes", async () => {
  for (const patch of [{ signLanguage: "both" }, { kind: "fake" }, { signerId: "" }, { sessionId: "person name" }, { signerId: "x".repeat(81) }, { label: " " }, { label: "x".repeat(81) }, { label: "__unknown__" }, { prediction: { status: "success", meaning: "WATER" } }]) {
    await assert.rejects(saveTrainingSample(data(patch)));
  }
  const sample = await saveTrainingSample(data({ label: " தண்ணீர் ", signLanguage: "asl" }));
  assert.equal(sample.label, "தண்ணீர்"); assert.equal(sample.signLanguage, "asl");
});

test("export detects corrupt counters and duplicate sample IDs", async () => {
  const row = await saveTrainingSample(data());
  assert.throws(() => exportTrainingDataset([row, row]), /duplicate/);
  assert.throws(() => exportTrainingDataset([{ ...row, frameCount: 99 }]), /frame count/);
  assert.throws(() => exportTrainingDataset([{ ...row, durationMs: 1 }]), /duration/);
  assert.throws(() => exportTrainingDataset([{ ...row, createdAt: NaN }]), /creation/);
  assert.throws(() => exportTrainingDataset([{ ...row, consent: false }]), /Choose to save/);
});

test("concurrent saves cannot exceed the sample count cap", async () => {
  const prototype = await saveTrainingSample(data());
  await deleteTrainingSample(prototype.id);
  await seed(Array.from({ length: MAX_TRAINING_SAMPLES - 1 }, (_, i) => ({ ...prototype, id: `seed-${i}` })));
  const results = await Promise.allSettled([saveTrainingSample(data()), saveTrainingSample(data())]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /250 samples/);
  assert.equal((await listTrainingSamples()).length, MAX_TRAINING_SAMPLES);
});

test("concurrent saves account for actual bytes within the same write transaction", async () => {
  const input = data({ frames: Array.from({ length: 100 }, (_, i) => frame(i * 100)) });
  input.frames.forEach((pose) => pose.keypoints.forEach((point) => { point[0] = .1234567890123456; point[1] = .2345678901234567; point[2] = -.3456789012345678; }));
  const prototype = await saveTrainingSample(input);
  await deleteTrainingSample(prototype.id);
  const seedCount = Math.floor(MAX_TRAINING_BYTES / prototype.byteSize) - 1;
  assert.ok(seedCount < MAX_TRAINING_SAMPLES - 2);
  await seed(Array.from({ length: seedCount }, (_, i) => ({ ...prototype, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })));
  const results = await Promise.allSettled([saveTrainingSample(input), saveTrainingSample(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /32 MB/);
  const all = await listTrainingSamples();
  assert.ok(all.reduce((total, row) => total + bytes(row), 0) <= MAX_TRAINING_STORAGE_BYTES);
  assert.ok(bytes(exportTrainingDataset(all)) <= MAX_TRAINING_BYTES);
});

test("the save budget reserves enough envelope space to export every sample", async () => {
  const prototype = await saveTrainingSample(data());
  const rows = Array.from({ length: MAX_TRAINING_SAMPLES }, (_, i) => ({ ...prototype, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
  const dataset = exportTrainingDataset(rows);
  const envelope = bytes(dataset) - dataset.samples.reduce((total, row) => total + bytes(row), 0);
  assert.ok(envelope > 0 && envelope <= TRAINING_EXPORT_RESERVE_BYTES);
  assert.equal(MAX_TRAINING_STORAGE_BYTES + TRAINING_EXPORT_RESERVE_BYTES, MAX_TRAINING_BYTES);
});

test("browser storage failure rejects with a useful local error", async () => {
  delete globalThis.indexedDB;
  await assert.rejects(saveTrainingSample(data()), /unavailable/);
});

test("validator returns a deep pose copy without treating a prediction as the label", () => {
  const input = data({ label: "HELP", prediction: { status: "recognized", meaning: "WATER" } });
  const copy = validateTrainingSample(input);
  input.frames[0].keypoints[0][0] = 8;
  assert.equal(copy.frames[0].keypoints[0][0], .5); assert.equal(copy.label, "HELP");
});

test("training hook retains committed inventory through concurrent mutations and unmount", async () => {
  const { JSDOM } = await import("jsdom");
  const { createElement, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useTrainingSamples } = await import("../src/hooks/useTrainingSamples.js");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  const descriptors = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  let hook, mounted = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  function Harness() { hook = useTrainingSamples(); return createElement("div", null, hook.samples.length); }
  try {
    const existing = await saveTrainingSample(data());
    await act(async () => root.render(createElement(Harness)));
    let added;
    await act(async () => { added = await hook.add(data({ signLanguage: "asl" })); });
    assert.deepEqual(new Set(hook.samples.map((row) => row.id)), new Set([existing.id, added.id]));
    await act(async () => { await assert.rejects(hook.add(data({ consent: false })), /Choose to save/); });
    assert.match(hook.error, /Choose to save/);
    await act(async () => { await Promise.all([hook.remove(existing.id), hook.reload()]); });
    assert.deepEqual(hook.samples.map((row) => row.id), [added.id]);
    assert.equal(hook.loading, false);
    let saving;
    await act(async () => { saving = hook.add(data()); root.unmount(); mounted = false; await saving; });
    assert.equal((await listTrainingSamples()).length, 2);
  } finally {
    if (mounted) await act(async () => root.unmount());
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    dom.window.close();
  }
});
