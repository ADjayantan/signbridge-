import { useEffect, useRef, useState } from "react";
import { usePoseTracking } from "../hooks/usePoseTracking.js";
import { useWordRecognitionModel } from "../hooks/useWordRecognitionModel.js";
import WordModelSelect from "./WordModelSelect.jsx";
import WordVocabularyHelp from "./WordVocabularyHelp.jsx";
import SignRecognitionDetails from "./SignRecognitionDetails.jsx";
import { poseFrameFromHolistic } from "../lib/trainedSignModel.js";
import { describePoseCapture, poseFraming } from "../lib/signWorkspace.js";
import { drawHands } from "../lib/drawHands.js";
import { HAND_FINGERS, handJointCounts, handsFromPoseFrame } from "../lib/handJoints.js";
import "../styles/roomRecognition.css";

function drawTrackingPreview(canvas, video, pose, showJointNumbers) {
  if (!canvas || video?.readyState < 2 || !video?.videoWidth || !video?.videoHeight) return;
  const hands = handsFromPoseFrame(pose);
  try {
    drawHands(canvas, hands, video.videoWidth, video.videoHeight, { showLabels: true, showJointNumbers, mirrorText: true });
    const context = canvas.getContext("2d");
    if (!context) return;
    context.save(); context.globalCompositeOperation = "destination-over";
    context.drawImage(video, 0, 0, canvas.width, canvas.height); context.restore();
    if (pose.confidences[11] >= .2 && pose.confidences[12] >= .2) {
      context.strokeStyle = "#ffc55b"; context.lineWidth = Math.max(2, canvas.width / 220);
      context.beginPath(); context.moveTo(pose.keypoints[11][0] * canvas.width, pose.keypoints[11][1] * canvas.height);
      context.lineTo(pose.keypoints[12][0] * canvas.width, pose.keypoints[12][1] * canvas.height); context.stroke();
    }
  } catch { /* Framing text remains available when canvas rendering is unsupported. */ }
}

