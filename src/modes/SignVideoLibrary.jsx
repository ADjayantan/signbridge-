import { useEffect, useRef, useState } from "react";
import { LanguageSelect } from "../components/Controls.jsx";
import SignVideoPlayer, { useBlobURL } from "../components/SignVideoPlayer.jsx";
import { clipId, MAX_CLIP_BYTES, wordsOf } from "../lib/signVideos.js";

function ClipCard({ clip, onRemove }) {
  const url = useBlobURL(clip.blob);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  return <article className="clip-card">
    <video src={url || undefined} muted playsInline controls preload="metadata" aria-label={`Saved sign: ${clip.label}`} />
    <strong>{clip.label}</strong><p className="hint">{clip.signLanguage.toUpperCase()} · {clip.textLanguage.toUpperCase()} · {clip.source}</p>
    <div className="actions">
      <a className="btn btn-small" href={url || undefined} download={`signbridge-${clip.signLanguage}-${clip.textLanguage}-${clip.label.replace(/[^\p{L}\p{N}]+/gu, "-")}.${clip.blob.type.includes("mp4") ? "mp4" : clip.blob.type.includes("ogg") ? "ogv" : "webm"}`}>Download</a>
      <button type="button" className="btn btn-small btn-ghost" onClick={async () => {
        if (!confirm) { setConfirm(true); return; }
        try { await onRemove(clip.id); } catch (e) { setError(e.message); setConfirm(false); }
      }}>{confirm ? `Delete ${clip.label}?` : "Delete"}</button>
      {confirm && <button type="button" className="btn btn-small" onClick={() => setConfirm(false)}>Keep</button>}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
  </article>;
}

