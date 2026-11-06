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
  const root = { children: new Map() };
  for (const clip of clips) {
    if (clip.signLanguage !== signLanguage || clip.textLanguage !== textLanguage) continue;
    const phrase = wordsOf(clip.label);
    if (!phrase.length || phrase.length > words.length) continue;
    let node = root;
    for (const word of phrase) {
      if (!node.children.has(word)) node.children.set(word, { children: new Map() });
      node = node.children.get(word);
    }
    // Duplicate labels retain the first supplied clip, as in the original lookup.
    node.clip ??= clip;
  }

  // Plan from the end instead of committing to a greedy longest prefix. A
  // shorter clip can leave a complete phrase available later in the message.
  // One score/choice per word keeps memory linear; no suffix arrays are copied.
  const best = new Array(words.length + 1);
  best[words.length] = { covered: 0, videos: 0, length: 0, clip: null };
  for (let i = words.length - 1; i >= 0; i--) {
    best[i] = { covered: best[i + 1].covered, videos: best[i + 1].videos, length: 1, clip: null };
    let node = root;
    for (let j = i; j < words.length; j++) {
      node = node.children.get(words[j]);
      if (!node) break;
      if (!node.clip) continue;
      const length = j - i + 1;
      const covered = length + best[j + 1].covered;
      const videos = 1 + best[j + 1].videos;
      if (covered > best[i].covered || (covered === best[i].covered &&
        (videos < best[i].videos || (videos === best[i].videos && (!best[i].clip || length > best[i].length))))) {
        best[i] = { covered, videos, length, clip: node.clip };
      }
    }
  }
  const steps = [];
  for (let i = 0; i < words.length;) {
    const choice = best[i];
    if (choice.clip) {
      steps.push({ kind: "video", text: words.slice(i, i + choice.length).join(" "), clip: choice.clip });
      i += choice.length;
    } else {
      steps.push({ kind: "missing", text: words[i++] });
    }
  }
  return { steps, covered: best[0].covered, total: words.length, exactPhrase: steps.length === 1 && steps[0].kind === "video" };
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