// Recognition borrows the call's video. It never acquires or stops a media track.
export default function RoomSignCapture({ videoRef, cameraStatus, signLanguage, onAppend, onActivityChange, onRead, canRead = false, speaking = false, onStopReading }) {
  const [engine, setEngine] = useState("legacy");
  const trained = useWordRecognitionModel(signLanguage, engine);
  const [recognizing, setRecognizing] = useState(false);
  const predictionEpoch = useRef(0);
  const [capturing, setCapturing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [meaning, setMeaning] = useState("");
  const [quality, setQuality] = useState(null);
  const [error, setError] = useState("");
  const [framing, setFraming] = useState(null);
  const [joints, setJoints] = useState({ left: 0, right: 0, total: 0 });
  const [showJointNumbers, setShowJointNumbers] = useState(false);
  const [stale, setStale] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const canvas = useRef(null), lastFrameAt = useRef(null);
  const frames = useRef([]), started = useRef(0), active = useRef(false), finishRef = useRef(null);
  const activity = useRef(onActivityChange); activity.current = onActivityChange;
  const ownedReading = useRef(false), stopReading = useRef(onStopReading); stopReading.current = onStopReading;
  const tracking = usePoseTracking({ videoRef, active: cameraStatus === "on", onFrame: (detected, video) => {
    const pose = poseFrameFromHolistic(detected), now = performance.now(), next = poseFraming(pose);
    const nextJoints = handJointCounts(pose);
    lastFrameAt.current = now; setStale(false);
    setFraming((previous) => previous?.hands === next.hands && previous.body === next.body && previous.clipped === next.clipped ? previous : next);
    setJoints((previous) => previous.left === nextJoints.left && previous.right === nextJoints.right ? previous : nextJoints);
    drawTrackingPreview(canvas.current, video || videoRef.current, pose, showJointNumbers);
    if (!active.current) return;
    const atMs = now - started.current;
    if (frames.current.length < 100 && atMs >= 0 && atMs <= 12000 && (!frames.current.length || atMs > frames.current.at(-1).atMs)) { frames.current.push({ ...pose, atMs }); setSampleCount(frames.current.length); }
  } });
  const cancel = () => { predictionEpoch.current++; trained.cancel(); active.current = false; frames.current = []; setCapturing(false); setRecognizing(false); setElapsed(0); setSampleCount(0); activity.current?.(false); };
  useEffect(() => {
    cancel(); setResult(null); setMeaning(""); setQuality(null); setError(""); setFraming(null); setJoints({ left: 0, right: 0, total: 0 }); setStale(false); lastFrameAt.current = null;
    return () => { predictionEpoch.current++; active.current = false; frames.current = []; activity.current?.(false); if (ownedReading.current) stopReading.current?.(); ownedReading.current = false; };
  }, [signLanguage, engine]);
  useEffect(() => {
    if ((active.current || recognizing) && (cameraStatus !== "on" || tracking.status === "error")) { cancel(); setError("Capture stopped. Reconnect the camera or tracking, then try again."); }
  }, [cameraStatus, tracking.status]);
  const pipelineReady = cameraStatus === "on" && tracking.status === "ready";
  const ready = pipelineReady && trained.status === "ready" && framing?.hands > 0 && framing.body && !stale && !recognizing;
  const readinessLabel = stale ? "Tracking frames paused" : ready ? "Ready to capture a word" : trained.status !== "ready" && framing?.hands ? `Hand joints detected · word model ${trained.status === "loading" ? "loading" : "unavailable"}` : "Check your framing";
  useEffect(() => {
    if (!pipelineReady) { setFraming(null); setJoints({ left: 0, right: 0, total: 0 }); setStale(false); lastFrameAt.current = null; return undefined; }
    const waitingSince = performance.now();
    const timer = setInterval(() => setStale(performance.now() - (lastFrameAt.current ?? waitingSince) > 2000), 500);
    return () => clearInterval(timer);
  }, [pipelineReady]);
  const start = () => {
    if (!ready || active.current) return;
    predictionEpoch.current++; frames.current = []; started.current = performance.now(); active.current = true;
    setCapturing(true); setElapsed(0); setSampleCount(0); setResult(null); setMeaning(""); setQuality(null); setError(""); activity.current?.(true);
  };
  const finish = () => {
    if (!active.current) return;
    active.current = false; setCapturing(false); activity.current?.(false);
    const sequence = frames.current; frames.current = [];
    const durationMs = Math.min(12000, performance.now() - started.current);
    setQuality(describePoseCapture(sequence, durationMs));
    const epoch = ++predictionEpoch.current;
    const commit = (next) => { if (epoch !== predictionEpoch.current) return; setRecognizing(false); activity.current?.(false); setResult(next); setMeaning(next.meaning || ""); };
    const fail = (cause) => { if (epoch !== predictionEpoch.current) return; setRecognizing(false); activity.current?.(false); if (cause?.name !== "AbortError") setError("This turn could not be recognised. You can type its meaning in your message."); };
    try {
      if (trained.async) { setRecognizing(true); activity.current?.(true); Promise.resolve(trained.predict(sequence, { durationMs })).then(commit, fail); }
      else commit(trained.predict(sequence, { durationMs }));
    } catch (cause) { fail(cause); }
  };
  finishRef.current = finish;
  useEffect(() => {
    if (!capturing) return undefined;
    const timer = setInterval(() => { const ms = performance.now() - started.current; setElapsed(Math.min(ms, 12000)); if (ms >= 12000) finishRef.current(); }, 100);
    return () => clearInterval(timer);
  }, [capturing]);
  return <section className="room-recognition" aria-label="Local word recognition">
    <h3>Hand joints and word capture</h3>
    <WordModelSelect value={engine} onChange={(next) => { cancel(); setEngine(next); }} />
    {trained.status === "ready" && <WordVocabularyHelp key={`${engine}:${signLanguage}`} model={trained.model} signLanguage={signLanguage} engine={engine} disabled={capturing || recognizing} />}
    <p className="hint">Track 21 joints per hand: wrist and all five fingers. Detection runs on this device using your existing camera stream. Experimental {signLanguage.toUpperCase()} word recognition uses the movement over a complete capture; review its meaning before speaking or adding it.</p>
    <ol className="room-recognition-steps"><li>Choose a supported word and keep both shoulders and your signing hand in view.</li><li>Press <strong>Capture a word</strong>, sign the complete word, then press <strong>Finish sign</strong>.</li><li>Review or correct the result. Use <strong>Speak reviewed word</strong> for voice, or <strong>Add reviewed word to message</strong> to compose text. You still choose when to Send.</li></ol>
    {trained.status === "loading" && <p role="status">Loading the local word model…</p>}
    {["error", "unavailable"].includes(trained.status) && <div className="room-notice"><p>Local research weights are unavailable on this device. Hand-joint tracking still works with the camera on. You can keep signing directly to your partner or type a reviewed meaning.</p>{engine === "graph" && <p>{trained.error || "No full-joint model has passed the release gates here yet."}</p>}<button className="btn btn-small" type="button" onClick={trained.retry}>Check local model again</button></div>}
    {recognizing && <p role="status">Recognising the completed turn… <button className="btn btn-small" type="button" onClick={cancel}>Cancel recognition</button></p>}
    {cameraStatus !== "on" && <p className="hint">Turn on your camera to see detected hand joints.</p>}
    {tracking.status === "loading" && <p role="status">Starting hand and body tracking…</p>}
    {pipelineReady && <>
      <figure className={`room-tracking-preview${stale ? " paused" : ""}`}><canvas ref={canvas} className="mirror" role="img" aria-label="Camera preview with 21 detected joints per hand and shoulders" /><figcaption>{stale ? "Preview paused" : "Live hand-joint preview"} · landmarks show tracking, not a word translation.</figcaption></figure>
      <div className="room-joint-counts" aria-label="Detected hand joints"><span>Left hand: <strong>{stale ? "Paused" : `${joints.left} / 21`}</strong></span><span>Right hand: <strong>{stale ? "Paused" : `${joints.right} / 21`}</strong></span><span>Total: <strong>{stale ? "Paused" : `${joints.total} / 42`}</strong></span></div>
      <div className="room-joint-legend" aria-label="Finger colours">{HAND_FINGERS.map((finger) => <span key={finger.name}><i style={{ backgroundColor: finger.color }} aria-hidden="true" />{finger.name}</span>)}</div>
      <label className="room-joint-numbers"><input type="checkbox" checked={showJointNumbers} onChange={(event) => setShowJointNumbers(event.target.checked)} />Show joint numbers (0–20)</label>
      <div className={`room-tracking-readiness ${ready ? "ready" : "attention"}`} aria-live="off"><strong>{readinessLabel}</strong><p>{stale ? "No new tracking frames for over two seconds. Check the camera preview, then retry tracking." : !framing ? "Waiting for the first camera frame. Show your signing hand and both shoulders." : `${framing.hands} ${framing.hands === 1 ? "hand" : "hands"} tracked · ${framing.body ? "both shoulders in view" : "shoulders not tracked"}`}</p>{framing && !stale && <p className="fine-print">{!framing.body ? "Move back until both shoulders fit in the frame." : !framing.hands ? "No hands tracked yet. Show your signing hand in good light." : framing.clipped ? "Your hand is reaching the camera edge. Leave more room for the complete movement." : "Hand and shoulder visibility is a framing check; it does not establish signing accuracy."}</p>}<p className="fine-print">One hand is enough for a one-hand sign. Use both for a two-hand sign.</p>{stale && <button className="btn btn-small" type="button" onClick={tracking.retry}>Retry paused tracking</button>}</div>
    </>}
    {trained.status === "ready" && <>
      {capturing && <div className="room-capture-progress"><strong>Capturing one complete word</strong><progress max={12000} value={elapsed} aria-label="Sign capture time" /><p>{(elapsed / 1000).toFixed(1)} / 12 seconds · {sampleCount} pose samples captured</p>{sampleCount === 0 && <p className="hint">No pose samples captured yet. Check that the camera is still playing.</p>}<p className="fine-print">Finish after the complete movement. The capture ends automatically at 12 seconds.</p></div>}
      <div className="actions">{capturing ? <><button className="btn btn-primary" type="button" onClick={finish}>Finish sign · {(elapsed / 1000).toFixed(1)}s</button><button className="btn" type="button" onClick={cancel}>Cancel capture</button></> : <button className="btn" type="button" disabled={!ready} onClick={start}>Capture a word</button>}</div></>}
    {tracking.status === "error" && <p role="alert">{tracking.error} <button className="btn btn-small" type="button" onClick={tracking.retry}>Retry tracking</button></p>}
    {result && <div className="room-word-review"><strong>{result.status === "recognized" ? "Tentative word — check the meaning" : "No reliable word match"}</strong><p className="hint">{result.feedback}</p>
      <SignRecognitionDetails result={result} captureQuality={quality} />
      {result.candidates?.length > 0 && <div className="actions">{result.candidates.map((candidate) => <button className="btn btn-small" key={candidate.label || candidate.meaning} type="button" onClick={() => setMeaning(candidate.label || candidate.meaning)}>{candidate.label || candidate.meaning}</button>)}</div>}
      <label className="field">Review or correct the word<input value={meaning} maxLength={2000} onChange={(event) => setMeaning(event.target.value)} /></label>
      {onRead && (canRead ? <div className="actions"><button className="btn" type="button" disabled={!meaning.trim() || speaking} onClick={() => {
        ownedReading.current = true;
        void Promise.resolve(onRead({ text: meaning.trim(), lang: "en" })).finally(() => { ownedReading.current = false; });
      }}>Speak reviewed word</button>{speaking && <button className="btn" type="button" onClick={onStopReading}>Stop word playback</button>}</div> : <p className="hint">Read aloud is unavailable in this browser. You can add the reviewed word as text.</p>)}
      <button className="btn btn-primary" type="button" disabled={!meaning.trim()} onClick={() => {
        if (onAppend({ text: meaning.trim(), lang: "en", inputMethod: "sign", signLanguage }) === false) {
          setError("Your message is full. Shorten it, then add this reviewed word again."); return;
        }
        setMeaning(""); setError("");
      }}>Add reviewed word to message</button>
      {quality && <div className="room-capture-quality"><p className="fine-print">{quality.count} pose samples · hands visible in {quality.handFrames} samples. Framing describes tracking, not signing accuracy.</p>{quality.hints.map((hint) => <p key={hint} className="hint">{hint}</p>)}</div>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
