import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CameraSelect, LanguageSelect, Switch, TopBar, isTyping } from "../components/Controls.jsx";
import { AUTO_SEND_OPTIONS } from "../hooks/useSettings.js";
import { useCamera } from "../hooks/useCamera.js";
import { useHandTracking } from "../hooks/useHandTracking.js";
import { useSignVideos } from "../hooks/useSignVideos.js";
import SignVideoPlayer, { useBlobURL } from "../components/SignVideoPlayer.jsx";
import { SIGN_LANGUAGES } from "../lib/signVideos.js";
import { askSign, checkSignAI } from "../lib/api.js";
import { drawHands } from "../lib/drawHands.js";
import { handsFromResult, toFeatures } from "../lib/features.js";
import { decideSign, gestureMap } from "../lib/gestures.js";
import { SignClassifier } from "../lib/knn.js";
import { language } from "../lib/languages.js";
import { createSignSmoother } from "../lib/signSmoother.js";
import { canListen, canSpeak, createSpeaker, getVoices, pickVoice, listenOnce, listenErrorMessage } from "../lib/speech.js";
import { load, save } from "../lib/storage.js";
import TeachSigns from "./TeachSigns.jsx";
import SignVideoLibrary from "./SignVideoLibrary.jsx";

const MAX_HISTORY = 12;
const MAX_WORDS = 30;

function loadClassifier(signLanguage) {
  try {
    // Old recordings predate the language picker and belong to the original ISL context.
    const saved = load(`signs:${signLanguage}`, signLanguage === "isl" ? load("signs", null) : null);
    return saved ? SignClassifier.fromJSON(saved) : new SignClassifier();
  } catch {
    return new SignClassifier();
  }
}

const SOURCE_TEXT = { taught: "your saved sign", gesture: "gesture shortcut" };
const NO_SHORTCUTS = {};

