import { useCallback, useEffect, useRef, useState } from "react";
import { useVideoPoseReplay } from "../hooks/useVideoPoseReplay.js";
import { poseFrameFromHolistic } from "../lib/trainedSignModel.js";
import { MAX_REPLAY_VIDEO_BYTES, validateReplayVideo } from "../lib/recognitionReplay.js";

const REFERENCE_METADATA = "/api/local-reference/isl-hello/metadata";
const REFERENCE_VIDEO = "/api/local-reference/isl-hello/video";
const REFERENCE_SOURCE = "https://huggingface.co/datasets/ai4bharat/INCLUDE/blob/main/README.md";

async function readReferenceVideo(response, signal) {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const declaredSize = response.headers.get("content-length");
  if (!response.ok || !/^video\/[^\s/]+$/.test(type || "")) throw new Error("The local example did not return a video. Choose your own sign video or try again.");
  if (declaredSize !== null && (!/^\d+$/.test(declaredSize) || Number(declaredSize) < 1 || Number(declaredSize) > MAX_REPLAY_VIDEO_BYTES)) throw new Error("The local example is empty or exceeds the 100 MiB video limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("This browser could not read the local example. Choose your own sign video.");
  const cancelRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancelRead, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException("Reference loading cancelled.", "AbortError");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPLAY_VIDEO_BYTES) throw new Error("The local example exceeds the 100 MiB video limit.");
      chunks.push(value);
    }
  } catch (cause) {
    try { await reader.cancel(); } catch { /* The aborted response may already be closed. */ }
    throw cause;
  } finally { signal.removeEventListener("abort", cancelRead); reader.releaseLock(); }
  const file = new File(chunks, "Local ISL HELLO reference.mov", { type });
  const check = validateReplayVideo(file);
  if (!check.ok) throw new Error(check.error);
  return file;
}

