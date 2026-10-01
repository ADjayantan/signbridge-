import { useCallback, useEffect, useRef, useState } from "react";
import { LanguageSelect, Switch, TopBar, isTyping } from "../components/Controls.jsx";
import { useCamera } from "../hooks/useCamera.js";
import { useVoiceAssistant } from "../hooks/useVoiceAssistant.js";
import { language } from "../lib/languages.js";
import { canListen, canSpeak } from "../lib/speech.js";

const STATUS_TEXT = {
  idle: { label: "Press Space to talk", hint: "or tap here" },
  listening: { label: "Listening…", hint: "Press Space when you're done" },
  thinking: { label: "Thinking…", hint: "Press Space to ask something else" },
  speaking: { label: "Speaking…", hint: "Press Space to interrupt" },
};

function captureFrame(video) {
  if (!video?.videoWidth) return null;
  const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export default function VoiceMode({ settings, update, onBack }) {
  const [cameraOn, setCameraOn] = useState(false);
  const [typed, setTyped] = useState("");
  const micRef = useRef(null);
  const { videoRef, status: cameraStatus, error: cameraError, retry: retryCamera } = useCamera({
    active: cameraOn,
    facingMode: "environment",
  });

  const captureImage = useCallback(
    () => (cameraStatus === "on" ? captureFrame(videoRef.current) : null),
    [cameraStatus, videoRef],
  );

  const assistant = useVoiceAssistant({
    lang: settings.lang,
    rate: settings.rate,
    handsFree: settings.handsFree,
    voiceOutput: settings.voiceOutput,
    captureImage,
  });
  const { status, toggle, cancel, repeat, notify } = assistant;

  useEffect(() => {
    document.title = "Voice mode · SignBridge";
    micRef.current?.focus();
  }, []);

  const setCamera = useCallback(
    (on) => {
      setCameraOn(on);
      notify(on ? "Camera on. Ask what's in front of you." : "Camera off.");
    },
    [notify],
  );

  const setHandsFree = useCallback(
    (on) => {
      update({ handsFree: on });
      notify(on ? "Hands-free on. I'll listen again after each answer." : "Hands-free off.");
    },
    [notify, update],
  );

  const changeRate = useCallback(
    (delta) => {
      const rate = Math.round(Math.min(2.5, Math.max(0.5, settings.rate + delta)) * 10) / 10;
      update({ rate });
    },
    [settings.rate, update],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if (isTyping(e)) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      const onControl = e.target instanceof HTMLElement && ["BUTTON", "A", "SUMMARY"].includes(e.target.tagName);
      switch (e.key) {
        case " ":
          if (onControl) return; // the focused button handles Space itself
          e.preventDefault();
          toggle();
          break;
        case "Escape":
          e.preventDefault();
          cancel();
          break;
        case "r":
        case "R":
          repeat();
          break;
        case "c":
        case "C":
          setCamera(!cameraOn);
          break;
        case "h":
        case "H":
          setHandsFree(!settings.handsFree);
          break;
        case "+":
        case "=":
          changeRate(0.1);
          break;
        case "-":
        case "_":
          changeRate(-0.1);
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraOn, cancel, changeRate, repeat, setCamera, setHandsFree, settings.handsFree, toggle]);

  const submitTyped = (e) => {
    e.preventDefault();
    if (!typed.trim()) return;
    assistant.ask(typed);
    setTyped("");
  };

  const text = STATUS_TEXT[status];
  const langName = language(settings.lang).name;

  return (
    <main className="mode voice-mode" aria-labelledby="voice-title">
      <TopBar title="Voice mode" titleId="voice-title" onBack={onBack}>
        <LanguageSelect value={settings.lang} onChange={(lang) => update({ lang })} id="voice-language" />
      </TopBar>

      <section className="voice-stage" aria-label="Talk to SignBridge">
        <button
          ref={micRef}
          type="button"
          className={`mic mic-${status}`}
          onClick={toggle}
          aria-describedby="voice-keys"
          disabled={!canListen}
        >
          <span className="mic-icon" aria-hidden="true">
            {status === "speaking" ? "🔊" : status === "thinking" ? "💭" : "🎙️"}
          </span>
          <span className="mic-label">{canListen ? text.label : "Voice input isn't available"}</span>
          {canListen && <span className="mic-hint">{text.hint}</span>}
        </button>
        <p className="transcript" aria-hidden="true">
          {assistant.interim || " "}
        </p>
        <div className={`voice-camera${cameraOn ? " on" : ""}`}>
          <video ref={videoRef} muted playsInline aria-hidden="true" />
          {cameraStatus === "starting" && <p className="camera-status">Starting camera…</p>}
          {cameraStatus === "error" && (
            <div className="camera-status error" role="alert">
              <p>{cameraError}</p>
              <button type="button" className="btn btn-small" onClick={retryCamera}>
                Try again
              </button>
            </div>
          )}
        </div>
        <p id="voice-keys" className="keys">
          <kbd>Space</kbd> talk / interrupt · <kbd>Esc</kbd> stop · <kbd>R</kbd> repeat · <kbd>C</kbd> camera ·{" "}
          <kbd>H</kbd> hands-free · <kbd>+</kbd>/<kbd>−</kbd> speed
        </p>
      </section>

      {!canListen && (
        <p className="notice warning">
          This browser can't turn speech into text. Use Chrome or Edge for voice input, or type below.
        </p>
      )}
      {!canSpeak && <p className="notice warning">This browser can't speak. Replies will appear as text.</p>}
      {assistant.voiceMissing && settings.voiceOutput === "voice" && (
        <p className="notice warning">
          No {langName} voice is installed in this browser, so replies may sound wrong. Microsoft Edge has natural Indian
          voices, or add a {langName} speech voice in your system settings.
        </p>
      )}
      {assistant.error && (
        <p className="notice error" role="alert">
          {assistant.error}
        </p>
      )}

      <section className="log" aria-label="Conversation">
        {assistant.messages.length === 0 ? (
          <p className="empty">
            Try: “What can you do?”, “Tell me a short story”, or turn on the camera (<kbd>C</kbd>) and ask “What’s in
            front of me?”
          </p>
        ) : (
          assistant.messages.map((m) => (
            <article key={m.id} className={`msg msg-${m.role}${m.error ? " msg-error" : ""}`}>
              <h2 className="msg-who">{m.role === "user" ? "You" : "SignBridge"}</h2>
              <p lang={m.role === "assistant" ? language(settings.lang).bcp47 : undefined}>
                {m.text || (m.pending ? "…" : "")}
              </p>
            </article>
          ))
        )}
      </section>

      <form className="type-row" onSubmit={submitTyped}>
        <label htmlFor="voice-typed" className="sr-only">
          Type a question
        </label>
        <input
          id="voice-typed"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or type a question…"
          autoComplete="off"
          maxLength={2000}
        />
        <button type="submit" className="btn btn-primary" disabled={!typed.trim()}>
          Send
        </button>
      </form>

      <section className="panel" aria-labelledby="voice-settings-title">
        <h2 id="voice-settings-title" className="panel-title">
          Settings
        </h2>
        <Switch
          checked={settings.handsFree}
          onChange={setHandsFree}
          description="After each answer, start listening again automatically."
        >
          Hands-free conversation
        </Switch>
        <Switch
          checked={cameraOn}
          onChange={setCamera}
          description="Each question includes a photo from your camera, so you can ask what's in front of you or have text read out. Photos go to the AI only while this is on."
        >
          Camera: describe surroundings
        </Switch>
        <div className="field">
          <label htmlFor="voice-output">Replies are read by</label>
          <select id="voice-output" value={settings.voiceOutput} onChange={(e) => update({ voiceOutput: e.target.value })}>
            <option value="voice">SignBridge's voice</option>
            <option value="screenreader">My screen reader</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="voice-rate">Speech speed: {settings.rate.toFixed(1)}×</label>
          <input
            id="voice-rate"
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value={settings.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
          />
        </div>
        <p className="fine-print">
          SignBridge isn't a mobility aid. Don't rely on it to decide whether something is safe.
        </p>
      </section>

      <div className="sr-only" aria-live="polite">
        {assistant.announcement}
      </div>
    </main>
  );
}
