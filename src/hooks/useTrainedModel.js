import { useEffect, useState } from "react";
import { validateTrainedModel } from "../lib/trainedSignModel.js";

const initial = (language) => ({ language, status: "loading", model: null, error: "" });

export function useTrainedModel(signLanguage) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(() => initial(signLanguage));
  useEffect(() => {
    const abort = new AbortController();
    if (import.meta.env?.MODE === "public-demo") {
      setState({ language: signLanguage, status: "error", model: null, error: "Research word models are unavailable in this public demo. Hand tracking and reviewed communication remain available." });
      return () => abort.abort();
    }
    setState(initial(signLanguage));
    (async () => {
      const response = await fetch(`/models/${signLanguage}.json`, { signal: abort.signal, cache: "no-cache" });
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) throw new Error("missing");
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error("size");
      const model = JSON.parse(text);
      validateTrainedModel(model, signLanguage);
      if (!abort.signal.aborted) setState({ language: signLanguage, status: "ready", model, error: "" });
    })().catch(() => {
      if (!abort.signal.aborted) setState({ language: signLanguage, status: "error", model: null, error: `The trained ${signLanguage.toUpperCase()} model is not available here yet. Finish training and reload the model.` });
    });
    return () => abort.abort();
  }, [signLanguage, attempt]);
  // An unkeyed consumer can render with a new language before this effect runs.
  const visible = state.language === signLanguage ? state : initial(signLanguage);
  return { ...visible, retry: () => setAttempt((n) => n + 1) };
}
