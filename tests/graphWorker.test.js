import assert from "node:assert/strict";
import { test } from "node:test";
import { createGraphWorkerController } from "../src/workers/graphSign.worker.js";
import { deferredGraph, graphFrames, graphManifest } from "./helpers/graph.js";

function fixture({ bytes = new Uint8Array([1, 2, 3]), creation } = {}) {
  const messages = [], runs = [], tensors = [], fetches = [];
  const session = {
    inputNames: ["pose"], outputNames: ["probabilities"], released: 0,
    async release() { this.released++; },
    async run(input) { runs.push(input); return { probabilities: { type: "float32", dims: [1, 2], data: new Float32Array([.9, .1]) } }; },
  };
  const runtime = { env: { wasm: {} }, InferenceSession: { create: async () => creation ? creation.promise : session }, Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; tensors.push(this); } } };
  let loads = 0;
  const controller = createGraphWorkerController({ postMessage: (message) => messages.push(message), fetchImpl: async (...args) => { fetches.push(args); return new Response(bytes); }, loadRuntime: async () => { loads++; return runtime; } });
  const model = graphManifest();
  const init = { type: "init", generation: 1, requestId: "init", signLanguage: "isl", modelId: model.modelId, modelVersion: model.modelVersion, manifest: model, manifestUrl: "http://localhost/models/graph/isl/manifest.json", wasmPaths: "/onnx/" };
  const predict = { ...init, type: "predict", requestId: "turn-1", frames: graphFrames(), durationMs: 500 };
  return { controller, init, predict, session, runtime, messages, runs, tensors, fetches, loads: () => loads };
}
test("eligible weights are hash checked before loading WASM, and runtime receives raw TVC only once", async () => {
  const f = fixture(); f.init.manifest.normalization.mean[33] = [2, 3];
  await f.controller.onMessage(f.init); assert.equal(f.messages[0].type, "ready");
  assert.deepEqual(f.runtime.env.wasm, { numThreads: 1, proxy: false, wasmPaths: "http://localhost/onnx/" });
  await f.controller.onMessage(f.predict);
  assert.equal(f.messages.at(-1).result.meaning, "WATER"); assert.deepEqual(f.tensors[0].dims, [1, 32, 75, 3]);
  // Mean2 is embedded in ONNX; raw x remains -.25 rather than being standardized twice.
  assert.ok(Math.abs(f.tensors[0].data[33 * 3] + .25) < 1e-6);
  await f.controller.dispose(); assert.equal(f.session.released, 1);
});
test("corrupt weights and failed candidates never initialize the runtime", async () => {
  const corrupt = fixture({ bytes: new Uint8Array([3, 2, 1]) }); await corrupt.controller.onMessage(corrupt.init);
  assert.match(corrupt.messages.at(-1).error, /integrity/); assert.equal(corrupt.loads(), 0);
  const candidate = fixture(); candidate.init.manifest.promotion.promoted = false; await candidate.controller.onMessage(candidate.init);
  assert.equal(candidate.messages.at(-1).code, "unavailable"); assert.equal(candidate.fetches.length, 0); assert.equal(candidate.loads(), 0);
});
test("untimed camera inputs produce a recapture result without executing model weights", async () => {
  const f = fixture(); await f.controller.onMessage(f.init); f.predict.frames.forEach((frame) => delete frame.atMs);
  await f.controller.onMessage(f.predict); assert.equal(f.messages.at(-1).result.status, "no_sign"); assert.equal(f.runs.length, 0);
});
test("one inference in flight stays bounded and disposal suppresses its late word", async () => {
  const f = fixture(), pending = deferredGraph(); await f.controller.onMessage(f.init);
  f.session.run = () => pending.promise;
  const first = f.controller.onMessage(f.predict);
  await f.controller.onMessage({ ...f.predict, requestId: "turn-2" }); assert.equal(f.messages.at(-1).code, "busy");
  await f.controller.dispose();
  pending.resolve({ probabilities: { type: "float32", dims: [1, 2], data: new Float32Array([.9, .1]) } }); await first;
  assert.equal(f.messages.filter((message) => message.type === "result").length, 0); assert.equal(f.session.released, 1);
});
test("a session created after disposal closes once and cannot announce ready", async () => {
  const creation = deferredGraph(), entered = deferredGraph();
  const f = fixture({ creation });
  f.runtime.InferenceSession.create = async () => { entered.resolve(); return creation.promise; };
  const initial = f.controller.onMessage(f.init); await entered.promise; await f.controller.dispose();
  creation.resolve(f.session); await initial;
  assert.equal(f.session.released, 1); assert.equal(f.messages.length, 0);
});
test("immediate disposal before initialization resumes cannot start a download", async () => {
  const f = fixture(); const initialization = f.controller.onMessage(f.init); await f.controller.dispose(); await initialization;
  assert.equal(f.fetches.length, 0); assert.equal(f.loads(), 0); assert.equal(f.messages.length, 0);
});
