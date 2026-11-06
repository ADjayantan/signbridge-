import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTrainedModel } from "../../src/hooks/useTrainedModel.js";
import { POSE_FRAMES, POSE_INPUT_SIZE, POSE_JOINTS } from "../../src/lib/trainedSignModel.js";

// A complete numeric GRU artifact exercises the real validator without private weights.
function artifact(signLanguage = "isl", labels = ["WATER", "HELP"]) {
  return {
    format: "signbridge-gru-v1", signLanguage, labels, frames: POSE_FRAMES,
    inputSize: POSE_INPUT_SIZE, hiddenSize: 1, joints: [...POSE_JOINTS],
    mean: Array(POSE_INPUT_SIZE).fill(0), std: Array(POSE_INPUT_SIZE).fill(1),
    threshold: 0.7, margin: 0.1,
    weights: {
      weight_ih_l0: Array.from({ length: 3 }, () => Array(POSE_INPUT_SIZE).fill(0)),
      weight_hh_l0: [[0], [0], [0]], bias_ih_l0: [0, 0, 0], bias_hh_l0: [0, 0, 0],
      head_weight: [[0], [0]], head_bias: [0, 0],
    },
  };
}
function response(body, { status = 200, contentType = "application/json" } = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    text: vi.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const renderModel = (language = "isl", observe) => renderHook(({ language: selected }) => {
  const state = useTrainedModel(selected);
  observe?.(selected, state);
  return state;
}, { initialProps: { language } });
let fetchModel;
beforeEach(() => { fetchModel = vi.fn(); vi.stubGlobal("fetch", fetchModel); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("diagnostic fingerprint binds the exact fetched model bytes rather than reserialized weights", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const body = ` \n${JSON.stringify(artifact())}\n`;
  fetchModel.mockResolvedValue(response(body));
  const { result } = renderModel();
  await waitFor(() => expect(result.current.sourceSha256).toBe(createHash("sha256").update(body).digest("hex")));
  expect(result.current.sourceSha256).not.toBe(createHash("sha256").update(JSON.stringify(artifact())).digest("hex"));
});

test("fingerprint failure disables comparison without making valid recognition weights unavailable", async () => {
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockRejectedValue(new Error("Hash unavailable")) } });
  fetchModel.mockResolvedValue(response(artifact()));
  const { result } = renderModel();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.sourceSha256).toBeNull();
  expect(result.current.model).toEqual(artifact());
});

test("a UTF-8 BOM is retained in the raw model fingerprint while decoded JSON remains valid", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const json = new TextEncoder().encode(JSON.stringify(artifact()));
  const bytes = new Uint8Array(json.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]); bytes.set(json, 3);
  const fetched = response(artifact()); fetched.arrayBuffer = vi.fn().mockResolvedValue(bytes.buffer);
  fetchModel.mockResolvedValue(fetched);
  const { result } = renderModel();
  await waitFor(() => expect(result.current.sourceSha256).toBe(createHash("sha256").update(bytes).digest("hex")));
  expect(result.current.model).toEqual(artifact());
  expect(fetched.text).not.toHaveBeenCalled();
});

test("a late fingerprint from the previous language cannot restore the old model", async () => {
  const old = deferred();
  const selected = artifact("asl");
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(new Uint8Array(32).fill(2).buffer) } });
  fetchModel.mockResolvedValueOnce(response(artifact())).mockResolvedValueOnce(response(selected));
  const { result, rerender } = renderModel();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  rerender({ language: "asl" });
  await waitFor(() => expect(result.current.sourceSha256).toBe("02".repeat(32)));
  await act(async () => old.resolve(new Uint8Array(32).fill(1).buffer));
  expect(result.current).toMatchObject({ status: "ready", model: selected, sourceSha256: "02".repeat(32) });
});

test("loads valid ISL then ASL artifacts and clears the previous language while loading", async () => {
  const isl = artifact("isl"), asl = artifact("asl", ["HELLO", "THANK YOU"]);
  const next = deferred();
  fetchModel.mockResolvedValueOnce(response(isl)).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderModel();
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.model).toEqual(isl);
  const firstOptions = fetchModel.mock.calls[0][1];
  expect(fetchModel.mock.calls[0][0]).toBe("/models/isl.json");
  expect(firstOptions.cache).toBe("no-cache");
  expect(firstOptions.signal.aborted).toBe(false);

  rerender({ language: "asl" });
  expect(firstOptions.signal.aborted).toBe(true);
  expect(result.current).toMatchObject({ status: "loading", model: null, error: "" });
  expect(fetchModel.mock.calls[1][0]).toBe("/models/asl.json");
  expect(fetchModel.mock.calls[1][1].signal).not.toBe(firstOptions.signal);
  await act(async () => next.resolve(response(asl)));
  expect(result.current).toMatchObject({ status: "ready", model: asl, error: "" });
});