export default function SignMode({ settings, update, onBack, initialTab = "talk", onLive, onTrained }) {
  const [tab, setTab] = useState(initialTab);
  const [words, setWords] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [live, setLive] = useState({ hands: 0, candidate: null, progress: 0, source: null, auto: 0, confidence: 0, framed: true });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [typed, setTyped] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [gestures, setGestures] = useState(() => gestureMap(load(`gestures:${settings.signLanguage}`, settings.signLanguage === "isl" ? load("gestures", null) : null)));
  const [signsVersion, setSignsVersion] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [bridge, setBridge] = useState(false);
  const [listening, setListening] = useState(false);
  const [partnerText, setPartnerText] = useState("");
  const [bridgeError, setBridgeError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [ai, setAI] = useState("checking");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [cameraEnabled, setCameraEnabled] = useState(initialTab !== "videos");
  const [cameraDevice, setCameraDevice] = useState("");
  const [uploaded, setUploaded] = useState(null);
  const [uploadReady, setUploadReady] = useState(false);
  const uploadedURL = useBlobURL(uploaded);
  const micRef = useRef(null);

  const [classifier, setClassifier] = useState(() => loadClassifier(settings.signLanguage));
  const videos = useSignVideos();
  const [speaker] = useState(createSpeaker);
  const smoother = useMemo(() => createSignSmoother({ holdMs: settings.recognitionProfile === "careful" ? 1100 : 700 }), [settings.recognitionProfile]);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const camera = useCamera({ active: cameraEnabled && !uploaded, facingMode: "user", deviceId: cameraDevice });
  const { videoRef, status: cameraStatus, error: cameraError, retry: retryCamera } = camera;
  const canvasRef = useRef(null);
  const classifierRef = useRef(classifier);
  const wordsRef = useRef([]);
  const editingRef = useRef(false);
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
  const latest = useRef({ tab, gestures, settings, bridge, ai });
  useLayoutEffect(() => {
    latest.current = { tab, gestures, settings, bridge, ai };
    classifierRef.current = classifier;
  });
  useLayoutEffect(() => {
    smoother.reset();
    armedRef.current = false;
    setLive((prev) => ({ ...prev, candidate: null, progress: 0, source: null, auto: 0, confidence: 0 }));
    speaker.cancel();
  }, [settings.gestureShortcuts, gestures, classifier, signsVersion, smoother, speaker]);

  useEffect(() => {
    document.title = "Sign mode · SignBridge";
    document.getElementById("sign-title")?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAI("checking");
    checkSignAI({ signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setAI(!data.configured ? "missing" : data.roomAuthRequired ? "room-only" : "configured");
    }).catch(() => { if (!controller.signal.aborted) setAI("unavailable"); });
    return () => controller.abort();
  }, [checkAttempt]);

  useEffect(() => {
    let alive = true;
    getVoices().then((voices) => {
      if (alive) { voiceRef.current = pickVoice(voices, language(settings.lang).bcp47); setVoiceAvailable(Boolean(voiceRef.current)); }
    });
    return () => {
      alive = false;
    };
  }, [settings.lang]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      speaker.cancel();
      micRef.current?.abort();
    },
    [speaker],
  );

  const setWordList = useCallback((next) => {
    wordsRef.current = next.slice(-MAX_WORDS);
    setWords(wordsRef.current);
    setTranscript(wordsRef.current.join(" "));
  }, []);

  const ask = useCallback(async ({ text, said, glosses = null }) => {
    if (latest.current.ai !== "configured") return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = `${Date.now()}`;
    const patch = (fields) => setLog((all) => all.map((e) => (e.id === id ? { ...e, ...fields } : e)));
    setLog((all) => [...all, { id, said, signed: Boolean(glosses), meaning: "", reply: "", pending: true, lang: latest.current.settings.lang }]);
    busyRef.current = true;
    setBusy(true);
    const { lang } = latest.current.settings;
    try {
      const messages = [...historyRef.current, { role: "user", text }];
      const { meaning, reply } = await askSign({ lang, messages, signal: controller.signal });
      historyRef.current = [...messages, { role: "assistant", text: JSON.stringify({ meaning, reply }) }].slice(-MAX_HISTORY);
      patch({ meaning, reply, pending: false });
      setAnnouncement(`${meaning ? `You said: ${meaning}. ` : ""}SignBridge says: ${reply}`);
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

  const speakText = useCallback((text, isGloss = false, replyLanguage = null) => {
    if (!text?.trim()) return;
    const { lang: selectedLang, rate } = latest.current.settings;
    const lang = replyLanguage || selectedLang;
    // Default glosses are English. Don't pretend changing the speech language translates them.
    const bcp47 = isGloss && /^[\x00-\x7f]*$/.test(text) ? "en-IN" : language(lang).bcp47;
    speaker.speak(text, { voice: bcp47 === language(selectedLang).bcp47 ? voiceRef.current : null, lang: bcp47, rate });
  }, [speaker]);

  const send = useCallback(() => {
    const said = wordsRef.current;
    if (!said.length || busyRef.current || (!latest.current.bridge && latest.current.ai !== "configured")) return;
    armedRef.current = false;
    setWordList([]);
    if (latest.current.bridge) {
      speakText(said.join(" "), true);
      setLog((all) => [...all, { id: `${Date.now()}`, said: said.join(" "), signed: true, local: true }]);
      setAnnouncement(`You signed: ${said.join(" ")}`);
      return;
    }
    // The smoother is not reset: a sign still held while sending stays "used" until the hands
    // change, so it doesn't sneak into the next sentence.
    ask({ text: `Signed: ${said.join(" ")}`, said: said.join(" "), glosses: said });
  }, [ask, setWordList, speakText]);

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
      if (uploaded && (video.paused || video.ended)) return;
      const hands = handsFromResult(result);
      const { videoWidth: width, videoHeight: height } = video;
      drawHands(canvasRef.current, hands, width, height);
      const aspect = width / height;
      const now = performance.now();
      const { tab: currentTab, gestures: map, settings: s } = latest.current;
      if (hands.length) lastHandsAtRef.current = now;
      if (recorderRef.current && hands.length) recorderRef.current.push(toFeatures(hands, aspect));

      const framed = hands.every((h) => h.landmarks.every((p) => p.x > 0.015 && p.x < 0.985 && p.y > 0.015 && p.y < 0.985));
      const careful = s.recognitionProfile === "careful";
      const decision = decideSign(hands, aspect, classifierRef.current, s.gestureShortcuts ? map : NO_SHORTCUTS, careful ? { minSignConfidence: 0.8, minGestureScore: 0.7 } : undefined);
      if (!framed && careful) decision.label = null;
      const step = smoother.update(decision.label, uploaded ? video.currentTime * 1000 : now);
      if (step.committed && currentTab === "talk" && !recorderRef.current && !editingRef.current) {
        setWordList([...wordsRef.current, step.committed]);
        armedRef.current = true;
        setAnnouncement(`Added ${step.committed}`);
        if (s.speakSigns) speakText(step.committed, true);
      }

      let auto = 0;
      if (currentTab === "talk" && (latest.current.bridge || latest.current.ai === "configured") && s.autoSendMs > 0 && armedRef.current && wordsRef.current.length && !busyRef.current && !editingRef.current && !hands.length) {
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
          confidence: decision.confidence,
          framed,
        });
      }
    },
    [setWordList, smoother, speakText, uploaded],
  );

  const tracking = useHandTracking({ videoRef, active: uploaded ? uploadReady : cameraStatus === "on", onFrame });
  const ready = (uploaded ? uploadReady : cameraStatus === "on") && tracking.status === "ready";
  const knownSigns = classifier.labels();
  const shortcutWords = settings.gestureShortcuts ? [...new Set(Object.values(gestures).filter((g) => g.enabled && g.word).map((g) => g.word))] : [];

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
      const ok = save(`signs:${settings.signLanguage}`, instance.toJSON());
      setSaveError(
        ok ? "" : "Couldn't save your signs in this browser (storage is full or blocked). Export them so you don't lose them.",
      );
      smoother.reset();
      setSignsVersion((v) => v + 1);
    },
    [smoother, settings.signLanguage],
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
    save(`gestures:${settings.signLanguage}`, next);
  }, [settings.signLanguage]);

  const submitTyped = (e) => {
    e.preventDefault();
    const value = typed.trim();
    if (!value || busy || (!bridge && ai !== "configured")) return;
    setTyped("");
    if (bridge) {
      setLog((all) => [...all, { id: `${Date.now()}`, said: value, reply: value, partner: true, local: true, lang: settings.lang }]);
      setAnnouncement(`Partner says: ${value}`);
    } else ask({ text: `Typed: ${value}`, said: value });
  };

  const listenToPartner = () => {
    if (listening) { micRef.current?.stop(); return; }
    setBridgeError(""); setPartnerText("");
    try {
      let failed = false;
      micRef.current = listenOnce({ lang: language(settings.lang).bcp47, onInterim: setPartnerText,
        onEnd: (value) => {
          setListening(false); micRef.current = null;
          if (value && !failed) setLog((all) => [...all, { id: `${Date.now()}`, said: value, reply: value, partner: true, local: true, lang: settings.lang }]);
          else if (!failed) setBridgeError("No speech heard. Try again or type your message.");
          setPartnerText("");
        },
        onError: (code) => { failed = true; setBridgeError(listenErrorMessage(code)); },
      });
      setListening(true);
    } catch { setListening(false); setBridgeError("Couldn't start the microphone. Try Chrome or Edge, or type the message."); }
  };

  return (
    <main className="mode sign-mode" aria-labelledby="sign-title">
      <TopBar title="Sign mode" titleId="sign-title" onBack={onBack}>
        {onTrained && <button type="button" className="btn btn-primary btn-small" onClick={onTrained}>Trained sign words</button>}
        {onLive && <button type="button" className="btn btn-primary btn-small" onClick={onLive}>Live Sign conversation</button>}
        <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="sign-language" />
      </TopBar>

      <div className="bridge-toolbar">
        <div className="field"><label htmlFor="sign-dialect">Sign language</label><select id="sign-dialect" value={settings.signLanguage} onChange={(e) => update({ signLanguage: e.target.value })}>{SIGN_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select><p className="fine-print">Each language has its own saved signs and videos. Changing it starts a new conversation.</p></div>
        <div className="bridge-flow" aria-label="Communication flow"><span>Camera</span><b aria-hidden="true">→</b><span>Words + speech</span><b aria-hidden="true">↔</b><span>{settings.signLanguage.toUpperCase()} videos</span></div>
      </div>

      <div className="tabs" role="tablist" aria-label="Sign mode">
        {[
          ["talk", "Talk"],
          ["teach", "Teach signs"],
          ["videos", "Sign videos"],
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
              if (id !== "talk") { micRef.current?.abort(); micRef.current = null; setListening(false); setPartnerText(""); }
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
          <div className="actions">
            <button type="button" className="btn btn-small" onClick={() => { setUploaded(null); setUploadReady(false); setSourceError(""); setCameraEnabled(uploaded ? true : !cameraEnabled); smoother.reset(); armedRef.current = false; }}>{uploaded ? "Use camera" : cameraEnabled ? "Pause camera" : "Start camera"}</button>
            <label className="btn btn-small file-button">Recognize a video<input type="file" aria-label="Recognize signs from a local video" accept="video/mp4,video/webm,video/ogg" onChange={(e) => {
              const file = e.target.files?.[0]; e.target.value = "";
              if (!file) return;
              if (!/^video\//.test(file.type) || !file.size || file.size > 100 * 1024 * 1024) { setSourceError("Choose a nonempty video under 100 MB."); return; }
              setSourceError("");
              setUploadReady(false); setUploaded(file); smoother.reset(); armedRef.current = false;
            }} /></label>
          </div>
          <CameraSelect camera={camera} value={cameraDevice} disabled={Boolean(uploaded)} onChange={(id) => { setCameraDevice(id); smoother.reset(); armedRef.current = false; }} />
          <p className="fine-print">Choose your laptop's Integrated Camera above and allow camera access if asked. If this browser cannot show the preview, try the same page in Chrome or Edge.</p>
          <div className={`camera${uploaded ? " camera-file" : ""}`}>
            <video ref={videoRef} src={uploadedURL || undefined} className={uploaded ? "" : "mirror"} muted playsInline controls={Boolean(uploaded)} aria-hidden={!uploaded} aria-label={uploaded ? "Video for sign recognition" : undefined} onLoadedData={() => { if (uploaded) setUploadReady(true); }} onSeeked={() => { if (uploaded) { smoother.reset(); armedRef.current = false; } }} onError={() => { if (uploaded) { setUploadReady(false); setSourceError("This video can't play here. Try an MP4 video."); } }} />
            <canvas ref={canvasRef} className={`${uploaded ? "" : "mirror "}overlay`} aria-hidden="true" />
            {cameraStatus === "off" && !uploaded && <p className="camera-status">Camera paused · text and sign videos still work</p>}
            {cameraStatus === "starting" && !uploaded && <p className="camera-status">Starting camera… Choose Allow if your browser asks for camera access.</p>}
            {cameraStatus === "error" && !uploaded && (
              <div className="camera-status error" role="alert">
                <p>{cameraError}</p>
                <button type="button" className="btn btn-small" onClick={retryCamera}>
                  Try again
                </button>
              </div>
            )}
            {(cameraStatus === "on" || uploadReady) && tracking.status === "loading" && (
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
            {ready && !uploaded && (
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
                    {live.hands} hand{live.hands > 1 ? "s" : ""} · no known match
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
          {cameraStatus === "on" && !uploaded && <p className="hint" role="status">Camera connected · {camera.name || "Default webcam"}</p>}
          {sourceError && <p className="notice error" role="alert">{sourceError}</p>}
          <div className="sign-vocabulary panel" aria-label="Available recognition vocabulary">
            <strong>{knownSigns.length} saved static {knownSigns.length === 1 ? "sign" : "signs"} · {settings.signLanguage.toUpperCase()}</strong>
            <p className="hint">{knownSigns.length ? `Saved words: ${knownSigns.map((s) => s.label).join(" · ")}` : "No personal signs saved yet. Teach a static handshape with its word to recognize it here."}</p>
            <p className="fine-print">{shortcutWords.length ? `Gesture shortcuts enabled: ${shortcutWords.join(" · ")}. These handshape shortcuts do not translate ISL or ASL.` : "Gesture shortcuts are off. An open palm will not automatically mean HELLO."}</p>
            <div className="actions"><button type="button" className="btn btn-small" onClick={() => { setTab("teach"); smoother.reset(); armedRef.current = false; }}>Teach a new sign</button>{onLive && <button type="button" className="btn btn-small" onClick={onLive}>Use Live Sign for a video turn</button>}</div>
          </div>
          {ready && live.hands > 0 && !live.candidate && tab === "talk" && <p className="hint" role="status">No known sign matched. Teach this static handshape, type its meaning, or try a video turn in Live Sign.</p>}
          <p className="hint">
            {uploaded ? `Video: ${uploaded.name}. Press Play to scan for known static signs. This video stays on your device.` : "Hold each static sign still to add it. Review the words, then Send."} {settings.autoSendMs > 0 && "Auto-send is on: lower your hands to send."} Hand tracking stays on this device.
          </p>
          <div className="tracking-stats" aria-label="Camera recognition feedback">
            <span><b>{tracking.fps || "—"}</b> FPS</span><span><b>{ready ? live.hands : 0}</b> hands</span><span><b>{ready && live.candidate ? `${Math.round(live.confidence * 100)}%` : "—"}</b> model confidence</span><span>{tracking.status === "idle" ? "Paused" : tracking.delegate || "Loading runtime"}</span>
          </div>
          <p className="hint">Confidence is a model score, not measured translation accuracy. Use bright, even light and keep both hands fully visible. {!live.framed && <strong className="framing-warning">Move your hands away from the frame edges.</strong>}</p>
          <div className="field"><label htmlFor="recognition-profile">Recognition mode</label><select id="recognition-profile" value={settings.recognitionProfile} onChange={(e) => update({ recognitionProfile: e.target.value })}><option value="balanced">Balanced · hold 0.7 seconds</option><option value="careful">Careful · hold 1.1 seconds, stricter confidence</option></select></div>
          <Switch checked={Boolean(settings.gestureShortcuts)} onChange={(gestureShortcuts) => update({ gestureShortcuts })} description="Optional demo shortcuts: open palm = HELLO, thumbs up = YES, thumbs down = NO. They can misread real signs; keep this off for personal-sign recognition.">Use gesture shortcuts</Switch>
          <p className="fine-print">Personal static-sign recognition. Full moving-sign and sentence translation require a trained ISL/ASL sequence model.</p>
        </section>

        {tab === "talk" ? (
          <section id="panel-talk" role="tabpanel" aria-labelledby="tab-talk" className="talk-panel">
            <Switch checked={bridge} onChange={(value) => { micRef.current?.abort(); setListening(false); setPartnerText(""); setBridgeError(""); setBridge(value); }} description="Speak your reviewed signs to a nearby person. Their speech becomes captions and matching sign videos. No Gemini key needed; browser speech recognition may use its online service.">Face-to-face bridge</Switch>
            {bridge && <div className="panel"><div className="actions"><button type="button" className="btn btn-primary" onClick={listenToPartner} disabled={!canListen}>{listening ? "Finish listening" : "Listen to partner"}</button><button type="button" className="btn" onClick={() => { micRef.current?.abort(); micRef.current = null; setListening(false); setPartnerText(""); }}>Cancel listening</button></div><p className="reply" role="status">{listening ? partnerText || "Listening…" : "Partner can speak or type below."}</p></div>}
            {bridgeError && <p className="notice error" role="alert">{bridgeError}</p>}
            {!bridge && ai !== "configured" && <aside className="notice" aria-label="AI setup">
              <strong>{ai === "checking" ? "Checking AI setup…" : ai === "missing" ? "AI replies need setup" : ai === "room-only" ? "AI help is available inside rooms" : "AI server unavailable"}</strong>
              <p>{ai === "checking" ? "Your words stay here while AI availability is checked." : ai === "missing" ? "AI replies are not enabled on this server. Set GEMINI_API_KEY in the server environment and restart the service." : ai === "room-only" ? "This server accepts AI requests inside authenticated conversation rooms. Open Connect from Home for optional AI draft help." : "The AI server could not be checked. Check your connection, then try again."}</p>
              <p>Recognition adds words for you to review. Use Speak words for local voice output, or turn on Face-to-face bridge to communicate with someone nearby. These work without an AI key.</p>
              <button type="button" className="btn btn-small" disabled={ai === "checking"} onClick={() => setCheckAttempt((n) => n + 1)}>Check AI setup again</button>
            </aside>}
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
              <div className="field"><label htmlFor="review-signs">Review / correct recognized words</label><input id="review-signs" value={transcript} maxLength={1200} onFocus={() => { armedRef.current = false; editingRef.current = true; }} onChange={(e) => { setTranscript(e.target.value); wordsRef.current = e.target.value.trim().split(/\s+/).filter(Boolean).slice(-MAX_WORDS); setWords(wordsRef.current); }} onBlur={() => { setWordList(wordsRef.current); editingRef.current = false; }} placeholder="Correct a word before speaking or sending" /></div>
              <div className="actions">
                <button type="button" className="btn" onClick={() => speakText(words.join(" "), true)} disabled={!words.length || !canSpeak}>Speak words</button>
                <button type="button" className="btn btn-ghost" onClick={() => speaker.cancel()} disabled={!canSpeak}>Stop speech</button>
                <button type="button" className="btn btn-primary" onClick={send} disabled={!words.length || busy || (!bridge && ai !== "configured")}>
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
              <button type="submit" className="btn btn-primary" disabled={!typed.trim() || busy || (!bridge && ai !== "configured")}>
                Send
              </button>
            </form>

            <section className="replies" aria-label="Conversation">
              {log.length === 0 ? (
                <p className="empty">
                  {settings.gestureShortcuts ? "Gesture shortcuts are on: ✋ HELLO, 👍 YES, 👎 NO, ✊ STOP, ☝️ WAIT, ✌️ BYE, 🤟 I LOVE YOU. Hold one still to try it." : "Recognize your saved static signs here. Teach a new handshape and its word, or type a message. Unknown signs stay unrecognized."}
                </p>
              ) : (
                [...log].reverse().map((e) => (
                  <article key={e.id} className="exchange">
                    <p className="said">
                      <span className="said-label">{e.partner ? "Partner said" : e.signed ? "You signed" : "You typed"}</span> {e.said}
                    </p>
                    {e.meaning && e.signed && (
                      <p className="meaning" lang={language(e.lang || settings.lang).bcp47}>
                        <span className="said-label">Meaning</span> {e.meaning}
                      </p>
                    )}
                    {e.pending && <p className="reply pending">Thinking…</p>}
                    {e.reply && (
                      <><p className="reply" lang={language(e.lang || settings.lang).bcp47}>{e.reply}</p>
                      <button type="button" className="btn btn-small" disabled={!canSpeak} onClick={() => speakText(e.reply, false, e.lang)}>Speak reply</button>
                      {settings.videoReplies && <SignVideoPlayer key={`${settings.signLanguage}:${e.lang || settings.lang}:${e.id}`} text={e.reply} clips={videos.clips} signLanguage={settings.signLanguage} textLanguage={e.lang || settings.lang} />}</>
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
                description="Speaks each recognized word immediately, including offline. It does not translate glosses or wait for AI."
              >
                Speak each recognized sign
              </Switch>
              {!canSpeak && <p className="notice">Speech output is unavailable in this browser.</p>}
              {canSpeak && !voiceAvailable && <p className="hint">No matching voice found for {language(settings.lang).name}. Your browser may use a fallback voice. English glosses are spoken in English.</p>}
              <Switch checked={settings.videoReplies} onChange={(videoReplies) => update({ videoReplies })} description="Shows saved clips matching the reply's text language. Words without videos stay visible as text.">Show sign-video replies</Switch>
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
        ) : tab === "teach" ? (
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
              signLanguage={settings.signLanguage}
            />
          </section>
        ) : <section id="panel-videos" role="tabpanel" aria-labelledby="tab-videos" className="teach-panel"><SignVideoLibrary library={videos} signLanguage={settings.signLanguage} lang={settings.lang} videoRef={videoRef} cameraReady={cameraStatus === "on" && !uploaded} /></section>}
      </div>

      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </main>
  );
}
