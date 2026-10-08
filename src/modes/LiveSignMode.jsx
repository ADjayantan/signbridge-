import { useEffect, useRef, useState } from "react";
import { CameraSelect, LanguageSelect, Switch, TopBar, isTyping } from "../components/Controls.jsx";
import SignVideoPlayer, { useBlobURL } from "../components/SignVideoPlayer.jsx";
import { useCamera } from "../hooks/useCamera.js";
import { useHandTracking } from "../hooks/useHandTracking.js";
import { useSignSession } from "../hooks/useSignSession.js";
import { useSignVideos } from "../hooks/useSignVideos.js";
import { checkSignAI } from "../lib/api.js";
import { drawHands } from "../lib/drawHands.js";
import { handsFromResult } from "../lib/features.js";
import { inspectSignClip } from "../lib/signCapture.js";
import { SIGN_LANGUAGES } from "../lib/signVideos.js";
import { canSpeak } from "../lib/speech.js";

const PHASE_LABEL = {
  idle: "Ready when you are", ready: "Your turn", capturing: "Recording your signs",
  preview: "Review your clip", interpreting: "Interpreting your signs…",
  review: "Check your meaning", thinking: "SignBridge is answering…", replied: "Your next turn",
};

export default function LiveSignMode({ settings, update, onBack, onLibrary, onLocal, onTrained }) {
  const session = useSignSession(settings);
  const [deviceId, setDeviceId] = useState("");
  const camera = useCamera({ active: session.active, deviceId });
  const videos = useSignVideos();
  const [ai, setAI] = useState({ state: "checking" });
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [consent, setConsent] = useState(false);
  const [autoFinish, setAutoFinish] = useState(false);
  const [hands, setHands] = useState({ count: 0, framed: true });
  const [typed, setTyped] = useState("");
  const [importing, setImporting] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [clipReady, setClipReady] = useState(false);
  const clipURL = useBlobURL(session.clip?.blob);
  const canvasRef = useRef(null);
  const handsDown = useRef({ seen: false, lastAt: 0, uiAt: 0 });
  const importToken = useRef(0);
  const busy = ["capturing", "interpreting", "thinking"].includes(session.phase);
  const lastReply = session.log.findLast((turn) => turn.reply);

  useEffect(() => {
    document.title = "Live Sign · SignBridge";
    document.getElementById("live-sign-title")?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setAI({ state: "checking" });
    checkSignAI({ signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setAI({ state: data.roomAuthRequired ? "room-only" : data.configured ? "configured" : "missing" });
    }).catch(() => { if (!controller.signal.aborted) setAI({ state: "unavailable" }); });
    return () => controller.abort();
  }, [checkAttempt]);
  useEffect(() => {
    setConsent(false); setClipReady(false); setSourceError("");
  }, [session.clip]);
  useEffect(() => {
    handsDown.current = { seen: false, lastAt: 0, uiAt: 0 };
  }, [session.phase]);
  useEffect(() => {
    if (!session.active) { importToken.current++; setImporting(false); setSourceError(""); }
    return () => { importToken.current++; };
  }, [session.active]);
  const tracking = useHandTracking({ videoRef: camera.videoRef, active: camera.status === "on", onFrame: (result, video) => {
    const detected = handsFromResult(result);
    drawHands(canvasRef.current, detected, video.videoWidth, video.videoHeight);
    const now = performance.now();
    const gate = handsDown.current;
    if (detected.length) { gate.seen = true; gate.lastAt = now; }
    if (autoFinish && session.phase === "capturing" && gate.seen && !detected.length && session.elapsed >= 2000 && now - gate.lastAt >= 1200) session.finish();
    if (now - gate.uiAt > 150) {
      gate.uiAt = now;
      setHands({ count: detected.length, framed: detected.every((h) => h.landmarks.every((p) => p.x > .02 && p.x < .98 && p.y > .02 && p.y < .98)) });
    }
  } });
  // Escape always interrupts. Space works outside form controls, like a push-to-talk button.
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape" && busy) { event.preventDefault(); session.interrupt(); return; }
      if (isTyping(event) || event.target?.closest?.("button,a,summary") || event.repeat) return;
      if (event.code === "Space" && session.active && !importing) {
        if (session.phase === "capturing") { event.preventDefault(); session.finish(); }
        else if (["ready", "replied"].includes(session.phase) && camera.status === "on") { event.preventDefault(); session.capture(camera.videoRef.current?.srcObject); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const importVideo = async (event) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || busy || !session.active) return;
    const token = ++importToken.current;
    setImporting(true); setSourceError("");
    try {
      const duration = await inspectSignClip(file);
      if (importToken.current === token) session.importClip(file, duration);
    } catch (error) { if (importToken.current === token) setSourceError(error.message); }
    finally { if (importToken.current === token) setImporting(false); }
  };
  const submitTyped = (event) => {
    event.preventDefault();
    if (!typed.trim() || busy || importing || ai.state !== "configured") return;
    session.send(typed, { signed: false }); setTyped("");
  };

  return (
    <main className="mode live-sign-mode" aria-labelledby="live-sign-title">
      <TopBar title="Live Sign" titleId="live-sign-title" onBack={onBack}>
        <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="live-reply-language" />
      </TopBar>
      <div className="live-intro">
        <div><p className="eyebrow">A conversation, in your hands</p><h2>Sign. Check. Keep talking.</h2><p>Short signed turns, a meaning you can correct, and AI replies in one session.</p></div>
        <span className="live-preview-badge">Experimental video interpretation</span>
      </div>
      <div className="live-toolbar">
        <div className="field"><label htmlFor="live-sign-language">Sign language</label><select id="live-sign-language" value={settings.signLanguage} onChange={(e) => update({ signLanguage: e.target.value })}>{SIGN_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
        <p className="fine-print">Changing a language ends this session. ISL and ASL are interpreted separately.</p>
        <button type="button" className="btn btn-small" onClick={onLibrary}>Sign video library</button>
        <button type="button" className="btn btn-small" onClick={onLocal}>Personal signs & face-to-face</button>
        {onTrained && <button type="button" className="btn btn-primary btn-small" onClick={onTrained}>Trained sign words · no AI key needed</button>}
      </div>
      {ai.state !== "configured" && (
        <aside className="live-setup notice" aria-label="AI setup">
          <strong>{ai.state === "room-only" ? "AI help is available inside rooms" : ai.state === "checking" ? "Checking AI setup…" : ai.state === "missing" ? "AI setup needed" : "AI server unavailable"}</strong>
          <p>{ai.state === "room-only" ? "Open Connect from Home for optional AI draft help. This interpretation tool runs with AI on the laptop’s development server. Local recording, speech and saved videos remain available here." : ai.state === "missing" ? "Add GEMINI_API_KEY to .env.local and restart npm run dev. Camera recording and your saved videos can still work locally." : "Camera recording stays available. AI interpretation and answers need the server and an internet connection."}</p>
          <p>The camera preview tracks hands only. Record a turn and interpret it to get words; without AI setup, you can type its meaning after recording and use Speak my message.</p>
          <button type="button" className="btn btn-small" onClick={() => setCheckAttempt((n) => n + 1)} disabled={ai.state === "checking"}>Check AI setup again</button>
        </aside>
      )}
      <div className="live-layout">
        <section className="live-camera-panel" aria-label="Your sign session">
          <div className="live-session-heading"><span className={`session-light${session.active ? " on" : ""}`} aria-hidden="true" /><strong role="status">{PHASE_LABEL[session.phase]}</strong><span className="live-clock">{session.phase === "capturing" ? `${(session.elapsed / 1000).toFixed(1)} / 12s` : settings.signLanguage.toUpperCase()}</span></div>
          <div className={`camera live-camera${session.phase === "capturing" ? " is-recording" : ""}`}>
            <video ref={camera.videoRef} className="mirror" muted playsInline aria-hidden="true" />
            <canvas ref={canvasRef} className="mirror overlay" aria-hidden="true" />
            {!session.active && <div className="live-camera-idle"><span aria-hidden="true">🤟</span><strong>Start a sign conversation</strong><p>Keep your face, upper body and both hands in view.</p></div>}
            {camera.status === "starting" && <p className="camera-status">Starting your laptop camera… Allow access if asked.</p>}
            {camera.status === "error" && <div className="camera-status error" role="alert"><p>{camera.error}</p><button type="button" className="btn btn-small" onClick={camera.retry}>Retry camera</button></div>}
            {session.phase === "capturing" && <div className="live-record-label"><span aria-hidden="true">●</span> Recording video only</div>}
          </div>
          <div className="live-framing" aria-live="polite">{camera.status === "on" ? !hands.framed ? "Move your hands fully inside the frame." : hands.count ? `${hands.count} ${hands.count === 1 ? "hand" : "hands"} in view · tracking only, not a translation` : "Bring both hands into view when you're ready." : "Your camera turns off when you end the session."}</div>
          <div className="live-session-actions">
            {!session.active ? <button type="button" className="btn btn-primary" onClick={session.start}>Start sign session</button> : <>
              {session.phase === "capturing" ? <button type="button" className="btn btn-primary" onClick={session.finish}>Finish signing <kbd>Space</kbd></button> : <button type="button" className="btn btn-primary" disabled={camera.status !== "on" || busy || importing} onClick={() => session.capture(camera.videoRef.current?.srcObject)}>{["preview", "review"].includes(session.phase) ? "Record again" : "Sign your turn"} <kbd>Space</kbd></button>}
              {busy && <button type="button" className="btn" onClick={session.interrupt}>Interrupt <kbd>Esc</kbd></button>}
              <button type="button" className="btn btn-ghost" onClick={session.end}>End session</button>
            </>}
          </div>
          <CameraSelect id="live-camera-device" camera={camera} value={deviceId} disabled={busy || importing} onChange={setDeviceId} />
          {session.active && <label className={`btn btn-small file-button${busy || importing ? " disabled" : ""}`}>{importing ? "Checking video…" : "Use a short sign video"}<input type="file" aria-label="Import a live sign turn" accept="video/mp4,video/webm" disabled={busy || importing} onChange={importVideo} /></label>}
          <details className="live-options"><summary>Session options</summary>
            <Switch checked={autoFinish} onChange={setAutoFinish} description="After signing for 2 seconds, lower your hands for 1.2 seconds to finish. Turn this off for signs below the camera.">Finish when hands lower</Switch>
            {canSpeak && <Switch checked={session.speakReplies} onChange={session.setSpeakReplies}>Speak AI replies aloud</Switch>}
            <Switch checked={settings.videoReplies} onChange={(videoReplies) => update({ videoReplies })}>Show saved sign videos for replies</Switch>
            {tracking.status === "error" && <p className="notice error">{tracking.error} <button type="button" className="btn btn-small" onClick={tracking.retry}>Retry tracking</button></p>}
            <p className="fine-print">Hand tracking helps with framing and finishing a turn. The AI examines the full video separately. Manual recording works without hand tracking.</p>
          </details>
          <p className="fine-print">12 seconds maximum · 2 MB maximum · no microphone recording</p>
          {sourceError && <p className="notice error" role="alert">{sourceError}</p>}
        </section>

        <section className="live-conversation" aria-label="Sign conversation">
          <div className="live-conversation-heading"><h2>Conversation</h2><span>{ai.state === "configured" ? "AI key configured" : "Local preview"}</span></div>
          {!session.log.length && !session.clip && <div className="live-empty"><p className="eyebrow">How it flows</p><ol><li><strong>Sign your turn</strong><span>Record a short message with your laptop camera.</span></li><li><strong>Check the meaning</strong><span>Choose to send the clip, then review the AI's tentative interpretation.</span></li><li><strong>Get a reply</strong><span>Confirm your message. Read, listen, or watch matching saved sign videos.</span></li></ol><p>Video interpretation can misread signs. This preview is not a validated ISL or ASL translator.</p></div>}
          {session.clip && ["preview", "interpreting", "review"].includes(session.phase) && <div className="live-review">
            <div className="live-review-heading"><strong>Your signed turn</strong><span>{session.clip.duration.toFixed(1)} seconds</span></div>
            {clipURL && <video key={clipURL} src={clipURL} muted playsInline controls aria-label="Review your signed clip" onLoadedData={() => setClipReady(true)} onError={() => { setClipReady(false); setSourceError("This clip cannot play. Record again or use a short MP4."); }} />}
            {session.phase === "interpreting" ? <p role="status">Interpreting movement and signs… <button type="button" className="btn btn-small" onClick={session.interrupt}>Cancel interpretation</button></p> : <>
              <label className="live-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Send this clip to <strong>Google Gemini</strong> to interpret my signs. Camera recordings have no audio; imported clips may include audio.</span></label>
              <button type="button" className="btn" disabled={importing || !consent || !clipReady || ai.state !== "configured"} onClick={() => { if (!importing) session.interpret(consent); }}>{session.interpretation ? "Interpret again" : "Interpret my signs"}</button>
            </>}
          </div>}
          {session.interpretation && session.phase === "review" && <div className={`live-interpretation ${session.interpretation.status}`}><strong>{session.interpretation.status === "recognized" ? "Tentative meaning — please check" : session.interpretation.status === "no_sign" ? "No clear signing found" : "I couldn't read this turn reliably"}</strong><p>{session.interpretation.feedback}</p>{session.interpretation.glosses.length > 0 && <p className="fine-print">Possible glosses: {session.interpretation.glosses.join(" · ")}</p>}</div>}
          {["preview", "review"].includes(session.phase) && <form className="live-meaning-form" onSubmit={(e) => { e.preventDefault(); if (!importing && ai.state === "configured") session.send(); }}><label htmlFor="live-meaning">{session.interpretation?.status === "recognized" ? "Is this what you meant? Correct it here." : "Type the meaning if needed"}</label><textarea id="live-meaning" value={session.meaning} disabled={importing} maxLength={2000} rows={3} onChange={(e) => session.setMeaning(e.target.value)} placeholder="Your message, in your own words" /><div className="actions"><button type="submit" className="btn btn-primary" disabled={importing || !session.meaning.trim() || ai.state !== "configured"}>Confirm meaning & get reply</button>{canSpeak && <button type="button" className="btn" disabled={!session.meaning.trim()} onClick={session.speakMessage}>Speak my message</button>}</div></form>}
          <div className="live-turns" role="log" aria-label="Conversation history" aria-live="polite" aria-relevant="additions text">
            {session.log.map((turn) => <article key={turn.id} className="live-turn"><div className="live-user-turn"><span>{turn.signed ? "You · reviewed signs" : "You · typed"}</span><p>{turn.said}</p></div><div className="live-ai-turn"><span>SignBridge</span>{turn.pending ? <p>Thinking…</p> : turn.interrupted ? <p>Interrupted. You can sign again.</p> : turn.error ? <p className="error">{turn.error}</p> : <p>{turn.reply}</p>}{turn.reply && canSpeak && <button type="button" className="btn btn-small" onClick={() => session.speak(turn)}>Speak this reply</button>}</div></article>)}
          </div>
          {lastReply && settings.videoReplies && <div className="live-reply-video"><SignVideoPlayer key={`${lastReply.id}:${session.phase}`} text={lastReply.reply} clips={videos.clips} signLanguage={lastReply.signLanguage} textLanguage={lastReply.lang} autoPlay={session.phase === "replied"} /><button type="button" className="btn btn-small" onClick={onLibrary}>Add missing reply videos</button></div>}
          {videos.error && <p className="notice error" role="alert">{videos.error}</p>}
          {session.error && <p className="notice error" role="alert">{session.error}</p>}
          {session.active && <form className="live-type-form" onSubmit={submitTyped}><label htmlFor="live-typed">Or type a turn</label><div><input id="live-typed" value={typed} maxLength={2000} onChange={(e) => setTyped(e.target.value)} disabled={busy || importing} placeholder="Keep the conversation going…" /><button type="submit" className="btn" disabled={busy || importing || !typed.trim() || ai.state !== "configured"}>Send</button></div></form>}
          {session.active && canSpeak && <button type="button" className="btn btn-ghost btn-small" onClick={session.stopSpeech}>Stop speech</button>}
        </section>
      </div>
      <p className="live-privacy fine-print">Clips stay in memory until you choose to send them. SignBridge does not save these turns to its video library or retain them on its server. Google's processing is subject to your Gemini account's data terms. Reply videos come from your own library; missing signs remain visible as text.</p>
    </main>
  );
}
