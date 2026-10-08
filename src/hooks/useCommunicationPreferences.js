import { useCallback, useEffect, useState } from "react";
import { load, save } from "../lib/storage.js";
import { LANGUAGES } from "../lib/languages.js";

export const DEFAULT_COMMUNICATION_PREFERENCES = Object.freeze({ inputMethod: "text", receive: "text", signVideos: false, signLanguage: "isl", lang: "en" });
export function sanitizeCommunicationPreferences(value) {
  const next = { ...DEFAULT_COMMUNICATION_PREFERENCES };
  if (!value || typeof value !== "object") return next;
  if (["text", "speech", "sign"].includes(value.inputMethod)) next.inputMethod = value.inputMethod;
  if (["text", "speech", "screenreader"].includes(value.receive)) next.receive = value.receive;
  if (typeof value.signVideos === "boolean") next.signVideos = value.signVideos;
  if (["isl", "asl"].includes(value.signLanguage)) next.signLanguage = value.signLanguage;
  if (LANGUAGES.some((language) => language.code === value.lang)) next.lang = value.lang;
  return next;
}
export function useCommunicationPreferences() {
  const [preferences, setPreferences] = useState(() => sanitizeCommunicationPreferences(load("communication-preferences", null)));
  useEffect(() => { save("communication-preferences", preferences); }, [preferences]);
  const update = useCallback((patch) => setPreferences((previous) => sanitizeCommunicationPreferences({ ...previous, ...patch })), []);
  return [preferences, update];
}
