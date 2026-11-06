import { useEffect, useRef, useState } from "react";
import { TopBar } from "../components/Controls.jsx";
import { canSpeak, createSpeaker } from "../lib/speech.js";
import "../styles/wlaslVideo.css";

const MAX_BYTES = 40 * 1024 * 1024;
const validDuration = (seconds) => Number.isFinite(seconds) && seconds >= .35 && seconds <= 12;
const durationError = "Choose one sign lasting between 0.35 and 12 seconds.";
const fileType = (file) => ({ mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" })[file.name.split(".").pop().toLowerCase()];

export default function WlaslVideoMode({ settings = {}, onBack, onConnect }) {
  const [model, setModel] = useState(null), [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState("camera"), [camera, setCamera] = useState("off");
  const [clip, setClip] = useState(null), [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0), [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null), [text, setText] = useState("");
  const [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const [autoVoice, setAutoVoice] = useState(false);
  const [query, setQuery] = useState(""), [speaker] = useState(createSpeaker);
  const cameraVideo = useRef(null), previewVideo = useRef(null), fileInput = useRef(null), autoVoiceRef = useRef(false);
  const owner = useRef({ epoch: 0, speech: 0, stream: null, recorder: null, timeout: 0, ticker: 0, metadata: 0, url: "", request: null });
  const labels = Array.isArray(model?.labels) ? model.labels.filter((label) => typeof label === "string") : [];
  const ready = model?.available === true && model.signLanguage === "asl" && model.engine === "wlasl-i3d" && labels.length > 0;

  const stopSpeech = () => { owner.current.speech++; speaker.cancel(); setFeedback(""); };
  const release = () => {
    const current = owner.current;
    current.epoch++; current.request?.abort(); current.request = null;
    clearTimeout(current.timeout); clearInterval(current.ticker); clearTimeout(current.metadata);
    if (current.recorder) {
      current.recorder.ondataavailable = null; current.recorder.onstop = null; current.recorder.onerror = null;
      if (current.recorder.state !== "inactive") { try { current.recorder.stop(); } catch { /* Already stopped. */ } }
      current.recorder = null;
    }
  };
  const stopCamera = () => {
    owner.current.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    owner.current.stream = null;
    if (cameraVideo.current) cameraVideo.current.srcObject = null;
    setCamera("off");
  };
  const cancel = (end = false) => {
    release(); setRecording(false); setBusy(false); setElapsed(0); stopSpeech();
    if (end || camera === "starting") stopCamera();
  };
  const clearClip = () => {
    clearTimeout(owner.current.metadata); previewVideo.current?.pause();
    if (owner.current.url) URL.revokeObjectURL(owner.current.url);
    owner.current.url = ""; setClip(null); setResult(null);
    if (fileInput.current) fileInput.current.value = "";
  };
  const changeSource = (next) => { cancel(true); clearClip(); setError(""); setSource(next); };
  const setVideo = (blob, mime, durationMs = null) => {
    clearClip();
    const url = URL.createObjectURL(blob); owner.current.url = url;
    setClip({ blob, mime, url, durationMs });
    if (durationMs === null) owner.current.metadata = setTimeout(() => {
      if (owner.current.url === url) setError("Video details could not be read. Try another MP4, WebM or MOV clip.");
    }, 10000);
  };

  useEffect(() => {
    document.title = "ASL video to text & voice · SignBridge";
    document.getElementById("wlasl-title")?.focus();
    return () => {
      release(); owner.current.speech++; speaker.cancel();
      owner.current.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      if (owner.current.url) URL.revokeObjectURL(owner.current.url);
    };
  }, [speaker]);
  useEffect(() => {
    const controller = new AbortController(); setModel(null);
    fetch("/api/local-wlasl/status", { signal: controller.signal, credentials: "same-origin" })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) setModel(data); })
      .catch(() => { if (!controller.signal.aborted) setModel({ available: false }); });
    return () => controller.abort();
  }, [attempt]);

  const startCamera = async (withVoice = false) => {
    cancel(true); clearClip(); setError("");
    if (withVoice === true && canSpeak) { setAutoVoice(true); autoVoiceRef.current = true; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Camera recording is unavailable in this browser. Choose a video instead."); return;
    }
    const epoch = owner.current.epoch; setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
      if (epoch !== owner.current.epoch) { stream.getTracks().forEach((track) => track.stop()); return; }
      owner.current.stream = stream;
      stream.getVideoTracks().forEach((track) => { track.onended = () => { cancel(true); setError("Camera disconnected. Start the camera again or choose a video."); }; });
      setCamera("on");
      if (cameraVideo.current) { cameraVideo.current.srcObject = stream; await cameraVideo.current.play(); }
    } catch {
      if (epoch === owner.current.epoch) { stopCamera(); setError("Could not start the camera. Allow camera access or choose a video."); }
    }
  };
  const finishRecording = () => {
    const current = owner.current;
    clearTimeout(current.timeout); clearInterval(current.ticker);
    if (current.recorder?.state === "recording") current.recorder.stop();
  };
  const record = () => {
    cancel(); clearClip(); setError("");
    const epoch = owner.current.epoch, chunks = []; let bytes = 0;
    const started = performance.now();
    try {
      const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(owner.current.stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2500000 });
      owner.current.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (epoch !== owner.current.epoch || !data?.size) return;
        bytes += data.size;
        if (bytes > MAX_BYTES) { cancel(true); setError("Recording exceeds 40 MiB. Record a shorter sign."); return; }
        chunks.push(data);
      };
      recorder.onerror = () => { if (epoch === owner.current.epoch) { cancel(true); setError("Recording failed. Try again or choose a video."); } };
      recorder.onstop = () => {
        if (epoch !== owner.current.epoch) return;
        clearTimeout(owner.current.timeout); clearInterval(owner.current.ticker); owner.current.recorder = null; setRecording(false);
        const durationMs = Math.min(12000, performance.now() - started);
        if (!validDuration(durationMs / 1000) || !bytes) { setError(durationError); return; }
        const type = recorder.mimeType || mime || "video/webm";
        const blob = new Blob(chunks, { type });
        setVideo(blob, type, durationMs);
        if (autoVoiceRef.current) void analyze({ clipOverride: { blob, mime: type, durationMs }, withVoice: true });
      };
      recorder.start(250); setRecording(true); setElapsed(0);
      owner.current.timeout = setTimeout(finishRecording, 12000);
      owner.current.ticker = setInterval(() => setElapsed(Math.min(12, (performance.now() - started) / 1000)), 200);
    } catch { cancel(true); setError("Recording could not start. Choose a video or try another browser."); }
  };
  const chooseFile = (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    cancel(true); clearClip(); setError("");
    const mime = fileType(file);
    if (!mime || (file.type && !file.type.startsWith("video/"))) { setError("Choose a video in MP4, WebM or MOV format."); return; }
    if (!file.size || file.size > MAX_BYTES) { setError("Choose a non-empty video no larger than 40 MiB."); return; }
    setVideo(file, mime);
  };
  const metadata = (event) => {
    if (clip?.url !== owner.current.url) return;
    clearTimeout(owner.current.metadata);
    if (clip.durationMs !== null) return;
    const duration = event.currentTarget.duration;
    if (!validDuration(duration)) { setError(durationError); return; }
    setClip((value) => ({ ...value, durationMs: duration * 1000 })); setError("");
  };
  const speakValue = async (rawText) => {
    const value = (typeof rawText === "string" ? rawText : text).trim();
    if (!value || !canSpeak) return;
    stopSpeech(); const epoch = owner.current.speech; setFeedback("Starting voice playback…");
    try {
      const outcome = await speaker.speak(value, { lang: "en-US", rate: settings.rate,
        onStart: () => { if (epoch === owner.current.speech) setFeedback("Speaking your reviewed text…"); } });
      if (epoch === owner.current.speech) setFeedback(outcome?.status === "error" ? outcome.error || "Voice playback failed. Try again." : outcome?.status === "ended" ? "Voice playback finished." : "");
    } catch { if (epoch === owner.current.speech) setFeedback("Voice playback failed. Try again."); }
  };
  const speak = () => speakValue(text);
  const analyze = async (options = {}) => {
    const targetClip = options?.clipOverride || clip;
    const shouldSpeak = Boolean(options?.withVoice ?? autoVoiceRef.current);
    if (!ready || !targetClip?.durationMs || busy || recording) return;
    cancel(); setError(""); setResult(null); setBusy(true);
    const epoch = owner.current.epoch, request = new AbortController(); owner.current.request = request;
    try {
      const response = await fetch("/api/local-wlasl/predict", { method: "POST", credentials: "same-origin", signal: request.signal,
        headers: { "Content-Type": targetClip.mime, "X-SignBridge-Local": "1" }, body: targetClip.blob });
      const data = await response.json();
      if (epoch !== owner.current.epoch) return;
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Video analysis failed. Try again.");
      if (data.status !== "review" || typeof data.suggestion !== "string" || !labels.includes(data.suggestion)) throw new Error("The model did not return a supported word. Try another sign.");
      setResult(data); setText(data.suggestion);
      if (shouldSpeak && canSpeak) void speakValue(data.suggestion);
    } catch (failure) {
      if (epoch === owner.current.epoch && !request.signal.aborted) setError(failure.message || "Could not analyze the video. Check the local model server.");
    } finally { if (epoch === owner.current.epoch) { owner.current.request = null; setBusy(false); } }
  };

  return <main className="mode wlasl-workspace">
    <TopBar title="ASL video to text & voice" titleId="wlasl-title" onBack={onBack}>
      {onConnect && <button type="button" className="btn btn-small workspace-partner-button" onClick={() => onConnect(text)}>Talk to a partner <span aria-hidden="true">↗</span></button>}
    </TopBar>
    <div className="wlasl-intro"><p className="eyebrow">Local video model · American Sign Language</p><h2>One sign. A word you can review.</h2><p>Record or choose a short ASL video. The model suggests one supported word, then you can edit the text and speak it.</p><p className="fine-print">This model is for ASL, not Indian Sign Language (ISL). It does not translate sentences or continuous signing.</p></div>
    <aside className="notice wlasl-model" role="status"><strong>{model === null ? "Checking local model…" : ready ? "Local ASL model ready" : "Local ASL model unavailable"}</strong><span>{ready ? `${model.modelName || "WLASL I3D"} · ${labels.length} supported words · experimental suggestions` : "Typing and speech are still available. Start the local WLASL service to analyze video."}</span>{model && !ready && <button className="btn btn-small" onClick={() => setAttempt((value) => value + 1)}>Check model again</button>}</aside>
    <div className="wlasl-columns">
      <section className="panel wlasl-input" aria-labelledby="wlasl-input-heading"><h2 id="wlasl-input-heading">1. Capture one ASL sign</h2>
        <div className="actions"><button className="btn btn-small" aria-pressed={source === "camera"} onClick={() => changeSource("camera")}>Use camera</button><button className="btn btn-small" aria-pressed={source === "file"} onClick={() => changeSource("file")}>Choose a video</button></div>
        {source === "camera" ? <><div className="wlasl-camera"><video ref={cameraVideo} aria-label="ASL camera preview" autoPlay muted playsInline />{camera !== "on" && <p>{camera === "starting" ? "Waiting for camera permission…" : "Your camera is off"}</p>}</div><p className="hint">Keep your face, hands and upper body visible. Sign one word, then finish the recording.</p><div className="actions">{camera !== "on" ? <>{canSpeak && <button className="btn btn-primary" disabled={camera === "starting"} onClick={() => startCamera(true)}>Start camera + read aloud</button>}<button className="btn" disabled={camera === "starting"} onClick={() => startCamera(false)}>Start camera</button></> : recording ? <button className="btn btn-primary" onClick={finishRecording}>Finish recording</button> : <button className="btn btn-primary" disabled={!ready || busy} onClick={record}>Record sign</button>}{camera !== "off" && <button className="btn btn-ghost" onClick={() => cancel(true)}>Stop camera</button>}</div>{recording && <p role="status">Recording {elapsed.toFixed(1)} / 12 seconds</p>}</> : <div className="field"><label htmlFor="wlasl-video-file">Local ASL video</label><input id="wlasl-video-file" ref={fileInput} type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" onChange={chooseFile} /><p className="hint">MP4, WebM or MOV · 0.35–12 seconds · up to 40 MiB</p></div>}
        {clip && <div className="wlasl-clip"><video key={clip.url} ref={previewVideo} src={clip.url} aria-label="Selected ASL video preview" controls muted playsInline preload="metadata" onLoadedMetadata={metadata} onError={() => { if (clip.url === owner.current.url) { setClip((value) => ({ ...value, durationMs: null })); setError("This browser cannot read the video. Choose another MP4, WebM or MOV clip."); } }} /><p className="fine-print">{clip.durationMs ? `${(clip.durationMs / 1000).toFixed(1)} second clip ready to analyze.` : "Reading video details…"}</p></div>}
        <div className="actions wlasl-analyze"><button className="btn btn-primary" disabled={!ready || !clip?.durationMs || recording || busy} onClick={() => analyze()}>{busy ? "Analyzing video…" : "Analyze video"}</button>{canSpeak && <button className="btn" disabled={!ready || !clip?.durationMs || recording || busy} onClick={() => { setAutoVoice(true); autoVoiceRef.current = true; void analyze({ withVoice: true }); }}>Convert to text + voice</button>}{(busy || recording || camera === "starting") && <button className="btn btn-ghost" onClick={() => cancel()}>Cancel</button>}{clip && !busy && <button className="btn btn-ghost" onClick={() => { cancel(); clearClip(); setError(""); }}>Clear video</button>}</div>
        {error && <p className="notice error" role="alert">{error}</p>}<p className="fine-print">Analyze sends only the video to the local model on this laptop. No cloud AI service is used.</p>
      </section>
      <section className="panel wlasl-output" aria-labelledby="wlasl-output-heading"><h2 id="wlasl-output-heading">2. Review text, then speak</h2>
        <div className="wlasl-suggestion" aria-live="polite"><span>{result ? "Model suggestion—check meaning" : busy ? "The local model is checking your video…" : "Your model suggestion will appear here"}</span>{result ? <><strong>{result.suggestion}</strong><p>This experimental model may be wrong. Check the meaning before speaking.</p></> : <p>You can also type a message below at any time.</p>}</div>
        {result?.candidates?.length > 1 && <details><summary>Other model suggestions</summary><p className="fine-print">Scores are model outputs, not verified accuracy.</p><ul>{result.candidates.filter((item) => labels.includes(item.label)).slice(0, 5).map((item) => <li key={item.label}>{item.label}{Number.isFinite(item.score) ? ` · score ${item.score.toFixed(3)}` : ""} <button type="button" className="btn btn-small" onClick={() => { setText(item.label); if (autoVoiceRef.current && canSpeak) void speakValue(item.label); }}>Use {item.label}</button></li>)}</ul></details>}
        <div className="field"><label htmlFor="wlasl-text">Editable text</label><textarea id="wlasl-text" rows={5} maxLength={2000} value={text} onChange={(event) => { stopSpeech(); setText(event.target.value); }} placeholder="Your word or message…" /></div>
        <div className="actions"><button className="btn btn-primary" disabled={!text.trim() || !canSpeak} onClick={speak}>Speak this text</button><button className="btn btn-ghost" onClick={stopSpeech}>Stop voice</button></div><p role="status">{feedback}</p>
        <label className="wlasl-auto-voice"><input type="checkbox" checked={autoVoice} disabled={!canSpeak} onChange={(event) => { const next = event.target.checked; setAutoVoice(next); autoVoiceRef.current = next; if (!next) stopSpeech(); }} /> Read results aloud automatically</label><p className="fine-print">{autoVoice ? "Automatic speech is on: recognized words are spoken aloud and camera recordings analyze automatically." : "Turn on to speak recognized words automatically, or press Speak this text after reviewing."}</p>{!canSpeak && <p className="hint">Voice output is unavailable in this browser. Your text remains usable.</p>}
      </section>
    </div>
    <details className="panel wlasl-vocabulary"><summary>Supported ASL words{labels.length ? ` (${labels.length})` : ""}</summary><p className="hint">Choose a word this model actually supports. Similar signs and signs outside this list can produce a wrong suggestion.</p><div className="field"><label htmlFor="wlasl-word-search">Find a supported word</label><input id="wlasl-word-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>{labels.length ? <ul>{labels.filter((word) => word.toLowerCase().includes(query.trim().toLowerCase())).map((word) => <li key={word}>{word}</li>)}</ul> : <p>The word list will appear when the local model is available.</p>}{labels.length > 0 && !labels.some((word) => word.toLowerCase().includes(query.trim().toLowerCase())) && <p>No supported word matches “{query}”.</p>}</details>
    <div className="actions"><button className="btn btn-ghost" onClick={() => { cancel(true); clearClip(); setError(""); setFeedback("Session ended. Your editable text is still available."); }}>End session</button></div>
  </main>;
}
