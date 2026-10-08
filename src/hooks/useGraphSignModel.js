import { useCallback, useEffect, useRef, useState } from "react";
import { describeGraphCapture, GraphUnavailableError, MAX_GRAPH_MANIFEST_BYTES, readGraphResponseBytes, validateGraphManifest, withGraphCaptureDiagnostics } from "../lib/graphSignModel.js";

const abortError = () => new DOMException("Graph recognition was cancelled.", "AbortError");
const initial = (language, status = "idle") => ({ language, status, model: null, manifest: null, error: "", predicting: false });

/** Explicit local graph choice. Does not own cameras, call AI, or load another language. */
export function useGraphSignModel(signLanguage, { enabled = false, wasmPaths = "/onnx/" } = {}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(() => initial(signLanguage, enabled ? "loading" : "idle"));
  const control = useRef({ generation: 0, worker: null, pending: null, enabled: false, ready: false, manifest: null });
  const sequence = useRef(0);
  const settlePending = useCallback((owner, failure, result) => {
    const pending = owner.pending; if (!pending) return;
    owner.pending = null; clearTimeout(pending.timer); pending.signal?.removeEventListener("abort", pending.onAbort);
    if (failure) pending.reject(failure); else pending.resolve(result);
  }, []);
  const close = useCallback((owner) => {
    owner.ready = false; owner.closed = true;
    if (owner.worker) {
      try { owner.worker.postMessage({ type: "dispose", generation: owner.generation, requestId: "dispose", signLanguage: owner.language, modelId: owner.manifest?.modelId, modelVersion: owner.manifest?.modelVersion }); } catch { /* Termination remains available. */ }
      owner.worker.terminate(); owner.worker = null;
    }
  }, []);

  useEffect(() => {
    const previous = control.current;
    settlePending(previous, abortError()); close(previous);
    const owner = { generation: previous.generation + 1, enabled, language: signLanguage, worker: null, pending: null, ready: false, manifest: null, closed: false };
    control.current = owner;
    let alive = true, timer = 0; const abort = new AbortController();
    const valid = () => alive && !owner.closed && control.current === owner && !abort.signal.aborted;
    const fail = (failure) => {
      if (!valid()) return;
      clearTimeout(timer); abort.abort(); close(owner); settlePending(owner, failure);
      setState({ ...initial(signLanguage, failure.code === "unavailable" ? "unavailable" : "error"), error: failure.message || "Graph recognition is unavailable. You can keep typing or signing directly." });
    };
    if (!enabled) setState(initial(signLanguage));
    else if (import.meta.env?.MODE === "public-demo") setState({ ...initial(signLanguage, "unavailable"), error: "Research graph models are excluded from this public demo. Hand tracking and live signing remain available." });
    else if (!["isl", "asl"].includes(signLanguage)) setState({ ...initial(signLanguage, "error"), error: "Choose ISL or ASL for local graph recognition." });
    else {
      setState(initial(signLanguage, "loading"));
      timer = setTimeout(() => fail(new Error("Graph model startup timed out. Retry loading; your message stays available.")), 45000);
      (async () => {
        if (typeof Worker !== "function") throw new GraphUnavailableError("This browser cannot run the local graph worker. Typing and live video remain available.");
        const path = `/models/graph/${signLanguage}/manifest.json`;
        const response = await fetch(path, { signal: abort.signal, cache: "no-cache", redirect: "error" });
        if (!valid()) return;
        if (response.status === 404) throw new GraphUnavailableError(`No promoted ${signLanguage.toUpperCase()} graph artifact is installed here.`);
        if (!response.ok) throw new Error("The graph manifest could not be loaded. Retry when the connection is ready.");
        if (!response.headers?.get("content-type")?.includes("json")) throw new Error("The graph manifest is not valid JSON metadata.");
        const bytes = await readGraphResponseBytes(response, MAX_GRAPH_MANIFEST_BYTES);
        if (!valid()) return;
        const manifest = validateGraphManifest(JSON.parse(new TextDecoder().decode(bytes)), signLanguage);
        owner.manifest = manifest;
        const worker = new Worker(new URL("../workers/graphSign.worker.js", import.meta.url), { type: "module", name: `signbridge-graph-${signLanguage}` });
        owner.worker = worker;
        const identity = (message) => message?.generation === owner.generation && message.signLanguage === signLanguage && message.modelId === manifest.modelId && message.modelVersion === manifest.modelVersion;
        worker.onmessage = ({ data }) => {
          if (!valid() || !identity(data)) return;
          if (data.type === "ready" && data.requestId === "init") {
            clearTimeout(timer); owner.ready = true;
            setState({ ...initial(signLanguage, "ready"), model: manifest, manifest });
          } else if (data.type === "result" && data.requestId === owner.pending?.id) {
            const result = data.result?.diagnostics || data.quality
              ? withGraphCaptureDiagnostics(data.result, { manifest: owner.manifest, capture: owner.pending.capture, quality: data.quality })
              : data.result;
            settlePending(owner, null, result); setState((previousState) => ({ ...previousState, predicting: false }));
          } else if (data.type === "error" && (data.requestId === "init" || data.requestId === owner.pending?.id)) {
            const failure = data.code === "unavailable" ? new GraphUnavailableError(data.error) : new Error(data.error || "The graph worker failed.");
            fail(failure);
          }
        };
        worker.onerror = () => fail(new Error("The local graph worker stopped. Retry loading; your draft is preserved."));
        worker.onmessageerror = () => fail(new Error("Graph worker data could not be read. Retry loading."));
        worker.postMessage({ type: "init", generation: owner.generation, requestId: "init", signLanguage, modelId: manifest.modelId, modelVersion: manifest.modelVersion, manifest, manifestUrl: new URL(path, globalThis.location.href).href, wasmPaths });
      })().catch(fail);
    }
    return () => { alive = false; abort.abort(); clearTimeout(timer); settlePending(owner, abortError()); close(owner); };
  }, [signLanguage, enabled, wasmPaths, attempt, close, settlePending]);

  const cancel = useCallback(() => {
    const owner = control.current;
    if (!owner.pending) return;
    settlePending(owner, abortError()); close(owner);
    setState((previousState) => ({ ...previousState, predicting: false }));
    if (owner.enabled) setAttempt((value) => value + 1);
  }, [close, settlePending]);
  const predict = useCallback((frames, { signal, durationMs } = {}) => {
    const owner = control.current;
    if (signal?.aborted) return Promise.reject(abortError());
    if (!owner.enabled || !owner.ready || !owner.worker) return Promise.reject(new Error("Wait for the selected graph model to become ready."));
    if (owner.pending) return Promise.reject(new Error("Finish or cancel the current graph recognition first."));
    return new Promise((resolve, reject) => {
      const id = `predict-${++sequence.current}`;
      const onAbort = () => { if (control.current === owner && owner.pending?.id === id) cancel(); };
      const pending = { id, resolve, reject, signal, onAbort, timer: 0, capture: describeGraphCapture(frames) };
      owner.pending = pending;
      pending.timer = setTimeout(() => {
        if (control.current !== owner || owner.pending !== pending) return;
        const failure = new Error("Graph recognition timed out. Retry loading or enter the meaning manually.");
        settlePending(owner, failure); close(owner);
        setState({ ...initial(owner.language, "error"), error: failure.message });
      }, 10000);
      signal?.addEventListener("abort", onAbort, { once: true });
      setState((previousState) => ({ ...previousState, predicting: true }));
      try { owner.worker.postMessage({ type: "predict", generation: owner.generation, requestId: id, signLanguage: owner.language, modelId: owner.manifest.modelId, modelVersion: owner.manifest.modelVersion, frames, durationMs }); }
      catch (failure) { settlePending(owner, failure); close(owner); setState({ ...initial(owner.language, "error"), error: "Tracking data could not reach the graph worker. Retry loading." }); }
    });
  }, [cancel, close, settlePending]);
  const visible = state.language === signLanguage ? state : initial(signLanguage, enabled ? "loading" : "idle");
  return { ...visible, predict, cancel, retry: () => setAttempt((value) => value + 1) };
}
