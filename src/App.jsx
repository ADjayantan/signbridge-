import { useEffect } from "react";
import { isTyping } from "./components/Controls.jsx";
import { useAppShell } from "./hooks/useAppShell.js";
import { useHashMode } from "./hooks/useHashMode.js";
import { useSettings } from "./hooks/useSettings.js";
import Home from "./modes/Home.jsx";
import SignMode from "./modes/SignMode.jsx";
import VoiceMode from "./modes/VoiceMode.jsx";

export default function App() {
  const [settings, update] = useSettings();
  const [mode, go] = useHashMode();
  const shell = useAppShell();

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
  let screen;
  if (mode === "voice") screen = <VoiceMode settings={settings} update={update} onBack={home} />;
  else if (mode === "sign") screen = <SignMode settings={settings} update={update} onBack={home} />;
  else screen = <Home settings={settings} update={update} onPick={go} shell={shell} />;

  return (
    <>
      {!shell.online && (
        <p className="offline-banner" role="status">
          You're offline. Hand tracking still works; AI answers need an internet connection.
        </p>
      )}
      {screen}
    </>
  );
}