export default function SignVideoLibrary({ library, signLanguage, lang, videoRef, cameraReady }) {
  const [label, setLabel] = useState("");
  const [textLanguage, setTextLanguage] = useState(lang);
  const [status, setStatus] = useState("idle");
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState("");
  const [testText, setTestText] = useState("");
  const [playerText, setPlayerText] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [playRequest, setPlayRequest] = useState(0);
  const recorder = useRef(null);
  const timer = useRef(null);
  const alive = useRef(true);
  const draftURL = useBlobURL(draft?.blob);
  const busy = status === "countdown" || status === "recording" || status === "processing";
  const visible = library.clips.filter((c) => c.signLanguage === signLanguage);
  const duplicate = library.clips.some((c) => c.id === clipId({ signLanguage, textLanguage, label }));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearInterval(timer.current);
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
    };
  }, []);

  const stop = () => {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") { setStatus("processing"); recorder.current.stop(); }
  };

  const record = () => {
    if (busy || !cameraReady || !wordsOf(label).length || duplicate) return;
    const stream = videoRef.current?.srcObject;
    if (!stream || !window.MediaRecorder) { setMessage("Recording is unavailable. Import an MP4 or WebM clip instead."); return; }
    setDraft(null); setPreviewReady(false); setMessage(""); setStatus("countdown"); setSeconds(3);
    let count = 3;
    timer.current = setInterval(() => {
      count -= 1;
      if (count > 0) { setSeconds(count); return; }
      clearInterval(timer.current);
      if (videoRef.current?.srcObject !== stream || !stream.getVideoTracks().some((t) => t.readyState === "live")) {
        setStatus("idle"); setMessage("Camera stopped. Start the camera, then record again."); return;
      }
      try {
        const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
        const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_500_000 });
        recorder.current = rec;
        const chunks = [];
        let failed = false;
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onerror = () => { failed = true; clearInterval(timer.current); if (alive.current) { setStatus("idle"); setMessage("Recording failed. Try again or import a video."); } };
        rec.onstop = () => {
          clearInterval(timer.current);
          recorder.current = null;
          if (!alive.current || failed) return;
          const blob = new Blob(chunks, { type: rec.mimeType });
          if (!blob.size) { setStatus("idle"); setMessage("No video was recorded. Try again."); return; }
          setDraft({ blob, source: "Your recording" }); setStatus("idle");
          setMessage("Preview the full sign. Save only when its phrase and sign language are correct.");
        };
        rec.start(); setStatus("recording"); setSeconds(0);
        let elapsed = 0;
        timer.current = setInterval(() => {
          elapsed += 1; setSeconds(elapsed);
          if (elapsed >= 12) { clearInterval(timer.current); setStatus("processing"); if (rec.state === "recording") rec.stop(); }
        }, 1000);
      } catch { setStatus("idle"); setMessage("Couldn't start recording. Try importing a video instead."); }
    }, 1000);
  };

  const importVideo = (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (!/^video\/(mp4|webm|ogg)(;|$)/.test(file.type) || file.size > MAX_CLIP_BYTES || !file.size) {
      setMessage("Choose an MP4, WebM or Ogg video under 20 MB."); return;
    }
    setDraft({ blob: file, source: file.name });
    setPreviewReady(false);
    setMessage("Check that this video matches the phrase and sign language before saving. Use videos you have permission to reuse.");
  };

  const save = async () => {
    if (!draft || !previewReady || saving) return;
    setSaving(true);
    try {
      await library.add({ label, textLanguage, signLanguage, ...draft });
      if (alive.current) { setDraft(null); setMessage(`Saved “${label}” locally. It can now appear in ${signLanguage.toUpperCase()} replies.`); setLabel(""); }
    } catch (e) { if (alive.current) setMessage(e.message); }
    finally { if (alive.current) setSaving(false); }
  };

  return <>
    <div className="section-kicker">YOUR SIGN DICTIONARY</div>
    <h2 className="panel-title">Real people. Real sign videos.</h2>
    <p className="hint">Record or import an {signLanguage.toUpperCase()} word or complete phrase. Videos stay in this browser and work offline. Download clips to keep a backup; clearing browser data removes the library.</p>
    <div className="video-library-form">
      <div className="field"><label htmlFor="clip-phrase">Exact word or phrase shown in the video</label><input id="clip-phrase" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. How can I help you?" maxLength={120} disabled={busy || saving} /></div>
      <LanguageSelect value={textLanguage} onChange={setTextLanguage} id="clip-text-language" label="Phrase text language" />
      <p className="hint">The text language must match the reply. ISL/ASL is chosen above. Recording a clip does not train the recognition model.</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={record} disabled={busy || saving || !cameraReady || !wordsOf(label).length || duplicate}>Record sign video</button>
        <label className={`btn file-button${busy || saving ? " disabled" : ""}`}>Import a video<input aria-label="Import sign video" type="file" accept="video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv" onChange={importVideo} disabled={busy || saving} /></label>
        {status === "recording" && <button type="button" className="btn btn-danger" onClick={stop}>Stop recording</button>}
        {status === "countdown" && <button type="button" className="btn" onClick={() => { clearInterval(timer.current); setStatus("idle"); }}>Cancel</button>}
      </div>
      {duplicate && <p className="notice">This phrase already has a {textLanguage.toUpperCase()} video. Delete that clip first to replace it.</p>}
      <p role="status" className={busy ? "record-indicator" : "hint"}>{status === "countdown" ? `Get ready: ${seconds}` : status === "recording" ? `Recording · ${seconds}s / 12s — finish your phrase, then Stop` : status === "processing" ? "Preparing preview…" : message}</p>
      {draft && <div className="clip-preview"><video key={draftURL} src={draftURL || undefined} controls muted playsInline preload="auto" aria-label="Preview your sign video" onLoadedData={() => setPreviewReady(true)} onError={() => { setPreviewReady(false); setMessage("This video cannot be decoded here. Import a playable MP4 or WebM clip."); }} /><p className="hint">Full frame is saved as the camera sees it; the mirrored camera preview is not applied. {previewReady ? "Preview is ready." : "Waiting for a playable preview before saving."}</p><div className="actions"><button type="button" className="btn btn-primary" onClick={save} disabled={!previewReady || !wordsOf(label).length || duplicate || saving || busy}>{saving ? "Saving…" : "Save this sign video"}</button><button type="button" className="btn" onClick={() => { setDraft(null); setPreviewReady(false); }} disabled={saving || busy}>Discard preview</button></div></div>}
    </div>
    <section className="panel" aria-label="Try sign video playback">
      <h3 className="panel-title">Text → sign videos</h3>
      <p className="hint">Try your saved vocabulary here without an AI key.</p>
      <form className="type-row" onSubmit={(e) => { e.preventDefault(); setPlayerText(testText.trim()); setPlayRequest((n) => n + 1); }}><input aria-label="Text to play as signs" value={testText} onChange={(e) => setTestText(e.target.value)} maxLength={2000} placeholder="Type your recorded phrase…" /><button type="submit" className="btn btn-primary" disabled={!testText.trim()}>Play signs</button></form>
      {playerText && <SignVideoPlayer key={`${signLanguage}:${textLanguage}:${playerText}:${playRequest}`} text={playerText} clips={library.clips} signLanguage={signLanguage} textLanguage={textLanguage} autoPlay />}
    </section>
    {library.error && <p className="notice error" role="alert">{library.error}</p>}
    <h3 className="subhead">{signLanguage.toUpperCase()} library · {visible.length} clips</h3>
    {library.loading ? <p role="status">Loading videos…</p> : visible.length === 0 ? <p className="empty">Start with everyday phrases: “Hello”, “Thank you”, “How can I help you?” and “I need help”. Add separate recordings for ISL and ASL.</p> : <div className="clip-grid">{visible.map((c) => <ClipCard key={c.id} clip={c} onRemove={library.remove} />)}</div>}
    <p className="hint">Reference dictionaries: <a href="https://divyangjan.depwd.gov.in/islrtc/" target="_blank" rel="noreferrer">ISLRTC · ISL</a> · <a href="https://www.lifeprint.com/" target="_blank" rel="noreferrer">ASL University</a>. Check meaning with a fluent signer; ISL and ASL use different vocabulary and grammar.</p>
  </>;
}
