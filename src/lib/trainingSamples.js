// Consented whole-sign poses only. No camera video, audio or automatic training.
export const TRAINING_DATASET_FORMAT = "signbridge-pose-dataset-v1";
export const MAX_TRAINING_BYTES = 32 * 1024 * 1024;
export const MAX_TRAINING_SAMPLES = 250;
// The dataset envelope and at most 249 sample separators fit in this reserve.
// Every full local inventory can therefore be exported under the same 32 MB limit.
export const TRAINING_EXPORT_RESERVE_BYTES = 1024;
export const MAX_TRAINING_STORAGE_BYTES = MAX_TRAINING_BYTES - TRAINING_EXPORT_RESERVE_BYTES;
export const TRAINING_DB_NAME = "signbridge-training-poses";
export const TRAINING_NEGATIVE_TYPES = ["nonsigning", "unsupported-sign", "unspecified"];
const STORE = "samples";
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function code(value, name) {
  if (typeof value !== "string" || !codePattern.test(value)) throw new Error(`Enter a ${name} code using 1–80 letters, numbers, dots, dashes or underscores.`);
  return value;
}

/** Validate and copy only supported fields; caller changes cannot alter a saved pose. */
export function validateTrainingSample(input, { stored = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.consent !== true) throw new Error("Choose to save this pose sample before adding it to the training dataset.");
  if (!["isl", "asl"].includes(input.signLanguage)) throw new Error("Choose ISL or ASL for the sample.");
  if (!["known", "unknown"].includes(input.kind)) throw new Error("Choose a labelled sign or an unknown/background sample.");
  const label = input.kind === "unknown" ? "__unknown__" : typeof input.label === "string" ? input.label.trim() : "";
  if (!label || label.length > 80 || (input.kind === "known" && label === "__unknown__")) throw new Error("Enter a sign label with 1–80 characters.");
  const signerId = code(input.signerId, "signer"), sessionId = code(input.sessionId, "session");
  if (!Array.isArray(input.frames) || input.frames.length < 4 || input.frames.length > 100) throw new Error("A sample needs 4–100 pose frames from one turn.");
  let previous = -1;
  const frames = Array.from(input.frames, (frame) => {
    if (!frame || !finite(frame.atMs) || frame.atMs < 0 || frame.atMs > 12000 || frame.atMs <= previous) throw new Error("Pose timestamps must increase within a 12 second turn.");
    previous = frame.atMs;
    if (!Array.isArray(frame.keypoints) || frame.keypoints.length !== 75 || !Array.isArray(frame.confidences) || frame.confidences.length !== 75) throw new Error("Each pose frame needs 75 landmarks and confidence values.");
    const keypoints = Array.from(frame.keypoints, (point) => {
      if (!Array.isArray(point) || point.length !== 3 || !Array.from(point).every((value) => finite(value) && Math.abs(value) <= 10)) throw new Error("Pose coordinates must be finite numbers between -10 and 10.");
      return [...point];
    });
    const confidences = Array.from(frame.confidences);
    if (!confidences.every((value) => finite(value) && value >= 0 && value <= 1)) throw new Error("Pose confidence values must be between 0 and 1.");
    return { keypoints, confidences, atMs: frame.atMs };
  });
  if (input.kind === "known") {
    const qualified = frames.filter((frame) => (frame.confidences[33] >= .5 || frame.confidences[54] >= .5) && frame.confidences[11] >= .2 && frame.confidences[12] >= .2);
    if (qualified.length < 4) throw new Error("Recapture this labelled sign: at least four frames need visible hands and both shoulders together in the signing interval.");
  }
  const sample = { signLanguage: input.signLanguage, label, signerId, sessionId, kind: input.kind, consent: true, frames };
  // Old v1 samples omit this metadata. Never infer nonsigning from their poses or prediction.
  if (Object.hasOwn(input, "negativeType")) {
    if (input.kind !== "unknown" || !TRAINING_NEGATIVE_TYPES.includes(input.negativeType)) throw new Error("Only unknown samples can declare nonsigning, unsupported-sign or unspecified negative type.");
    sample.negativeType = input.negativeType;
  }
  // Measured recording window, independent of the legacy last-minus-first span.
  // Older exports omit it; pose timestamps alone cannot recover this window.
  if (Object.hasOwn(input, "captureDurationMs")) {
    if (!finite(input.captureDurationMs) || input.captureDurationMs < 350 || input.captureDurationMs > 12000 || input.captureDurationMs < frames.at(-1).atMs) throw new Error("Capture duration must be a measured 350–12,000 ms recording window covering every pose timestamp.");
    sample.captureDurationMs = input.captureDurationMs;
  }
  if (input.prediction != null) {
    const prediction = input.prediction;
    if (!prediction || !["recognized", "unclear", "no_sign"].includes(prediction.status) || typeof prediction.meaning !== "string" || prediction.meaning.length > 120) throw new Error("The optional prediction needs a valid status and short text meaning.");
    sample.prediction = { status: prediction.status, meaning: prediction.meaning };
  }
  if (stored) {
    sample.id = code(input.id, "sample ID");
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) throw new Error("The sample has an invalid creation time.");
    sample.createdAt = input.createdAt;
  }
  sample.frameCount = frames.length;
  sample.durationMs = frames.at(-1).atMs - frames[0].atMs;
  if (stored && (input.frameCount !== sample.frameCount || input.durationMs !== sample.durationMs)) throw new Error("The sample frame count or duration does not match its poses.");
  return sample;
}

