import { useEffect, useRef, useState } from "react";
import { useTrainingSamples } from "../hooks/useTrainingSamples.js";

export default function TrainingSampleForm({ frames, result, signLanguage, sessionCode, signerCode, onSignerChange, label, onLabelChange, busy, onSaving }) {
  const store = useTrainingSamples();
  const [kind, setKind] = useState("known");
  const [negativeType, setNegativeType] = useState("unspecified");
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onSaving(false); }; }, [onSaving]);
  useEffect(() => { setConsent(false); setNotice(""); }, [label, kind, negativeType, signerCode, sessionCode]);
  const valid = consent && Boolean(signerCode.trim()) && (kind === "unknown" || Boolean(label.trim())) && frames.length >= 4;
  const save = async (event) => {
    event.preventDefault();
    if (inFlight.current || busy || store.loading || !valid) return;
    inFlight.current = true; onSaving(true); setNotice(""); setFailed(false);
    try {
      await store.add({ signLanguage, label: kind === "known" ? label.trim() : "__unknown__", signerId: signerCode.trim(), sessionId: sessionCode,
        kind, ...(kind === "unknown" ? { negativeType } : {}), frames, consent: true, prediction: { status: result.status, meaning: result.meaning } });
      if (alive.current) { setConsent(false); setNotice("Saved this pose sequence locally. Your model has not been retrained."); }
    } catch (error) { if (alive.current) { setFailed(true); setNotice(error.message || "Could not save this sample."); } }
    finally { inFlight.current = false; if (alive.current) onSaving(false); }
  };
  return <details className="workspace-save"><summary>Save this turn for model training</summary><form onSubmit={save}>
    <p className="hint">Save landmarks and timing on this browser. No camera video is saved or uploaded. Export samples from Training Studio for a separate training run.</p>
    <div className="field"><label htmlFor="sample-kind">Sample type</label><select id="sample-kind" value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)}><option value="known">Labelled word</option><option value="unknown">Other sign or no sign · rejection example</option></select></div>
    {kind === "known" ? <><div className="field"><label htmlFor="sample-label">Verified training label</label><input id="sample-label" value={label} maxLength={80} disabled={busy} onChange={(e) => onLabelChange(e.target.value)} /></div><p className="fine-print">Verify the word with someone who knows this sign language. A model prediction or your practice attempt alone is not a verified label.</p></> : <><div className="field"><label htmlFor="sample-negative-type">Rejection example type</label><select id="sample-negative-type" value={negativeType} disabled={busy} onChange={(e) => setNegativeType(e.target.value)}><option value="unspecified">Unsure / not reviewed</option><option value="unsupported-sign">Sign outside the supported vocabulary</option><option value="nonsigning">No intentional sign</option></select></div><p className="fine-print">Choose No intentional sign only for idle or everyday movement. An unfamiliar sign is not a nonsigning example. If unsure, leave the type unreviewed.</p></>}
    <div className="field"><label htmlFor="sample-signer">Signer code</label><input id="sample-signer" value={signerCode} maxLength={80} disabled={busy} placeholder="signer-01" onChange={(e) => onSignerChange(e.target.value)} /></div>
    <p className="fine-print">Session: {sessionCode}. Use a code instead of your real name. Reuse the same signer code across sessions so training and testing can keep different people apart.</p>
    <label className="live-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} /><span>I have checked the sample label/type and agree to save this pose sequence locally for training.</span></label>
    <button type="submit" className="btn btn-small" disabled={busy || store.loading || !valid}>{inFlight.current ? "Saving sample…" : "Save training sample"}</button>
    {notice && <p className={`notice${failed ? " error" : ""}`} role={failed ? "alert" : "status"}>{notice}</p>}{store.error && <p className="notice error" role="alert">{store.error}</p>}
  </form></details>;
}
