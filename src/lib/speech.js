// Browser speech: speech-to-text (Web Speech API) and text-to-speech (speechSynthesis).
import { stripForSpeech } from "./text.js";

const Recognition =
  typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const canListen = Boolean(Recognition);
export const canSpeak =
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

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
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    onInterim?.(`${finalText}${interim}`.trim());
  };
  rec.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") onError?.(event.error);
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    onEnd?.(finalText.trim());
  };

  rec.start();
  return {
    stop: () => rec.stop(),
    abort: () => {
      ended = true;
      rec.abort();
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
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, 1500);
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

/**
 * Queues sentences on speechSynthesis. onIdle fires when the last queued sentence finishes.
 * Short sentences also avoid Chrome cutting off long utterances.
 */
export function createSpeaker() {
  const live = new Set();
  let onIdle = null;

  function speak(text, { voice, lang, rate = 1, onStart } = {}) {
    const clean = stripForSpeech(text);
    if (!clean || !canSpeak) return Promise.resolve();
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(clean);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || lang;
      utterance.rate = rate;
      live.add(utterance); // Keeping a reference stops Chrome from dropping the end event.
      // Some browsers silently never speak or never fire "end"; a watchdog keeps the app moving.
      const longest = 8000 + (clean.length * 120) / rate;
      let watchdog = 0;
      const finish = () => {
        clearTimeout(watchdog);
        resolve();
        if (!live.delete(utterance)) return;
        if (live.size === 0) onIdle?.();
      };
      utterance.onstart = () => onStart?.();
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
      // Queued sentences wait for earlier ones, so the watchdog allows for everything ahead of it.
      watchdog = setTimeout(finish, longest * live.size);
    });
  }

  function cancel() {
    live.clear();
    if (canSpeak) window.speechSynthesis.cancel();
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
