import { useCallback, useEffect, useRef, useState } from "react";
import { askSign, interpretSignVideo } from "../lib/api.js";
import { recordSignTurn } from "../lib/signCapture.js";
import { canSpeak, createSpeaker } from "../lib/speech.js";
import { language } from "../lib/languages.js";

/** Each async operation belongs to a turn. End/interrupt invalidates that turn immediately. */
export function useSignSession(settings) {
  const [phase, setPhase] = useState("idle");
  const [clip, setClip] = useState(null);
  const [meaning, setMeaning] = useState("");
  const [interpretation, setInterpretation] = useState(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [log, setLog] = useState([]);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [speaker] = useState(createSpeaker);
  const phaseRef = useRef("idle");
  const epoch = useRef(0);
  const recorder = useRef(null);
  const request = useRef(null);
  const history = useRef([]);
  const alive = useRef(true);
  const latest = useRef(settings);
  const replySpeech = useRef(false);
  replySpeech.current = speakReplies;
  latest.current = settings;
  const transition = useCallback((next) => { phaseRef.current = next; setPhase(next); }, []);
  const cancel = useCallback(() => {
    epoch.current++;
    request.current?.abort(); request.current = null;
    recorder.current?.cancel(); recorder.current = null;
    speaker.cancel();
    setLog((all) => all.map((turn) => turn.pending ? { ...turn, pending: false, interrupted: true } : turn));
  }, [speaker]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; epoch.current++;
      request.current?.abort(); recorder.current?.cancel(); speaker.cancel();
    };
  }, [speaker]);
  const valid = (id) => alive.current && epoch.current === id;
  const clearDraft = () => { setClip(null); setMeaning(""); setInterpretation(null); setElapsed(0); setError(""); };
  const start = () => { if (phaseRef.current !== "idle") return; cancel(); clearDraft(); transition("ready"); };
  const end = () => { cancel(); clearDraft(); transition("idle"); };
  const interrupt = () => { cancel(); clearDraft(); transition("ready"); };
  const again = () => { cancel(); clearDraft(); transition("ready"); };
  const newConversation = () => { cancel(); clearDraft(); history.current = []; setLog([]); transition(phaseRef.current === "idle" ? "idle" : "ready"); };
  const capture = (stream) => {
    if (["idle", "capturing"].includes(phaseRef.current)) return;
    cancel(); clearDraft();
    const id = epoch.current;
    transition("capturing");
    try {
      recorder.current = recordSignTurn(stream, {
        onElapsed: (ms) => { if (valid(id)) setElapsed(ms); },
        onComplete: (next) => { if (!valid(id)) return; recorder.current = null; setClip(next); transition("preview"); },
        onError: (message) => { if (!valid(id)) return; recorder.current = null; setError(message); transition("ready"); },
      });
    } catch (err) { setError(err.message || "Couldn't start recording."); transition("ready"); }
  };
  const finish = () => { if (phaseRef.current === "capturing") recorder.current?.finish(); };
  const importClip = (blob, duration) => {
    if (!["ready", "replied", "preview", "review"].includes(phaseRef.current)) return;
    cancel(); clearDraft(); setClip({ blob, duration }); transition("preview");
  };
  const interpret = async (consent) => {
    if (!clip || !["preview", "review"].includes(phaseRef.current)) return;
    if (!consent) { setError("Choose whether to send this clip to Google Gemini before interpreting it."); return; }
    cancel(); setError(""); transition("interpreting");
    const id = epoch.current;
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await interpretSignVideo({ ...clip, ...latest.current, consent: true, signal: controller.signal });
      if (!valid(id)) return;
      setMeaning(result.meaning); setInterpretation(result); transition("review");
    } catch (err) {
      if (!valid(id)) return;
      setError(err.message || "Couldn't interpret the video. You can type its meaning instead."); transition("preview");
    } finally { if (request.current === controller) request.current = null; }
  };
  const send = async (text = meaning, { signed = Boolean(clip) } = {}) => {
    const value = text.trim().slice(0, 2000);
    if (!value || ["idle", "capturing", "interpreting", "thinking"].includes(phaseRef.current)) return;
    cancel(); setMeaning(value); setError(""); transition("thinking");
    const id = epoch.current;
    const controller = new AbortController(); request.current = controller;
    const { lang, signLanguage, rate } = latest.current;
    const turnId = `${Date.now()}-${id}`;
    const messages = [...history.current, { role: "user", text: `Typed: ${value}` }];
    const patch = (next) => setLog((all) => all.map((t) => t.id === turnId ? { ...t, ...next } : t));
    setLog((all) => [...all, { id: turnId, said: value, signed, lang, signLanguage, pending: true }]);
    try {
      const { reply } = await askSign({ lang, messages, signal: controller.signal });
      if (!valid(id)) return;
      history.current = [...messages, { role: "assistant", text: reply }].slice(-12);
      patch({ reply, pending: false }); setClip(null); setMeaning(""); setInterpretation(null); transition("replied");
      if (replySpeech.current && canSpeak) speaker.speak(reply, { lang: language(lang).bcp47, rate });
      return { ok: true, reply };
    } catch (err) {
      if (!valid(id)) return;
      const message = err.message || "Couldn't get an answer. Try again.";
      patch({ error: message, pending: false }); setError(message); transition("review");
      return { ok: false, error: message };
    } finally { if (request.current === controller) request.current = null; }
  };
  return { phase, active: phase !== "idle", clip, meaning, setMeaning, interpretation, error, elapsed, log, speakReplies,
    setSpeakReplies: (on) => { replySpeech.current = on; setSpeakReplies(on); if (!on) speaker.cancel(); },
    start, end, interrupt, again, newConversation, capture, finish, importClip, interpret, send,
    speak: (turn) => speaker.speak(turn.reply, { lang: language(turn.lang).bcp47, rate: latest.current.rate }),
    speakMessage: () => { if (meaning.trim()) speaker.speak(meaning, { lang: language(latest.current.lang).bcp47, rate: latest.current.rate }); },
    stopSpeech: () => speaker.cancel(),
  };
}