test.each(["ready", "error"])("a language change hides the previous %s state during render before passive effects", async (status) => {
  const next = deferred(), renders = [];
  fetchModel.mockResolvedValueOnce(status === "ready" ? response(artifact("isl")) : response({}, { status: 404 })).mockReturnValueOnce(next.promise);
  const { result, rerender } = renderModel("isl", (requested, state) => {
    renders.push({ requested, status: state.status, model: state.model, error: state.error });
  });
  await waitFor(() => expect(result.current.status).toBe(status));
  const oldSignal = fetchModel.mock.calls[0][1].signal;
  rerender({ language: "asl" });
  // This snapshot is taken inside render, before useEffect can clear old state.
  expect(renders.find((state) => state.requested === "asl")).toEqual({ requested: "asl", status: "loading", model: null, error: "" });
  expect(oldSignal.aborted).toBe(true);
  expect(fetchModel.mock.calls[1][0]).toBe("/models/asl.json");
  const selected = artifact("asl", ["DRINK", "HELP"]);
  await act(async () => next.resolve(response(selected)));
  expect(result.current).toMatchObject({ status: "ready", model: selected, error: "" });
});

test.each(["success", "failure"])("a late old-language fetch %s cannot replace the selected ready model", async (outcome) => {
  const old = deferred(), selected = artifact("asl", ["HELLO", "THANK YOU"]);
  fetchModel.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(selected));
  const { result, rerender } = renderModel();
  const oldSignal = fetchModel.mock.calls[0][1].signal;
  rerender({ language: "asl" });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => {
    if (outcome === "success") old.resolve(response(artifact("isl")));
    else old.reject(new Error("Old request failed after the language changed"));
  });
  expect(result.current).toMatchObject({ status: "ready", model: selected, error: "" });
});

test("an old response body finishing after language change cannot report an error for the ready language", async () => {
  const body = deferred();
  const oldResponse = response(artifact("isl")); oldResponse.text.mockReturnValue(body.promise);
  const selected = artifact("asl");
  fetchModel.mockResolvedValueOnce(oldResponse).mockResolvedValueOnce(response(selected));
  const { result, rerender } = renderModel();
  await waitFor(() => expect(oldResponse.text).toHaveBeenCalledOnce());
  rerender({ language: "asl" });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => body.resolve("malformed old JSON"));
  expect(result.current).toMatchObject({ status: "ready", model: selected, error: "" });
});

test("unmount aborts the model request and ignores a late response from an abort-insensitive fetch", async () => {
  const pending = deferred(), renders = [];
  fetchModel.mockReturnValue(pending.promise);
  const { unmount } = renderHook(() => {
    const state = useTrainedModel("isl"); renders.push(state.status); return state;
  });
  const signal = fetchModel.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
  const before = [...renders];
  await act(async () => pending.resolve(response(artifact())));
  expect(renders).toEqual(before);
  expect(fetchModel).toHaveBeenCalledOnce();
});

test.each([
  ["public 404", () => response({ error: "This resource is unavailable" }, { status: 404 }), false],
  ["HTML content type", () => response(artifact(), { contentType: "text/html" }), false],
  ["malformed JSON", () => response("{ broken JSON"), true],
  ["wrong sign language", () => response(artifact("asl")), true],
  ["non-numeric learned weights", () => { const model = artifact(); model.weights.head_bias[0] = "invalid"; return response(model); }, true],
  ["oversized otherwise-valid artifact", () => response({ ...artifact(), padding: "x".repeat(4 * 1024 * 1024) }), true],
])("%s leaves the selected model unavailable", async (_name, makeResponse, shouldReadBody) => {
  const unavailable = makeResponse(); fetchModel.mockResolvedValue(unavailable);
  const { result } = renderModel();
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.model).toBeNull();
  expect(result.current.error).toMatch(/trained ISL model is not available/);
  if (shouldReadBody) expect(unavailable.text).toHaveBeenCalledOnce();
  else expect(unavailable.text).not.toHaveBeenCalled();
});

test("retry clears public-model failure and recovers from a new valid artifact", async () => {
  const valid = artifact(), pending = deferred();
  fetchModel.mockResolvedValueOnce(response({}, { status: 404 })).mockReturnValueOnce(pending.promise);
  const { result } = renderModel();
  await waitFor(() => expect(result.current.status).toBe("error"));
  const oldSignal = fetchModel.mock.calls[0][1].signal;
  act(() => result.current.retry());
  expect(oldSignal.aborted).toBe(true);
  expect(result.current).toMatchObject({ status: "loading", model: null, error: "" });
  expect(fetchModel.mock.calls.map(([url]) => url)).toEqual(["/models/isl.json", "/models/isl.json"]);
  expect(fetchModel.mock.calls[1][1]).toMatchObject({ cache: "no-cache" });
  expect(fetchModel.mock.calls[1][1].signal.aborted).toBe(false);
  await act(async () => pending.resolve(response(valid)));
  expect(result.current).toMatchObject({ status: "ready", model: valid, error: "" });
});

test("retrying an unfinished request cannot let its late success replace the newer artifact", async () => {
  const old = deferred(), selected = artifact("isl", ["NEW WATER", "NEW HELP"]);
  fetchModel.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(selected));
  const { result } = renderModel();
  const oldSignal = fetchModel.mock.calls[0][1].signal;
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => old.resolve(response(artifact("isl", ["OLD WATER", "OLD HELP"]))));
  expect(result.current).toMatchObject({ status: "ready", model: selected, error: "" });
});

test("public builds never fetch previously cached research weights", async () => {
  vi.stubEnv("MODE", "public-demo");
  try {
    const { result, unmount } = renderModel();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/public demo/);
    expect(fetchModel).not.toHaveBeenCalled();
    unmount();
  } finally { vi.unstubAllEnvs(); }
});
