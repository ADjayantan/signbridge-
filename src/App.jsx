import { useEffect, useState } from "react";
import { isTyping } from "./components/Controls.jsx";
import { useAppShell } from "./hooks/useAppShell.js";
import { useHashMode } from "./hooks/useHashMode.js";
import { useSettings } from "./hooks/useSettings.js";
import Home from "./modes/Home.jsx";
import SignMode from "./modes/SignMode.jsx";
import VoiceMode from "./modes/VoiceMode.jsx";
import LiveSignMode from "./modes/LiveSignMode.jsx";
import TrainedSignMode from "./modes/TrainedSignMode.jsx";
import TrainingStudio from "./modes/TrainingStudio.jsx";
import ConnectMode from "./modes/ConnectMode.jsx";

export default function App() {
  const [settings, update] = useSettings();
  const [mode, go] = useHashMode();
  const shell = useAppShell();
  const [connectDraft, setConnectDraft] = useState(null);

  useEffect(() => {
    if (mode !== "home") return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e)) return;
      if (e.key === "v" || e.key === "V") go("voice");
      else if (e.key === "s" || e.key === "S") go("trained-sign");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, go]);

  useEffect(() => {
    document.documentElement.lang = "en";
  }, []);

  const home = () => { setConnectDraft(null); go("home"); };
  const connect = (text) => { setConnectDraft(typeof text === "string" && text.trim() ? text : null); go("connect"); };
  let screen;
  if (mode === "connect") screen = <ConnectMode settings={settings} onBack={home} onTool={go} initialReviewedText={connectDraft} onReviewedTextConsumed={() => setConnectDraft(null)} />;
  else if (mode === "voice") screen = <VoiceMode settings={settings} update={update} onBack={home} />;
  else if (mode === "live-sign") screen = <LiveSignMode key={`${settings.signLanguage}:${settings.lang}`} settings={settings} update={update} onBack={home} onLibrary={() => go("sign-videos")} onLocal={() => go("sign")} onTrained={() => go("trained-sign")} />;
  else if (mode === "trained-sign" || mode === "sign-workspace") screen = <TrainedSignMode key={`${settings.signLanguage}:${settings.lang}`} settings={settings} update={update} onBack={home} onLive={() => go("live-sign")} onLibrary={() => go("sign-videos")} onStudio={() => go("training-studio")} initialDestination={new URLSearchParams(window.location.hash.split("?")[1] || "").get("with") === "ai" ? "ai" : "local"} onConnect={connect} />;
  else if (mode === "training-studio") screen = <TrainingStudio settings={settings} update={update} onBack={home} onCapture={() => go("trained-sign")} />;
  else if (mode === "sign" || mode === "sign-videos") screen = <SignMode key={`${settings.signLanguage}:${mode}`} settings={settings} update={update} onBack={home} initialTab={mode === "sign-videos" ? "videos" : "talk"} onLive={() => go("live-sign")} onTrained={() => go("trained-sign")} />;
  else screen = <Home settings={settings} update={update} onPick={go} shell={shell} />;

  return (
    <>
      {!shell.online && (
        <p className="offline-banner" role="status">
          You're offline. Room connections and AI need the internet. You can keep editing your message.
        </p>
      )}
      {screen}
    </>
  );
}
