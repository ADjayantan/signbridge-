import { useCallback, useEffect, useState } from "react";

const MODES = ["home", "connect", "voice", "sign", "live-sign", "trained-sign", "sign-workspace", "training-studio", "sign-videos"];

function fromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return MODES.includes(hash) ? hash : "home";
}

/**
 * The current screen lives in the URL (#voice, #sign), so the browser's Back button works and
 * a blind user can bookmark voice mode and land straight in it.
 */
export function useHashMode() {
  const [mode, setMode] = useState(fromHash);

  useEffect(() => {
    const onChange = () => setMode(fromHash());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  const go = useCallback((next) => {
    if (next === "home") {
      if (window.location.hash) window.history.pushState(null, "", window.location.pathname + window.location.search);
    } else if (window.location.hash !== `#${next}`) {
      window.history.pushState(null, "", `#${next}`);
    }
    setMode(next);
  }, []);

  return [mode, go];
}
