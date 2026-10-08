import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// Self-host exact companion files from the pinned runtime, never research weights.
const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("onnxruntime-web/wasm"));
const output = path.resolve("public/onnx");
await mkdir(output, { recursive: true });
const files = (await readdir(dist)).filter((name) => /^ort-wasm-simd-threaded\.(?:wasm|mjs)$/.test(name));
if (files.length !== 2) throw new Error("Matching ONNX WASM companion assets were not found.");
for (const name of files) await copyFile(path.join(dist, name), path.join(output, name));
console.log(`Prepared ${files.length} pinned ONNX runtime assets (no sign models).`);
