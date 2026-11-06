import { useEffect, useRef, useState } from "react";
import "./GuidedSignPractice.css";

const METADATA_URL = "/api/local-reference/isl-hello/metadata";
const VIDEO_URL = "/api/local-reference/isl-hello/video";
const SOURCE_URL = "https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md";

/** Viewing guidance only. No tracker, predictor, speech or output-message access. */
export default function GuidedSignPractice({ model, signLanguage, modelStatus = "ready", cameraOn = false }) {
  const video = useRef(null);
  const playbackEpoch = useRef(0);
  const [state, setState] = useState("loading");
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [playError, setPlayError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const supported = signLanguage === "isl" && modelStatus === "ready" && (!model?.signLanguage || model.signLanguage === "isl") && Array.isArray(model?.labels) && model.labels.includes("HELLO");
  useEffect(() => {
    if (import.meta.env?.MODE === "public-demo" || !supported) return;
    const abort = new AbortController();
    setState("loading"); setPlaying(false); setPlayError("");
    (async () => {
      const response = await fetch(METADATA_URL, { signal: abort.signal, cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("unavailable");
      const metadata = await response.json();
      if (abort.signal.aborted) return;
      setState(metadata.available === true && metadata.signLanguage === "isl" && metadata.label === "HELLO" && metadata.videoUrl === VIDEO_URL ? "ready" : "unavailable");
    })().catch(() => { if (!abort.signal.aborted) setState("unavailable"); });
    return () => abort.abort();
  }, [supported, attempt]);
  useEffect(() => {
    const element = video.current;
    return () => { playbackEpoch.current++; element?.pause(); };
  }, [supported, state]);
  useEffect(() => {
    if (cameraOn) { playbackEpoch.current++; video.current?.pause(); setPlaying(false); }
  }, [cameraOn]);
  useEffect(() => { if (video.current) video.current.playbackRate = slow ? .5 : 1; }, [slow, state]);
  if (import.meta.env?.MODE === "public-demo") return null;
  const watch = async () => {
    if (cameraOn || state !== "ready" || !video.current) return;
    const epoch = playbackEpoch.current;
    setPlayError("");
    try {
      video.current.currentTime = 0; video.current.playbackRate = slow ? .5 : 1;
      await video.current.play();
    } catch { if (epoch === playbackEpoch.current) setPlayError("The example could not play. Try Watch example again or use a local reference video below."); }
  };
  const status = signLanguage !== "isl" ? "This local example teaches ISL. Choose ISL to practice HELLO; ASL uses a separate model and language."
    : modelStatus === "loading" ? "Waiting for the local ISL word model before checking this example."
    : !supported ? "HELLO practice needs a loaded ISL model whose supported-word list includes HELLO. Typing remains available."
    : state === "loading" ? "Checking whether the permitted example is available on this laptop…"
    : state === "unavailable" ? "The permitted HELLO example is unavailable on this laptop. You can choose your own permitted video in Reference video demo."
    : cameraOn ? "Example paused for your camera trial. Copy the complete movement, then pause briefly."
    : "Watch the complete movement first. Then start your camera and try it yourself.";
  return <section className="guided-sign-practice" aria-label="Guided ISL HELLO practice">
    <div className="guided-sign-practice-heading"><span className="eyebrow">Try one supported word</span><h3>Learn the ISL HELLO example</h3></div>
    <p className="fine-print" role="status" aria-label="HELLO practice availability">{status}</p>
    {supported && state === "ready" && <div className="guided-sign-practice-body">
      <div className="guided-sign-practice-media"><video ref={video} src={VIDEO_URL} muted playsInline controls={!cameraOn} preload="metadata" aria-label="INCLUDE ISL HELLO reference example" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setState("unavailable"); setPlaying(false); }} /><span className="guided-sign-practice-badge">Reference example · not your camera</span></div>
      <div className="guided-sign-practice-copy"><p><strong>HELLO is in this loaded ISL vocabulary.</strong> A still hand does not show the complete sign. Follow the example’s movement; recognition may still reject or misread your attempt.</p>
        <div className="actions"><button type="button" className="btn btn-small" disabled={cameraOn} onClick={() => void watch()}>Watch example</button><button type="button" className="btn btn-small btn-ghost" disabled={!playing} onClick={() => video.current?.pause()}>Pause example</button></div>
        <label className="guided-sign-practice-speed"><input type="checkbox" checked={slow} onChange={(event) => setSlow(event.target.checked)} /> Half speed</label>
        <p className="fine-print">Example: normal view. Your camera preview is mirrored. Watching this clip does not run recognition, write a message or speak a word.</p>
      </div>
    </div>}
    {supported && state === "unavailable" && <button type="button" className="btn btn-small" onClick={() => setAttempt((value) => value + 1)}>Check local example again</button>}
    {playError && <p className="notice error" role="alert">{playError}</p>}
    {supported && state === "ready" && <p className="guided-sign-practice-credit fine-print">Local INCLUDE validation example · Sridhar, Ganesan, Kumar &amp; Khapra (2020) · CC BY 4.0. <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Dataset and attribution</a>. This example is for practice and pipeline comparison, not a new accuracy test.</p>}
  </section>;
}
