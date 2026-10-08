import { useEffect, useReducer, useRef, useState } from "react";
import { CameraSelect, LanguageSelect, Switch, TopBar, isTyping } from "../components/Controls.jsx";
import SignVideoPlayer from "../components/SignVideoPlayer.jsx";
import TrainingSampleForm from "../components/TrainingSampleForm.jsx";
import { useCamera } from "../hooks/useCamera.js";
import { usePoseTracking } from "../hooks/usePoseTracking.js";
import { useWordRecognitionModel } from "../hooks/useWordRecognitionModel.js";
import WordModelSelect from "../components/WordModelSelect.jsx";
import WordVocabularyHelp from "../components/WordVocabularyHelp.jsx";
import SignRecognitionDetails from "../components/SignRecognitionDetails.jsx";
import { useSignSession } from "../hooks/useSignSession.js";
import { useSignVideos } from "../hooks/useSignVideos.js";
import { checkSignAI } from "../lib/api.js";
import { poseFrameFromHolistic } from "../lib/trainedSignModel.js";
import { describePoseCapture, EMPTY_SIGN_DRAFT, poseFraming, signDraftReducer } from "../lib/signWorkspace.js";
import { SIGN_LANGUAGES } from "../lib/signVideos.js";
import { canSpeak, createSpeaker } from "../lib/speech.js";
import { drawHands } from "../lib/drawHands.js";
import { handJointCounts, handsFromPoseFrame } from "../lib/handJoints.js";
import "../styles/signWorkspace.css";

const newSessionCode = () => `session-${Date.now().toString(36)}`;

