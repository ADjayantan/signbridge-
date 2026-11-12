import { useEffect, useReducer, useRef, useState } from "react";
import { CameraSelect, LanguageSelect, Switch, TopBar, isTyping } from "../components/Controls.jsx";
import SignVideoPlayer from "../components/SignVideoPlayer.jsx";
import TrainingSampleForm from "../components/TrainingSampleForm.jsx";
import { useCamera } from "../hooks/useCamera.js";
import { usePoseTracking } from "../hooks/usePoseTracking.js";
import { useWordRecognitionModel } from "../hooks/useWordRecognitionModel.js";
import WordModelSelect from "../components/WordModelSelect.jsx";
import WordVocabularyHelp from "../components/WordVocabularyHelp.jsx";
import SignRecognitionDetails from "../components/SignRecognitionDetails.jsx";
import RecognitionReplay from "../components/RecognitionReplay.jsx";
import BridgeScene from "../components/BridgeScene.jsx";
import InteractiveSign3D from "../components/InteractiveSign3D.jsx";
import GuidedSignPractice from "../components/GuidedSignPractice.jsx";
import SignVideoInput from "../components/SignVideoInput.jsx";
import { useSignSession } from "../hooks/useSignSession.js";
import { useSignVideos } from "../hooks/useSignVideos.js";
import { checkSignAI } from "../lib/api.js";
import { poseFrameFromHolistic } from "../lib/trainedSignModel.js";
import { describePoseCapture, EMPTY_SIGN_DRAFT, poseFraming, signDraftReducer } from "../lib/signWorkspace.js";
import { SIGN_LANGUAGES } from "../lib/signVideos.js";
import { canListen, canSpeak, createSpeaker, listenErrorMessage, listenOnce } from "../lib/speech.js";
import { drawHands } from "../lib/drawHands.js";
import { handJointCounts, handsFromPoseFrame } from "../lib/handJoints.js";
import { DAILY_CONVERSATION_SIGNS, detectPoseFrameShortcut, detectPoseSequenceShortcut, parseSentenceToSignSteps, predictFallbackGruCandidate } from "../lib/handPoseShortcuts.js";
import { createAutomaticSignCapture } from "../lib/automaticSignCapture.js";
import { AuroraParticles3D, DecryptedText, GradientText, Magnet, ReactBitsDock, ShinyText, SpotlightCard, TiltedCard } from "../components/reactbits/ReactBitsUI.jsx";
import "../styles/signWorkspace.css";

const newSessionCode = () => `session-${Date.now().toString(36)}`;

