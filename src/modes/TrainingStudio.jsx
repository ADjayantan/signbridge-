import { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "../components/Controls.jsx";
import NonsigningCapture from "../components/NonsigningCapture.jsx";
import RecognitionReplay from "../components/RecognitionReplay.jsx";
import { useTrainingSamples } from "../hooks/useTrainingSamples.js";
import { exportTrainingDataset } from "../lib/trainingSamples.js";
import "../styles/trainingStudio.css";

const negativeName = (sample) => sample.negativeType === "nonsigning" ? "No intentional sign" : sample.negativeType === "unsupported-sign" ? "Unsupported sign" : "Unreviewed type";
const sampleName = (sample) => sample.kind === "unknown" ? sample.negativeType === "nonsigning" ? "No intentional sign" : sample.negativeType === "unsupported-sign" ? "Unsupported sign" : "Unknown example" : sample.label;
const distinct = (samples, field) => new Set(samples.map((sample) => sample[field]).filter(Boolean)).size;
function recordedAt(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Date unavailable";
}

export default function TrainingStudio({ settings, onBack, onCapture }) {
  const library = useTrainingSamples();
  const [filter, setFilter] = useState("both");
  const [operation, setOperation] = useState(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [nonsigningOpen, setNonsigningOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const operationRef = useRef(null);
  const downloads = useRef(new Map());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    document.title = "Training Studio · SignBridge";
    document.getElementById("training-studio-title")?.focus();
    return () => {
      mounted.current = false;
      for (const [url, timer] of downloads.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
      downloads.current.clear();
    };
  }, []);
  const visible = useMemo(() => library.samples.filter((sample) => filter === "both" || sample.signLanguage === filter)
    .toSorted((a, b) => b.createdAt - a.createdAt), [library.samples, filter]);
  const counts = useMemo(() => ({
    total: visible.length,
    known: visible.filter((sample) => sample.kind === "known").length,
    unknown: visible.filter((sample) => sample.kind === "unknown").length,
    labels: new Set(visible.filter((sample) => sample.kind === "known").map((sample) => `${sample.signLanguage}:${sample.label}`)).size,
    signers: distinct(visible, "signerId"), sessions: new Set(visible.map((sample) => `${sample.signerId}:${sample.sessionId}`)).size,
    nonsigning: visible.filter((sample) => sample.kind === "unknown" && sample.negativeType === "nonsigning").length,
    unsupported: visible.filter((sample) => sample.kind === "unknown" && sample.negativeType === "unsupported-sign").length,
    unreviewed: visible.filter((sample) => sample.kind === "unknown" && !["nonsigning", "unsupported-sign"].includes(sample.negativeType)).length,
  }), [visible]);
  const busy = Boolean(operation);
  const unavailable = library.loading || Boolean(library.error);
  const error = actionError || library.error;
  const viewName = filter === "both" ? "ISL + ASL" : filter.toUpperCase();

  const remove = async (sample) => {
    if (operationRef.current || library.loading) return;
    operationRef.current = `delete:${sample.id}`;
    setOperation(operationRef.current); setActionError(""); setNotice("");
    try {
      await library.remove(sample.id);
      if (mounted.current) setNotice(`Deleted ${sampleName(sample)} (${sample.signLanguage.toUpperCase()}) from this browser.`);
    } catch (err) {
      if (mounted.current) setActionError(err?.message || "Could not delete this sample. Try reloading the inventory.");
    } finally {
      operationRef.current = null;
      if (mounted.current) setOperation(null);
    }
  };
  const reload = async () => {
    if (operationRef.current || library.loading) return;
    operationRef.current = "reload"; setOperation("reload"); setActionError(""); setNotice("");
    try { await library.reload(); }
    catch (err) { if (mounted.current) setActionError(err?.message || "Could not reload saved samples. Try again."); }
    finally { operationRef.current = null; if (mounted.current) setOperation(null); }
  };
  const saveNonsigning = async (data) => {
    if (operationRef.current || library.loading) throw new Error("Finish the current sample operation before saving this recording.");
    operationRef.current = "save-nonsigning"; setOperation("save-nonsigning"); setNotice(""); setActionError("");
    try { return await library.add(data); }
    finally { operationRef.current = null; if (mounted.current) setOperation(null); }
  };
  const download = (all) => {
    if (operationRef.current || unavailable) return;
    const samples = all ? library.samples : visible;
    if (!samples.length) return;
    operationRef.current = "export"; setOperation("export"); setActionError(""); setNotice("");
    let url = "";
    let link;
    try {
      const dataset = exportTrainingDataset(samples);
      const blob = new Blob([JSON.stringify(dataset)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      link = document.createElement("a");
      link.href = url; link.download = `signbridge-training-${all ? "all" : filter}.json`;
      link.hidden = true; document.body.appendChild(link); link.click();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000);
      downloads.current.set(url, timer);
      setNotice(`Download requested for ${dataset.samples.length} ${dataset.samples.length === 1 ? "sample" : "samples"}${all ? " across both languages" : ` in the ${viewName} view`}. The JSON includes pose sequences and your labels; nothing was uploaded.`);
    } catch (err) {
      if (url) URL.revokeObjectURL(url);
      setActionError(err?.message || "Could not export these samples. Try again.");
    } finally {
      link?.remove(); operationRef.current = null; setOperation(null);
    }
  };

  return <main className="mode training-studio" aria-labelledby="training-studio-title">
    <TopBar title="Training Studio" titleId="training-studio-title" onBack={onBack} />
    <section className="training-intro" aria-labelledby="training-intro-title">
      <div><p className="eyebrow">Your labelled signing recordings</p><h2 id="training-intro-title">Build examples worth learning from.</h2><p>Capture a whole sign, check its label and save its pose sequence after choosing to keep it. ISL and ASL examples stay labelled separately.</p></div>
      <div className="training-capture"><span className="training-local">Local browser data</span><button type="button" className="btn btn-primary" onClick={onCapture}>Capture a sample <span aria-hidden="true">↗</span></button><p>Capture opens your {settings.signLanguage.toUpperCase()} session. This view filter does not change its language.</p></div>
    </section>
    {import.meta.env?.MODE !== "public-demo" && <details className="training-nonsigning" onToggle={(event) => setReplayOpen(event.currentTarget.open)}><summary>Recognition diagnostics · check a reference video</summary>{replayOpen && <RecognitionReplay key={settings.signLanguage} signLanguage={settings.signLanguage} />}</details>}
    <details className="training-nonsigning" onToggle={(event) => setNonsigningOpen(event.currentTarget.open)}><summary>Record no-sign examples · no sign-language knowledge needed</summary>{nonsigningOpen && <NonsigningCapture key={settings.signLanguage} signLanguage={settings.signLanguage} store={{ ...library, add: saveNonsigning }} disabled={busy} />}</details>
    <div className="training-toolbar"><div className="field"><label htmlFor="training-filter">View sign language</label><select id="training-filter" value={filter} disabled={busy} onChange={(event) => { setFilter(event.target.value); setNotice(""); }}><option value="both">ISL + ASL</option><option value="isl">ISL only</option><option value="asl">ASL only</option></select></div><p className="training-filter-note">{library.loading ? "Loading saved examples…" : `${visible.length} of ${library.samples.length} saved samples in this view`}</p></div>
    <dl className="training-metrics" aria-label="Sample inventory">
      {[["Saved samples", counts.total], ["Known signs", counts.known], ["Unknown examples", counts.unknown], ["Distinct labels", counts.labels], ["Signers", counts.signers], ["Sessions", counts.sessions]].map(([label, count]) => <div key={label} className={label === "Saved samples" ? "training-metric-primary" : ""}><dt>{label}</dt><dd>{library.loading || (library.error && !library.samples.length) ? "—" : count}</dd></div>)}
    </dl>
    <aside className="training-data-note"><strong>Saving examples does not retrain the model.</strong><p>These are body and hand coordinates with timing, not video. Export them for a separate training run. Signer and session labels help keep future evaluation recordings separate. A prediction score is not a measure of signer accuracy.</p>{!library.loading && <p className="fine-print">Unknown types in this view: {counts.nonsigning} no intentional sign · {counts.unsupported} unsupported sign · {counts.unreviewed} unreviewed type. Older unknown recordings keep their unreviewed type until you verify what was recorded.</p>}</aside>
    {error && <div className="notice error training-feedback" role="alert"><p>{error}</p><button type="button" className="btn btn-small" disabled={busy || library.loading} onClick={reload}>Reload samples</button></div>}
    <p className="training-download-status" role="status" aria-live="polite">{notice || (operation?.startsWith("delete:") ? "Deleting this sample…" : "")}</p>
    <section className="training-inventory" aria-labelledby="training-samples-title" aria-busy={library.loading || busy}>
      <div className="training-inventory-heading"><div><p className="eyebrow">{viewName} inventory</p><h2 id="training-samples-title">Saved examples</h2></div><div className="actions"><button type="button" className="btn btn-small" disabled={unavailable || busy || !visible.length} onClick={() => download(false)}>Export this view</button><button type="button" className="btn btn-ghost btn-small" disabled={unavailable || busy || !library.samples.length} onClick={() => download(true)}>Export all samples</button></div></div>
      {library.loading ? <p className="training-empty" role="status">Loading saved pose sequences…</p> : library.error && !library.samples.length ? <div className="training-empty"><strong>Saved examples could not be loaded.</strong><p>Reload the inventory to check what is stored in this browser before exporting.</p></div> : !visible.length ? <div className="training-empty"><strong>{library.samples.length ? `No ${viewName} samples saved yet.` : "Start with one carefully labelled example."}</strong><p>Open Capture in trained sign mode, finish the turn, then choose to save it after consent. Nothing is saved automatically. Include unknown or nonsigning examples as well as known words.</p><button type="button" className="btn" onClick={onCapture}>Open Capture</button></div> : <div className="training-table-wrap"><table className="training-table" role="table"><caption className="sr-only">Saved pose samples in the {viewName} view</caption><thead role="rowgroup"><tr role="row"><th scope="col">Sample</th><th scope="col">Signer</th><th scope="col">Session</th><th scope="col">Recorded</th><th scope="col">Duration</th><th scope="col">Frames</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody role="rowgroup">{visible.map((sample) => <tr key={sample.id} role="row"><th scope="row" className="training-sample-name"><span>{sampleName(sample)}</span><div className="training-sample-tags"><span className="training-tag">{sample.signLanguage.toUpperCase()}</span><span className={`training-tag ${sample.kind === "unknown" ? "training-tag-unknown" : "training-tag-known"}`}>{sample.kind === "unknown" ? negativeName(sample) : "Known sign"}</span></div></th><td data-label="Signer">{sample.signerId}</td><td data-label="Session">{sample.sessionId}</td><td data-label="Recorded"><time dateTime={new Date(sample.createdAt).toISOString()}>{recordedAt(sample.createdAt)}</time></td><td data-label="Duration">{(sample.durationMs / 1000).toFixed(1)}s</td><td data-label="Frames">{sample.frameCount}</td><td className="training-sample-action"><button type="button" className="btn btn-ghost btn-small" disabled={busy} aria-label={`Delete ${sample.signLanguage.toUpperCase()} ${sample.kind === "unknown" ? "unknown" : sample.label} sample`} onClick={() => remove(sample)}>{operation === `delete:${sample.id}` ? "Deleting…" : "Delete"}</button></td></tr>)}</tbody></table></div>}
    </section>
    <p className="training-privacy fine-print">Exports contain pose coordinates, labels and signer/session identifiers. Use participant codes instead of personal names. Samples stay in this browser until you delete them or explicitly download an export.</p>
  </main>;
}
