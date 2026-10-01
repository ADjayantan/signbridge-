import { useEffect } from "react";
import { isTyping } from "./components/Controls.jsx";
import { useHashMode } from "./hooks/useHashMode.js";
import { useSettings } from "./hooks/useSettings.js";
import Home from "./modes/Home.jsx";
import SignMode from "./modes/SignMode.jsx";
import VoiceMode from "./modes/VoiceMode.jsx";

export default function App() {
  const [settings, update] = useSettings();
  const [mode, go] = useHashMode();

  useEffect(() => {
    if (mode !== "home") return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e)) return;
      if (e.key === "v" || e.key === "V") go("voice");
      else if (e.key === "s" || e.key === "S") go("sign");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, go]);

  useEffect(() => {
    document.documentElement.lang = "en";
  }, []);

  const home = () => go("home");
  if (mode === "voice") return <VoiceMode settings={settings} update={update} onBack={home} />;
  if (mode === "sign") return <SignMode settings={settings} update={update} onBack={home} />;
  return <Home settings={settings} update={update} onPick={go} />;
}
