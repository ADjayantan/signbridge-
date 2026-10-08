import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useGraphSignModel } from "../../src/hooks/useGraphSignModel.js";
import { deferredGraph, graphFrames, graphManifest } from "../helpers/graph.js";

let workers, fetchModel;
class FakeWorker {
  constructor() { this.messages = []; this.terminate = vi.fn(); workers.push(this); }
  postMessage(message) { this.messages.push(message); }
  emit(body, request = this.messages.find((message) => message.type === "init")) {
    this.onmessage?.({ data: { generation: request.generation, requestId: request.requestId, signLanguage: request.signLanguage, modelId: request.modelId, modelVersion: request.modelVersion, ...body } });
  }
}
const response = (manifest, status = 200) => new Response(JSON.stringify(manifest), { status, headers: { "content-type": "application/json" } });
const renderModel = (language = "isl", enabled = true) => renderHook(({ selected, active }) => useGraphSignModel(selected, { enabled: active }), { initialProps: { selected: language, active: enabled } });
beforeEach(() => { workers = []; fetchModel = vi.fn().mockImplementation((url) => Promise.resolve(response(graphManifest(url.includes("asl") ? "asl" : "isl")))); vi.stubGlobal("fetch", fetchModel); vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const ready = async () => { await waitFor(() => expect(workers.length).toBeGreaterThan(0)); act(() => workers.at(-1).emit({ type: "ready" })); };

test("graph choice is explicit, candidates/missing manifests remain unavailable without weight workers", async () => {
  const { result, rerender } = renderModel("isl", false); expect(result.current.status).toBe("idle"); expect(fetchModel).not.toHaveBeenCalled();
  fetchModel.mockResolvedValueOnce(response({}, 404)); rerender({ selected: "isl", active: true }); await waitFor(() => expect(result.current.status).toBe("unavailable")); expect(workers).toHaveLength(0);
  const candidate = graphManifest(); candidate.promotion.promoted = false; fetchModel.mockResolvedValueOnce(response(candidate)); act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe("unavailable")); expect(workers).toHaveLength(0);
});
test("public demo cannot fetch cached research manifests or start a worker", async () => {
  vi.stubEnv("MODE", "public-demo"); const { result } = renderModel(); await waitFor(() => expect(result.current.status).toBe("unavailable"));
  expect(fetchModel).not.toHaveBeenCalled(); expect(workers).toHaveLength(0);
});
test("a language change aborts old loading and ignores an old worker's late ready", async () => {
  const { result, rerender } = renderModel(); await ready(); expect(result.current.model.signLanguage).toBe("isl"); const old = workers[0], oldSignal = fetchModel.mock.calls[0][1].signal;
  rerender({ selected: "asl", active: true }); expect(oldSignal.aborted).toBe(true); expect(old.terminate).toHaveBeenCalledOnce(); expect(result.current.model).toBeNull();
  await waitFor(() => expect(workers).toHaveLength(2)); act(() => old.emit({ type: "ready" })); expect(result.current.status).toBe("loading");
  act(() => workers[1].emit({ type: "ready" })); expect(result.current.model.signLanguage).toBe("asl");
});
test("one pending turn is bounded; cancel rejects it, disposes the worker and cannot append a stale result", async () => {
  const { result } = renderModel(); await ready(); const worker = workers[0]; let prediction;
  act(() => { prediction = result.current.predict(graphFrames(), { durationMs: 500 }).catch((error) => error); }); expect(result.current.predicting).toBe(true);
  await expect(result.current.predict(graphFrames())).rejects.toThrow(/current graph recognition/);
  const request = worker.messages.find((message) => message.type === "predict"); act(() => result.current.cancel()); expect((await prediction).name).toBe("AbortError"); expect(worker.terminate).toHaveBeenCalledOnce();
  act(() => worker.emit({ type: "result", result: { status: "recognized", meaning: "STALE" } }, request)); expect(result.current.predicting).toBe(false); expect(result.current.model).toBeNull();
  await waitFor(() => expect(workers).toHaveLength(2)); act(() => workers[1].emit({ type: "ready" })); expect(result.current.status).toBe("ready");
});
test("request identity rejects wrong-language/old-generation replies and settles the right turn once", async () => {
  const { result } = renderModel(); await ready(); const worker = workers[0]; let prediction;
  act(() => { prediction = result.current.predict(graphFrames()); }); const request = worker.messages.at(-1);
  act(() => worker.emit({ type: "result", signLanguage: "asl", result: { meaning: "WRONG" } }, request)); expect(result.current.predicting).toBe(true);
  const expected = { status: "recognized", meaning: "WATER", candidates: [{ label: "WATER", score: .9 }], score: .9 };
  act(() => worker.emit({ type: "result", result: expected }, request)); expect(await prediction).toEqual(expected); expect(result.current.predicting).toBe(false);
  act(() => worker.emit({ type: "result", result: { meaning: "DUPLICATE" } }, request)); expect(result.current.model.signLanguage).toBe("isl");
});
test("worker camera rejection retains scalar diagnostics without fabricating inference confidence", async () => {
  const { result } = renderModel("asl"); await ready(); const worker = workers[0]; let prediction;
  act(() => { prediction = result.current.predict(graphFrames(), { durationMs: 2500 }); });
  const request = worker.messages.at(-1);
  const reply = { status: "no_sign", meaning: "", glosses: [], candidates: [], score: 0, margin: 0,
    diagnostics: { inferenceRan: false, reasonCodes: ["recapture"], model: null, capture: null, posterior: null } };
  const quality = { ok: false, code: "tracking-gap", metrics: { count: 4, qualified: 4, durationMs: 2500, largestGapMs: 2050 } };
  act(() => worker.emit({ type: "result", result: reply, quality }, request));
  const measured = await prediction;
  expect(measured.meaning).toBe(""); expect(measured.score).toBe(0);
  expect(measured.diagnostics).toEqual({ inferenceRan: false, reasonCodes: ["tracking-gap"],
    model: { signLanguage: "asl", engine: "graph", labelsCount: 2, threshold: .7, requiredMargin: .1, acceptanceEnabled: true },
    capture: { inputFrames: 4, handFrames: 4, shoulderFrames: 4, qualifiedFrames: 4, trimmedFrames: 4, trimmedShoulderFrames: 4, modelFrames: 0, durationMs: 2500, largestGapMs: 2050 },
    posterior: null, cameraGate: { passed: false, code: "tracking-gap" } });
  expect(JSON.stringify(measured.diagnostics)).not.toMatch(/keypoints|confidences|atMs/);
});
test("unmount settles pending inference and late fetches cannot create replacement workers", async () => {
  const old = deferredGraph(); fetchModel.mockReturnValueOnce(old.promise); const loading = renderModel(); loading.unmount(); await act(async () => old.resolve(response(graphManifest()))); expect(workers).toHaveLength(0);
  const loaded = renderModel(); await ready(); let prediction; act(() => { prediction = loaded.result.current.predict(graphFrames()).catch((error) => error); });
  loaded.unmount(); expect((await prediction).name).toBe("AbortError"); expect(workers[0].terminate).toHaveBeenCalledOnce();
});
test("worker failures and inference timeouts release resources and expose retry without changing language", async () => {
  const { result } = renderModel(); await ready(); const worker = workers[0]; act(() => worker.onerror()); expect(result.current.status).toBe("error"); expect(worker.terminate).toHaveBeenCalledOnce();
  act(() => result.current.retry()); await waitFor(() => expect(workers).toHaveLength(2)); act(() => workers[1].emit({ type: "ready" }));
  vi.useFakeTimers(); let prediction; act(() => { prediction = result.current.predict(graphFrames()).catch((error) => error); }); act(() => vi.advanceTimersByTime(10000));
  expect((await prediction).message).toMatch(/timed out/); expect(result.current.status).toBe("error"); expect(workers[1].terminate).toHaveBeenCalledOnce(); vi.useRealTimers();
});
