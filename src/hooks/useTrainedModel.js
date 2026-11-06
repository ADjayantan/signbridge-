import { useEffect, useState } from "react";
import { validateTrainedModel } from "../lib/trainedSignModel.js";

const initial = (language) => ({ language, status: "loading", model: null, sourceSha256: null, error: "" });

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
      const bytes = typeof response.arrayBuffer === "function" ? await response.arrayBuffer() : null;
      if (bytes && bytes.byteLength > 4 * 1024 * 1024) throw new Error("size");
      const text = bytes ? new TextDecoder().decode(bytes) : await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error("size");
      const model = JSON.parse(text);
      validateTrainedModel(model, signLanguage);
      if (abort.signal.aborted) return;
      setState({ language: signLanguage, status: "ready", model, sourceSha256: null, error: "" });
      // Hash the exact fetched bytes for local replay comparisons. A missing
      // crypto API only disables comparison; it never changes model inference.
      let sourceSha256 = null;
      try {
        if (globalThis.crypto?.subtle) {
          const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes || new TextEncoder().encode(text));
          sourceSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        }
      } catch { /* Recognition remains available without a diagnostic hash. */ }
      if (!abort.signal.aborted && sourceSha256) setState({ language: signLanguage, status: "ready", model, sourceSha256, error: "" });
    })().catch(() => {
      if (!abort.signal.aborted) setState({ language: signLanguage, status: "error", model: null, error: `The trained ${signLanguage.toUpperCase()} model is not available here yet. Finish training and reload the model.` });
    });
    return () => abort.abort();
  }, [signLanguage, attempt]);
  // An unkeyed consumer can render with a new language before this effect runs.
  const visible = state.language === signLanguage ? state : initial(signLanguage);
  return { ...visible, retry: () => setAttempt((n) => n + 1) };
}