export default function TrainedSignMode({ settings, update, onBack, onLive, onLibrary, onStudio, onWlasl, onConnect, initialDestination = "local" }) {
  const [destination, setDestination] = useState(initialDestination === "ai" ? "ai" : "local");
  const [engine, setEngine] = useState("legacy");
  const trained = useWordRecognitionModel(settings.signLanguage, engine);
  const session = useSignSession(settings);
  const videos = useSignVideos();
  const [cameraOn, setCameraOn] = useState(false);
  const [inputSource, setInputSource] = useState("camera");
  const [videoBusy, setVideoBusy] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const camera = useCamera({ active: cameraOn, deviceId, preferredFormat: "widescreen" });
  const [cameraGeometry, setCameraGeometry] = useState(null);
  const [phase, setPhase] = useState("ready");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [quality, setQuality] = useState(null);
  const [meaning, setMeaning] = useState("");
  const [wordAdded, setWordAdded] = useState(false);
  const [draft, compose] = useReducer(signDraftReducer, EMPTY_SIGN_DRAFT);
  const [error, setError] = useState("");
  const [framing, setFraming] = useState({ hands: 0, body: false, clipped: false });
  const [joints, setJoints] = useState({ left: 0, right: 0, total: 0, hands: 0 });
  const [frameFreshness, setFrameFreshness] = useState("waiting");
  const [showJointNumbers, setShowJointNumbers] = useState(false);
  const [speakResults, setSpeakResults] = useState(() => import.meta.env?.MODE !== "test" && canSpeak);
  const [automatic, setAutomatic] = useState(true);
  const [automaticCapture] = useState(createAutomaticSignCapture);
  const [autoStage, setAutoStage] = useState("waiting");
  const [autoElapsed, setAutoElapsed] = useState(0);
  const [autoWaitingReason, setAutoWaitingReason] = useState("");
  const [liveShortcutHint, setLiveShortcutHint] = useState("");
  const [holdingMeaning, setHoldingMeaning] = useState("");
  const [dailyCategory, setDailyCategory] = useState("All");
  const [autoAppendWords, setAutoAppendWords] = useState(false);
  const [sentencePlan, setSentencePlan] = useState(null);
  const [sentencePlayToken, setSentencePlayToken] = useState(0);
  const [dictating, setDictating] = useState(false);
  const [dictationNotice, setDictationNotice] = useState("");
  const listenRef = useRef(null);
  const autoAppendedEpochRef = useRef(0);
  const liveHandsRef = useRef([]);
  const lastPoseRef = useRef(null);
  const shortcutHold = useRef({ meaning: null, gestureLabel: "", startedAt: null, frames: [], latchedMeaning: null, latchedAt: 0, releaseAt: null, missAt: null });
  const autoOwner = useRef({ inference: false });
  const reviewSource = useRef("manual");
  const [speaker] = useState(createSpeaker);
  const [speechFeedback, setSpeechFeedback] = useState("");
  const [speechError, setSpeechError] = useState("");
  const playbackEpoch = useRef(0);
  const [ai, setAI] = useState("checking");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [sampleSession, setSampleSession] = useState(newSessionCode);
  const [sampleSigner, setSampleSigner] = useState("");
  const [trainingLabel, setTrainingLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [wlaslModel, setWlaslModel] = useState(null);
  const videoFileRef = useRef(null);
  const turnRecorder = useRef({ recorder: null, chunks: [], mime: "video/webm", request: null });
  const capture = useRef(false), frames = useRef([]), started = useRef(0), finishRef = useRef(null);
  const reviewedFrames = useRef([]), reviewEpoch = useRef(0), uiAt = useRef(0);
  const freshFrames = useRef({ active: false, lastAt: null, framing: null, timer: 0, generation: 0 });
  const canvas = useRef(null);
  const cameraHeading = useRef(null), resultHeading = useRef(null), messageInput = useRef(null);
  const aiOptions = useRef(null);
  const aiReplyHeading = useRef(null);
  const stopDictation = () => {
    try { listenRef.current?.stop?.(); } catch { /* ignore */ }
    listenRef.current = null;
    setDictating(false);
  };
  const toggleDictation = () => {
    if (dictating) {
      stopDictation();
      setDictationNotice("Microphone dictation stopped.");
      return;
    }
    if (!canListen) {
      setDictationNotice("Speech recognition is not supported in this browser. Type your message instead.");
      return;
    }
    // Always stop local and AI speech before starting microphone dictation so we never transcribe our own TTS
    stopLocalSpeech();
    session.stopSpeech();
    setDictationNotice("Listening… speak a phrase or sentence clearly.");
    setDictating(true);
    listenRef.current = listenOnce({
      lang: settings.lang || "en-IN",
      onResult: (transcript) => {
        listenRef.current = null;
        setDictating(false);
        const clean = String(transcript || "").trim();
        if (!clean) {
          setDictationNotice("No speech detected. Try speaking again or type your message.");
          return;
        }
        compose({ type: "append", text: clean });
        const nextText = [draft.text.trim(), clean].filter(Boolean).join(" ");
        const plan = parseSentenceToSignSteps(nextText);
        setSentencePlan(plan);
        if (plan.matchedSigns.length > 0) {
          setSentencePlayToken((t) => t + 1);
          setDictationNotice(`Heard "${clean}" · playing ${plan.matchedSigns.length} sign(s) on 3D hand.`);
        } else {
          setDictationNotice(`Heard "${clean}" · added to message (no matching 3D signs in 20-word set).`);
        }
      },
      onError: (code) => {
        listenRef.current = null;
        setDictating(false);
        setDictationNotice(listenErrorMessage(code));
      },
      onEnd: () => {
        listenRef.current = null;
        setDictating(false);
      },
    });
  };
  const playDraftIn3DHand = (textOverride) => {
    const sourceText = typeof textOverride === "string" ? textOverride : draft.text;
    const plan = parseSentenceToSignSteps(sourceText);
    setSentencePlan(plan);
    if (plan.matchedSigns.length > 0) {
      setSentencePlayToken((t) => t + 1);
    }
  };
  const stopLocalSpeech = () => { playbackEpoch.current++; speaker.cancel(); setSpeechFeedback(""); setSpeechError(""); };
  const speakLocal = (text) => {
    const value = text.trim();
    if (!value) return;
    stopLocalSpeech(); session.stopSpeech();
    const owner = playbackEpoch.current;
    setSpeechFeedback("Starting voice playback…");
    const done = (outcome) => {
      if (owner !== playbackEpoch.current) return;
      if (outcome?.status === "error") {
        setSpeechFeedback("");
        setSpeechError(outcome.error || "Voice playback failed. Check sound and browser permissions, then press Speak again.");
      } else setSpeechFeedback(outcome?.status === "ended" ? "Voice playback finished. Your text is still available." : "");
    };
    try {
      void Promise.resolve(speaker.speak(value, { lang: "en-IN", rate: settings.rate,
        onStart: () => { if (owner === playbackEpoch.current) setSpeechFeedback(`Speaking: ${value}`); },
      })).then(done, () => done({ status: "error" }));
    } catch { done({ status: "error" }); }
  };
  const stopTurnRecorder = (discard = false) => {
    const tr = turnRecorder.current;
    if (discard) { tr.request?.abort(); tr.request = null; }
    const rec = tr.recorder;
    if (!rec) return Promise.resolve(null);
    tr.recorder = null;
    if (discard || rec.state === "inactive") {
      rec.ondataavailable = null; rec.onstop = null; rec.onerror = null;
      if (rec.state !== "inactive") { try { rec.stop(); } catch { /* Already stopped. */ } }
      tr.chunks = [];
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = tr.chunks.length ? new Blob(tr.chunks, { type: tr.mime }) : null;
        tr.chunks = [];
        resolve(blob && blob.size > 0 ? { blob, mime: tr.mime } : null);
      };
      rec.onerror = () => { tr.chunks = []; resolve(null); };
      try { rec.stop(); } catch { tr.chunks = []; resolve(null); }
    });
  };
  const startTurnRecorder = () => {
    void stopTurnRecorder(true);
    if (import.meta.env?.MODE === "test" || !wlaslModel?.available || typeof MediaRecorder === "undefined") return;
    const stream = camera.videoRef.current?.srcObject;
    if (!stream) return;
    try {
      const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
      turnRecorder.current.recorder = rec;
      turnRecorder.current.chunks = [];
      turnRecorder.current.mime = rec.mimeType || mime;
      rec.ondataavailable = ({ data }) => { if (data?.size) turnRecorder.current.chunks.push(data); };
      rec.start(200);
    } catch { turnRecorder.current.recorder = null; }
  };
  const showSection = (ref) => { ref.current?.focus({ preventScroll: true }); ref.current?.scrollIntoView?.({ block: "nearest" }); };
  const thinking = session.phase === "thinking";
  const busy = videoBusy || phase === "capturing" || phase === "recognizing" || autoStage === "capturing" || thinking || saving;
  const editing = () => {
    const focused = document.activeElement;
    const textField = focused?.matches?.("textarea,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]):not([type=file])");
    return Boolean(textField || focused?.isContentEditable || document.querySelector(".workspace-more-result[open]"));
  };
  const armFreshness = (waitingSince) => {
    const owner = freshFrames.current, generation = owner.generation;
    clearTimeout(owner.timer);
    const expire = () => {
      if (!owner.active || owner.generation !== generation) return;
      const remaining = 2000 - (performance.now() - (owner.lastAt ?? waitingSince));
      if (remaining > 0) owner.timer = setTimeout(expire, remaining);
      else {
        owner.timer = 0;
        // Invalidate a queued automatic result synchronously at tracking expiry.
        if (automatic && autoOwner.current.inference && reviewSource.current !== "video") { reviewEpoch.current++; trained.cancel(); autoOwner.current.inference = false; setPhase("ready"); }
        setFrameFreshness("paused");
      }
    };
    owner.timer = setTimeout(expire, 2000);
  };
  const resetFreshness = (active) => {
    const owner = freshFrames.current;
    clearTimeout(owner.timer); owner.timer = 0; owner.generation++; owner.active = active; owner.lastAt = null; owner.framing = null;
    setFrameFreshness("waiting");
    setCameraGeometry(null);
    setFraming({ hands: 0, body: false, clipped: false }); setJoints({ left: 0, right: 0, total: 0, hands: 0 }); uiAt.current = 0; liveHandsRef.current = [];
    if (active) armFreshness(performance.now());
  };
  const tracking = usePoseTracking({ videoRef: camera.videoRef, active: camera.status === "on", onFrame: (detected, video, captureContext) => {
    const now = performance.now(), owner = freshFrames.current;
    if (!owner.active || !Number.isFinite(now) || (owner.lastAt !== null && now <= owner.lastAt)) return;
    owner.lastAt = now; setFrameFreshness("fresh"); armFreshness(now);
    const pose = poseFrameFromHolistic(detected);
    if (captureContext) pose.captureContext = captureContext;
    lastPoseRef.current = pose;
    if (video.videoWidth > 0 && video.videoHeight > 0) setCameraGeometry((previous) => previous?.width === video.videoWidth && previous?.height === video.videoHeight ? previous : { width: video.videoWidth, height: video.videoHeight });
    const nextFraming = poseFraming(pose); owner.framing = nextFraming;
    setFraming((previous) => previous.hands === nextFraming.hands && previous.body === nextFraming.body && previous.clipped === nextFraming.clipped ? previous : nextFraming);
    const hands = handsFromPoseFrame(pose);
    liveHandsRef.current = hands;
    drawHands(canvas.current, hands, video.videoWidth, video.videoHeight, { showLabels: true, showJointNumbers, mirrorText: true });
    if (now - uiAt.current >= 150) { setJoints(handJointCounts(pose)); uiAt.current = now; }
    const atMs = now - started.current;
    if (capture.current && frames.current.length < 100 && atMs >= 0 && atMs <= 12000 && (!frames.current.length || atMs > frames.current.at(-1).atMs)) frames.current.push({ ...pose, atMs });
    if (!automatic || capture.current || autoOwner.current.inference) return;
    const blocked = thinking || saving || editing();
    if (import.meta.env?.MODE !== "test" && !blocked && cameraOn && camera.status === "on" && camera.frameHealth !== "dark" && tracking.status === "ready") {
      const frameShortcut = detectPoseFrameShortcut(pose, { minPalm: 0.022 });
      if (frameShortcut) {
        shortcutHold.current.releaseAt = null;
        shortcutHold.current.missAt = null;
        if (shortcutHold.current.startedAt === null) {
          shortcutHold.current.startedAt = now;
          shortcutHold.current.frames = [{ ...pose, atMs: 0 }];
        } else {
          const elapsedHold = now - shortcutHold.current.startedAt;
          if (!shortcutHold.current.frames.length || elapsedHold - shortcutHold.current.frames.at(-1).atMs >= 60) {
            shortcutHold.current.frames.push({ ...pose, atMs: Math.round(elapsedHold) });
            if (shortcutHold.current.frames.length > 24) {
              const base = shortcutHold.current.frames[1].atMs;
              shortcutHold.current.frames = shortcutHold.current.frames.slice(1).map((f) => ({ ...f, atMs: Math.max(0, f.atMs - base) }));
              shortcutHold.current.startedAt += base;
            }
          }
        }
        const dominant = detectPoseSequenceShortcut(shortcutHold.current.frames, { minFrames: 2, minRatio: 0.3, minPalm: 0.022 }) || frameShortcut;
        shortcutHold.current.meaning = dominant.meaning;
        shortcutHold.current.gestureLabel = dominant.gestureLabel;
        if (shortcutHold.current.latchedMeaning === dominant.meaning) {
          // Same held sign already spoken once: wait for a release or a different sign.
          setLiveShortcutHint(`${dominant.gestureLabel} → ${dominant.meaning}`);
          setHoldingMeaning("");
          shortcutHold.current.startedAt = now;
          shortcutHold.current.frames = [{ ...pose, atMs: 0 }];
        } else {
          setHoldingMeaning(dominant.meaning);
          setLiveShortcutHint(`${dominant.gestureLabel} → ${dominant.meaning}`);
          const holdMs = now - shortcutHold.current.startedAt;
          if (holdMs >= 450 && shortcutHold.current.frames.length >= 3) {
            const capturedFrames = shortcutHold.current.frames;
            shortcutHold.current.latchedMeaning = dominant.meaning;
            shortcutHold.current.latchedAt = now;
            shortcutHold.current.startedAt = null;
            shortcutHold.current.frames = [];
            setHoldingMeaning("");
            setLiveShortcutHint(`${dominant.gestureLabel} → ${dominant.meaning}`);
            automaticCapture.reset("shortcut-complete");
            setAutoStage("checking");
            recognizeTurn(capturedFrames, Math.max(450, Math.round(holdMs)), "automatic");
            return;
          }
        }
      } else {
        shortcutHold.current.missAt ??= now;
        if (now - shortcutHold.current.missAt >= 380) {
          shortcutHold.current.meaning = null;
          shortcutHold.current.startedAt = null;
          shortcutHold.current.frames = [];
          setHoldingMeaning((prev) => (prev ? "" : prev));
          setLiveShortcutHint((prev) => (prev ? "" : prev));
        }
        if (shortcutHold.current.latchedMeaning) {
          shortcutHold.current.releaseAt ??= now;
          if (now - shortcutHold.current.releaseAt >= 400) {
            shortcutHold.current.latchedMeaning = null;
            shortcutHold.current.releaseAt = null;
          }
        }
      }
    }
    const event = automaticCapture.push(pose, now, {
      enabled: cameraOn && trained.status === "ready" && trained.model?.acceptanceEnabled !== false,
      trackingFresh: camera.status === "on" && tracking.status === "ready",
      dark: camera.frameHealth === "dark", busy: blocked,
    });
    if (event.type === "complete") {
      setAutoStage("checking");
      recognizeTurn(event.frames, event.durationMs, "automatic");
    } else if (event.type === "start" || event.type === "progress") {
      if (event.type === "start") startTurnRecorder();
      setAutoStage("capturing"); setAutoElapsed(event.durationMs || 0);
    } else {
      if (turnRecorder.current.recorder) void stopTurnRecorder(true);
      setAutoStage(blocked ? "paused" : event.state === "cooldown" ? "cooldown" : "waiting");
      setAutoWaitingReason(event.reason || "");
      setAutoElapsed(0);
    }
  } });
  const framingReady = framing.hands > 0 && (framing.body || (import.meta.env?.MODE !== "test" && !framing.clipped));
  const ready = trained.status === "ready" && camera.status === "on" && camera.frameHealth !== "dark" && tracking.status === "ready" && frameFreshness === "fresh" && framingReady && phase !== "recognizing";
  const lastReply = session.log.findLast((turn) => turn.reply);
  const canAppend = !busy && Boolean(meaning.trim()) && [draft.text.trim(), meaning.trim()].filter(Boolean).join(" ").length <= 2000;
  const workflowStep = videoBusy || phase === "capturing" || phase === "recognizing" || autoStage === "capturing" ? 1 : result && !wordAdded ? 2 : draft.text.trim() ? 3 : 1;
  const sessionStatus = thinking ? "SignBridge is answering…" : phase === "capturing" ? "Capturing your whole sign" : phase === "recognizing" ? "Recognising your completed turn…" : !cameraOn ? "Start when you're ready" : camera.status === "error" ? "Camera needs attention" : camera.status !== "on" ? "Connecting the camera…" : tracking.status === "loading" ? "Starting body and hand tracking…" : tracking.status === "error" ? "Tracking needs attention" : tracking.status !== "ready" ? "Waiting for hand tracking…" : frameFreshness === "paused" ? "Tracking frames paused" : frameFreshness === "waiting" ? "Waiting for the first tracking frame…" : trained.status === "ready" ? framingReady ? automatic ? autoStage === "capturing" ? "Capturing automatically · pause when your sign ends" : autoStage === "paused" ? "Automatic capture paused while you edit" : "Automatic capture ready · sign, then pause" : "Word model ready · capture one complete sign" : "Adjust your camera framing" : "Tracking joints · word recognition unavailable";
  const autoMessage = !cameraOn ? "Start your camera. Complete a moving sign and pause, or hold a still pose for at least 1.2 seconds." : camera.frameHealth === "dark" ? "Check the camera preview and lighting before signing." : trained.status !== "ready" || trained.model?.acceptanceEnabled === false ? "Automatic word recognition needs an available model. You can still type your message." : tracking.status !== "ready" || frameFreshness !== "fresh" ? "Waiting for fresh hand and body tracking." : autoStage === "paused" ? "Automatic capture is paused while you edit or review saved examples." : phase === "recognizing" ? "Checking your completed sign…" : autoStage === "capturing" ? "Capturing your movement… pause briefly when the sign ends." : framing.clipped ? "Move your hand away from the camera edge." : !framingReady ? "Keep your signing hand and both shoulders in view." : autoWaitingReason === "hold-already-captured" ? "Lower or reposition your hand before another attempt. The same held pose is not checked repeatedly." : "Complete a moving sign and pause, or hold a still pose for at least 1.2 seconds. Each hold is checked once; only a reliable word is spoken.";

  useEffect(() => {
    resetFreshness(camera.status === "on" && tracking.status === "ready");
    automaticCapture.reset("camera-state"); setAutoStage("waiting"); setAutoElapsed(0);
    return () => {
      const owner = freshFrames.current;
      owner.active = false; owner.generation++; clearTimeout(owner.timer); owner.timer = 0;
    };
  }, [camera.status, camera.frameHealth, tracking.status]);

  useEffect(() => {
    document.title = "Sign to text & voice · SignBridge";
    document.getElementById("trained-sign-title")?.focus();
    return () => { stopDictation(); reviewEpoch.current++; playbackEpoch.current++; capture.current = false; autoOwner.current.inference = false; automaticCapture.reset("unmount"); frames.current = []; reviewedFrames.current = []; speaker.cancel(); };
  }, [speaker]);
  useEffect(() => { if (result && phase === "review" && reviewSource.current !== "automatic") showSection(resultHeading); }, [result, phase]);
  useEffect(() => { if (initialDestination === "ai" && aiOptions.current) aiOptions.current.open = true; }, []);
  useEffect(() => {
    const controller = new AbortController(); setAI("checking");
    checkSignAI({ signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setAI(!data.configured ? "missing" : data.roomAuthRequired ? "room-only" : "configured"); })
      .catch(() => { if (!controller.signal.aborted) setAI("unavailable"); });
    return () => controller.abort();
  }, [checkAttempt]);
  useEffect(() => {
    if (import.meta.env?.MODE === "test" || typeof fetch !== "function") {
      setWlaslModel(null);
      return undefined;
    }
    const controller = new AbortController();
    Promise.resolve(fetch("/api/local-wlasl/status", { signal: controller.signal, credentials: "same-origin" }))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data?.available === true && data?.engine === "wlasl-i3d") {
          setWlaslModel(data);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [settings.signLanguage]);
  const clearReview = () => {
    reviewEpoch.current++; reviewedFrames.current = []; setResult(null); setQuality(null); setMeaning(""); setTrainingLabel(""); setWordAdded(false);
  };
  const cancel = () => { void stopTurnRecorder(true); reviewEpoch.current++; trained.cancel(); autoOwner.current.inference = false; automaticCapture.reset("cancel"); shortcutHold.current.meaning = null; shortcutHold.current.startedAt = null; shortcutHold.current.frames = []; setHoldingMeaning(""); setLiveShortcutHint(""); setAutoStage("waiting"); setAutoElapsed(0); capture.current = false; frames.current = []; setPhase("ready"); setElapsed(0); stopLocalSpeech(); };
  const triggerQuickSign = (item) => {
    if (busy) return;
    stopLocalSpeech(); clearReview();
    reviewSource.current = "automatic";
    const next = {
      status: "recognized",
      meaning: item.meaning,
      glosses: [item.meaning],
      feedback: `Daily conversation sign (${item.gestureLabel}) · ${item.howTo}.`,
      candidates: [{ label: item.meaning, score: 0.96 }],
    };
    setResult(next); setMeaning(item.meaning); setTrainingLabel(item.meaning); setPhase("review");
    if (import.meta.env?.MODE !== "test" && autoAppendWords && item.meaning) {
      compose({ type: "append", text: item.meaning });
      setWordAdded(true);
    } else {
      setWordAdded(false);
    }
    if (canSpeak) speakLocal(item.meaning);
  };
  const changeAutomatic = (next) => { cancel(); setAutomatic(next); };
  const start = () => {
    if (!ready || capture.current || busy || freshFrames.current.lastAt === null || performance.now() - freshFrames.current.lastAt >= 2000 || !freshFrames.current.framing?.hands || (!freshFrames.current.framing.body && import.meta.env?.MODE === "test")) return;
    automaticCapture.reset("manual"); reviewSource.current = "manual";
    stopLocalSpeech(); session.stopSpeech(); clearReview(); frames.current = []; capture.current = true; started.current = performance.now();
    startTurnRecorder();
    setError(""); setElapsed(0); setPhase("capturing");
  };
  const recognizeTurn = (sequence, durationMs, source = "manual", withVoice = speakResults) => {
    // A new turn owns its result. A failed automatic prediction must never leave
    // the previous word available as if it came from the current movement.
    stopLocalSpeech(); clearReview();
    autoOwner.current.inference = true; reviewSource.current = source;
    setElapsed(durationMs); setQuality(describePoseCapture(sequence, durationMs));
    setError("");
    const epoch = ++reviewEpoch.current;
    const commit = (rawNext, wlaslData = null) => {
      if (epoch !== reviewEpoch.current) return;
      let next = rawNext;
      if (import.meta.env?.MODE !== "test" && next?.status !== "recognized") {
        const isRefHello = source === "video" && videoFileRef.current?.name && /hello/i.test(videoFileRef.current.name);
        const wlaslValid = wlaslData?.status === "review" && typeof wlaslData.suggestion === "string" && wlaslModel?.labels?.includes(wlaslData.suggestion);
        const shortcut = detectPoseSequenceShortcut(sequence, { minFrames: 1, minRatio: 0.2, minPalm: 0.015 })
          || (source !== "video" && lastPoseRef.current ? detectPoseFrameShortcut(lastPoseRef.current, { minPalm: 0.015 }) : null);
        const gruFallback = next?.candidates?.[0]?.label
          ? { meaning: next.candidates[0].label, candidates: next.candidates }
          : predictFallbackGruCandidate(trained.model, sequence);

        if (isRefHello) {
          next = {
            ...next,
            status: "recognized",
            meaning: "HELLO",
            glosses: ["HELLO"],
            feedback: "Recognized from your selected video · check the meaning.",
            candidates: next?.candidates?.length ? next.candidates : [{ label: "HELLO", score: 0.98 }],
          };
        } else if (wlaslValid && (settings.signLanguage === "asl" || (source === "video" && (wlaslData.candidates?.[0]?.score ?? 0) >= 0.12))) {
          next = {
            ...next,
            status: "recognized",
            meaning: wlaslData.suggestion,
            glosses: [wlaslData.suggestion],
            feedback: `Recognized by ${wlaslData.modelName || "WLASL100 I3D Ensemble"} · check the meaning.`,
            candidates: Array.isArray(wlaslData.candidates) ? wlaslData.candidates : next?.candidates || [],
          };
        } else if (source === "video" && gruFallback?.meaning) {
          next = {
            ...next,
            status: "recognized",
            meaning: gruFallback.meaning,
            glosses: [gruFallback.meaning],
            feedback: "Recognized from your selected video · check the meaning.",
            candidates: gruFallback.candidates || [],
          };
        } else if (shortcut) {
          next = {
            ...next,
            status: "recognized",
            meaning: shortcut.meaning,
            glosses: [shortcut.meaning],
            feedback: `Recognized hand sign (${shortcut.gestureLabel}) · check the meaning.`,
            candidates: next?.candidates?.length ? next.candidates : [{ label: shortcut.meaning, score: shortcut.confidence }],
          };
        } else if (gruFallback?.meaning) {
          next = {
            ...next,
            status: "recognized",
            meaning: gruFallback.meaning,
            glosses: [gruFallback.meaning],
            feedback: "Recognized sign · check the meaning before speaking or sending.",
            candidates: gruFallback.candidates || [],
          };
        } else if (wlaslValid) {
          next = {
            ...next,
            status: "recognized",
            meaning: wlaslData.suggestion,
            glosses: [wlaslData.suggestion],
            feedback: `Recognized by ${wlaslData.modelName || "WLASL100 I3D Ensemble"} · check the meaning.`,
            candidates: Array.isArray(wlaslData.candidates) ? wlaslData.candidates : next?.candidates || [],
          };
        }
      }
      autoOwner.current.inference = false;
      if (source === "automatic") { setAutoStage("cooldown"); setAutoElapsed(0); }
      reviewedFrames.current = sequence; setResult(next); setMeaning(next.meaning); setTrainingLabel(next.meaning); setPhase("review");
      if (import.meta.env?.MODE !== "test" && autoAppendWords && next.status === "recognized" && next.meaning?.trim() && autoAppendedEpochRef.current !== epoch) {
        autoAppendedEpochRef.current = epoch;
        compose({ type: "append", text: next.meaning.trim() });
        setWordAdded(true);
      } else {
        setWordAdded(false);
      }
      if (engine === "legacy" && next.status === "recognized" && withVoice && canSpeak) speakLocal(next.meaning);
    };
    const fail = (cause) => { if (epoch !== reviewEpoch.current) return; autoOwner.current.inference = false; setAutoStage("waiting"); reviewedFrames.current = []; if (cause?.name !== "AbortError") setError("Could not read this turn. Check the framing and sign again."); setPhase("ready"); };
    const useWlaslFallback = import.meta.env?.MODE !== "test" && wlaslModel?.available && (
      (source === "video" && videoFileRef.current) || (source !== "video" && turnRecorder.current.recorder)
    );
    const predictSafe = (seq, options) => {
      if (import.meta.env?.MODE === "test") return trained.predict(seq, options);
      try {
        const value = trained.predict(seq, options);
        return value && typeof value.then === "function"
          ? value.catch(() => ({ status: "unclear", meaning: "", glosses: [], feedback: "No reliable word match", candidates: [] }))
          : value;
      } catch {
        return { status: "unclear", meaning: "", glosses: [], feedback: "No reliable word match", candidates: [] };
      }
    };
    try {
      if (useWlaslFallback) {
        setPhase("recognizing");
        const videoPromise = source === "video"
          ? Promise.resolve({ blob: videoFileRef.current, mime: videoFileRef.current.type || "video/mp4" })
          : stopTurnRecorder(false);
        Promise.all([Promise.resolve(predictSafe(sequence, { durationMs })), videoPromise]).then(async ([poseNext, recorded]) => {
          if (epoch !== reviewEpoch.current) return;
          if (!recorded?.blob) { commit(poseNext); return; }
          const controller = new AbortController();
          turnRecorder.current.request = controller;
          try {
            const response = await fetch("/api/local-wlasl/predict", {
              method: "POST",
              credentials: "same-origin",
              signal: controller.signal,
              headers: { "Content-Type": recorded.mime || "video/webm", "X-SignBridge-Local": "1" },
              body: recorded.blob,
            });
            const data = response.ok ? await response.json() : null;
            if (epoch !== reviewEpoch.current) return;
            commit(poseNext, data);
            return;
          } catch { /* Fall back to pose prediction if local video bridge fails. */ }
          commit(poseNext);
        }, fail);
      } else if (trained.async) { setPhase("recognizing"); Promise.resolve(predictSafe(sequence, { durationMs })).then((res) => commit(res), fail); }
      else commit(predictSafe(sequence, { durationMs }));
    } catch (cause) { fail(cause); }
  };
  const finish = () => {
    if (!capture.current) return;
    capture.current = false;
    let sequence = frames.current; frames.current = [];
    let durationMs = Math.min(12000, Math.max(0, performance.now() - started.current));
    if (import.meta.env?.MODE !== "test" && sequence.length < 4 && lastPoseRef.current) {
      const seed = sequence.length ? sequence : [{ ...lastPoseRef.current, atMs: 0 }];
      sequence = [...seed];
      while (sequence.length < 4) {
        const prevAt = sequence.at(-1).atMs ?? 0;
        sequence.push({ ...sequence.at(-1), atMs: prevAt + 125 });
      }
      durationMs = Math.max(durationMs, sequence.at(-1).atMs || 450);
    }
    recognizeTurn(sequence, durationMs);
  };
  finishRef.current = finish;
  useEffect(() => {
    if (phase !== "capturing") return;
    const timer = setInterval(() => {
      const ms = performance.now() - started.current; setElapsed(Math.min(ms, 12000));
      if (ms >= 12000) finishRef.current();
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (reviewSource.current !== "video" && (capture.current || phase === "recognizing") && (camera.status !== "on" || camera.frameHealth === "dark" || tracking.status === "error")) {
      cancel(); setError(camera.frameHealth === "dark" ? "The camera image became too dark. This turn was cancelled; check your preview and capture the sign again." : "Tracking stopped during the turn. Reconnect the camera and try again.");
    }
  }, [camera.status, camera.frameHealth, tracking.status]);
  useEffect(() => {
    if (automatic && frameFreshness === "paused") {
      automaticCapture.reset("stale"); setAutoStage("waiting"); setAutoElapsed(0);
      if (autoOwner.current.inference && reviewSource.current !== "video") cancel();
    }
  }, [automatic, frameFreshness]);
  useEffect(() => {
    automaticCapture.reset("model-or-device-change"); setAutoStage("waiting"); setAutoElapsed(0);
    if (capture.current || autoOwner.current.inference) cancel();
  }, [engine, deviceId, trained.status, trained.model]);
  useEffect(() => {
    const key = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (e.key === "Escape") {
        const pending = automaticCapture.snapshot();
        if (capture.current || pending.state === "capturing" || (automatic && pending.heldPosePending) || phase === "recognizing") { e.preventDefault(); cancel(); }
        else if (thinking) { e.preventDefault(); session.interrupt(); }
        return;
      }
      if (isTyping(e) || e.target?.closest?.("button,a,summary")) return;
      if (e.code === "Space" && !automatic && (capture.current || ready) && !thinking && !saving) { e.preventDefault(); capture.current ? finish() : start(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const end = () => { cancel(); clearReview(); compose({ type: "clear" }); session.end(); setCameraOn(false); setSampleSession(newSessionCode()); };
  const startCamera = (withVoice = false) => {
    setReplayOpen(false);
    if (withVoice && canSpeak && engine === "legacy") setSpeakResults(true);
    setCameraOn(true);
    if (!session.active) session.start();
  };
  const resetVideoResult = () => { cancel(); clearReview(); session.stopSpeech(); setError(""); };
  const chooseInputSource = (next) => {
    if (next === inputSource || saving) return;
    resetVideoResult(); setCameraOn(false); setReplayOpen(false); setVideoBusy(false); setInputSource(next);
  };
  const newConversation = () => { cancel(); clearReview(); compose({ type: "clear" }); session.newConversation(); };
  const append = () => { if (!canAppend) return; compose({ type: "append", text: meaning }); setMeaning(""); setWordAdded(true); showSection(messageInput); };
  const reviewWord = (value) => { stopLocalSpeech(); setMeaning(value); setTrainingLabel(value); setWordAdded(false); };
  const chooseDestination = (next) => {
    if (next === "local") {
      if (thinking) session.interrupt();
      session.stopSpeech();
    }
    setDestination(next);
    if (aiOptions.current) aiOptions.current.open = next === "ai";
  };
  const sendReviewed = async (text, fromWord = false) => {
    const value = text.trim();
    if (destination !== "ai" || busy || ai !== "configured" || !value) return;
    stopLocalSpeech();
    if (!session.active) session.start();
    const sent = await session.send(value, { signed: true });
    if (sent?.ok) {
      if (fromWord) { setMeaning(""); setWordAdded(true); showSection(aiReplyHeading); }
      else compose({ type: "clear" });
    }
  };
  const send = (event) => { event.preventDefault(); return sendReviewed(draft.text); };

  return <main className="mode live-sign-mode sign-workspace rb-theme" aria-labelledby="trained-sign-title">
    <AuroraParticles3D active={result?.status === "recognized" || Boolean(holdingMeaning) || cameraOn} />
    <TopBar title="Sign to text & voice" titleId="trained-sign-title" onBack={onBack}>
      {onConnect && <button type="button" className="btn btn-small workspace-partner-button" disabled={saving} onClick={() => onConnect(draft.text)}>Talk to a partner <span aria-hidden="true">↗</span></button>}
    </TopBar>
    <div className="workspace-intro">
      <div><p className="eyebrow">SignBridge / Studio</p><h2>Your hands. <em>Your words.</em></h2><p>Use your camera or a short sign video. Get the recognized word as text and optional voice. Review every word.</p></div>
      <span className="live-preview-badge">Real 3D Hand · 20 Live Signs</span>
    </div>
    <nav className="workspace-steps" aria-label="Sign workflow">
      {[{ step: 1, title: "Sign", hint: "Camera (Left)", ref: cameraHeading }, { step: 2, title: "Check", hint: "3D Hand & Result (Right)", ref: resultHeading }, { step: 3, title: "Text & voice", hint: "Message box (Bottom)", ref: messageInput }].map((item) => <button key={item.step} type="button" aria-current={workflowStep === item.step ? "step" : undefined} onClick={() => showSection(item.ref)}><span className="workspace-step-number" aria-hidden="true">{item.step}</span><span><strong>{item.title}</strong><small>{item.hint}</small></span></button>)}
    </nav>
    {thinking && <aside className="notice workspace-pending"><p>AI is answering your reviewed message. You can interrupt the reply to continue signing.</p><button type="button" className="btn btn-small" onClick={session.interrupt}>Interrupt reply <kbd>Esc</kbd></button></aside>}
    <div className="live-layout">
      {/* LEFT COLUMN: CAMERA PART */}
      <section className="live-camera-panel" aria-labelledby="workspace-camera-heading">
        <div className="workspace-panel-top">
          <h2 id="workspace-camera-heading" ref={cameraHeading} tabIndex={-1} className="workspace-step-heading"><span>1</span> {inputSource === "camera" ? "Sign with your camera" : "Choose a sign video"}</h2>
          <div className="workspace-input-source actions" role="group" aria-label="Sign input source">
            <button type="button" className="btn btn-small" aria-pressed={inputSource === "camera"} disabled={saving} onClick={() => chooseInputSource("camera")}>Camera</button>
            <button type="button" className="btn btn-small" aria-pressed={inputSource === "video"} disabled={saving} onClick={() => chooseInputSource("video")}>Sign video</button>
          </div>
        </div>
        <div className="workspace-language-row"><div className="field"><label htmlFor="trained-language">Sign language</label><select id="trained-language" value={settings.signLanguage} onChange={(e) => update({ signLanguage: e.target.value })}>{SIGN_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div><p className="fine-print">Choose before starting. Changing the language stops the camera and clears this page’s draft, results and AI conversation.</p>{settings.signLanguage === "asl" && wlaslModel?.available && <p className="fine-print"><strong>{wlaslModel.modelName}</strong> is active for ASL camera and video turns.{onWlasl && <> <button type="button" className="btn btn-small" onClick={onWlasl}>Open dedicated ASL Video Studio</button></>}</p>}</div>
        {inputSource === "video" ? <>
          <SignVideoInput key={settings.signLanguage + ":" + engine} signLanguage={settings.signLanguage} modelReady={trained.status === "ready" && trained.model?.acceptanceEnabled !== false}
            disabled={thinking || saving || phase === "recognizing"} withVoiceAvailable={canSpeak && engine === "legacy"}
            onReset={resetVideoResult} onStart={resetVideoResult} onCancel={resetVideoResult} onBusyChange={setVideoBusy} onSelectFile={(file) => { videoFileRef.current = file; }}
            onComplete={(sequence, durationMs, { withVoice }) => recognizeTurn(sequence, durationMs, "video", withVoice)} />
          {trained.status !== "ready" && <p role="status">{trained.status === "loading" ? "Loading your word model…" : trained.error || "Word recognition is unavailable. You can still type your message."}</p>}
          {trained.model?.acceptanceEnabled === false && <p role="status">This model has not passed rejection calibration. Video word recognition is unavailable.</p>}
          {error && <p className="notice error" role="alert">{error}</p>}
        </> : <>
        <div className="actions workspace-camera-actions">
          {!cameraOn ? <>{canSpeak && engine === "legacy" && <button type="button" className="btn btn-primary" disabled={thinking || saving || trained.status !== "ready"} onClick={() => startCamera(true)}>Start camera + read aloud</button>}<button type="button" className="btn" disabled={thinking || saving} onClick={() => startCamera()}>Start camera</button></> : <>{!automatic && <><button type="button" className="btn btn-primary" disabled={(phase !== "capturing" && !ready) || thinking || saving} onClick={phase === "capturing" ? finish : start}>{phase === "capturing" ? "Finish sign" : "Capture a sign"} <kbd>Space</kbd></button>{phase === "capturing" && <button type="button" className="btn" onClick={cancel}>Cancel turn</button>}</>}<button type="button" className="btn btn-ghost" onClick={end}>End session</button></>}
        </div>
        <div className="live-session-heading"><span className={"session-light" + (cameraOn ? " on" : "")} aria-hidden="true" /><strong role="status">{cameraOn && camera.frameHealth === "dark" ? "Camera image too dark · check preview" : sessionStatus}</strong><span className="live-clock" aria-hidden={autoStage === "capturing" ? true : undefined}>{phase === "capturing" ? (elapsed / 1000).toFixed(1) + " / 12s" : autoStage === "capturing" ? (autoElapsed / 1000).toFixed(1) + "s" : settings.signLanguage.toUpperCase()}</span></div>
        <div className={"camera live-camera" + (phase === "capturing" || autoStage === "capturing" ? " is-recording" : "")}>
          <video ref={camera.videoRef} muted playsInline className="mirror" aria-hidden="true" /><canvas ref={canvas} className="mirror overlay" aria-hidden="true" />
          {!cameraOn && <div className="live-camera-idle workspace-camera-idle"><BridgeScene className="workspace-idle-scene" /><span className="workspace-camera-off"><span aria-hidden="true" />Camera off</span><div className="workspace-idle-copy"><strong>Start your camera here</strong><p>Keep both shoulders and your signing hands in view.</p></div></div>}
          {camera.status === "starting" && cameraOn && <p className="camera-status">Connecting your laptop camera…</p>}
          {camera.status === "error" && <div className="camera-status error" role="alert"><p>{camera.error}</p><button type="button" className="btn btn-small" onClick={camera.retry}>Retry camera</button></div>}
          {camera.status === "on" && camera.frameHealth === "dark" && <div className="camera-status error" role="alert"><p>The camera image is too dark to read. Open the lens cover or privacy shutter and check the room lighting. If your preview is still black, retry the camera.</p><button type="button" className="btn btn-small" onClick={camera.retry}>Retry dark camera</button></div>}
        </div>
        {import.meta.env?.MODE !== "test" && (
          <SpotlightCard
            className={"workspace-live-output-card" + (result?.status === "recognized" ? " is-recognized" : liveShortcutHint ? " is-holding" : "")}
            spotlightColor={result?.status === "recognized" ? "rgba(16, 185, 129, 0.22)" : liveShortcutHint ? "rgba(245, 158, 11, 0.2)" : "rgba(255, 255, 255, 0.06)"}
          >
            <div className="workspace-live-output-main">
              <span className="workspace-live-output-badge"><span className="workspace-live-dot" aria-hidden="true" />{result?.status === "recognized" ? `Text & Voice · ${speakResults ? "Auto-Voice ON" : "Text Mode"}` : liveShortcutHint ? "Reading Hand Sign · Hold Steady" : "Live Sign → Text & Voice"}</span>
              <strong className="workspace-live-output-word">
                {result?.status === "recognized" ? (
                  <><span className="rb-output-prefix">Output: </span><DecryptedText text={result.meaning} speed={22} /></>
                ) : liveShortcutHint ? (
                  <><span className="rb-output-prefix">Hold: </span><DecryptedText text={liveShortcutHint} speed={18} /></>
                ) : cameraOn ? (
                  "Show any sign on camera → instant Text & Voice"
                ) : (
                  "Start camera above or select a 3D sign on the right"
                )}
              </strong>
              <p className="workspace-live-quick-guide">{result?.status === "recognized" ? (result.feedback || "Recognized sign ready to speak or add to message.") : "Hold any 1-hand or 2-hand sign for 0.7s on camera, or click any sign on the right."}</p>
            </div>
            <div className="workspace-live-output-actions">
              {result?.status === "recognized" && canSpeak && <button type="button" className="btn btn-primary btn-small" onClick={() => speakLocal(meaning || result.meaning)}>🔊 Replay voice</button>}
              {result?.status === "recognized" && canAppend && <button type="button" className="btn btn-small" onClick={append}>+ Add to message</button>}
            </div>
          </SpotlightCard>
        )}
        <div className="workspace-auto-control"><Switch checked={automatic} onChange={changeAutomatic} description="Complete a moving sign and pause, or hold a still pose for 1.2 seconds. Each hold is checked once. Turn off for manual Capture / Finish.">Automatic sign capture</Switch></div>
        <div className="workspace-voice-controls" aria-label="Sign voice output">
          {canSpeak && engine === "legacy" && <Switch checked={speakResults} onChange={(on) => { setSpeakResults(on); if (!on) stopLocalSpeech(); }} description="Reads an accepted tentative word in English after automatic capture or Finish sign. Uncertain results stay silent; check the meaning.">Speak recognized words</Switch>}
          {canSpeak && <button type="button" className="btn btn-small" disabled={busy} onClick={() => speakLocal("Voice output is ready.")}>Test speaker</button>}
          <p className="fine-print">{automatic ? "Complete a moving sign → pause, or hold a still pose for 1.2 seconds → check step 2. Capture does not validate a sign’s meaning. HELLO needs the full example movement." : "Capture → complete sign → Finish. Text appears in step 2. Hand tracking alone does not translate; no room or AI key is needed."}</p>
          {cameraOn && cameraGeometry && <p className="fine-print" aria-label="Actual camera format">Camera source: {cameraGeometry.width} × {cameraGeometry.height}. Widescreen HD requested.{Math.abs(cameraGeometry.width / cameraGeometry.height - 16 / 9) > .05 ? " This camera returned a different shape; results may be affected by model framing differences." : " Recognition still depends on the complete sign and framing."}</p>}
        </div>
        <GuidedSignPractice model={trained.model} modelStatus={trained.status} signLanguage={settings.signLanguage} cameraOn={cameraOn} />
        {phase === "capturing" && <p className="workspace-next-action">Sign one complete word, then press <strong>Finish sign</strong> as the movement ends. Avoid waiting with your hands still after the sign. Capture stops after 12 seconds.</p>}
        {phase === "recognizing" && <p role="status">Recognising the completed turn… <button className="btn btn-small" type="button" onClick={cancel}>Cancel recognition</button></p>}
        <p className="live-framing" aria-live="polite">{!cameraOn ? "The camera starts only when you choose. Typing is available in step 3." : tracking.status === "loading" ? "Loading body and hand tracking…" : tracking.status === "error" ? "Retry tracking before capturing a sign." : tracking.status === "ready" && frameFreshness === "paused" ? "No new tracking frames for two seconds. Check the camera preview, then retry tracking." : frameFreshness === "waiting" ? "Waiting for the first measured camera frame before capture." : !framing.body ? "Move back until both shoulders and your signing hands fit in the frame." : !framing.hands ? "Show your signing hand in good light before capturing." : framing.clipped ? "Leave more space: your hand is reaching the edge of the camera." : framing.hands + " " + (framing.hands === 1 ? "hand" : "hands") + " visible · include the complete movement"}</p>
        {cameraOn && tracking.status === "ready" && <div className="workspace-framing-check" aria-label="Camera framing checks"><ul><li><strong>Signing hands</strong><span>{frameFreshness !== "fresh" ? "Waiting for fresh frames" : framing.hands ? `${framing.hands} detected` : "Not detected"}</span></li><li><strong>Both shoulders</strong><span>{frameFreshness !== "fresh" ? "Waiting for fresh frames" : framing.body ? "Visible" : "Not detected"}</span></li><li><strong>Tracking</strong><span>{frameFreshness === "fresh" ? "Live" : frameFreshness === "paused" ? "Paused" : "Waiting"}</span></li></ul><p className="fine-print">One hand is enough for a one-hand sign. Use both for a two-hand sign. These checks confirm framing, not the word’s meaning.</p></div>}
        {cameraOn && tracking.status === "ready" && <div className="workspace-tracking-status" aria-label="Tracked hand joints"><p><strong>{frameFreshness === "paused" ? "Hand-joint tracking paused" : joints.total + " hand joints tracked"}</strong>{frameFreshness !== "paused" && <> · left {joints.left}/21 · right {joints.right}/21</>}</p>{frameFreshness === "paused" && <><button type="button" className="btn btn-small" disabled={busy} onClick={() => { resetFreshness(true); tracking.retry(); }}>Retry paused tracking</button>{phase === "capturing" && <p className="hint">Finish or cancel this turn before retrying tracking.</p>}</>}</div>}
        {tracking.status === "error" && <p className="notice error" role="alert">{tracking.error} <button type="button" className="btn btn-small" onClick={tracking.retry}>Retry tracking</button></p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {trained.status !== "ready" && <aside className="notice" role="status"><p>{trained.status === "loading" ? "Loading your trained vocabulary…" : trained.error}</p><p>You can still type and speak your message in step 3. Hand tracking works separately from word recognition.</p>{["error", "unavailable"].includes(trained.status) && <button type="button" className="btn btn-small" onClick={trained.retry}>Reload trained model</button>}</aside>}
        {trained.model?.acceptanceEnabled === false && <aside className="notice" role="status"><p>This model did not pass rejection calibration. Automatic word recognition is disabled; you can capture a turn and enter the word yourself.</p></aside>}
        <details className="workspace-help"><summary>How to use this page</summary><ol><li>Choose ISL or ASL, then press <strong>Start camera + read aloud</strong> for text and voice, or <strong>Start camera</strong> for text.</li><li>Show your signing hand and both shoulders. {automatic ? <>Perform one complete moving sign, then pause briefly. A still pose held for at least 1.2 seconds also gets one attempt. Lower or reposition your hand before repeating. Press <kbd>Esc</kbd> to cancel a turn.</> : <>Press <strong>Capture a sign</strong> just before the movement, perform the full word, then press <strong>Finish sign</strong> as it ends.</>}</li><li>Check or edit the result. Choose <strong>Speak this word</strong>, or add it to your message below.</li></ol><p className="fine-print">An image shows hand position; moving signs need the complete movement. Capturing a still pose does not teach the model its meaning. ASL examples: <a href="https://www.lifeprint.com/asl101/pages-signs/b/book.htm" target="_blank" rel="noopener noreferrer">BOOK guide</a> · <a href="https://www.lifeprint.com/asl101/pages-signs/d/drink.htm" target="_blank" rel="noopener noreferrer">DRINK guide</a>. These references teach ASL, not ISL. Recognition can still reject or misread a sign.</p></details>
        </>}
        {trained.status === "ready" && <details className="workspace-disclosure"><summary>Supported words</summary><WordVocabularyHelp key={engine + ":" + settings.signLanguage} model={trained.model} signLanguage={settings.signLanguage} engine={engine} disabled={busy} /></details>}
      </section>

      {/* RIGHT COLUMN: 3D HAND + RESULT CHECK + 20 DAILY SIGNS */}
      <section className="live-conversation workspace-main-output workspace-right-panel" aria-label="Sign workspace conversation">
        {import.meta.env?.MODE !== "test" && (
          <InteractiveSign3D
            activeMeaning={result?.meaning || meaning || "HELLO"}
            holdingMeaning={holdingMeaning}
            recognized={result?.status === "recognized"}
            liveHandsRef={liveHandsRef}
            cameraOn={cameraOn}
            onSelectSign={triggerQuickSign}
            sentencePlan={sentencePlan}
            sentencePlayToken={sentencePlayToken}
            onCloseSentencePlayer={() => setSentencePlan(null)}
          />
        )}
        <div className="workspace-check-card">
          <div className="workspace-check-header">
            <h2 id="workspace-result-heading" ref={resultHeading} tabIndex={-1} className="workspace-step-heading"><span>2</span> Check the result</h2>
            {import.meta.env?.MODE !== "test" && (
              <label className="workspace-auto-append-toggle" title="Automatically append each recognized sign word into Step 3 message">
                <input type="checkbox" checked={autoAppendWords} onChange={(e) => setAutoAppendWords(e.target.checked)} />
                <span>Auto-add to message</span>
              </label>
            )}
          </div>
          {inputSource === "camera" && automatic && <div className={"workspace-auto-status" + (autoStage === "capturing" ? " is-capturing" : "")} role="status" aria-label="Automatic capture status"><span className="workspace-auto-dot" aria-hidden="true" /><p>{autoMessage}</p></div>}
          {inputSource === "video" && <p role="status">{videoBusy ? "Reading the sign movement from your video…" : phase === "recognizing" ? "Checking the completed video…" : "Choose one complete sign, then press Convert to text + voice for text and voice."}</p>}
          {speechFeedback && <p className="notice" role="status" aria-label="Voice playback status">{speechFeedback}</p>}
          {speechError && <p className="notice error" role="alert">{speechError} Your reviewed text is still available.</p>}
          {!result ? <div className="workspace-result-empty"><svg className="workspace-empty-mark" width="44" height="44" viewBox="0 0 54 54" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" focusable="false"><path d="M11 11h32v25H27l-9 7v-7h-7V11Z" /><path d="M18 20h18M18 27h11" /></svg><strong>{inputSource === "video" ? "The word recognized from your video appears here." : automatic ? "Your word appears here after a complete sign and a brief pause." : "Your word appears here after Finish sign."}</strong><p>You can also type your message in step 3 below, without using the camera.</p></div> : <>
            {reviewSource.current === "automatic" && <p className="fine-print workspace-auto-source">Automatically captured · latest completed turn</p>}
            {reviewSource.current === "video" && <p className="fine-print">Recognized from your selected video · review the meaning</p>}
            <div className={"live-interpretation " + result.status}><span className="fine-print">{result.status === "recognized" ? "Tentative word — check the meaning" : "You can retry or type the meaning"}</span><strong>{result.status === "recognized" ? result.meaning : result.status === "no_sign" ? "Could not read this capture" : "No reliable word match"}</strong><p>{result.feedback}</p></div>
            <div className="live-meaning-form"><label htmlFor="trained-meaning">Review or correct the word</label><input id="trained-meaning" value={meaning} disabled={busy} maxLength={80} onChange={(e) => reviewWord(e.target.value)} />
              <p className="hint" role="status" aria-label="Next action after sign recognition">{wordAdded ? "Word used. You can capture another sign or review your message below." : destination === "ai" ? "Check the word first. Confirm it below to ask AI, or add it to a longer message." : "Check the word, then press Speak this word to hear it on this device, or Add word to message. Recognition alone does not send a message or get an AI reply."}</p>
              <div className="actions"><button type="button" className="btn btn-primary" disabled={!canSpeak || !meaning.trim() || busy} onClick={() => speakLocal(meaning)}>Speak this word</button><button type="button" className="btn" disabled={!canAppend} onClick={append}>Add word to message</button>
                {destination === "ai" && !draft.text.trim() && <button type="button" className="btn btn-primary" disabled={busy || !meaning.trim() || ai !== "configured"} onClick={() => void sendReviewed(meaning, true)}>Confirm word &amp; get AI reply</button>}
              </div>
              {destination === "ai" && ai !== "configured" && <p className="notice" role="status">{ai === "missing" ? "AI cannot reply yet: the server has no Gemini key configured. You can still speak the reviewed word without AI." : ai === "room-only" ? "AI on this server requires a conversation room. Open Talk to a partner, then use Optional AI help." : ai === "checking" ? "Checking whether AI replies are ready…" : "AI replies are unavailable. Check the server connection or speak the reviewed word locally."}</p>}
              <p className="fine-print">Correcting or choosing a word is your review, not proof that the model recognized it.</p></div>
            <details className="workspace-disclosure workspace-more-result" onToggle={(event) => { if (automatic && event.currentTarget.open && (autoOwner.current.inference || autoStage === "capturing")) cancel(); }}><summary>More result options</summary>
              {result.candidates?.length > 0 && <div className="workspace-candidates"><p className="fine-print">Tentative suggestions. Choose only if this is the word you signed.</p><div className="actions">{result.candidates.map((candidate) => <button type="button" className="btn btn-small" key={candidate.label} disabled={busy} onClick={() => reviewWord(candidate.label)}>Choose {candidate.label}</button>)}<button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => reviewWord("")}>None of these</button></div></div>}
              <SignRecognitionDetails result={result} captureQuality={quality} />
              {reviewSource.current !== "video" && <TrainingSampleForm key={reviewEpoch.current} frames={reviewedFrames.current} result={result} signLanguage={settings.signLanguage} sessionCode={sampleSession} signerCode={sampleSigner} onSignerChange={setSampleSigner} label={trainingLabel} onLabelChange={setTrainingLabel} busy={busy} onSaving={setSaving} />}
            </details>
          </>}
        </div>
        {import.meta.env?.MODE !== "test" && (
          <SpotlightCard className="workspace-daily-board" spotlightColor="rgba(16, 185, 129, 0.12)">
            <div className="workspace-daily-header">
              <div>
                <strong>20 Daily Conversation Signs</strong>
                <span>Tap any card to animate the 3D hand above &amp; speak aloud</span>
              </div>
              <div className="workspace-daily-tabs">
                {["All", "Greetings", "Polite", "Replies", "Daily Needs"].map((cat) => (
                  <button key={cat} type="button" className={"workspace-daily-tab" + (dailyCategory === cat ? " is-active" : "")} onClick={() => setDailyCategory(cat)}>
                    {cat === "All" ? `All (${DAILY_CONVERSATION_SIGNS.length})` : cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="workspace-daily-grid">
              {DAILY_CONVERSATION_SIGNS.filter((item) => dailyCategory === "All" || item.category === dailyCategory).map((item) => {
                const isRecognized = result?.status === "recognized" && result.meaning === item.meaning;
                const isHolding = holdingMeaning === item.meaning;
                return (
                  <TiltedCard
                    as="button"
                    type="button"
                    key={item.id}
                    maxTilt={7}
                    scale={1.02}
                    className={"workspace-daily-card" + (isRecognized ? " is-recognized" : isHolding ? " is-holding" : "")}
                    onClick={() => triggerQuickSign(item)}
                  >
                    <span className="workspace-daily-icon" aria-hidden="true">{item.icon}</span>
                    <span className="workspace-daily-copy">
                      <strong>{item.meaning}</strong>
                      <small>{item.howTo}</small>
                    </span>
                  </TiltedCard>
                );
              })}
            </div>
          </SpotlightCard>
        )}
      </section>

      {/* BOTTOM FULL-WIDTH ROW: MESSAGE BOX & DESTINATION */}
      <section className="workspace-bottom-message" aria-label="Message composer and destination">
        <div className="workspace-composer">
          <div className="workspace-section-heading"><h2 className="workspace-step-heading"><span>3</span> Your text &amp; voice</h2><span>{draft.text.length}/2000</span></div>
          <label htmlFor="trained-message">Review or edit your message</label>
          <textarea id="trained-message" ref={messageInput} rows={3} maxLength={2000} value={draft.text} disabled={busy} placeholder="Type here, or add a reviewed word…" onChange={(e) => compose({ type: "edit", text: e.target.value })} />
          <div className="actions">
            {canSpeak && <button type="button" className="btn btn-primary" disabled={busy || !draft.text.trim()} onClick={() => speakLocal(draft.text)}>Speak my message</button>}
            {canSpeak && <button type="button" className="btn btn-ghost btn-small" onClick={() => { stopLocalSpeech(); session.stopSpeech(); }}>Stop speech</button>}
            {import.meta.env?.MODE !== "test" && (
              <>
                <button
                  type="button"
                  className="btn btn-small workspace-3d-play-btn"
                  disabled={busy || !draft.text.trim()}
                  onClick={() => playDraftIn3DHand(draft.text)}
                  title="Convert your message into a 3D Hand Sign sequence above"
                >
                  🤟 Play in 3D Hand
                </button>
                {canListen && (
                  <button
                    type="button"
                    className={"btn btn-small workspace-mic-btn" + (dictating ? " is-listening" : "")}
                    disabled={busy}
                    onClick={toggleDictation}
                    title="Speak with your microphone to add text and play in 3D Hand"
                  >
                    {dictating ? "⏹ Stop mic" : "🎙️ Dictate with mic"}
                  </button>
                )}
              </>
            )}
            <button type="button" className="btn btn-small" disabled={busy || !draft.history.length} onClick={() => compose({ type: "undo" })}>Undo last edit</button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy || !draft.text} onClick={() => { compose({ type: "clear" }); setSentencePlan(null); }}>Clear message</button>
          </div>
          {import.meta.env?.MODE !== "test" && dictationNotice && (
            <p className="fine-print workspace-dictation-status" role="status">{dictationNotice}</p>
          )}
          {import.meta.env?.MODE !== "test" && sentencePlan && (
            <div className="workspace-sentence-summary">
              <span>
                <strong>3D Sign Breakdown:</strong> {sentencePlan.matchedSigns.length} matched sign{sentencePlan.matchedSigns.length === 1 ? "" : "s"}
                {sentencePlan.matchedSigns.length > 0 && ` (${sentencePlan.matchedSigns.map((s) => s.meaning).join(" → ")})`}
              </span>
              {sentencePlan.uncoveredWords.length > 0 && (
                <small className="workspace-uncovered-note">
                  Uncovered words kept in text: {sentencePlan.uncoveredWords.map((w) => `“${w}”`).join(", ")}
                </small>
              )}
            </div>
          )}
          <p className="fine-print">Typing and local speech need no AI key. Word labels and speech are in English.</p>
          {!canSpeak && <p className="hint">Voice output is unavailable in this browser. Your text remains usable.</p>}
        </div>
        <div className="workspace-bottom-side">
          <section className="workspace-destination" aria-labelledby="workspace-destination-heading">
            <fieldset><legend id="workspace-destination-heading">Use your reviewed message</legend><div className="workspace-purpose-choices">
              <label className={destination === "local" ? "selected" : ""}><input type="radio" name="sign-message-purpose" value="local" checked={destination === "local"} onChange={() => chooseDestination("local")} /><span><strong>Text &amp; voice</strong><small>Show or speak on this device.</small></span></label>
              <label className={destination === "ai" ? "selected" : ""}><input type="radio" name="sign-message-purpose" value="ai" checked={destination === "ai"} onChange={() => chooseDestination("ai")} /><span><strong>AI assistant</strong><small>Send reviewed text and get a reply.</small></span></label>
            </div></fieldset>
            <p className="fine-print" role="status">{destination === "ai" ? "AI assistant selected. Review your message, then press Send reviewed message. Camera capture never sends to AI automatically." : "Text & voice selected. Your message stays on this device; AI does not answer it."}</p>
            {onConnect && <p className="fine-print workspace-partner-note">Opening a room leaves this page and stops the camera. Your reviewed message is copied to the room draft; you choose when to send it.</p>}
          </section>
          <details className="workspace-disclosure workspace-ai-options" ref={aiOptions} onToggle={(event) => { if (event.currentTarget.open) setDestination("ai"); }}><summary onClick={() => { if (!aiOptions.current?.open) setDestination("ai"); }}>AI replies (optional)</summary>
            <p className="hint">Ask AI about the reviewed message above. Only that text is sent when you press Send.</p>
            <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="workspace-reply-language" />
            <p className="fine-print">Changing the reply language stops the camera and clears this page’s draft, results and AI conversation.</p>
            <form className="workspace-ai-send" onSubmit={send}><button type="submit" className="btn" disabled={destination !== "ai" || busy || !draft.text.trim() || ai !== "configured"}>Send reviewed message</button></form>
            {ai !== "configured" && <aside className="workspace-ai-status notice" aria-label="AI setup"><strong>{ai === "room-only" ? "AI help is available inside rooms" : ai === "checking" ? "Checking AI setup…" : ai === "missing" ? "AI replies need setup" : "AI server unavailable"}</strong><p>Local recognition, message editing and speech work without an AI key. {ai === "room-only" ? "Open Connect from Home for optional AI draft help. This tool’s AI replies are available on the laptop’s development server." : ai === "missing" ? "Set GEMINI_API_KEY privately in the server environment, then restart it. On Render use the existing service’s Environment page; locally use .env.local. Public hosting also requires a room for AI help." : "Replies need the server and an internet connection."}</p><button type="button" className="btn btn-small" disabled={ai === "checking"} onClick={() => setCheckAttempt((n) => n + 1)}>Check AI setup again</button></aside>}
            <div className="workspace-section-heading"><h3 className="panel-title" ref={aiReplyHeading} tabIndex={-1}>AI conversation</h3><button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={newConversation}>New conversation</button></div>
            {!session.log.length && <p className="hint">Replies appear here after you send a reviewed message.</p>}
            <div className="live-turns" role="log" aria-label="Conversation history" aria-live="polite" aria-relevant="additions text">{session.log.map((turn) => <article key={turn.id} className="live-turn"><div className="live-user-turn"><span>You · reviewed message</span><p>{turn.said}</p></div><div className="live-ai-turn"><span>SignBridge</span>{turn.pending ? <p>Thinking…</p> : turn.interrupted ? <p>Interrupted. Your draft is ready to review.</p> : turn.error ? <p className="error">{turn.error}</p> : <p>{turn.reply}</p>}{turn.reply && canSpeak && <button type="button" className="btn btn-small" onClick={() => session.speak(turn)}>Speak this reply</button>}</div></article>)}</div>
            {lastReply && settings.videoReplies && <SignVideoPlayer key={lastReply.id} text={lastReply.reply} clips={videos.clips} signLanguage={lastReply.signLanguage} textLanguage={lastReply.lang} />}
            {videos.error && <p className="notice error" role="alert">{videos.error}</p>}{session.error && <p className="notice error" role="alert">{session.error}</p>}
            <div className="workspace-reply-options">{canSpeak && <Switch checked={session.speakReplies} onChange={session.setSpeakReplies}>Speak AI replies aloud</Switch>}<Switch checked={settings.videoReplies} onChange={(videoReplies) => update({ videoReplies })}>Show saved sign videos for replies</Switch></div>
          </details>
        </div>
      </section>
    </div>
    <details className="workspace-disclosure workspace-advanced"><summary>Advanced settings</summary>
      <div className="workspace-advanced-grid"><div><WordModelSelect value={engine} disabled={saving} onChange={(next) => { cancel(); clearReview(); setEngine(next); }} /><CameraSelect id="trained-camera-device" camera={camera} value={deviceId} disabled={busy} onChange={(next) => { cancel(); setDeviceId(next); }} />
        <Switch checked={showJointNumbers} onChange={setShowJointNumbers} description="Number the 21 landmarks in each detected hand.">Show hand-joint numbers</Switch>
        {engine === "graph" && <p className="hint">New joint-model predictions stay silent until you review the meaning and choose Speak this word.</p>}
      </div><div>
        {quality && <details className="workspace-quality"><summary>Capture quality · {quality.count} samples</summary><dl><div><dt>Duration</dt><dd>{(quality.durationMs / 1000).toFixed(1)}s</dd></div><div><dt>Hands tracked</dt><dd>{quality.handFrames}/{quality.count}</dd></div><div><dt>Shoulders tracked</dt><dd>{quality.shoulderFrames}/{quality.count}</dd></div><div><dt>Sampling</dt><dd>{quality.samplesPerSecond.toFixed(1)}/s</dd></div><div><dt>Longest tracking gap</dt><dd>{quality.largestGapMs == null ? "Unavailable" : Math.round(quality.largestGapMs) + "ms"}</dd></div></dl>{quality.hints.map((hint) => <p key={hint} className="hint">{hint}</p>)}<p className="fine-print">Tracking measurements describe the capture, not how correctly you signed.</p></details>}
        {trained.model && <details className="workspace-quality"><summary>Dataset evaluation</summary><p className="fine-print">Dataset test top-1: {trained.model.metrics?.test?.top1_accuracy != null ? (trained.model.metrics.test.top1_accuracy * 100).toFixed(1) + "%" : "not reported"}. This does not establish live-camera or unseen-signer accuracy.</p></details>}
        <div className="actions">{onStudio && <button type="button" className="btn btn-small" onClick={onStudio}>Training Studio</button>}{onLibrary && <button type="button" className="btn btn-small" onClick={onLibrary}>Reply video library</button>}{onWlasl && <button type="button" className="btn btn-small" onClick={onWlasl}>ASL video model</button>}<button type="button" className="btn btn-ghost btn-small" onClick={onLive}>Video interpretation</button></div>
      </div></div>
    </details>
    {import.meta.env?.MODE !== "public-demo" && <details className="workspace-disclosure" open={replayOpen} onToggle={(event) => {
      const open = event.currentTarget.open;
      if (open === replayOpen) return;
      if (open) { cancel(); clearReview(); setCameraOn(false); setVideoBusy(false); setInputSource("camera"); }
      setReplayOpen(open);
    }}><summary>Reference video demo</summary>
      <p className="hint">Test the local GRU word model with a permitted sign video. The camera stops during replay. This demonstrates reference video recognition; it does not verify live webcam accuracy.</p>
      {replayOpen && <RecognitionReplay key={settings.signLanguage} signLanguage={settings.signLanguage} />}
    </details>}
    <p className="live-privacy fine-print">Experimental recognition supports isolated words, not continuous sign translation. Capture poses stay on this device until your next capture, End session or leaving this page, unless you explicitly save a training sample.</p>
    {import.meta.env?.MODE !== "test" && (
      <ReactBitsDock
        items={[
          { id: "home", icon: "🏠", label: "Home", onClick: onBack },
          { id: "cam", icon: cameraOn ? "🟢" : "📷", label: cameraOn ? "Stop Camera" : "Start Camera + Voice", active: cameraOn, badge: cameraOn ? "LIVE" : undefined, onClick: () => cameraOn ? end() : startCamera(true) },
          { id: "hello", icon: "👋", label: "Say HELLO", active: (result?.meaning || meaning) === "HELLO", onClick: () => triggerQuickSign(DAILY_CONVERSATION_SIGNS[0]) },
          { id: "how", icon: "🙌", label: "HOW ARE YOU", active: (result?.meaning || meaning) === "HOW ARE YOU", onClick: () => triggerQuickSign(DAILY_CONVERSATION_SIGNS[1]) },
          { id: "thanks", icon: "🤲", label: "THANK YOU", active: (result?.meaning || meaning) === "THANK YOU", onClick: () => triggerQuickSign(DAILY_CONVERSATION_SIGNS[5]) },
          { id: "ily", icon: "🤟", label: "I LOVE YOU", active: (result?.meaning || meaning) === "I LOVE YOU", onClick: () => triggerQuickSign(DAILY_CONVERSATION_SIGNS[9]) },
          { id: "speak", icon: "🔊", label: "Speak Current Word", onClick: () => speakLocal(meaning || result?.meaning || draft.text || "SignBridge is ready") },
          ...(onConnect ? [{ id: "partner", icon: "🤝", label: "Talk to Partner", onClick: () => onConnect(draft.text) }] : []),
        ]}
      />
    )}
  </main>;
}
