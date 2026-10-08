import { GRAPH_INPUT_SHAPE, poseGraphTensorData, preprocessPoseGraph } from "../lib/poseGraphFeatures.js";
import { graphNoSign, graphPredictionFromProbabilities, readGraphResponseBytes, sha256Hex, validateCameraTurn, validateGraphManifest } from "../lib/graphSignModel.js";

/** Exported controller permits lifecycle tests without acquiring media or browser access. */
export function createGraphWorkerController({ postMessage, fetchImpl = (...args) => globalThis.fetch(...args), loadRuntime = () => import("onnxruntime-web/wasm") }) {
  let current = null, epoch = 0;
  const identity = (message) => ({ generation: message.generation, requestId: message.requestId, signLanguage: message.signLanguage, modelId: message.modelId, modelVersion: message.modelVersion });
  const matches = (message, state) => state && state === current && !state.disposed && message.generation === state.generation && message.signLanguage === state.signLanguage && message.modelId === state.modelId && message.modelVersion === state.modelVersion;
  const emit = (message, body) => postMessage({ ...identity(message), ...body });
  const release = async (state) => {
    if (!state || state.released || !state.session || state.busy) return;
    state.released = true;
    try { await state.session.release(); } catch { /* Old sessions must never overwrite a newer result. */ }
    state.session = null;
  };
  const dispose = async (state) => {
    if (!state) return;
    state.disposed = true; state.abort.abort();
    if (state === current) current = null;
    await release(state);
  };
  const onMessage = async (message) => {
    if (!message || !Number.isSafeInteger(message.generation) || typeof message.requestId !== "string" || message.requestId.length > 128) return;
    if (message.type === "dispose") { if (matches(message, current)) { epoch++; await dispose(current); } return; }
    if (message.type === "init") {
      const ownEpoch = ++epoch, previous = current; await dispose(previous);
      if (ownEpoch !== epoch) return;
      const state = { ...identity(message), abort: new AbortController(), session: null, runtime: null, busy: false, disposed: false, released: false };
      current = state;
      try {
        const manifest = validateGraphManifest(message.manifest, message.signLanguage);
        if (manifest.modelId !== message.modelId || manifest.modelVersion !== message.modelVersion) throw new Error("Graph worker identity does not match the selected model.");
        const manifestUrl = new URL(message.manifestUrl);
        if (!/^https?:$/.test(manifestUrl.protocol) || manifestUrl.pathname !== `/models/graph/${message.signLanguage}/manifest.json` || (globalThis.location?.origin && manifestUrl.origin !== globalThis.location.origin)) throw new Error("Invalid local graph manifest URL.");
        const modelUrl = new URL(manifest.modelFile.name, manifestUrl);
        const response = await fetchImpl(modelUrl.href, { signal: state.abort.signal, cache: "no-cache", redirect: "error" });
        if (!response.ok) throw new Error("The selected graph weights could not be loaded.");
        const bytes = await readGraphResponseBytes(response, manifest.modelFile.bytes);
        if (!matches(message, state)) return;
        if (bytes.byteLength !== manifest.modelFile.bytes || await sha256Hex(bytes) !== manifest.modelFile.sha256) throw new Error("The graph weights failed their integrity check.");
        if (!matches(message, state)) return;
        const runtime = await loadRuntime();
        if (!matches(message, state)) return;
        runtime.env.wasm.numThreads = 1; runtime.env.wasm.proxy = false;
        const wasmUrl = new URL(message.wasmPaths || "/onnx/", manifestUrl);
        if (wasmUrl.origin !== manifestUrl.origin || !wasmUrl.pathname.endsWith("/")) throw new Error("Graph runtime assets must be served from this origin.");
        runtime.env.wasm.wasmPaths = wasmUrl.href;
        state.runtime = runtime;
        state.session = await runtime.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
        if (!matches(message, state)) { await release(state); return; }
        if (!state.session.inputNames.includes(manifest.input.name) || !state.session.outputNames.includes(manifest.output.name)) throw new Error("Exported graph tensor names do not match the manifest.");
        state.manifest = manifest;
        emit(message, { type: "ready" });
      } catch (failure) {
        if (matches(message, state)) { await dispose(state); emit(message, { type: "error", code: failure.code || "load", error: failure.message || "Graph runtime could not start." }); }
        else await release(state);
      }
      return;
    }
    const state = current;
    if (message.type !== "predict" || !matches(message, state)) return;
    if (!state.session || !state.manifest) { emit(message, { type: "error", code: "not-ready", error: "Wait for the graph model to finish loading." }); return; }
    if (state.busy) { emit(message, { type: "error", code: "busy", error: "Finish or cancel the current graph recognition first." }); return; }
    state.busy = true; let input = null, output = null;
    try {
      const quality = validateCameraTurn(message.frames, { durationMs: message.durationMs });
      if (!quality.ok) { emit(message, { type: "result", result: graphNoSign(quality.feedback), quality }); return; }
      const features = preprocessPoseGraph(message.frames);
      if (!features.length) { emit(message, { type: "result", result: graphNoSign("Keep the signing hand and both shoulders visible through the complete word.") }); return; }
      input = new state.runtime.Tensor("float32", poseGraphTensorData(features), [...GRAPH_INPUT_SHAPE]);
      output = await state.session.run({ [state.manifest.input.name]: input });
      if (!matches(message, state)) return;
      const scores = output[state.manifest.output.name];
      if (!scores || scores.type !== "float32" || scores.dims.length !== 2 || scores.dims[0] !== 1 || scores.dims[1] !== state.manifest.labels.length) throw new Error("The graph runtime returned the wrong output tensor.");
      emit(message, { type: "result", result: graphPredictionFromProbabilities(state.manifest, scores.data), quality });
    } catch (failure) {
      if (matches(message, state)) emit(message, { type: "error", code: "inference", error: failure.message || "This graph turn could not be recognized." });
    } finally {
      input?.dispose?.(); if (output) Object.values(output).forEach((tensor) => tensor.dispose?.());
      state.busy = false; if (state.disposed) await release(state);
    }
  };
  return { onMessage, dispose: () => { epoch++; return dispose(current); } };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const controller = createGraphWorkerController({ postMessage: (message) => globalThis.postMessage(message) });
  globalThis.onmessage = (event) => { void controller.onMessage(event.data); };
}
