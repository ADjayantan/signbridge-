// Exact vocabulary lookup only. Concatenating signs is not sign-language grammar.
export const SIGN_LANGUAGES = [{ code: "isl", name: "Indian Sign Language · ISL" }, { code: "asl", name: "American Sign Language · ASL" }];
export const MAX_CLIP_BYTES = 20 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 150 * 1024 * 1024;

export function wordsOf(text) {
  return String(text).normalize("NFKC").replace(/’/g, "'").toLowerCase().match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu) || [];
}

export function clipId({ signLanguage, textLanguage, label }) {
  return JSON.stringify([signLanguage, textLanguage, wordsOf(label).join(" ")]);
}

export function planSignVideos(text, clips, signLanguage, textLanguage) {
  const words = wordsOf(text);
  const entries = clips.filter((c) => c.signLanguage === signLanguage && c.textLanguage === textLanguage)
    .map((clip) => ({ clip, words: wordsOf(clip.label) })).filter((e) => e.words.length)
    .sort((a, b) => b.words.length - a.words.length);
  const steps = [];
  for (let i = 0; i < words.length;) {
    const found = entries.find((e) => e.words.every((w, n) => words[i + n] === w));
    if (found) {
      steps.push({ kind: "video", text: words.slice(i, i + found.words.length).join(" "), clip: found.clip });
      i += found.words.length;
    } else {
      steps.push({ kind: "missing", text: words[i++] });
    }
  }
  const covered = steps.filter((s) => s.kind === "video").reduce((n, s) => n + wordsOf(s.text).length, 0);
  return { steps, covered, total: words.length, exactPhrase: steps.length === 1 && steps[0].kind === "video" };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("signbridge-videos", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("clips", { keyPath: "id" });
    request.onerror = () => reject(new Error("Video storage is unavailable in this browser."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listSignVideos() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("clips", "readonly");
    const req = tx.objectStore("clips").getAll();
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Couldn't load saved sign videos.")); };
  });
}

export async function saveSignVideo({ label, signLanguage, textLanguage, blob, source = "Your recording" }) {
  label = String(label).trim().slice(0, 120);
  if (!wordsOf(label).length) throw new Error("Enter a word or phrase for this video.");
  if (!["isl", "asl"].includes(signLanguage) || !["en", "ta", "hi", "ml", "te", "kn"].includes(textLanguage)) throw new Error("Choose a supported language.");
  if (!(blob instanceof Blob) || !/^video\/(webm|mp4|ogg)(;|$)/.test(blob.type) || !blob.size || blob.size > MAX_CLIP_BYTES) {
    throw new Error("Choose an MP4, WebM or Ogg video under 20 MB.");
  }
  const clip = { id: clipId({ label, signLanguage, textLanguage }), label, signLanguage, textLanguage, blob, source: String(source).slice(0, 160), createdAt: Date.now() };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("clips", "readwrite");
    const store = tx.objectStore("clips");
    let message = "Couldn't save this video. Browser storage may be full.";
    const req = store.getAll();
    req.onsuccess = () => {
      if (req.result.some((c) => c.id === clip.id)) { message = "This phrase already has a video. Delete it first to replace it."; tx.abort(); return; }
      if (req.result.reduce((n, c) => n + c.blob.size, 0) + blob.size > MAX_LIBRARY_BYTES) { message = "Your video library is full (150 MB). Export and remove some clips first."; tx.abort(); return; }
      store.put(clip);
    };
    tx.oncomplete = () => { db.close(); resolve(clip); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error(message)); };
  });
}

export async function deleteSignVideo(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("clips", "readwrite");
    tx.objectStore("clips").delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Couldn't delete this video.")); };
  });
}
