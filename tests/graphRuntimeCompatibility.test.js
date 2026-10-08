import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Ignored untrained artifacts are local operator smoke tests, never linguistic evidence.
for (const { name, variant, folder } of [
  { name: "gru75", variant: "GRU75", folder: "operator-spike-2026-10-04" },
  { name: "stgcn", variant: "historical dense STGCN", folder: "operator-spike-2026-10-04" },
  { name: "stgcn", variant: "final compact STGCN", folder: "compact-operator-spike-2026-10-04" },
]) {
  const root = new URL(`../training/artifacts/graph-v1/${folder}/`, import.meta.url);
  const model = new URL(`${name}-untrained.onnx`, root), parity = new URL(`${name}-parity.json`, root);
  test(`Node single-thread WASM ${variant} untrained operator/float32 parity`, { skip: !fs.existsSync(model) || !fs.existsSync(parity) }, async () => {
    const runtime = await import("onnxruntime-web/wasm");
    runtime.env.wasm.numThreads = 1; runtime.env.wasm.proxy = false;
    runtime.env.wasm.wasmPaths = pathToFileURL(path.resolve("node_modules/onnxruntime-web/dist") + path.sep).href;
    const fixture = JSON.parse(fs.readFileSync(parity));
    const session = await runtime.InferenceSession.create(new Uint8Array(fs.readFileSync(model)), { executionProviders: ["wasm"] });
    let maximum = 0;
    try {
      for (let index = 0; index < fixture.features.length; index++) {
        const input = new runtime.Tensor("float32", new Float32Array(fixture.features[index].flat(2)), [1, 32, 75, 3]);
        const output = await session.run({ pose: input }); const expected = fixture.probabilities[index], actual = Array.from(output.probabilities.data);
        maximum = Math.max(maximum, ...actual.map((value, i) => Math.abs(value - expected[i])));
        assert.equal(actual.indexOf(Math.max(...actual)), expected.indexOf(Math.max(...expected)));
        assert.ok(maximum <= 1e-4, `probability error ${maximum}`);
        input.dispose(); output.probabilities.dispose();
      }
    } finally { await session.release(); }
    process.stdout.write(`${variant} Node WASM maximum probability error: ${maximum}\n`);
  });
}
