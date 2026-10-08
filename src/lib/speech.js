// Browser speech: speech-to-text (Web Speech API) and text-to-speech (speechSynthesis).
import { stripForSpeech } from "./text.js";

const Recognition =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const canListen = Boolean(Recognition);
export const canSpeak =
  typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function" && typeof window.SpeechSynthesisUtterance === "function";

/**
 * Listens for one utterance. Calls onEnd(finalText) once when the user stops talking
 * ("" if nothing was heard). abort() cancels without calling onEnd.
 */
export function listenOnce({ lang, onInterim, onEnd, onError }) {
  const rec = new Recognition();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = "";
  let ended = false;

  rec.onresult = (event) => {
    if (ended) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    onInterim?.(`${finalText}${interim}`.trim());
  };
  rec.onerror = (event) => {
    if (ended) return;
    if (event.error !== "aborted" && event.error !== "no-speech") onError?.(event.error);
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    onEnd?.(finalText.trim());
  };

  rec.start();
  return {
    stop: () => { if (!ended) { try { rec.stop(); } catch { /* Already stopped by the browser. */ } } },
    abort: () => {
      ended = true;
      try { rec.abort(); } catch { /* Already stopped by the browser. */ }
    },
  };
}

/** Plain-language message for a SpeechRecognition error code. */
export function listenErrorMessage(code) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow microphone access for this site in your browser, then try again.";
    case "audio-capture":
      return "No microphone was found. Connect a microphone and try again.";
    case "network":
      return "Speech recognition needs an internet connection. Check your connection and try again.";
    case "language-not-supported":
      return "This browser can't recognise speech in the chosen language. Try English, or use Chrome.";
    default:
      return "Speech recognition stopped unexpectedly. Try again.";
  }
}

/** Resolves with the installed voices (Chrome loads them asynchronously). */
export function getVoices() {
  if (!canSpeak) return Promise.resolve([]);
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    const timeout = setTimeout(done, 1500);
  });
}

/** Best voice for a BCP 47 tag such as "ta-IN": exact match, then same language; prefers natural voices. */
export function pickVoice(voices, bcp47) {
  const want = bcp47.toLowerCase();
  const base = want.split("-")[0];
  let best = null;
  let bestScore = 0;
  for (const voice of voices) {
    const lang = voice.lang.replace("_", "-").toLowerCase();
    let score = lang === want ? 4 : lang.split("-")[0] === base ? 2 : 0;
    if (!score) continue;
    if (/natural|neural|online|google/i.test(voice.name)) score += 1;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/** Runtime speech errors are separate from recognition or sign-model accuracy. */
export function speakErrorMessage(code) {
  switch (code) {
    case "not-allowed": return "Speech playback was blocked. Press Speak again and allow audio for this site.";
    case "audio-busy":
    case "audio-hardware": return "Speech could not reach an audio output device. Check your speakers or headphones, then retry.";
    case "network": return "This speech voice needs a network connection. Check the connection and retry.";
    case "language-unavailable":
    case "voice-unavailable": return "A speech voice for this language is unavailable. Install a matching voice or choose another language.";
    case "synthesis-unavailable":
    case "synthesis-failed": return "Your browser's speech service is unavailable. Check installed voices or try another browser.";
    case "text-too-long": return "This text is too long for browser speech. Try speaking a shorter message.";
    case "invalid-argument": return "Browser speech could not use these settings. Reset the speech speed and retry.";
    case "timeout": return "Speech did not finish. Check sound and browser permissions, then press Speak again.";
    case "unsupported": return "Speech output is unavailable in this browser. Text remains available.";
    default: return "Speech playback failed. Check your sound output and browser permissions, then retry.";
  }
}

/**
 * Queues sentences on speechSynthesis. onIdle fires when the last queued sentence settles.
 * speak resolves a status instead of rejecting, preserving callers that ignore its result.
 * Optional onError(code) reports failures; user cancellation stays silent.
 */
export function createSpeaker() {
  const live = new Map();
  let onIdle = null;

  function speak(text, { voice, lang, rate = 1, onStart, onError } = {}) {
    const clean = stripForSpeech(text);
    const report = (code) => { try { onError?.(code); } catch { /* Caller errors must not leave a native utterance pending. */ } };
    if (!clean) return Promise.resolve({ status: "empty" });
    if (!canSpeak) { report("unsupported"); return Promise.resolve({ status: "error", code: "unsupported", error: speakErrorMessage("unsupported") }); }
    return new Promise((resolve) => {
      let utterance;
      try {
        utterance = new window.SpeechSynthesisUtterance(clean);
        if (voice) utterance.voice = voice;
        if (voice?.lang || lang) utterance.lang = voice?.lang || lang;
        utterance.rate = Number.isFinite(rate) && rate > 0 ? Math.min(10, Math.max(.1, rate)) : 1;
      } catch (error) {
        const code = error?.name === "NotAllowedError" ? "not-allowed" : "synthesis-failed";
        report(code); resolve({ status: "error", code, error: speakErrorMessage(code) }); return;
      }
      // Some browsers silently never speak or never fire "end"; a watchdog keeps the app moving.
      const longest = 8000 + (clean.length * 120) / utterance.rate;
      let watchdog = 0;
      let done = false;
      let started = false;
      const finish = (status = "ended", code = "") => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        live.delete(utterance);
        if (status === "error") report(code);
        resolve({ status, ...(code ? { code, error: speakErrorMessage(code) } : {}) });
        if (status !== "cancelled" && live.size === 0) onIdle?.();
      };
      // A short turn can wait behind a longer one. Give every queued turn its
      // own duration budget instead of multiplying the new turn's length.
      const waitingBudget = [...live.values()].reduce((sum, entry) => sum + entry.budget, 0);
      live.set(utterance, { finish, budget: longest });
      utterance.onstart = () => {
        if (done || started) return;
        started = true; clearTimeout(watchdog); watchdog = setTimeout(() => finish("error", "timeout"), longest); onStart?.();
      };
      utterance.onend = () => finish();
      utterance.onerror = (event) => {
        const code = event?.error || "synthesis-failed";
        if (["canceled", "cancelled", "interrupted"].includes(code)) finish("cancelled"); else finish("error", code);
      };
      // Set the watchdog before speak(), including browsers that fire synchronously.
      watchdog = setTimeout(() => finish("error", "timeout"), longest + waitingBudget);
      try {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch (error) { finish("error", error?.name === "NotAllowedError" ? "not-allowed" : "synthesis-failed"); }
      // Queued sentences wait for earlier ones, so the watchdog allows for everything ahead of it.
    });
  }

  function cancel() {
    for (const { finish } of [...live.values()]) finish("cancelled");
    if (canSpeak) { try { window.speechSynthesis.cancel(); } catch { /* Queue promises are already settled. */ } }
  }

  return {
    speak,
    cancel,
    get busy() {
      return live.size > 0;
    },
    /** fn runs when the last queued sentence finishes (null to clear). */
    setIdleHandler(fn) {
      onIdle = fn;
    },
  };
}
