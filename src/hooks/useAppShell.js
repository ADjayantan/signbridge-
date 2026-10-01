import { useCallback, useEffect, useState } from "react";

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

/**
 * Install and connection state for the installable app.
 * - canInstall: the browser offered an install prompt (Chrome, Edge, Android)
 * - iosHint: on iPhone/iPad Safari, installing is done from the Share menu
 */
export function useAppShell() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [online, setOnline] = useState(() => window.navigator.onLine);

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault(); // show our own button instead of the mini-infobar
      setPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setPrompt(null);
  }, [prompt]);

  return {
    canInstall: Boolean(prompt) && !installed,
    iosHint: !installed && isIos(),
    installed,
    install,
    online,
  };
}
