import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useWordRecognitionModel } from "../../src/hooks/useWordRecognitionModel.js";
import { legacyCameraFrame, legacyCameraFrames, legacyCameraModel } from "../helpers/legacyCamera.js";

const mock = vi.hoisted(() => ({ model: null, predict: vi.fn(), graph: vi.fn(), graphPredict: vi.fn() }));
vi.mock("../../src/hooks/useTrainedModel.js", () => ({ useTrainedModel: () => ({ status: "ready", model: mock.model }) }));
vi.mock("../../src/hooks/useGraphSignModel.js", () => ({ useGraphSignModel: (...args) => mock.graph(...args) }));
vi.mock("../../src/lib/trainedSignModel.js", async (original) => {
  const real = await original();
  return { ...real, predictTrainedSign: (...args) => { mock.predict(...args); return real.predictTrainedSign(...args); } };
});

beforeEach(() => {
  vi.clearAllMocks(); mock.model = legacyCameraModel();
  mock.graph.mockReturnValue({ status: "unavailable", model: null, predict: mock.graphPredict, cancel: vi.fn() });
});
afterEach(cleanup);

test("legacy camera hook forwards actual timing, then retains the learned predictor's accepted word", () => {
  const { result } = renderHook(() => useWordRecognitionModel("asl", "legacy"));
  const frames = legacyCameraFrames(), prediction = result.current.predict(frames, { durationMs: 500 });
  expect(mock.predict).toHaveBeenCalledExactlyOnceWith(mock.model, frames);
  expect(prediction.status).toBe("recognized"); expect(prediction.meaning).toBe("BOOK");
  expect(prediction.diagnostics.cameraGate).toEqual({ passed: true, code: "" });
  expect(prediction.diagnostics.capture).toMatchObject({ durationMs: 500, largestGapMs: 125 });
  expect(mock.graph).toHaveBeenCalledWith("asl", { enabled: false });
});

test("legacy camera hook never calls learned inference for missing duration or a trailing tracking gap", () => {
  const { result } = renderHook(() => useWordRecognitionModel("asl"));
  for (const options of [undefined, { durationMs: 3000 }]) {
    const prediction = result.current.predict(legacyCameraFrames(), options);
    expect(prediction.meaning).toBe(""); expect(prediction.diagnostics.posterior).toBeNull();
    expect(prediction.diagnostics.inferenceRan).toBe(false);
  }
  expect(mock.predict).not.toHaveBeenCalled(); expect(mock.graphPredict).not.toHaveBeenCalled();
});

test("legacy camera hook rejects hands and shoulders that were never observed together before inference", () => {
  const { result } = renderHook(() => useWordRecognitionModel("asl"));
  const frames = [legacyCameraFrame({ shoulders: false }),
    ...Array.from({ length: 4 }, (_, i) => legacyCameraFrame({ hand: false, atMs: 125 * (i + 1) })),
    ...Array.from({ length: 3 }, (_, i) => legacyCameraFrame({ shoulders: false, atMs: 625 + 125 * i }))];
  const prediction = result.current.predict(frames, { durationMs: 1000 });
  expect(prediction.diagnostics.reasonCodes).toEqual(["framing"]);
  expect(prediction.diagnostics.capture.qualifiedFrames).toBe(0);
  expect(mock.predict).not.toHaveBeenCalled();
});

test("explicit graph selection keeps its own async predictor without a legacy fallback", () => {
  const { result } = renderHook(() => useWordRecognitionModel("asl", "graph"));
  const frames = legacyCameraFrames(), options = { durationMs: 500 };
  mock.graphPredict.mockReturnValue("graph response");
  expect(result.current.async).toBe(true); expect(result.current.status).toBe("unavailable");
  expect(result.current.predict(frames, options)).toBe("graph response");
  expect(mock.graphPredict).toHaveBeenCalledExactlyOnceWith(frames, options);
  expect(mock.predict).not.toHaveBeenCalled();
  expect(mock.graph).toHaveBeenCalledWith("asl", { enabled: true });
});