export default function TrainedSignMode({ settings, update, onBack, onLive, onLibrary, onStudio, onConnect, initialDestination = "local" }) {
  const [destination, setDestination] = useState(initialDestination === "ai" ? "ai" : "local");
  const [engine, setEngine] = useState("legacy");
  const trained = useWordRecognitionModel(settings.signLanguage, engine);
  const session = useSignSession(settings);
  const videos = useSignVideos();
  const [cameraOn, setCameraOn] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const camera = useCamera({ active: cameraOn, deviceId });
  const [phase, setPhase] = useState("ready");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [quality, setQuality] = useState(null);
  const [meaning, setMeaning] = useState("");
  const [wordAdded, setWordAdded] = useState(false);
  const [draft, compose] = useReducer(signDraftReducer, EMPTY_SIGN_DRAFT);
  const [error, setError] = useState("");
  const [framing, setFraming] = useState({ hands: 0, body: false, clipped: false });
  const [joints, setJoints] = useState({ left: 0, right: 0, total: 0, hands: 0 });
  const [frameFreshness, setFrameFreshness] = useState("waiting");
  const [showJointNumbers, setShowJointNumbers] = useState(false);
  const [speakResults, setSpeakResults] = useState(false);
  const [speaker] = useState(createSpeaker);
  const [ai, setAI] = useState("checking");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [sampleSession, setSampleSession] = useState(newSessionCode);
  const [sampleSigner, setSampleSigner] = useState("");
  const [trainingLabel, setTrainingLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const capture = useRef(false), frames = useRef([]), started = useRef(0), finishRef = useRef(null);
  const reviewedFrames = useRef([]), reviewEpoch = useRef(0), uiAt = useRef(0);
  const freshFrames = useRef({ active: false, lastAt: null, framing: null, timer: 0, generation: 0 });
  const canvas = useRef(null);
  const cameraHeading = useRef(null), resultHeading = useRef(null), messageInput = useRef(null);
  const aiOptions = useRef(null);
  const showSection = (ref) => { ref.current?.focus({ preventScroll: true }); ref.current?.scrollIntoView?.({ block: "nearest" }); };
  const thinking = session.phase === "thinking";
  const busy = phase === "capturing" || phase === "recognizing" || thinking || saving;
  const armFreshness = (waitingSince) => {
    const owner = freshFrames.current, generation = owner.generation;
    clearTimeout(owner.timer);
    const expire = () => {
      if (!owner.active || owner.generation !== generation) return;
      const remaining = 2000 - (performance.now() - (owner.lastAt ?? waitingSince));
      if (remaining > 0) owner.timer = setTimeout(expire, remaining);
      else { owner.timer = 0; setFrameFreshness("paused"); }
    };
    owner.timer = setTimeout(expire, 2000);
  };
  const resetFreshness = (active) => {
    const owner = freshFrames.current;
    clearTimeout(owner.timer); owner.timer = 0; owner.generation++; owner.active = active; owner.lastAt = null; owner.framing = null;
    setFrameFreshness("waiting");
    setFraming({ hands: 0, body: false, clipped: false }); setJoints({ left: 0, right: 0, total: 0, hands: 0 }); uiAt.current = 0;
    if (active) armFreshness(performance.now());
  };
  const tracking = usePoseTracking({ videoRef: camera.videoRef, active: camera.status === "on", onFrame: (detected, video) => {
    const now = performance.now(), owner = freshFrames.current;
    if (!owner.active || !Number.isFinite(now) || (owner.lastAt !== null && now <= owner.lastAt)) return;
    owner.lastAt = now; setFrameFreshness("fresh"); armFreshness(now);
    const pose = poseFrameFromHolistic(detected);
    const nextFraming = poseFraming(pose); owner.framing = nextFraming;
    setFraming((previous) => previous.hands === nextFraming.hands && previous.body === nextFraming.body && previous.clipped === nextFraming.clipped ? previous : nextFraming);
    const hands = handsFromPoseFrame(pose);
    drawHands(canvas.current, hands, video.videoWidth, video.videoHeight, { showLabels: true, showJointNumbers, mirrorText: true });
    if (now - uiAt.current >= 150) { setJoints(handJointCounts(pose)); uiAt.current = now; }
    const atMs = now - started.current;
    if (capture.current && frames.current.length < 100 && atMs >= 0 && atMs <= 12000 && (!frames.current.length || atMs > frames.current.at(-1).atMs)) frames.current.push({ ...pose, atMs });
  } });
  const framingReady = framing.hands > 0 && framing.body;
  const ready = trained.status === "ready" && camera.status === "on" && tracking.status === "ready" && frameFreshness === "fresh" && framingReady && phase !== "recognizing";
  const lastReply = session.log.findLast((turn) => turn.reply);
  const canAppend = !busy && Boolean(meaning.trim()) && [draft.text.trim(), meaning.trim()].filter(Boolean).join(" ").length <= 2000;
  const workflowStep = phase === "capturing" || phase === "recognizing" ? 1 : result && !wordAdded ? 2 : draft.text.trim() ? 3 : 1;
  const sessionStatus = thinking ? "SignBridge is answering…" : phase === "capturing" ? "Capturing your whole sign" : phase === "recognizing" ? "Recognising your completed turn…" : !cameraOn ? "Start when you're ready" : camera.status === "error" ? "Camera needs attention" : camera.status !== "on" ? "Connecting the camera…" : tracking.status === "loading" ? "Starting body and hand tracking…" : tracking.status === "error" ? "Tracking needs attention" : tracking.status !== "ready" ? "Waiting for hand tracking…" : frameFreshness === "paused" ? "Tracking frames paused" : frameFreshness === "waiting" ? "Waiting for the first tracking frame…" : trained.status === "ready" ? framingReady ? "Word model ready · capture one complete sign" : "Adjust your camera framing" : "Tracking joints · word recognition unavailable";

  useEffect(() => {
    resetFreshness(camera.status === "on" && tracking.status === "ready");
    return () => {
      const owner = freshFrames.current;
      owner.active = false; owner.generation++; clearTimeout(owner.timer); owner.timer = 0;
    };
  }, [camera.status, tracking.status]);

  useEffect(() => {
    document.title = "Sign to text & voice · SignBridge";
    document.getElementById("trained-sign-title")?.focus();
    return () => { reviewEpoch.current++; capture.current = false; frames.current = []; reviewedFrames.current = []; speaker.cancel(); };
  }, [speaker]);
  useEffect(() => { if (result && phase === "review") showSection(resultHeading); }, [result, phase]);
  useEffect(() => { if (initialDestination === "ai" && aiOptions.current) aiOptions.current.open = true; }, []);
  useEffect(() => {
    const controller = new AbortController(); setAI("checking");
    checkSignAI({ signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setAI(data.roomAuthRequired ? "room-only" : data.configured ? "configured" : "missing"); })
      .catch(() => { if (!controller.signal.aborted) setAI("unavailable"); });
    return () => controller.abort();
  }, [checkAttempt]);
  const clearReview = () => {
    reviewEpoch.current++; reviewedFrames.current = []; setResult(null); setQuality(null); setMeaning(""); setTrainingLabel(""); setWordAdded(false);
  };
  const cancel = () => { reviewEpoch.current++; trained.cancel(); capture.current = false; frames.current = []; setPhase("ready"); setElapsed(0); speaker.cancel(); };
  const start = () => {
    if (!ready || capture.current || busy || freshFrames.current.lastAt === null || performance.now() - freshFrames.current.lastAt >= 2000 || !freshFrames.current.framing?.hands || !freshFrames.current.framing.body) return;
    speaker.cancel(); session.stopSpeech(); clearReview(); frames.current = []; capture.current = true; started.current = performance.now();
    setError(""); setElapsed(0); setPhase("capturing");
  };
  const finish = () => {
    if (!capture.current) return;
    capture.current = false;
    const sequence = frames.current; frames.current = [];
    const durationMs = Math.min(12000, Math.max(0, performance.now() - started.current));
    setElapsed(durationMs); setQuality(describePoseCapture(sequence, durationMs));
    const epoch = ++reviewEpoch.current;
    const commit = (next) => {
      if (epoch !== reviewEpoch.current) return;
      reviewedFrames.current = sequence; setResult(next); setMeaning(next.meaning); setTrainingLabel(next.meaning); setPhase("review");
      if (engine === "legacy" && next.status === "recognized" && speakResults && canSpeak) speaker.speak(next.meaning, { lang: "en-IN", rate: settings.rate });
    };
    const fail = (cause) => { if (epoch !== reviewEpoch.current) return; reviewedFrames.current = []; if (cause?.name !== "AbortError") setError("Could not read this turn. Check the framing and sign again."); setPhase("ready"); };
    try {
      if (trained.async) { setPhase("recognizing"); Promise.resolve(trained.predict(sequence, { durationMs })).then(commit, fail); }
      else commit(trained.predict(sequence, { durationMs }));
    } catch (cause) { fail(cause); }
  };
  finishRef.current = finish;
  useEffect(() => {
    if (phase !== "capturing") return;
    const timer = setInterval(() => {
      const ms = performance.now() - started.current; setElapsed(Math.min(ms, 12000));
      if (ms >= 12000) finishRef.current();
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if ((capture.current || phase === "recognizing") && (camera.status !== "on" || tracking.status === "error")) {
      cancel(); setError("Tracking stopped during the turn. Reconnect the camera and try again.");
    }
  }, [camera.status, tracking.status]);
  useEffect(() => {
    const key = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (e.key === "Escape") {
        if (capture.current || phase === "recognizing") { e.preventDefault(); cancel(); }
        else if (thinking) { e.preventDefault(); session.interrupt(); }
        return;
      }
      if (isTyping(e) || e.target?.closest?.("button,a,summary")) return;
      if (e.code === "Space" && (capture.current || ready) && !thinking && !saving) { e.preventDefault(); capture.current ? finish() : start(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const end = () => { cancel(); clearReview(); compose({ type: "clear" }); session.end(); setCameraOn(false); setSampleSession(newSessionCode()); };
  const newConversation = () => { cancel(); clearReview(); compose({ type: "clear" }); session.newConversation(); };
  const append = () => { if (!canAppend) return; compose({ type: "append", text: meaning }); setMeaning(""); setWordAdded(true); showSection(messageInput); };
  const reviewWord = (value) => { setMeaning(value); setTrainingLabel(value); setWordAdded(false); };
  const chooseDestination = (next) => {
    if (next === "local") {
      if (thinking) session.interrupt();
      session.stopSpeech();
    }
    setDestination(next);
    if (aiOptions.current) aiOptions.current.open = next === "ai";
  };
  const send = async (event) => {
    event.preventDefault();
    if (destination !== "ai" || busy || ai !== "configured" || !draft.text.trim()) return;
    if (!session.active) session.start();
    const sent = await session.send(draft.text, { signed: true });
    if (sent?.ok) compose({ type: "clear" });
  };

  return <main className="mode live-sign-mode sign-workspace" aria-labelledby="trained-sign-title">
    <TopBar title="Sign to text & voice" titleId="trained-sign-title" onBack={onBack} />
    <div className="workspace-intro">
      <div><p className="eyebrow">SignBridge · one word at a time</p><h2>Sign. Check. Speak.</h2><p>Use the camera, review the result, then choose text or voice. You can also type at any time.</p></div>
      <span className="live-preview-badge">Experimental word recognition</span>
    </div>
    <nav className="workspace-steps" aria-label="Sign workflow">
      {[{ step: 1, title: "Sign", hint: "Camera and capture", ref: cameraHeading }, { step: 2, title: "Check", hint: "Review the result", ref: resultHeading }, { step: 3, title: "Text & voice", hint: "Use your message", ref: messageInput }].map((item) => <button key={item.step} type="button" aria-current={workflowStep === item.step ? "step" : undefined} onClick={() => showSection(item.ref)}><span className="workspace-step-number" aria-hidden="true">{item.step}</span><span><strong>{item.title}</strong><small>{item.hint}</small></span></button>)}
    </nav>
    <section className="workspace-destination" aria-labelledby="workspace-destination-heading">
      <fieldset><legend id="workspace-destination-heading">Use your reviewed message</legend><div className="workspace-purpose-choices">
        <label className={destination === "local" ? "selected" : ""}><input type="radio" name="sign-message-purpose" value="local" checked={destination === "local"} onChange={() => chooseDestination("local")} /><span><strong>Text &amp; voice</strong><small>Show or speak on this device.</small></span></label>
        <label className={destination === "ai" ? "selected" : ""}><input type="radio" name="sign-message-purpose" value="ai" checked={destination === "ai"} onChange={() => chooseDestination("ai")} /><span><strong>AI assistant</strong><small>Send reviewed text and get a reply.</small></span></label>
      </div></fieldset>
      <p className="fine-print" role="status">{destination === "ai" ? "AI assistant selected. Review your message, then press Send reviewed message. Camera capture never sends to AI automatically." : "Text & voice selected. Your message stays on this device; AI does not answer it."}</p>
      {onConnect && <div className="workspace-partner-entry"><button type="button" className="btn btn-small" disabled={saving} onClick={() => onConnect(draft.text)}>Talk to a partner</button><p className="fine-print">Opening a room leaves this page and stops the camera. Your reviewed message is copied to the room draft; you choose when to send it.</p></div>}
    </section>
    {thinking && <aside className="notice workspace-pending"><p>AI is answering your reviewed message. You can interrupt the reply to continue signing.</p><button type="button" className="btn btn-small" onClick={session.interrupt}>Interrupt reply <kbd>Esc</kbd></button></aside>}
    <div className="live-layout">
      <section className="live-camera-panel" aria-labelledby="workspace-camera-heading">
        <h2 id="workspace-camera-heading" ref={cameraHeading} tabIndex={-1} className="workspace-step-heading"><span>1</span> Sign with your camera</h2>
        <div className="workspace-language-row"><div className="field"><label htmlFor="trained-language">Sign language</label><select id="trained-language" value={settings.signLanguage} onChange={(e) => update({ signLanguage: e.target.value })}>{SIGN_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div><p className="fine-print">Choose before starting. Changing the language stops the camera and clears this page’s draft, results and AI conversation.</p></div>
        <div className="actions workspace-camera-actions">
          {!cameraOn ? <button type="button" className="btn btn-primary" disabled={thinking || saving} onClick={() => { setCameraOn(true); if (!session.active) session.start(); }}>Start camera</button> : <><button type="button" className="btn btn-primary" disabled={(phase !== "capturing" && !ready) || thinking || saving} onClick={phase === "capturing" ? finish : start}>{phase === "capturing" ? "Finish sign" : "Capture a sign"} <kbd>Space</kbd></button>{phase === "capturing" && <button type="button" className="btn" onClick={cancel}>Cancel turn</button>}<button type="button" className="btn btn-ghost" onClick={end}>End session</button></>}
        </div>
        <div className="live-session-heading"><span className={"session-light" + (cameraOn ? " on" : "")} aria-hidden="true" /><strong role="status">{sessionStatus}</strong><span className="live-clock">{phase === "capturing" ? (elapsed / 1000).toFixed(1) + " / 12s" : settings.signLanguage.toUpperCase()}</span></div>
        <div className={"camera live-camera" + (phase === "capturing" ? " is-recording" : "")}>
          <video ref={camera.videoRef} muted playsInline className="mirror" aria-hidden="true" /><canvas ref={canvas} className="mirror overlay" aria-hidden="true" />
          {!cameraOn && <div className="live-camera-idle"><strong>Start your camera here</strong><p>Keep both shoulders and your signing hands in view.</p></div>}
          {camera.status === "starting" && cameraOn && <p className="camera-status">Connecting your laptop camera…</p>}
          {camera.status === "error" && <div className="camera-status error" role="alert"><p>{camera.error}</p><button type="button" className="btn btn-small" onClick={camera.retry}>Retry camera</button></div>}
        </div>
        {phase === "capturing" && <p className="workspace-next-action">Sign one complete word, then press <strong>Finish sign</strong> as the movement ends. Avoid waiting with your hands still after the sign. Capture stops after 12 seconds.</p>}
        {phase === "recognizing" && <p role="status">Recognising the completed turn… <button className="btn btn-small" type="button" onClick={cancel}>Cancel recognition</button></p>}
        <p className="live-framing" aria-live="polite">{!cameraOn ? "The camera starts only when you choose. Typing is available in step 3." : tracking.status === "loading" ? "Loading body and hand tracking…" : tracking.status === "error" ? "Retry tracking before capturing a sign." : tracking.status === "ready" && frameFreshness === "paused" ? "No new tracking frames for two seconds. Check the camera preview, then retry tracking." : frameFreshness === "waiting" ? "Waiting for the first measured camera frame before capture." : !framing.body ? "Move back until both shoulders and your signing hands fit in the frame." : !framing.hands ? "Show your signing hand in good light before capturing." : framing.clipped ? "Leave more space: your hand is reaching the edge of the camera." : framing.hands + " " + (framing.hands === 1 ? "hand" : "hands") + " visible · include the complete movement"}</p>
        {cameraOn && tracking.status === "ready" && <div className="workspace-framing-check" aria-label="Camera framing checks"><ul><li><strong>Signing hands</strong><span>{frameFreshness !== "fresh" ? "Waiting for fresh frames" : framing.hands ? `${framing.hands} detected` : "Not detected"}</span></li><li><strong>Both shoulders</strong><span>{frameFreshness !== "fresh" ? "Waiting for fresh frames" : framing.body ? "Visible" : "Not detected"}</span></li><li><strong>Tracking</strong><span>{frameFreshness === "fresh" ? "Live" : frameFreshness === "paused" ? "Paused" : "Waiting"}</span></li></ul><p className="fine-print">One hand is enough for a one-hand sign. Use both for a two-hand sign. These checks confirm framing, not the word’s meaning.</p></div>}
        {cameraOn && tracking.status === "ready" && <div className="workspace-tracking-status" aria-label="Tracked hand joints"><p><strong>{frameFreshness === "paused" ? "Hand-joint tracking paused" : joints.total + " hand joints tracked"}</strong>{frameFreshness !== "paused" && <> · left {joints.left}/21 · right {joints.right}/21</>}</p>{frameFreshness === "paused" && <><button type="button" className="btn btn-small" disabled={busy} onClick={() => { resetFreshness(true); tracking.retry(); }}>Retry paused tracking</button>{phase === "capturing" && <p className="hint">Finish or cancel this turn before retrying tracking.</p>}</>}</div>}
        {tracking.status === "error" && <p className="notice error" role="alert">{tracking.error} <button type="button" className="btn btn-small" onClick={tracking.retry}>Retry tracking</button></p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {trained.status !== "ready" && <aside className="notice" role="status"><p>{trained.status === "loading" ? "Loading your trained vocabulary…" : trained.error}</p><p>You can still type and speak your message in step 3. Hand tracking works separately from word recognition.</p>{["error", "unavailable"].includes(trained.status) && <button type="button" className="btn btn-small" onClick={trained.retry}>Reload trained model</button>}</aside>}
        {trained.model?.acceptanceEnabled === false && <aside className="notice" role="status"><p>This model did not pass rejection calibration. Automatic word recognition is disabled; you can capture a turn and enter the word yourself.</p></aside>}
        <details className="workspace-help"><summary>How to use this page</summary><ol><li>Choose ISL or ASL, then press <strong>Start camera</strong>.</li><li>Show your signing hand and both shoulders. Press <strong>Capture a sign</strong> just before the movement, perform the full word, then press <strong>Finish sign</strong> as it ends.</li><li>Check or edit the result. Choose <strong>Speak this word</strong>, or add it to your message below.</li></ol><p className="fine-print">An image helps you learn the hand position; this model needs your complete movement. ASL examples: <a href="https://www.lifeprint.com/asl101/pages-signs/b/book.htm" target="_blank" rel="noopener noreferrer">BOOK guide</a> · <a href="https://www.lifeprint.com/asl101/pages-signs/d/drink.htm" target="_blank" rel="noopener noreferrer">DRINK guide</a>. These references teach ASL, not ISL. Recognition can still reject or misread a sign.</p></details>
        {trained.status === "ready" && <details className="workspace-disclosure"><summary>Supported words</summary><WordVocabularyHelp key={engine + ":" + settings.signLanguage} model={trained.model} signLanguage={settings.signLanguage} engine={engine} disabled={busy} /></details>}
      </section>
      <section className="live-conversation workspace-main-output" aria-label="Sign workspace conversation">
        <h2 id="workspace-result-heading" ref={resultHeading} tabIndex={-1} className="workspace-step-heading"><span>2</span> Check the result</h2>
        {!result ? <div className="workspace-result-empty"><strong>Your word appears here after Finish sign.</strong><p>You can also type your message in step 3, without using the camera.</p></div> : <>
          <div className={"live-interpretation " + result.status}><span className="fine-print">{result.status === "recognized" ? "Tentative word — check the meaning" : "You can retry or type the meaning"}</span><strong>{result.status === "recognized" ? result.meaning : result.status === "no_sign" ? "Could not read this capture" : "No reliable word match"}</strong><p>{result.feedback}</p></div>
          <div className="live-meaning-form"><label htmlFor="trained-meaning">Review or correct the word</label><input id="trained-meaning" value={meaning} disabled={busy} maxLength={80} onChange={(e) => reviewWord(e.target.value)} /><div className="actions"><button type="button" className="btn btn-primary" disabled={!canAppend} onClick={append}>Add word to message</button><button type="button" className="btn" disabled={!canSpeak || !meaning.trim() || busy} onClick={() => speaker.speak(meaning.trim(), { lang: "en-IN", rate: settings.rate })}>Speak this word</button></div><p className="fine-print">Correcting or choosing a word is your review, not proof that the model recognized it.</p></div>
          <details className="workspace-disclosure workspace-more-result"><summary>More result options</summary>
            {result.candidates?.length > 0 && <div className="workspace-candidates"><p className="fine-print">Tentative suggestions. Choose only if this is the word you signed.</p><div className="actions">{result.candidates.map((candidate) => <button type="button" className="btn btn-small" key={candidate.label} disabled={busy} onClick={() => reviewWord(candidate.label)}>Choose {candidate.label}</button>)}<button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => reviewWord("")}>None of these</button></div></div>}
            <SignRecognitionDetails result={result} captureQuality={quality} />
            <TrainingSampleForm key={reviewEpoch.current} frames={reviewedFrames.current} result={result} signLanguage={settings.signLanguage} sessionCode={sampleSession} signerCode={sampleSigner} onSignerChange={setSampleSigner} label={trainingLabel} onLabelChange={setTrainingLabel} busy={busy} onSaving={setSaving} />
          </details>
        </>}
        <div className="workspace-composer"><div className="workspace-section-heading"><h2 className="workspace-step-heading"><span>3</span> Your text & voice</h2><span>{draft.text.length}/2000</span></div><label htmlFor="trained-message">Review or edit your message</label><textarea id="trained-message" ref={messageInput} rows={3} maxLength={2000} value={draft.text} disabled={busy} placeholder="Type here, or add a reviewed word…" onChange={(e) => compose({ type: "edit", text: e.target.value })} /><div className="actions">{canSpeak && <button type="button" className="btn btn-primary" disabled={busy || !draft.text.trim()} onClick={() => speaker.speak(draft.text.trim(), { lang: "en-IN", rate: settings.rate })}>Speak my message</button>}{canSpeak && <button type="button" className="btn btn-ghost btn-small" onClick={() => { speaker.cancel(); session.stopSpeech(); }}>Stop speech</button>}<button type="button" className="btn btn-small" disabled={busy || !draft.history.length} onClick={() => compose({ type: "undo" })}>Undo last edit</button><button type="button" className="btn btn-ghost btn-small" disabled={busy || !draft.text} onClick={() => compose({ type: "clear" })}>Clear message</button></div><p className="fine-print">Typing and local speech need no AI key. Word labels and speech are in English.</p>{!canSpeak && <p className="hint">Voice output is unavailable in this browser. Your text remains usable.</p>}</div>
        <details className="workspace-disclosure workspace-ai-options" ref={aiOptions} onToggle={(event) => { if (event.currentTarget.open) setDestination("ai"); }}><summary onClick={() => { if (!aiOptions.current?.open) setDestination("ai"); }}>AI replies (optional)</summary>
          <p className="hint">Ask AI about the reviewed message above. Only that text is sent when you press Send.</p>
          <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="workspace-reply-language" />
          <p className="fine-print">Changing the reply language stops the camera and clears this page’s draft, results and AI conversation.</p>
          <form className="workspace-ai-send" onSubmit={send}><button type="submit" className="btn" disabled={destination !== "ai" || busy || !draft.text.trim() || ai !== "configured"}>Send reviewed message</button></form>
          {ai !== "configured" && <aside className="workspace-ai-status notice" aria-label="AI setup"><strong>{ai === "room-only" ? "AI help is available inside rooms" : ai === "checking" ? "Checking AI setup…" : ai === "missing" ? "AI replies need setup" : "AI server unavailable"}</strong><p>Local recognition, message editing and speech work without an AI key. {ai === "room-only" ? "Open Connect from Home for optional AI draft help. This tool’s AI replies are available on the laptop’s development server." : ai === "missing" ? "Add GEMINI_API_KEY to .env.local and restart the server to enable replies." : "Replies need the server and an internet connection."}</p><button type="button" className="btn btn-small" disabled={ai === "checking"} onClick={() => setCheckAttempt((n) => n + 1)}>Check AI setup again</button></aside>}
          <div className="workspace-section-heading"><h3 className="panel-title">AI conversation</h3><button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={newConversation}>New conversation</button></div>
          {!session.log.length && <p className="hint">Replies appear here after you send a reviewed message.</p>}
          <div className="live-turns" role="log" aria-label="Conversation history" aria-live="polite" aria-relevant="additions text">{session.log.map((turn) => <article key={turn.id} className="live-turn"><div className="live-user-turn"><span>You · reviewed message</span><p>{turn.said}</p></div><div className="live-ai-turn"><span>SignBridge</span>{turn.pending ? <p>Thinking…</p> : turn.interrupted ? <p>Interrupted. Your draft is ready to review.</p> : turn.error ? <p className="error">{turn.error}</p> : <p>{turn.reply}</p>}{turn.reply && canSpeak && <button type="button" className="btn btn-small" onClick={() => session.speak(turn)}>Speak this reply</button>}</div></article>)}</div>
          {lastReply && settings.videoReplies && <SignVideoPlayer key={lastReply.id} text={lastReply.reply} clips={videos.clips} signLanguage={lastReply.signLanguage} textLanguage={lastReply.lang} />}
          {videos.error && <p className="notice error" role="alert">{videos.error}</p>}{session.error && <p className="notice error" role="alert">{session.error}</p>}
          <div className="workspace-reply-options">{canSpeak && <Switch checked={session.speakReplies} onChange={session.setSpeakReplies}>Speak AI replies aloud</Switch>}<Switch checked={settings.videoReplies} onChange={(videoReplies) => update({ videoReplies })}>Show saved sign videos for replies</Switch></div>
        </details>
      </section>
    </div>
    <details className="workspace-disclosure workspace-advanced"><summary>Advanced settings</summary>
      <div className="workspace-advanced-grid"><div><WordModelSelect value={engine} disabled={saving} onChange={(next) => { cancel(); clearReview(); setEngine(next); }} /><CameraSelect id="trained-camera-device" camera={camera} value={deviceId} disabled={busy} onChange={setDeviceId} />
        <Switch checked={showJointNumbers} onChange={setShowJointNumbers} description="Number the 21 landmarks in each detected hand.">Show hand-joint numbers</Switch>
        {canSpeak && engine === "legacy" && <Switch checked={speakResults} onChange={(on) => { setSpeakResults(on); if (!on) speaker.cancel(); }} description="Speaks an accepted word in English. Uncertain results and suggestions stay silent.">Speak recognized words</Switch>}
        {engine === "graph" && <p className="hint">New joint-model predictions stay silent until you review the meaning and choose Speak this word.</p>}
      </div><div>
        {quality && <details className="workspace-quality"><summary>Capture quality · {quality.count} samples</summary><dl><div><dt>Duration</dt><dd>{(quality.durationMs / 1000).toFixed(1)}s</dd></div><div><dt>Hands tracked</dt><dd>{quality.handFrames}/{quality.count}</dd></div><div><dt>Shoulders tracked</dt><dd>{quality.shoulderFrames}/{quality.count}</dd></div><div><dt>Sampling</dt><dd>{quality.samplesPerSecond.toFixed(1)}/s</dd></div><div><dt>Longest tracking gap</dt><dd>{quality.largestGapMs == null ? "Unavailable" : Math.round(quality.largestGapMs) + "ms"}</dd></div></dl>{quality.hints.map((hint) => <p key={hint} className="hint">{hint}</p>)}<p className="fine-print">Tracking measurements describe the capture, not how correctly you signed.</p></details>}
        {trained.model && <details className="workspace-quality"><summary>Dataset evaluation</summary><p className="fine-print">Dataset test top-1: {trained.model.metrics?.test?.top1_accuracy != null ? (trained.model.metrics.test.top1_accuracy * 100).toFixed(1) + "%" : "not reported"}. This does not establish live-camera or unseen-signer accuracy.</p></details>}
        <div className="actions">{onStudio && <button type="button" className="btn btn-small" onClick={onStudio}>Training Studio</button>}{onLibrary && <button type="button" className="btn btn-small" onClick={onLibrary}>Reply video library</button>}<button type="button" className="btn btn-ghost btn-small" onClick={onLive}>Video interpretation</button></div>
      </div></div>
    </details>
    <p className="live-privacy fine-print">Experimental recognition supports isolated words, not continuous sign translation. Capture poses stay on this device until your next capture, End session or leaving this page, unless you explicitly save a training sample.</p>
  </main>;
}
