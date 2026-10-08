import { useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera.js";
import { usePoseTracking } from "../hooks/usePoseTracking.js";
import { poseFrameFromHolistic } from "../lib/trainedSignModel.js";
import { assessNonsigningCapture, copyNonsigningFrame, NONSIGNING_CAPTURE_MS } from "../lib/nonsigningCapture.js";

const activities = {
  idle: "Sit normally with relaxed hands. Do not intentionally perform a sign.",
  everyday: "Make ordinary movements, such as adjusting your glasses or reaching for an object. Do not intentionally sign.",
  outside: "Move your hands or body out of the camera frame. Keep the camera running; do not intentionally sign.",
};
const validCode = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.trim());

export default function NonsigningCapture({ signLanguage, store, disabled = false }) {
  const [cameraOn, setCameraOn] = useState(false), [activity, setActivity] = useState("idle");
  const [phase, setPhase] = useState("ready"), [elapsed, setElapsed] = useState(0), [review, setReview] = useState(null);
  const [signer, setSigner] = useState(""), [attested, setAttested] = useState(false), [consent, setConsent] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [fresh, setFresh] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [sessionId] = useState(() => `nonsigning-${Date.now().toString(36)}`);
  const camera = useCamera({ active: cameraOn });
  const recording = useRef(false), frames = useRef([]), started = useRef(0), lastFrame = useRef(null);
  const alive = useRef(true), epoch = useRef(0), pending = useRef(false), finishRef = useRef(null), freshnessTimer = useRef(0);
  const quality = review?.quality;
  const resetConsent = () => { setAttested(false); setConsent(false); setNotice(""); };
  const clearCapture = () => { recording.current = false; frames.current = []; epoch.current++; setReview(null); setElapsed(0); setPhase("ready"); resetConsent(); };
  const tracking = usePoseTracking({ videoRef: camera.videoRef, active: camera.status === "on", onFrame: (detected) => {
    const now = performance.now();
    if (!alive.current || !cameraOn || !Number.isFinite(now) || (lastFrame.current !== null && now <= lastFrame.current)) return;
    const pose = poseFrameFromHolistic(detected);
    if (!copyNonsigningFrame(pose, 0)) return;
    lastFrame.current = now; setFresh(true); clearTimeout(freshnessTimer.current);
    freshnessTimer.current = setTimeout(() => { if (alive.current) setFresh(false); }, 1000);
    if (!recording.current || frames.current.length >= 100) return;
    const atMs = now - started.current, frame = copyNonsigningFrame(pose, atMs);
    if (frame && (!frames.current.length || atMs > frames.current.at(-1).atMs)) frames.current.push(frame);
  } });
  const ready = camera.status === "on" && tracking.status === "ready" && fresh && !disabled && phase !== "saving";
  const canSave = quality?.ok && validCode(signer) && attested && consent && !pending.current && !reloading && !store.loading && !store.error && !disabled && phase !== "saving";
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current++; recording.current = false; frames.current = []; lastFrame.current = null; clearTimeout(freshnessTimer.current); };
  }, []);
  useEffect(() => {
    lastFrame.current = null; setFresh(false); clearTimeout(freshnessTimer.current);
    if (recording.current && (camera.status !== "on" || tracking.status === "error")) { clearCapture(); setError("Tracking stopped during recording. Nothing was saved. Retry the camera or tracking, then record again."); }
  }, [camera.status, tracking.status]);
  const finish = () => {
    if (!recording.current) return;
    recording.current = false;
    const durationMs = Math.max(0, performance.now() - started.current);
    const captured = frames.current; frames.current = [];
    setElapsed(durationMs); setReview({ frames: captured, quality: assessNonsigningCapture(captured, durationMs) }); setPhase("review"); resetConsent();
  };
  finishRef.current = finish;
  useEffect(() => {
    if (phase !== "recording") return;
    const progress = setInterval(() => { if (recording.current) setElapsed(Math.min(NONSIGNING_CAPTURE_MS, performance.now() - started.current)); }, 100);
    const timer = setTimeout(() => finishRef.current(), NONSIGNING_CAPTURE_MS);
    return () => { clearInterval(progress); clearTimeout(timer); };
  }, [phase]);
  const record = () => {
    if (!ready || recording.current || pending.current || lastFrame.current === null || performance.now() - lastFrame.current > 1000) return;
    clearCapture(); setError(""); started.current = performance.now(); recording.current = true; setPhase("recording");
  };
  const stopCamera = () => { clearCapture(); setCameraOn(false); setError(""); };
  const retryStorage = async () => {
    if (pending.current || reloading || recording.current) return;
    const currentEpoch = epoch.current; setReloading(true);
    try {
      await store.reload();
      if (alive.current && epoch.current === currentEpoch) { setError(""); setNotice("Storage check completed. Review the recording and choose Save when ready."); }
    } catch (cause) { if (alive.current && epoch.current === currentEpoch) setError(cause?.message || "Storage is still unavailable. Your recording is kept while this section remains open."); }
    finally { if (alive.current) setReloading(false); }
  };
  const save = async (event) => {
    event.preventDefault();
    if (!canSave || pending.current) return;
    const currentEpoch = epoch.current, captured = review.frames;
    pending.current = true; setPhase("saving"); setError(""); setNotice("");
    try {
      await store.add({ signLanguage, signerId: signer.trim(), sessionId, frames: captured, captureDurationMs: quality.durationMs, kind: "unknown", label: "__unknown__", negativeType: "nonsigning", consent: true });
      if (alive.current && epoch.current === currentEpoch) { setAttested(false); setConsent(false); setReview(null); setElapsed(0); setNotice("Saved one nonsigning example locally. The recognition model has not been retrained."); setPhase("ready"); }
    } catch (cause) { if (alive.current && epoch.current === currentEpoch) { setError(cause?.message || "Could not save this example. The recording is kept for retry."); setPhase("review"); } }
    finally { pending.current = false; }
  };
  return <section className="nonsigning-capture" aria-labelledby="nonsigning-capture-title">
    <div><h3 id="nonsigning-capture-title">Record everyday movement</h3><p className="hint">You do not need to know sign language. These examples help a future model learn when to say “no sign”. No sign-recognition model or AI is used here.</p></div>
    <div className="nonsigning-layout"><div>
      <div className="field"><label htmlFor="nonsigning-activity">What will you record?</label><select id="nonsigning-activity" value={activity} disabled={phase === "recording" || phase === "saving"} onChange={(event) => { setActivity(event.target.value); clearCapture(); setError(""); }}>{Object.entries({ idle: "Sitting still", everyday: "Everyday movement", outside: "Hands or body out of view" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <p className="nonsigning-instruction">{activities[activity]}</p>
      <div className="actions">{!cameraOn ? <button type="button" className="btn" disabled={disabled || pending.current} onClick={() => setCameraOn(true)}>Start nonsigning camera</button> : <><button type="button" className="btn btn-primary" disabled={!ready || phase === "recording"} onClick={record}>Record 3 seconds</button>{phase === "recording" && <button type="button" className="btn" onClick={() => { clearCapture(); setError(""); }}>Cancel recording</button>}<button type="button" className="btn btn-ghost btn-small" disabled={pending.current} onClick={stopCamera}>Stop nonsigning camera</button></>}</div>
      <div className="camera nonsigning-camera"><video ref={camera.videoRef} muted playsInline className="mirror" aria-hidden="true" />{!cameraOn && <p className="camera-status">Camera off until you start it.</p>}</div>
      {phase === "recording" ? <><p role="status">Recording for three seconds. Nothing is saved yet.</p><p aria-live="off">Recording {(elapsed / 1000).toFixed(1)} / 3 seconds · {frames.current.length} samples</p></> : <p role="status">{!cameraOn ? "Nothing is recorded or saved automatically." : camera.status === "starting" ? "Connecting camera…" : camera.status === "error" ? "Camera needs attention." : tracking.status === "loading" ? "Loading local body and hand tracking…" : tracking.status === "error" ? "Tracking needs attention." : !fresh ? "Waiting for fresh tracking frames. Missing hands are allowed; missing tracking frames are not." : "Ready to record. Hands and shoulders do not have to be visible."}</p>}
      {camera.status === "error" && <p className="notice error" role="alert">{camera.error} <button type="button" className="btn btn-small" onClick={camera.retry}>Retry nonsigning camera</button></p>}
      {cameraOn && tracking.status === "error" && <p className="notice error" role="alert">{tracking.error} <button type="button" className="btn btn-small" onClick={tracking.retry}>Retry nonsigning tracking</button></p>}
    </div><div>
      {quality && <div className="nonsigning-review"><h4>Review this recording</h4><dl><div><dt>Measured samples</dt><dd>{quality.count}</dd></div><div><dt>Recording duration</dt><dd>{(quality.durationMs / 1000).toFixed(1)} seconds</dd></div>{quality.ok && <div><dt>Longest tracking gap</dt><dd>{Math.round(quality.largestGapMs)} ms</dd></div>}</dl><p className={quality.ok ? "hint" : "notice error"} role={quality.ok ? undefined : "alert"}>{quality.feedback}</p><p className="fine-print">Dataset: {signLanguage.toUpperCase()} · no intentional sign. This is your attestation, not a model prediction.</p></div>}
      <form onSubmit={save}><div className="field"><label htmlFor="nonsigning-signer">Anonymous signer code</label><input id="nonsigning-signer" value={signer} maxLength={80} placeholder="participant-01" disabled={phase === "saving"} onChange={(event) => { setSigner(event.target.value); resetConsent(); }} /></div><p className="fine-print">Use letters, numbers, dots, dashes or underscores. Reuse the same anonymous code across sessions; do not enter a real name.</p><label className="live-consent"><input type="checkbox" checked={attested} disabled={!quality?.ok || phase === "saving"} onChange={(event) => setAttested(event.target.checked)} /><span>I did not intentionally perform a sign in this recording.</span></label><label className="live-consent"><input type="checkbox" checked={consent} disabled={!quality?.ok || phase === "saving"} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to store this recording’s pose coordinates and timing locally for training.</span></label><button type="submit" className="btn" disabled={!canSave}>{phase === "saving" ? "Saving nonsigning example…" : "Save nonsigning example"}</button></form>
      {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      {store.error && <div className="notice"><p>Pose storage needs attention. Your recording is kept while this section remains open.</p><button type="button" className="btn btn-small" disabled={reloading || pending.current || phase === "recording"} onClick={retryStorage}>{reloading ? "Checking pose storage…" : "Retry pose storage"}</button></div>}
      <p className="fine-print">No video or audio is stored. Nothing is uploaded. Closing this section stops the camera and clears any unsaved recording.</p>
    </div></div>
  </section>;
}
