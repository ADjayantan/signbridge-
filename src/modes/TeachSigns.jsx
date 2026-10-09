import { useEffect, useRef, useState } from "react";
import { handCount } from "../lib/features.js";
import { BUILT_IN_GESTURES } from "../lib/gestures.js";
import { SignClassifier, normalizeLabel } from "../lib/knn.js";

const RECORD_MS = 2500;
const KEEP_PER_RECORDING = 45;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keeps frames with the usual number of hands (drops frames where a hand flickered out),
// spread evenly over the recording.
function cleanSamples(samples) {
  if (!samples.length) return [];
  const counts = new Map();
  for (const s of samples) counts.set(handCount(s), (counts.get(handCount(s)) || 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const kept = samples.filter((s) => handCount(s) === usual);
  if (kept.length <= KEEP_PER_RECORDING) return kept;
  return Array.from({ length: KEEP_PER_RECORDING }, (_, i) => kept[Math.floor((i * kept.length) / KEEP_PER_RECORDING)]);
}

export default function TeachSigns({
  classifier,
  version,
  onChange,
  onReplace,
  gestures,
  onGestures,
  recorderRef,
  ready,
  handsVisible,
  saveError,
  signLanguage = "isl",
}) {
  const [word, setWord] = useState("");
  const [phase, setPhase] = useState({ step: "idle" });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [fileMessage, setFileMessage] = useState("");
  const mounted = useRef(true);
  const wordRef = useRef(null);
  const recordRef = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recorderRef.current = null;
    };
  }, [recorderRef]);

  useEffect(() => {
    if (!confirmDelete) return undefined;
    const t = setTimeout(() => setConfirmDelete(null), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const recording = phase.step === "countdown" || phase.step === "recording";

  const record = async (e) => {
    e.preventDefault();
    const label = normalizeLabel(word);
    if (!label || !ready || recording) return;
    for (const n of [3, 2, 1]) {
      setPhase({ step: "countdown", n });
      await wait(800);
      if (!mounted.current) return;
    }
    const samples = [];
    recorderRef.current = { push: (features) => samples.push(features) };
    const start = performance.now();
    setPhase({ step: "recording", progress: 0, count: 0 });
    while (performance.now() - start < RECORD_MS) {
      await wait(100);
      if (!mounted.current) return;
      setPhase({ step: "recording", progress: (performance.now() - start) / RECORD_MS, count: samples.length });
    }
    recorderRef.current = null;
    const kept = cleanSamples(samples);
    if (kept.length < 8) {
      setPhase({
        step: "error",
        message: "I couldn't see your hands clearly. Move into the frame, check the light, and try again.",
      });
      return;
    }
    classifier.addSamples(label, kept);
    onChange();
    setPhase({
      step: "done",
      message: `Saved ${kept.length} frames for “${label}”. Record it once or twice more from a slightly different angle to make it more reliable.`,
    });
  };

  const recordMore = (label) => {
    setWord(label);
    setPhase({ step: "idle" });
    recordRef.current?.focus();
  };

  const remove = (label) => {
    if (confirmDelete !== label) {
      setConfirmDelete(label);
      return;
    }
    classifier.remove(label);
    setConfirmDelete(null);
    onChange();
  };

  const exportSigns = () => {
    const blob = new Blob([JSON.stringify({ ...classifier.toJSON(), signLanguage })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signbridge-${signLanguage}-signs.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importSigns = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Choose a signs file under 5 MB.");
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Choose a SignBridge signs export file.");
      const incomingLanguage = parsed.signLanguage || "isl";
      if (!["isl", "asl"].includes(incomingLanguage)) throw new Error("This file has an unsupported sign language. Choose an ISL or ASL export.");
      if (incomingLanguage !== signLanguage) throw new Error(`These recordings belong to ${incomingLanguage.toUpperCase()}. Choose that sign language before importing.`);
      const incoming = SignClassifier.fromJSON(parsed).toJSON();
      const mine = classifier.toJSON();
      for (const [label, list] of Object.entries(incoming.signs)) mine.signs[label] = [...(mine.signs[label] || []), ...list];
      onReplace(SignClassifier.fromJSON(mine));
      setFileMessage(`Imported ${Object.keys(incoming.signs).length} sign(s) from ${file.name}.`);
    } catch (err) {
      setFileMessage(err instanceof SyntaxError ? "That file isn't valid JSON." : err.message);
    }
  };

  const signs = classifier.labels();
  void version; // re-render when signs change

  return (
    <>
      <h2 className="panel-title">Teach a sign</h2>
      <p className="hint">
        Type the word, press Record, and hold the sign in front of the camera for 3 seconds. Signs are saved in this
        browser, in your {signLanguage.toUpperCase()} library. Moving signs aren't supported yet: hold the key handshape.
      </p>
      <form className="teach-form" onSubmit={record}>
        <div className="field">
          <label htmlFor="teach-word">Word or phrase</label>
          <input
            id="teach-word"
            ref={wordRef}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="e.g. WATER"
            maxLength={40}
            autoComplete="off"
            disabled={recording}
          />
        </div>
        <button ref={recordRef} type="submit" className="btn btn-primary" disabled={!normalizeLabel(word) || !ready || recording}>
          {recording ? "Recording…" : "Record"}
        </button>
      </form>

      <div className="record-status" role="status">
        {!ready && <p>Waiting for the camera and hand tracking…</p>}
        {phase.step === "countdown" && (
          <p className="countdown">
            Get ready: <strong>{phase.n}</strong>
          </p>
        )}
        {phase.step === "recording" && (
          <>
            <p>
              Recording “{normalizeLabel(word)}”… keep signing.{" "}
              {handsVisible ? `${phase.count} frames` : "I can't see your hands!"}
            </p>
            <div className="progress">
              <div className="progress-bar" style={{ "--p": phase.progress }} />
            </div>
          </>
        )}
        {phase.step === "done" && <p className="ok">{phase.message}</p>}
        {phase.step === "error" && <p className="notice error">{phase.message}</p>}
      </div>
      {saveError && <p className="notice error">{saveError}</p>}

      <h3 className="subhead">Your signs ({signs.length})</h3>
      {signs.length === 0 ? (
        <p className="empty">No signs yet. Teach two or three to start, then try them in Talk.</p>
      ) : (
        <ul className="sign-list">
          {signs.map(({ label, count }) => (
            <li key={label}>
              <span className="sign-name">{label}</span>
              <span className="sign-count">{count} frames</span>
              <button type="button" className="btn btn-small" onClick={() => recordMore(label)}>
                Record more
              </button>
              <button
                type="button"
                className={`btn btn-small${confirmDelete === label ? " btn-danger" : " btn-ghost"}`}
                onClick={() => remove(label)}
                aria-label={confirmDelete === label ? `Confirm deleting ${label}` : `Delete ${label}`}
              >
                {confirmDelete === label ? "Confirm delete" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="file-row">
        <button type="button" className="btn btn-small" onClick={exportSigns} disabled={!signs.length}>
          Export signs
        </button>
        <label className="btn btn-small file-button">
          Import signs
          <input aria-label="Import taught signs" type="file" accept="application/json,.json" onChange={importSigns} />
        </label>
        {fileMessage && (
          <p className="fine-print" role="status">
            {fileMessage}
          </p>
        )}
      </div>

      <h3 className="subhead">Built-in gestures</h3>
      <p className="hint">Optional handshape shortcuts. Enable “Use gesture shortcuts” in the camera panel to use these mappings. They do not translate ISL or ASL; an open palm can appear in many different signs.</p>
      <table className="gesture-table">
        <thead>
          <tr>
            <th scope="col">Gesture</th>
            <th scope="col">Word</th>
            <th scope="col">On</th>
          </tr>
        </thead>
        <tbody>
          {BUILT_IN_GESTURES.map((g) => (
            <tr key={g.id}>
              <th scope="row">
                <span aria-hidden="true" className="gesture-emoji">
                  {g.emoji}
                </span>{" "}
                {g.name}
              </th>
              <td>
                <input
                  aria-label={`Word for ${g.name}`}
                  value={gestures[g.id].word}
                  maxLength={40}
                  onChange={(e) => onGestures({ ...gestures, [g.id]: { ...gestures[g.id], word: e.target.value.toUpperCase() } })}
                  onBlur={(e) =>
                    onGestures({ ...gestures, [g.id]: { ...gestures[g.id], word: normalizeLabel(e.target.value) || g.word } })
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Use ${g.name}`}
                  checked={gestures[g.id].enabled}
                  onChange={(e) => onGestures({ ...gestures, [g.id]: { ...gestures[g.id], enabled: e.target.checked } })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
