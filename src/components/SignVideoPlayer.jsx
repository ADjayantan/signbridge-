import { useEffect, useMemo, useRef, useState } from "react";
import { planSignVideos } from "../lib/signVideos.js";

export function useBlobURL(blob) {
  const [resource, setResource] = useState(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setResource({ blob, url: next });
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  // A new blob must never temporarily render the previous blob's revoked URL.
  return blob && resource?.blob === blob ? resource.url : "";
}

// Key the parent by reply/language, so a new reply always starts at its first step.
export default function SignVideoPlayer({ text, clips, signLanguage, textLanguage, autoPlay = false }) {
  const plan = useMemo(() => planSignVideos(text, clips, signLanguage, textLanguage), [text, clips, signLanguage, textLanguage]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const currentIndex = Math.min(index, Math.max(0, plan.steps.length - 1));
  const step = plan.steps[currentIndex];
  const url = useBlobURL(step?.clip?.blob);
  const next = () => { setError(""); if (currentIndex + 1 < plan.steps.length) setIndex(currentIndex + 1); else setPlaying(false); };

  useEffect(() => {
    let current = true;
    const video = videoRef.current;
    if (video && url) {
      video.playbackRate = rate;
      if (playing) video.play().catch(() => { if (current) setPlaying(false); });
      else video.pause();
    }
    if (playing && step?.kind === "missing") {
      // Missing signs stay visible until explicitly advanced: never hide gaps in the message.
      setPlaying(false);
    }
    return () => { current = false; };
  }, [url, rate, playing, step, currentIndex]);

  if (!plan.total) return null;
  return (
    <section className="sign-video-player" aria-label="Sign video reply">
      <div className="video-heading"><strong>{signLanguage.toUpperCase()} video reply</strong><span>{plan.covered}/{plan.total} words covered</span></div>
      <p className="hint">{plan.exactPhrase ? "Saved phrase video. Meaning and signing are provided by its contributor." : "Vocabulary clips in text order. This is not a grammatical sign-language translation."}</p>
      {plan.covered === 0 ? (
        <div className="video-empty"><strong>No matching sign videos yet</strong><p>Add a recording in Sign videos for this phrase and text language.</p></div>
      ) : (
        <>
          <div className="sign-stage">
            {step?.kind === "video" ? url ? <video key={`${currentIndex}:${url}`} ref={videoRef} src={url} muted playsInline controls onPlay={() => setPlaying(true)} onPause={(e) => { if (e.currentTarget === videoRef.current && !e.currentTarget.ended) setPlaying(false); }} onEnded={next} onError={() => { setPlaying(false); setError("This video cannot play in this browser. Try an MP4 clip."); }} aria-label={`Sign video: ${step.text}`} /> : <p className="video-empty">Loading sign video…</p> : <div className="video-empty"><strong>{step?.text}</strong><p>Video missing — read this word as text.</p></div>}
          </div>
          <p className="video-current" aria-live="polite">{step?.text} · {currentIndex + 1} of {plan.steps.length}</p>
          <div className="actions">
            <button type="button" className="btn btn-small" onClick={() => { setIndex(0); setError(""); if (videoRef.current) videoRef.current.currentTime = 0; setPlaying(true); }}>Replay</button>
            <button type="button" className="btn btn-small" disabled={step?.kind !== "video"} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
            <button type="button" className="btn btn-small" disabled={currentIndex === 0} onClick={() => { setIndex(currentIndex - 1); setError(""); }}>Previous</button>
            <button type="button" className="btn btn-small" disabled={currentIndex + 1 >= plan.steps.length} onClick={next}>Next</button>
            <label className="video-speed">Speed <select value={rate} onChange={(e) => setRate(Number(e.target.value))}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option></select></label>
          </div>
        </>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="coverage-strip" aria-label="Video coverage">{plan.steps.map((s, i) => <span key={i} className={s.kind === "video" ? "covered" : "uncovered"}>{s.text}{s.kind === "missing" ? " · text only" : ""}</span>)}</div>
    </section>
  );
}
