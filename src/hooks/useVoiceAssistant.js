import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { streamVoice } from "../lib/api.js";
import { earcon } from "../lib/earcons.js";
import { language } from "../lib/languages.js";
import { canListen, canSpeak, createSpeaker, getVoices, listenErrorMessage, listenOnce, pickVoice } from "../lib/speech.js";
import { createSentenceChunker } from "../lib/text.js";

const MAX_HISTORY = 12;

const speaksAloud = (s) => s.voiceOutput === "voice" && canSpeak;

/**
 * The voice assistant loop: listen → think → speak → (hands-free) listen again.
 * Replies are spoken sentence by sentence while the AI is still writing, so the first words
 * come out quickly. Every async callback checks the turn number, so an interrupted turn can
 * never speak or change state afterwards.
 *
 * status: "idle" | "listening" | "thinking" | "speaking"
 */
export function useVoiceAssistant({ lang, rate, handsFree, voiceOutput, captureImage }) {
  const [status, setStatusState] = useState("idle");
  const [interim, setInterim] = useState("");
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [voiceMissing, setVoiceMissing] = useState(false);

  const [speaker] = useState(createSpeaker);
  const statusRef = useRef("idle");
  const turnRef = useRef(0);
  const historyRef = useRef([]);
  const recRef = useRef(null);
  const abortRef = useRef(null);
  const voiceRef = useRef(null);
  const englishVoiceRef = useRef(null);
  const lastReplyRef = useRef("");
  const askRef = useRef(null);
  // Latest settings for callbacks that run later (speech events, streaming).
  const settings = useRef({ lang, rate, handsFree, voiceOutput, captureImage });
  useLayoutEffect(() => {
    settings.current = { lang, rate, handsFree, voiceOutput, captureImage };
  });

  const setStatus = useCallback((next) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  useEffect(() => {
    let alive = true;
    getVoices().then((voices) => {
      if (!alive) return;
      voiceRef.current = pickVoice(voices, language(lang).bcp47);
      englishVoiceRef.current = pickVoice(voices, "en-IN") || pickVoice(voices, "en-US");
      setVoiceMissing(canSpeak && voices.length > 0 && !voiceRef.current);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  const say = useCallback((text, { english = false, onStart } = {}) => {
    const { lang: code, rate: speed } = settings.current;
    return speaker.speak(text, {
      voice: english ? englishVoiceRef.current : voiceRef.current,
      lang: english ? "en-IN" : language(code).bcp47,
      rate: speed,
      onStart,
    });
  }, [speaker]);

  const stopAll = useCallback(() => {
    turnRef.current += 1;
    recRef.current?.abort();
    recRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    speaker.setIdleHandler(null);
    speaker.cancel();
    setInterim("");
  }, [speaker]);

  /** Short app message (errors, toggles): spoken in voice mode, announced for screen readers. */
  const notify = useCallback(
    (text, { isError = false } = {}) => {
      if (isError) {
        setError(text);
        earcon.error();
      }
      // Don't talk over the microphone, except to report that listening failed.
      if (!speaksAloud(settings.current) || (!isError && statusRef.current === "listening")) {
        setAnnouncement(text);
        return;
      }
      // When nothing else is happening, finishing this message must not restart listening.
      if (statusRef.current === "idle") speaker.setIdleHandler(null);
      say(text, { english: true });
    },
    [say, speaker],
  );

  const listen = useCallback(() => {
    if (!canListen) {
      setError("Voice input needs Chrome or Edge. You can type your question below instead.");
      return;
    }
    stopAll();
    const turn = turnRef.current;
    let failed = false;
    setError("");
    earcon.listen();
    setStatus("listening");
    try {
      recRef.current = listenOnce({
        lang: language(settings.current.lang).bcp47,
        onInterim: (text) => {
          if (turn === turnRef.current) setInterim(text);
        },
        onError: (code) => {
          if (turn !== turnRef.current) return;
          failed = true;
          notify(listenErrorMessage(code), { isError: true });
        },
        onEnd: (text) => {
          if (turn !== turnRef.current) return;
          recRef.current = null;
          setInterim("");
          if (text && !failed) {
            askRef.current(text);
            return;
          }
          if (!failed) earcon.stop();
          setStatus("idle");
        },
      });
    } catch {
      setStatus("idle");
      notify("The microphone couldn't start. Try again.", { isError: true });
    }
  }, [notify, setStatus, stopAll]);

  const ask = useCallback(
    async (question) => {
      const text = question.trim();
      if (!text) return;
      stopAll();
      const turn = turnRef.current;
      const aloud = speaksAloud(settings.current);
      const { lang: code, captureImage: capture } = settings.current;
      const history = [...historyRef.current, { role: "user", text }].slice(-MAX_HISTORY);
      const id = `${Date.now()}-${turn}`;
      const patch = (fields) => setMessages((all) => all.map((m) => (m.id === `${id}-a` ? { ...m, ...fields } : m)));

      setError("");
      setMessages((all) => [
        ...all,
        { id: `${id}-u`, role: "user", text },
        { id: `${id}-a`, role: "assistant", text: "", pending: true },
      ]);
      setStatus("thinking");
      earcon.send();

      const controller = new AbortController();
      abortRef.current = controller;
      let image = null;
      try {
        image = capture?.() || null;
      } catch {
        image = null;
      }

      let full = "";
      let streamDone = false;
      let failed = false;
      const finish = () => {
        if (turn !== turnRef.current || !streamDone || speaker.busy) return;
        if (!failed && settings.current.handsFree && aloud) listen();
        else setStatus("idle");
      };
      speaker.setIdleHandler(finish);
      const chunker = createSentenceChunker((sentence) => {
        if (!aloud || turn !== turnRef.current) return;
        say(sentence, {
          onStart: () => {
            if (turn === turnRef.current) setStatus("speaking");
          },
        });
      });
      const pulse = setInterval(() => {
        if (turn === turnRef.current && statusRef.current === "thinking") earcon.thinking();
      }, 1800);

      try {
        for await (const piece of streamVoice({ lang: code, messages: history, image, signal: controller.signal })) {
          if (turn !== turnRef.current) return;
          full += piece;
          patch({ text: full });
          chunker.push(piece);
        }
        chunker.flush();
        historyRef.current = [...history, { role: "assistant", text: full }].slice(-MAX_HISTORY);
        lastReplyRef.current = full;
        patch({ text: full, pending: false });
        if (!aloud) setAnnouncement(full);
      } catch (err) {
        if (controller.signal.aborted || turn !== turnRef.current) return;
        failed = true;
        const message = err?.message || "Something went wrong. Try again.";
        patch({ text: message, pending: false, error: true });
        speaker.cancel();
        speaker.setIdleHandler(finish);
        notify(message, { isError: true });
      } finally {
        clearInterval(pulse);
        if (turn === turnRef.current) {
          abortRef.current = null;
          streamDone = true;
          finish();
        }
      }
    },
    [listen, notify, say, setStatus, speaker, stopAll],
  );
  useLayoutEffect(() => {
    askRef.current = ask;
  }, [ask]);

  /** Space / the big button: start talking, stop talking early, or interrupt the answer. */
  const toggle = useCallback(() => {
    if (statusRef.current === "listening") recRef.current?.stop();
    else listen();
  }, [listen]);

  /** Esc: stop everything. */
  const cancel = useCallback(() => {
    const wasBusy = statusRef.current !== "idle";
    stopAll();
    setStatus("idle");
    if (wasBusy) earcon.stop();
  }, [setStatus, stopAll]);

  const repeat = useCallback(() => {
    const last = lastReplyRef.current;
    if (!last) {
      notify("There's no answer to repeat yet.");
      return;
    }
    stopAll();
    setStatus("idle");
    if (!speaksAloud(settings.current)) {
      setAnnouncement("");
      setTimeout(() => setAnnouncement(last), 50);
      return;
    }
    const turn = turnRef.current;
    speaker.setIdleHandler(() => {
      if (turn === turnRef.current) setStatus("idle");
    });
    say(last, {
      onStart: () => {
        if (turn === turnRef.current) setStatus("speaking");
      },
    });
  }, [notify, say, setStatus, speaker, stopAll]);

  useEffect(() => stopAll, [stopAll]);

  return { status, interim, messages, error, announcement, voiceMissing, toggle, cancel, repeat, ask, notify, stopAll };
}
