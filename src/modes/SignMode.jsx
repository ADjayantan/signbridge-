import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LanguageSelect, Switch, TopBar, isTyping } from "../components/Controls.jsx";
import { AUTO_SEND_OPTIONS } from "../hooks/useSettings.js";
import { useCamera } from "../hooks/useCamera.js";
import { useHandTracking } from "../hooks/useHandTracking.js";
import { askSign } from "../lib/api.js";
import { drawHands } from "../lib/drawHands.js";
import { handsFromResult, toFeatures } from "../lib/features.js";
import { decideSign, gestureMap } from "../lib/gestures.js";
import { SignClassifier } from "../lib/knn.js";
import { language } from "../lib/languages.js";
import { createSignSmoother } from "../lib/signSmoother.js";
import { canSpeak, createSpeaker, getVoices, pickVoice } from "../lib/speech.js";
import { load, save } from "../lib/storage.js";
import TeachSigns from "./TeachSigns.jsx";

const MAX_HISTORY = 12;
const MAX_WORDS = 30;

function loadClassifier() {
  try {
    const saved = load("signs", null);
    return saved ? SignClassifier.fromJSON(saved) : new SignClassifier();
  } catch {
    return new SignClassifier();
  }
}

const SOURCE_TEXT = { taught: "your sign", gesture: "gesture" };

