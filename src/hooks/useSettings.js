import { useCallback, useEffect, useState } from "react";
import { LANGUAGES } from "../lib/languages.js";
import { load, save } from "../lib/storage.js";

export const AUTO_SEND_OPTIONS = [0, 1500, 2000, 3000, 5000];

export const DEFAULT_SETTINGS = {
  lang: "en",
  rate: 1, // speech rate
  handsFree: true, // voice mode: listen again after each answer
  voiceOutput: "voice", // "voice" = app speaks; "screenreader" = the user's screen reader reads replies
  autoSendMs: 2000, // sign mode: send after hands are down this long (0 = off)
  speakSigns: false, // sign mode: say the user's signed sentence aloud for people nearby
};

function sanitize(saved) {
  const s = { ...DEFAULT_SETTINGS };
  if (!saved || typeof saved !== "object") return s;
  if (LANGUAGES.some((l) => l.code === saved.lang)) s.lang = saved.lang;
  if (typeof saved.rate === "number" && saved.rate >= 0.5 && saved.rate <= 2.5) s.rate = saved.rate;
  if (typeof saved.handsFree === "boolean") s.handsFree = saved.handsFree;
  if (saved.voiceOutput === "voice" || saved.voiceOutput === "screenreader") s.voiceOutput = saved.voiceOutput;
  if (AUTO_SEND_OPTIONS.includes(saved.autoSendMs)) s.autoSendMs = saved.autoSendMs;
  if (typeof saved.speakSigns === "boolean") s.speakSigns = saved.speakSigns;
  return s;
}

/** Settings shared by both modes, remembered in this browser. */
export function useSettings() {
  const [settings, setSettings] = useState(() => sanitize(load("settings", null)));
  useEffect(() => {
    save("settings", settings);
  }, [settings]);
  const update = useCallback((patch) => setSettings((prev) => sanitize({ ...prev, ...patch })), []);
  return [settings, update];
}