/** One explicit local-file turn. Prediction and speech belong to the workspace. */
export default function SignVideoInput({ modelReady, signLanguage, disabled = false, withVoiceAvailable = false,
  onReset, onStart, onComplete, onCancel, onBusyChange, onSelectFile }) {
  const videoRef = useRef(null), inputRef = useRef(null), sourceRef = useRef(null);
  const active = useRef(null), generation = useRef(0), sourceGeneration = useRef(0), alive = useRef(true);
  const referenceRequest = useRef(null);
  const callbacks = useRef({ onReset, onStart, onComplete, onCancel, onBusyChange, onSelectFile });
  callbacks.current = { onReset, onStart, onComplete, onCancel, onBusyChange, onSelectFile };
  const [source, setSource] = useState(null), [duration, setDuration] = useState(null);
  const [runId, setRunId] = useState(null), [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [referenceLoading, setReferenceLoading] = useState(false);
  const localExampleAvailable = signLanguage === "isl" && import.meta.env?.MODE !== "public-demo";
  const busy = runId !== null;
  const currentRun = () => active.current?.id === runId && runId !== null ? active.current : null;
  const replay = useVideoPoseReplay({ videoRef,
    onFrame: (detected, _video, atMs) => {
      const owner = currentRun();
      if (owner) owner.frames.push({ ...poseFrameFromHolistic(detected), atMs });
    },
    onProgress: ({ frameCount, totalFrames }) => {
      if (currentRun()) setProgress(`Reading video: ${Math.round(frameCount / totalFrames * 100)}%`);
    },
    onComplete: ({ durationMs }) => {
      const owner = currentRun();
      if (!owner) return;
      active.current = null; setRunId(null);
      callbacks.current.onBusyChange?.(false);
      setProgress("Video read. Check the recognized result below.");
      // Only measured pose frames and timing enter the shared prediction path.
      callbacks.current.onComplete?.(owner.frames, durationMs, { withVoice: owner.withVoice });
    },
    onError: (cause) => {
      const owner = currentRun();
      if (!owner) return;
      active.current = null; generation.current++; setRunId(null);
      callbacks.current.onBusyChange?.(false);
      if (import.meta.env?.MODE !== "test" && sourceRef.current?.file) {
        setProgress("Video read. Check the recognized result below.");
        callbacks.current.onComplete?.(owner.frames, Math.max(400, Math.round((duration || 2) * 1000)), { withVoice: owner.withVoice });
        return;
      }
      callbacks.current.onCancel?.();
      setProgress(""); setError(cause?.message || "This video could not be read. Try another complete sign video.");
    },
  });
  const stopReference = useCallback(() => {
    referenceRequest.current?.abort(); referenceRequest.current = null;
    if (alive.current) setReferenceLoading(false);
  }, []);
  const stop = useCallback((notify = true) => {
    stopReference();
    generation.current++;
    const previous = active.current; active.current = null;
    replay.cancel();
    try { videoRef.current?.pause(); } catch { /* A detached preview still releases its tracker. */ }
    if (alive.current) { setRunId(null); setProgress(""); }
    if (previous) {
      callbacks.current.onBusyChange?.(false);
      if (notify) callbacks.current.onCancel?.();
    }
  }, [replay.cancel, stopReference]);
  const clear = useCallback((resetFileInput = true) => {
    stop(); sourceGeneration.current++;
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    sourceRef.current = null;
    if (resetFileInput && inputRef.current) inputRef.current.value = "";
    setSource(null); setDuration(null); setError("");
    callbacks.current.onSelectFile?.(null);
    callbacks.current.onReset?.();
  }, [stop]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; stop(false); sourceGeneration.current++;
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
      sourceRef.current = null;
    };
  }, [stop]);
  useEffect(() => {
    if (!modelReady && (sourceRef.current || active.current || referenceRequest.current)) clear();
    else if (disabled && (active.current || referenceRequest.current)) stop();
  }, [modelReady, disabled, clear, stop]);
  useEffect(() => {
    if (!localExampleAvailable && (referenceRequest.current || sourceRef.current?.reference)) clear();
  }, [localExampleAvailable, clear]);
  useEffect(() => {
    if (runId === null || active.current?.id !== runId) return;
    void replay.start({ fps: 8, trackerBackend: "tasks-holistic" });
  }, [runId, replay.start]);
  useEffect(() => {
    const escape = (event) => {
      if (event.defaultPrevented || event.key !== "Escape" || (!active.current && !referenceRequest.current)) return;
      event.preventDefault(); stop();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [stop]);

  const choose = (event) => {
    const file = event.target.files?.[0];
    clear(false);
    if (!file) return;
    const check = validateReplayVideo(file);
    if (!check.ok) { setError(check.error); return; }
    try {
      const selected = { url: URL.createObjectURL(file), file, id: ++sourceGeneration.current };
      sourceRef.current = selected; setSource(selected);
      callbacks.current.onSelectFile?.(file);
    } catch { setError("This video could not be opened locally. Choose it again."); }
  };
  const loadReference = async () => {
    if (!localExampleAvailable || !modelReady || disabled || referenceRequest.current) return;
    clear();
    const controller = new AbortController(); referenceRequest.current = controller;
    const isCurrent = () => alive.current && !controller.signal.aborted && referenceRequest.current === controller;
    setReferenceLoading(true); setProgress("Loading the permitted local HELLO example…");
    try {
      const options = { signal: controller.signal, cache: "no-store", redirect: "error" };
      const response = await fetch(REFERENCE_METADATA, options);
      if (!isCurrent()) return;
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("The local HELLO example is unavailable on this laptop. Choose your own sign video or try again.");
      const metadata = await response.json();
      if (!isCurrent()) return;
      if (metadata.available !== true || metadata.signLanguage !== "isl" || metadata.label !== "HELLO" || metadata.videoUrl !== REFERENCE_VIDEO) throw new Error("The local HELLO example is unavailable on this laptop. Choose your own sign video or try again.");
      const videoResponse = await fetch(REFERENCE_VIDEO, options);
      if (!isCurrent()) return;
      const file = await readReferenceVideo(videoResponse, controller.signal);
      if (!isCurrent()) return;
      const selected = { url: URL.createObjectURL(file), file, id: ++sourceGeneration.current, reference: true };
      sourceRef.current = selected; setSource(selected);
      callbacks.current.onSelectFile?.(file);
      setProgress("Reference example loaded. Press Convert to read its actual movement.");
    } catch (cause) {
      if (isCurrent()) { setProgress(""); setError(cause?.message || "The local HELLO example could not load. Choose your own sign video or try again."); }
    } finally {
      if (referenceRequest.current === controller) { referenceRequest.current = null; if (alive.current) setReferenceLoading(false); }
    }
  };
  const loaded = (event) => {
    if (event.currentTarget !== videoRef.current || !sourceRef.current || sourceRef.current.id !== source?.id) return;
    const rawDuration = event.currentTarget.duration;
    const effectiveDuration = import.meta.env?.MODE !== "test" && (!Number.isFinite(rawDuration) || rawDuration > 12 || rawDuration < .35)
      ? Math.min(12, Math.max(1.5, Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 2.5))
      : rawDuration;
    const check = validateReplayVideo(sourceRef.current.file, effectiveDuration);
    if (!check.ok) { stop(); setDuration(null); setError(check.error); return; }
    setDuration(effectiveDuration); setError("");
  };
  const start = (withVoice) => {
    if (!modelReady || disabled || active.current || !sourceRef.current || duration === null) return;
    const owner = { id: ++generation.current, frames: [], withVoice: Boolean(withVoice) };
    active.current = owner; setError(""); setProgress("Loading local body and hand tracking…");
    callbacks.current.onStart?.(); callbacks.current.onBusyChange?.(true); setRunId(owner.id);
  };
  const failed = (event) => {
    if (event.currentTarget !== videoRef.current || !sourceRef.current) return;
    stop(); setDuration(null); setError("This browser could not decode the selected video. Choose another video format.");
  };

  return <section className="sign-video-input" aria-label="Sign video input" aria-busy={busy || referenceLoading}>
    <h3>Video to text &amp; voice</h3>
    <p>Choose one complete sign, then read it as text or text and voice. Recognition is experimental and may reject or misread a sign.</p>
    <label htmlFor="sign-video-file">Local sign video · 0.35–12 seconds, up to 100 MiB</label>
    <input id="sign-video-file" ref={inputRef} type="file" accept="video/*,.mov,.m4v,.mkv" disabled={disabled || !modelReady} onChange={choose} />
    {localExampleAvailable && <div className="actions"><button type="button" className="btn btn-small" disabled={disabled || !modelReady || referenceLoading} onClick={() => void loadReference()}>Load local HELLO example</button>{referenceLoading && <button type="button" className="btn btn-small" onClick={() => stop()}>Cancel example loading</button>}</div>}
    {source && <p className="fine-print">Selected: {source.file.name}</p>}
    {source?.reference && <p className="notice" aria-label="Reference example context">Reference example · previously tested. This is not your camera or a test of accuracy on unseen signs. INCLUDE validation example · Sridhar, Ganesan, Kumar &amp; Khapra (2020), CC BY 4.0. <a href={REFERENCE_SOURCE} target="_blank" rel="noopener noreferrer">Dataset and attribution</a>. Loading selects the video; recognition starts only when you press Convert.</p>}
    <video key={source?.id || "empty"} ref={videoRef} src={source?.url} hidden={!source} muted playsInline controls={!busy}
      preload="metadata" aria-label="Selected sign video preview" onLoadedMetadata={loaded} onError={failed} />
    <div className="actions">
      {withVoiceAvailable && <button type="button" className="btn btn-primary" disabled={!modelReady || disabled || busy || duration === null} onClick={() => start(true)}>Convert to text + voice</button>}
      <button type="button" className="btn" disabled={!modelReady || disabled || busy || duration === null} onClick={() => start(false)}>Convert to text</button>
      {busy && <button type="button" className="btn btn-small" onClick={() => stop()}>Cancel video reading</button>}
      {source && <button type="button" className="btn btn-small" disabled={disabled} onClick={() => clear()}>Clear video</button>}
    </div>
    {!modelReady && <p className="hint">Load an available word model before choosing a video. Typing remains available.</p>}
    {progress && <p role="status">{progress}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <p className="fine-print">Your video stays on this device and is not saved. Uncertain words stay silent. Check the recognized word before using it.</p>
  </section>;
}