export default function SignMode({ settings, update, onBack }) {
  const [tab, setTab] = useState("talk");
  const [words, setWords] = useState([]);
  const [live, setLive] = useState({ hands: 0, candidate: null, progress: 0, source: null, auto: 0 });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [typed, setTyped] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [gestures, setGestures] = useState(() => gestureMap(load("gestures", null)));
  const [signsVersion, setSignsVersion] = useState(0);
  const [saveError, setSaveError] = useState("");

  const [classifier, setClassifier] = useState(loadClassifier);
  const [speaker] = useState(createSpeaker);
  const [smoother] = useState(createSignSmoother);
  const camera = useCamera({ active: true, facingMode: "user" });
  const { videoRef, status: cameraStatus, error: cameraError, retry: retryCamera } = camera;
  const canvasRef = useRef(null);
  const classifierRef = useRef(classifier);
  const wordsRef = useRef([]);
  const busyRef = useRef(false);
  const armedRef = useRef(false); // auto-send only after a new word since the last send
  const lastHandsAtRef = useRef(0);
  const lastUiRef = useRef(0);
  const recorderRef = useRef(null); // TeachSigns sets { push(features) } while recording
  const historyRef = useRef([]);
  const abortRef = useRef(null);
  const voiceRef = useRef(null);
  const sendRef = useRef(null);
  // Latest values for the per-frame loop and async callbacks.
  const latest = useRef({ tab, gestures, settings });
  useLayoutEffect(() => {
    latest.current = { tab, gestures, settings };
    classifierRef.current = classifier;
  });

  useEffect(() => {
    document.title = "Sign mode · SignBridge";
    document.getElementById("sign-title")?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    getVoices().then((voices) => {
      if (alive) voiceRef.current = pickVoice(voices, language(settings.lang).bcp47);
    });
    return () => {
      alive = false;
    };
  }, [settings.lang]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      speaker.cancel();
    },
    [speaker],
  );

  const setWordList = useCallback((next) => {
    wordsRef.current = next.slice(-MAX_WORDS);
    setWords(wordsRef.current);
  }, []);

  const ask = useCallback(async ({ text, said, glosses = null }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = `${Date.now()}`;
    const patch = (fields) => setLog((all) => all.map((e) => (e.id === id ? { ...e, ...fields } : e)));
    setLog((all) => [...all, { id, said, signed: Boolean(glosses), meaning: "", reply: "", pending: true }]);
    busyRef.current = true;
    setBusy(true);
    const { lang, rate, speakSigns } = latest.current.settings;
    try {
      const messages = [...historyRef.current, { role: "user", text }];
      const { meaning, reply } = await askSign({ lang, messages, signal: controller.signal });
      historyRef.current = [...messages, { role: "assistant", text: JSON.stringify({ meaning, reply }) }].slice(-MAX_HISTORY);
      patch({ meaning, reply, pending: false });
      setAnnouncement(`${meaning ? `You said: ${meaning}. ` : ""}SignBridge says: ${reply}`);
      if (speakSigns && canSpeak) {
        speaker.speak(meaning || said, { voice: voiceRef.current, lang: language(lang).bcp47, rate });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err?.message || "Something went wrong. Try again.";
      patch({ pending: false, error: message });
      setAnnouncement(message);
      if (glosses) setWordList([...glosses, ...wordsRef.current]); // put the words back so they can resend
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }, [setWordList, speaker]);

  const send = useCallback(() => {
    const said = wordsRef.current;
    if (!said.length || busyRef.current) return;
    armedRef.current = false;
    setWordList([]);
    // The smoother is not reset: a sign still held while sending stays "used" until the hands
    // change, so it doesn't sneak into the next sentence.
    ask({ text: `Signed: ${said.join(" ")}`, said: said.join(" "), glosses: said });
  }, [ask, setWordList]);

  const removeLast = useCallback(() => setWordList(wordsRef.current.slice(0, -1)), [setWordList]);
  const clearWords = useCallback(() => {
    armedRef.current = false;
    setWordList([]);
  }, [setWordList]);

  useLayoutEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onFrame = useCallback(
    (result, video) => {
      const hands = handsFromResult(result);
      const { videoWidth: width, videoHeight: height } = video;
      drawHands(canvasRef.current, hands, width, height);
      const aspect = width / height;
      const now = performance.now();
      const { tab: currentTab, gestures: map, settings: s } = latest.current;
      if (hands.length) lastHandsAtRef.current = now;
      if (recorderRef.current && hands.length) recorderRef.current.push(toFeatures(hands, aspect));

      const decision = decideSign(hands, aspect, classifierRef.current, map);
      const step = smoother.update(decision.label, now);
      if (step.committed && currentTab === "talk" && !recorderRef.current) {
        setWordList([...wordsRef.current, step.committed]);
        armedRef.current = true;
        setAnnouncement(`Added ${step.committed}`);
      }

      let auto = 0;
      if (currentTab === "talk" && s.autoSendMs > 0 && armedRef.current && wordsRef.current.length && !busyRef.current && !hands.length) {
        const idle = now - lastHandsAtRef.current;
        auto = Math.min(1, idle / s.autoSendMs);
        if (idle >= s.autoSendMs) sendRef.current();
      }

      if (step.committed || now - lastUiRef.current > 80) {
        lastUiRef.current = now;
        setLive({
          hands: hands.length,
          candidate: step.candidate,
          progress: step.progress,
          source: decision.label && decision.label === step.candidate ? decision.source : null,
          auto,
        });
      }
    },
    [setWordList, smoother],
  );

  const tracking = useHandTracking({ videoRef, active: cameraStatus === "on", onFrame });
  const ready = cameraStatus === "on" && tracking.status === "ready";

  useEffect(() => {
    const onKey = (e) => {
      if (latest.current.tab !== "talk" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTyping(e)) return;
      const onControl = e.target instanceof HTMLElement && ["BUTTON", "A", "SUMMARY"].includes(e.target.tagName);
      if (e.key === "Enter" && !onControl) {
        e.preventDefault();
        send();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        removeLast();
      } else if (e.key === "Escape") {
        clearWords();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearWords, removeLast, send]);

  const persistSigns = useCallback(
    (instance) => {
      const ok = save("signs", instance.toJSON());
      setSaveError(
        ok ? "" : "Couldn't save your signs in this browser (storage is full or blocked). Export them so you don't lose them.",
      );
      smoother.reset();
      setSignsVersion((v) => v + 1);
    },
    [smoother],
  );

  const signsChanged = useCallback(() => persistSigns(classifier), [classifier, persistSigns]);

  const replaceClassifier = useCallback(
    (next) => {
      classifierRef.current = next;
      setClassifier(next);
      persistSigns(next);
    },
    [persistSigns],
  );

  const changeGestures = useCallback((next) => {
    setGestures(next);
    save("gestures", next);
  }, []);

  const submitTyped = (e) => {
    e.preventDefault();
    const value = typed.trim();
    if (!value || busy) return;
    setTyped("");
    ask({ text: `Typed: ${value}`, said: value });
  };

  const replyLang = language(settings.lang).bcp47;

  return (
    <main className="mode sign-mode" aria-labelledby="sign-title">
      <TopBar title="Sign mode" titleId="sign-title" onBack={onBack}>
        <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="sign-language" />
      </TopBar>

      <div className="tabs" role="tablist" aria-label="Sign mode">
        {[
          ["talk", "Talk"],
          ["teach", "Teach signs"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={`tab${tab === id ? " active" : ""}`}
            onClick={() => {
              setTab(id);
              smoother.reset();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="sign-layout">
        <section className="camera-panel" aria-label="Camera">
          <div className="camera">
            <video ref={videoRef} className="mirror" muted playsInline aria-hidden="true" />
            <canvas ref={canvasRef} className="mirror overlay" aria-hidden="true" />
            {cameraStatus === "starting" && <p className="camera-status">Starting camera…</p>}
            {cameraStatus === "error" && (
              <div className="camera-status error" role="alert">
                <p>{cameraError}</p>
                <button type="button" className="btn btn-small" onClick={retryCamera}>
                  Try again
                </button>
              </div>
            )}
            {cameraStatus === "on" && tracking.status === "loading" && (
              <p className="camera-status">Loading hand tracking…</p>
            )}
            {tracking.status === "error" && (
              <div className="camera-status error" role="alert">
                <p>{tracking.error}</p>
                <button type="button" className="btn btn-small" onClick={tracking.retry}>
                  Try again
                </button>
              </div>
            )}
            {ready && (
              <div className={`live-chip${live.candidate ? " has-sign" : ""}`} aria-hidden="true">
                {live.hands === 0 ? (
                  <span>Show your hands</span>
                ) : live.candidate ? (
                  <>
                    <span className="ring" style={{ "--p": live.progress }} />
                    <strong>{live.candidate}</strong>
                    {live.source && <small>{SOURCE_TEXT[live.source]}</small>}
                  </>
                ) : (
                  <span>
                    {live.hands} hand{live.hands > 1 ? "s" : ""} · no sign
                  </span>
                )}
              </div>
            )}
            {live.auto > 0 && tab === "talk" && (
              <div className="auto-send" aria-hidden="true">
                <div className="auto-send-bar" style={{ "--p": live.auto }} />
                <span>Sending… raise a hand to keep signing</span>
              </div>
            )}
          </div>
          <p className="hint">
            Hold each sign still for a moment to add it. Lower your hands to send. Hand tracking runs on this device —
            video never leaves it.
          </p>
        </section>

        {tab === "talk" ? (
          <section id="panel-talk" role="tabpanel" aria-labelledby="tab-talk" className="talk-panel">
            <div className="sentence-box">
              <h2 className="panel-title" id="sentence-title">
                Your signs
              </h2>
              <ol className="sentence" aria-labelledby="sentence-title">
                {words.length === 0 ? (
                  <li className="placeholder">Signed words appear here</li>
                ) : (
                  words.map((w, i) => (
                    <li key={`${i}-${w}`} className="word">
                      {w}
                    </li>
                  ))
                )}
              </ol>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={send} disabled={!words.length || busy}>
                  Send <kbd>Enter</kbd>
                </button>
                <button type="button" className="btn" onClick={removeLast} disabled={!words.length}>
                  Delete last <kbd>⌫</kbd>
                </button>
                <button type="button" className="btn btn-ghost" onClick={clearWords} disabled={!words.length}>
                  Clear <kbd>Esc</kbd>
                </button>
              </div>
            </div>

            <form className="type-row" onSubmit={submitTyped}>
              <label htmlFor="sign-typed" className="sr-only">
                Type a message instead
              </label>
              <input
                id="sign-typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Or type a message…"
                autoComplete="off"
                maxLength={2000}
              />
              <button type="submit" className="btn btn-primary" disabled={!typed.trim() || busy}>
                Send
              </button>
            </form>

            <section className="replies" aria-label="Conversation">
              {log.length === 0 ? (
                <p className="empty">
                  Try the built-in gestures: ✋ HELLO, 👍 YES, 👎 NO, ✊ STOP, ☝️ WAIT, ✌️ BYE, 🤟 I LOVE YOU. Then
                  teach your own signs in “Teach signs”.
                </p>
              ) : (
                [...log].reverse().map((e) => (
                  <article key={e.id} className="exchange">
                    <p className="said">
                      <span className="said-label">{e.signed ? "You signed" : "You typed"}</span> {e.said}
                    </p>
                    {e.meaning && e.signed && (
                      <p className="meaning" lang={replyLang}>
                        <span className="said-label">Meaning</span> {e.meaning}
                      </p>
                    )}
                    {e.pending && <p className="reply pending">Thinking…</p>}
                    {e.reply && (
                      <p className="reply" lang={replyLang}>
                        {e.reply}
                      </p>
                    )}
                    {e.error && <p className="notice error">{e.error}</p>}
                  </article>
                ))
              )}
            </section>

            <section className="panel" aria-labelledby="sign-settings-title">
              <h2 id="sign-settings-title" className="panel-title">
                Settings
              </h2>
              <Switch
                checked={settings.speakSigns}
                onChange={(speakSigns) => update({ speakSigns })}
                description="Says what you signed out loud, so hearing people nearby can follow."
              >
                Speak my words aloud
              </Switch>
              <div className="field">
                <label htmlFor="auto-send">Send automatically when hands are down for</label>
                <select
                  id="auto-send"
                  value={settings.autoSendMs}
                  onChange={(e) => update({ autoSendMs: Number(e.target.value) })}
                >
                  {AUTO_SEND_OPTIONS.map((ms) => (
                    <option key={ms} value={ms}>
                      {ms === 0 ? "Never (press Send)" : `${ms / 1000} seconds`}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </section>
        ) : (
          <section id="panel-teach" role="tabpanel" aria-labelledby="tab-teach" className="teach-panel">
            <TeachSigns
              classifier={classifier}
              version={signsVersion}
              onChange={signsChanged}
              onReplace={replaceClassifier}
              gestures={gestures}
              onGestures={changeGestures}
              recorderRef={recorderRef}
              ready={ready}
              handsVisible={live.hands}
              saveError={saveError}
            />
          </section>
        )}
      </div>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </main>
  );
}