function sizeSample(sample) {
  // Include the size field itself so budget accounting matches the saved JSON.
  sample.byteSize = 0;
  let actual = byteLength(sample);
  while (actual !== sample.byteSize) { sample.byteSize = actual; actual = byteLength(sample); }
  return sample;
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Pose storage is unavailable in this browser.")); return; }
    const request = indexedDB.open(TRAINING_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onerror = () => reject(new Error("Pose storage is unavailable in this browser."));
    request.onblocked = () => reject(new Error("Close other SignBridge tabs and retry pose storage."));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

export async function saveTrainingSample(input) {
  // Snapshot before the first await, including before opening IndexedDB.
  const sample = sizeSample({ ...validateTrainingSample(input), id: crypto.randomUUID(), createdAt: Date.now() });
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
    let message = "Couldn't save this pose sample. Browser storage may be full.";
    const request = store.getAll();
    request.onsuccess = () => {
      if (request.result.length >= MAX_TRAINING_SAMPLES) { message = "Your training dataset is full (250 samples). Export and remove some samples first."; tx.abort(); return; }
      // Stored sizes are generated by this module; recompute for older/corrupt rows.
      const used = request.result.reduce((total, row) => total + byteLength(row), 0);
      if (used + sample.byteSize > MAX_TRAINING_STORAGE_BYTES) { message = "Your training dataset is full (32 MB). Export and remove some samples first."; tx.abort(); return; }
      store.add(sample);
    };
    tx.oncomplete = () => { db.close(); resolve(sample); };
    tx.onabort = () => { db.close(); reject(new Error(message)); };
    tx.onerror = () => { message = "Couldn't save this pose sample. Browser storage may be full."; };
  });
}

export async function listTrainingSamples() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly"), request = tx.objectStore(STORE).getAll();
    tx.oncomplete = () => { db.close(); resolve(request.result.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))); };
    tx.onabort = () => { db.close(); reject(new Error("Couldn't load saved pose samples.")); };
  });
}

export async function deleteTrainingSample(id) {
  code(id, "sample ID");
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error("Couldn't delete this pose sample.")); };
  });
}

export function exportTrainingDataset(samples) {
  if (!Array.isArray(samples) || samples.length > MAX_TRAINING_SAMPLES) throw new Error("Choose up to 250 saved samples to export.");
  const snapshots = samples.map((sample) => sizeSample(validateTrainingSample(sample, { stored: true })));
  if (new Set(snapshots.map((sample) => sample.id)).size !== snapshots.length) throw new Error("The dataset contains duplicate sample IDs.");
  const dataset = { format: TRAINING_DATASET_FORMAT, exportedAt: new Date().toISOString(), samples: snapshots };
  if (byteLength(dataset) > MAX_TRAINING_BYTES) throw new Error("This export exceeds 32 MB. Export a smaller selection.");
  return dataset;
}

export function summarizeTrainingSamples(samples) {
  const summarize = (rows) => ({ total: rows.length, known: rows.filter((row) => row.kind === "known").length, unknown: rows.filter((row) => row.kind === "unknown").length,
    negativeTypes: Object.fromEntries(TRAINING_NEGATIVE_TYPES.map((type) => [type, rows.filter((row) => row.kind === "unknown" && (row.negativeType ?? "unspecified") === type).length])),
    signers: new Set(rows.map((row) => row.signerId)).size, sessions: new Set(rows.map((row) => `${row.signerId}:${row.sessionId}`)).size });
  return { ...summarize(samples), bytes: samples.reduce((total, row) => total + byteLength(row), 0), languages: Object.fromEntries(["isl", "asl"].map((language) => [language, summarize(samples.filter((row) => row.signLanguage === language))])) };
}
