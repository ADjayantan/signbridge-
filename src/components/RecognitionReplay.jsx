import { useEffect, useRef, useState } from "react";
import { usePoseTracking } from "../hooks/usePoseTracking.js";
import { useTrainedModel } from "../hooks/useTrainedModel.js";
import { useVideoPoseReplay } from "../hooks/useVideoPoseReplay.js";
import { poseFrameFromHolistic } from "../lib/trainedSignModel.js";
import { predictTrainedCameraSign } from "../lib/cameraWordRecognition.js";
import { prepareReplayFrames, summarizeReplay, validateReplayBaseline, validateReplayVideo } from "../lib/recognitionReplay.js";

/** A local engineering diagnostic. File playback never enters a conversation. */
export default function RecognitionReplay({ signLanguage }) {
  const trained = useTrainedModel(signLanguage);
  const videoRef = useRef(null), owner = useRef({ epoch: 0, active: false, started: 0, frames: [], timeout: 0 });
  const source = useRef("");
  const downloads = useRef(new Map());
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(null);
  const [videoSha256, setVideoSha256] = useState(null);
  const [hashing, setHashing] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [samplingMode, setSamplingMode] = useState("realtime-8hz");
  const [trackerBackend, setTrackerBackend] = useState("tasks-holistic");
  const [coordinateContract, setCoordinateContract] = useState("normalized-image");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [baseline, setBaseline] = useState(null);
  const [baselineError, setBaselineError] = useState("");
  const [report, setReport] = useState(null);
  const fileRef = useRef(null);
  const busy = phase === "loading" || phase === "playing" || phase === "sequential";

  useEffect(() => {
    const ownedVideo = videoRef.current;
    // React clears refs before passive unmount cleanup. Keep this element,
    // rather than reading an already-null ref when releasing file playback.
    return () => ownedVideo?.pause();
  }, [url]);

  const stop = () => {
    owner.current.epoch++; owner.current.active = false; owner.current.frames = [];
    clearTimeout(owner.current.timeout); owner.current.timeout = 0;
    sequential.cancel();
    videoRef.current?.pause();
  };
  const cancel = () => { stop(); setPhase("idle"); setError(""); };
  const tracking = usePoseTracking({ videoRef, active: phase === "loading" || phase === "playing", onFrame: (detected) => {
    const run = owner.current;
    if (!run.active || run.frames.length >= 100) return;
    const atMs = performance.now() - run.started;
    if (!Number.isFinite(atMs) || atMs < 0 || atMs > 12000 || (run.frames.length && atMs <= run.frames.at(-1).atMs)) return;
    run.frames.push({ ...poseFrameFromHolistic(detected), atMs });
  } });
  const evaluate = (frames, durationMs) => {
    stop();
    try {
      // Baseline labels are deliberately excluded from prediction arguments.
      const prepared = prepareReplayFrames(frames, coordinateContract, signLanguage);
      const result = predictTrainedCameraSign(trained.model, prepared, { durationMs, framesAlreadyInModelSpace: coordinateContract !== "normalized-image" });
      setReport(summarizeReplay(prepared, durationMs, result, { signLanguage, modelSha256: trained.sourceSha256, videoSha256, baseline, samplingMode, trackerBackend, coordinateContract, modelCameraInput: trained.model.cameraInput }));
      setPhase("done");
    } catch { setPhase("idle"); setError("This replay could not be evaluated. Check the model and try another complete video."); }
  };
  const sequential = useVideoPoseReplay({ videoRef,
    onFrame: (detected, _video, atMs) => {
      if (owner.current.active) owner.current.frames.push({ ...poseFrameFromHolistic(detected), atMs });
    },
    onProgress: ({ frameCount, totalFrames }) => setProgress(`${frameCount} of ${totalFrames} source samples`),
    onComplete: ({ durationMs }) => { if (owner.current.active) evaluate(owner.current.frames, durationMs); },
    onError: (cause) => { if (!owner.current.active) return; stop(); setPhase("idle"); setError(cause.message || "Sequential replay failed."); },
  });

  useEffect(() => {
    if (phase !== "loading" || tracking.status !== "ready") return;
    const run = owner.current, epoch = run.epoch, video = videoRef.current;
    if (!video) return;
    video.currentTime = 0; video.playbackRate = 1; video.muted = true;
    run.frames = []; run.active = false;
    run.timeout = setTimeout(() => {
      if (epoch !== owner.current.epoch) return;
      stop(); setPhase("idle"); setError("Playback stalled or exceeded 12 seconds. Use a shorter complete sign video and try again.");
    }, 12500);
    setPhase("playing");
    try {
      Promise.resolve(video.play()).catch(() => {
        if (epoch !== owner.current.epoch) return;
        stop(); setPhase("idle"); setError("Video playback could not start. Check the file and try Run video again.");
      });
    } catch {
      stop(); setPhase("idle"); setError("Video playback could not start. Check the file and try Run video again.");
    }
  }, [phase, tracking.status]);
  useEffect(() => {
    if ((phase !== "loading" && phase !== "playing") || tracking.status !== "error") return;
    stop(); setPhase("idle"); setError(tracking.error || "Tracking stopped. Run the video again to retry.");
  }, [phase, tracking.status, tracking.error]);
  useEffect(() => () => {
    owner.current.epoch++; owner.current.active = false; owner.current.frames = [];
    clearTimeout(owner.current.timeout);
    videoRef.current?.pause();
    if (source.current) URL.revokeObjectURL(source.current);
    for (const [download, timer] of downloads.current) { clearTimeout(timer); URL.revokeObjectURL(download); }
    downloads.current.clear();
  }, []);

  const chooseVideo = async (event) => {
    stop(); const epoch = owner.current.epoch;
    setPhase("idle"); setReport(null); setError(""); setDuration(null); setVideoSha256(null); setHashing(false); fileRef.current = null;
    if (source.current) URL.revokeObjectURL(source.current);
    source.current = ""; setUrl("");
    const file = event.target.files?.[0];
    if (!file) return;
    const check = validateReplayVideo(file);
    if (!check.ok) { setError(check.error); return; }
    try {
      source.current = URL.createObjectURL(file); fileRef.current = file; setUrl(source.current);
      if (globalThis.crypto?.subtle) {
        setHashing(true);
        try {
          const bytes = await file.arrayBuffer();
          if (epoch !== owner.current.epoch) return;
          const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
          if (epoch !== owner.current.epoch) return;
          setVideoSha256(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
        } catch { /* Without a hash, the replay cannot claim a paired comparison. */ }
        if (epoch === owner.current.epoch) setHashing(false);
      }
    } catch { setError("This video could not be opened locally. Choose the file again."); }
  };
  const loaded = () => {
    const check = validateReplayVideo(fileRef.current, videoRef.current?.duration);
    if (!check.ok) { stop(); setPhase("idle"); setDuration(null); setError(check.error); return; }
    setDuration(videoRef.current.duration); setError("");
  };
  const baselineEpoch = useRef(0);
  useEffect(() => () => { baselineEpoch.current++; }, []);
  const chooseBaseline = async (event) => {
    const epoch = ++baselineEpoch.current;
    setBaseline(null); setBaselineError(""); setReport(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.size || file.size > 16384) { setBaselineError("Choose a baseline JSON file smaller than 16 KB."); return; }
    try {
      const checked = validateReplayBaseline(JSON.parse(await file.text()));
      if (epoch !== baselineEpoch.current) return;
      if (!checked.ok) { setBaselineError(checked.error); return; }
      setBaseline(checked.baseline);
    } catch { if (epoch === baselineEpoch.current) setBaselineError("The baseline JSON could not be read."); }
  };
  const run = () => {
    if (busy || hashing || !url || duration === null || trained.status !== "ready") return;
    stop(); setReport(null); setError(""); setProgress("");
    if (samplingMode === "sequential-25fps") {
      owner.current.active = true; setPhase("sequential"); void sequential.start({ fps: 25, trackerBackend });
    } else setPhase("loading");
  };
  const playing = () => {
    if (phase !== "playing" || owner.current.active) return;
    owner.current.started = performance.now(); owner.current.frames = []; owner.current.active = true;
  };
  const finish = () => {
    const run = owner.current;
    if (!run.active || phase !== "playing") return;
    evaluate(run.frames, performance.now() - run.started);
  };
  const download = () => {
    if (!report) return;
    let exportUrl = "", anchor;
    try {
      exportUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      anchor = document.createElement("a"); anchor.href = exportUrl; anchor.download = "signbridge-recognition-replay.json";
      anchor.hidden = true; document.body.appendChild(anchor); anchor.click();
      const timer = setTimeout(() => { URL.revokeObjectURL(exportUrl); downloads.current.delete(exportUrl); }, 1000);
      downloads.current.set(exportUrl, timer);
    } catch { if (exportUrl) URL.revokeObjectURL(exportUrl); setError("Report download failed. The result is still visible; try again."); }
    finally { anchor?.remove(); }
  };

  return <section aria-labelledby="replay-title" className="recognition-replay">
    <h2 id="replay-title">Check a reference sign video</h2>
    <p>Run a complete local video through the camera's body/hand tracker and word predictor, or explicitly compare an older tracker. This diagnoses the pipeline; it does not train a model or prove webcam accuracy.</p>
    <p className="fine-print">Use a recording you have permission to process. Video and joint coordinates stay in memory on this device. Tracking downloads its runtime/model; your video is not uploaded, saved, sent or spoken.</p>
    <div className="field"><label htmlFor="replay-video">Reference video · up to 12 seconds / 100 MB</label><input id="replay-video" type="file" accept="video/*,.mov,.mp4,.webm" onChange={chooseVideo} /></div>
    <div className="field"><label htmlFor="replay-sampling">Replay sampling</label><select id="replay-sampling" value={samplingMode} disabled={busy} onChange={(event) => { setSamplingMode(event.target.value); if (event.target.value === "realtime-8hz") setTrackerBackend("tasks-holistic"); setReport(null); }}><option value="realtime-8hz">Realtime camera path · up to 8 samples/s</option><option value="sequential-25fps">Sequential 25 samples/s · diagnostic only</option></select><p className="fine-print">Sequential mode pauses and decodes each sample at source timestamps. At 25 samples/s, clips must be at most 4 seconds (100 samples). It isolates sampling effects and does not change the camera recognizer.</p></div>
    <div className="field"><label htmlFor="replay-tracker">Diagnostic tracker</label><select id="replay-tracker" value={trackerBackend} disabled={busy} onChange={(event) => { setTrackerBackend(event.target.value); if (event.target.value === "solutions-holistic-experiment") setSamplingMode("sequential-25fps"); setReport(null); }}><option value="tasks-holistic">Current camera tracker · Tasks Holistic</option><option value="solutions-holistic-experiment">Older Solutions Holistic · compatibility experiment</option></select><p className="fine-print">The older tracker downloads its pinned runtime and models only when Run is pressed. It uses sequential sampling and does not replace the camera tracker or establish model accuracy.</p></div>
    <div className="field"><label htmlFor="replay-coordinates">Diagnostic coordinates</label><select id="replay-coordinates" value={coordinateContract} disabled={busy} onChange={(event) => { setCoordinateContract(event.target.value); setReport(null); }}><option value="normalized-image">Current camera · normalized image coordinates</option>{signLanguage === "isl" && <option value="archive-isl-hw-1080x1920-experiment">ISL archive scale · x × 1080, y × 1920 experiment</option>}</select><p className="fine-print">The ISL archive experiment tests measured pixel scaling from the paired 1080 × 1920 archive metadata. It does not change the camera, model weights or acceptance thresholds.</p></div>
    <div className="field"><label htmlFor="replay-baseline">Optional offline baseline JSON</label><input id="replay-baseline" type="file" accept="application/json,.json" disabled={busy} onChange={chooseBaseline} /><p className="fine-print">Comparison requires the same video hash, model hash and sign language. The supplied reference label never influences recognition.</p></div>
    {baselineError && <p className="notice error" role="alert">{baselineError}</p>}
    {baseline && <p>Supplied reference: <strong>{baseline.expectedLabel}</strong> · {baseline.signLanguage.toUpperCase()}. Labels still require independent review.</p>}
    {url && <video ref={videoRef} src={url} controls={!busy} muted playsInline preload="metadata" onLoadedMetadata={loaded} onPlaying={playing} onEnded={finish} onError={() => { stop(); setPhase("idle"); setDuration(null); setError("This browser cannot decode the selected video. Try a supported MP4 or WebM recording."); }} aria-label="Reference sign video" />}
    <p role="status">{trained.status === "ready" ? `Loaded ${signLanguage.toUpperCase()} word model · ${trained.model.labels.length} labels` : trained.status === "loading" ? "Loading local word model…" : trained.error}</p>
    <div className="actions"><button type="button" className="btn" disabled={busy || hashing || !url || duration === null || trained.status !== "ready"} onClick={run}>Run video through recognition</button>{busy && <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel replay</button>}{trained.status === "error" && <button type="button" className="btn btn-small" onClick={trained.retry}>Retry local model</button>}</div>
    <p role="status" aria-live="polite">{hashing ? "Checking the local video fingerprint…" : phase === "loading" ? "Starting the camera’s body and hand tracker…" : phase === "playing" ? "Reading the complete video. Please keep this tab active." : phase === "sequential" ? `Decoding source frames: ${progress || "starting tracker…"}` : phase === "done" ? "Replay complete. Review the measured result below." : ""}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {report && <div className="notice" aria-label="Replay result">
      <p><strong>{report.prediction.status === "recognized" ? `Predicted word: ${report.prediction.meaning}` : "No word accepted"}</strong></p>
      <p>Sampling: {report.samplingMode} · {report.captureClock} clock.</p>
      <p>Tracker: {report.trackerBackend}.</p>
      <p>Coordinates: {report.coordinateContract}.</p>
      <p>Model camera input: {report.modelCameraInput ? `${report.modelCameraInput.space} · x × ${report.modelCameraInput.scaleX}, y × ${report.modelCameraInput.scaleY}` : "Legacy artifact; camera coordinate contract unspecified"}.</p>
      <p>{report.frameCount} tracked samples · {Number.isFinite(report.durationMs) ? `${(report.durationMs / 1000).toFixed(2)} seconds` : "duration outside capture bounds"}. Highest scoring label: {report.prediction.topLabel || "Inference did not run"}.</p>
      <p>Rejection/result reasons: {report.prediction.reasonCodes.join(", ") || "Unavailable"}.</p>
      <p>Offline comparison: {report.comparison.status}. {report.comparison.status === "matched-model" ? `Top label ${report.comparison.topLabelMatches === null ? "unavailable" : report.comparison.topLabelMatches ? "matches" : "differs"}; ${report.prediction.status !== "recognized" && report.comparison.baselineStatus !== "recognized" ? "both paths withheld a word. This does not establish correct recognition." : `accepted output ${report.comparison.acceptedMeaningMatches ? "matches" : "differs"}.`}` : "No comparable offline result established."}</p>
      <p className="fine-print">A replay prediction is not a verified translation or an accuracy score. The report excludes the video, filename and joint coordinates.</p>
      <button type="button" className="btn btn-small" onClick={download}>Download replay report</button>
    </div>}
  </section>;
}
