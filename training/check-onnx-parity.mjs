// Local research verification only. Real validation poses stay in ignored exports.
import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GraphUnavailableError, MAX_GRAPH_MANIFEST_BYTES, MAX_GRAPH_MODEL_BYTES, validateGraphManifest } from "../src/lib/graphSignModel.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOLERANCE = 1e-4;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = (value) => typeof value === "number" && Number.isFinite(value);

function validateCalibration(calibration) {
  assert(calibration && finite(calibration.threshold) && calibration.threshold >= 0 && calibration.threshold <= 1 &&
    finite(calibration.margin) && calibration.margin >= 0 && calibration.margin <= 1 && typeof calibration.acceptanceEnabled === "boolean", "Invalid calibrated rejection settings");
}

/** Same inclusive boundaries and stable first-index argmax as the calibrated model. */
export function calibrationDecision(probabilities, calibration) {
  validateCalibration(calibration);
  assert((Array.isArray(probabilities) || ArrayBuffer.isView(probabilities)) && probabilities.length >= 2, "A probability distribution needs two or more classes");
  const values = Array.from(probabilities);
  assert(values.every((value) => finite(value) && value >= 0 && value <= 1) && Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-3, "Invalid normalized probabilities");
  const indices = values.map((_, index) => index).sort((a, b) => values[b] - values[a] || a - b);
  const confidence = values[indices[0]], margin = confidence - values[indices[1]];
  return { top1: indices[0], confidence, margin, accepted: calibration.acceptanceEnabled && confidence >= calibration.threshold && margin >= calibration.margin };
}

/** Numerical closeness alone is insufficient when a rejection boundary changes. */
export function compareProbabilityParity(actualRows, expectedRows, calibration, tolerance = TOLERANCE) {
  validateCalibration(calibration);
  assert(finite(tolerance) && tolerance > 0 && tolerance <= TOLERANCE, "Invalid probability parity tolerance");
  assert(Array.isArray(actualRows) && actualRows.length > 0 && Array.isArray(expectedRows) && actualRows.length === expectedRows.length, "Parity fixture counts differ or are empty");
  let maximumProbabilityError = 0, expectedAccepted = 0, actualAccepted = 0;
  const classes = expectedRows[0]?.length;
  for (let row = 0; row < actualRows.length; row++) {
    const actual = calibrationDecision(actualRows[row], calibration), expected = calibrationDecision(expectedRows[row], calibration);
    assert(actualRows[row].length === classes && expectedRows[row].length === classes, "Parity class counts differ");
    for (let index = 0; index < classes; index++) maximumProbabilityError = Math.max(maximumProbabilityError, Math.abs(actualRows[row][index] - expectedRows[row][index]));
    assert(maximumProbabilityError <= tolerance, `Probability parity error exceeds ${tolerance}`);
    assert(actual.top1 === expected.top1, "WASM top-1 differs from PyTorch");
    assert(actual.accepted === expected.accepted, "WASM calibrated acceptance differs from PyTorch");
    expectedAccepted += Number(expected.accepted); actualAccepted += Number(actual.accepted);
  }
  return { fixtures: actualRows.length, maximumProbabilityError, top1Matches: true, acceptanceMatches: true, expectedAccepted, actualAccepted, passed: true };
}

/** Nearest-rank percentiles; report the observed samples without a browser claim. */
export function summarizeTimings(timings) {
  assert(Array.isArray(timings) && timings.length > 0 && timings.every((value) => finite(value) && value >= 0), "Timing observations must be finite and nonnegative");
  const sorted = [...timings].sort((a, b) => a - b), quantile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
  return { iterations: sorted.length, p50Ms: quantile(.5), p95Ms: quantile(.95), minimumMs: sorted[0], maximumMs: sorted.at(-1) };
}

async function boundedRead(path, maximum) {
  assert((await stat(path)).size <= maximum, "Runtime verification input exceeds its size limit");
  const bytes = await readFile(path);
  assert(bytes.byteLength <= maximum, "Runtime verification input exceeds its size limit");
  return bytes;
}

function validateFeatures(features) {
  assert(Array.isArray(features) && features.length >= 3 && features.length <= 128, "Three or more bounded validation fixtures are required");
  for (const sample of features) assert(Array.isArray(sample) && sample.length === 32 && sample.every((frame) => Array.isArray(frame) && frame.length === 75 && frame.every((point) => Array.isArray(point) && point.length === 3 && point.every(finite))), "Validation features must use raw float32 TVC [32,75,3]");
}

async function checkExport(runtime, directory, language, architecture, { iterations, warmup }) {
  const manifestBytes = await boundedRead(resolve(directory, "manifest.json"), MAX_GRAPH_MANIFEST_BYTES);
  const manifest = JSON.parse(manifestBytes);
  // Schema/contract checks still apply to candidates; release eligibility does not.
  try { validateGraphManifest(manifest, language); }
  catch (error) { if (!(error instanceof GraphUnavailableError)) throw error; }
  assert(manifest.provenance.architecture === architecture && manifest.provenance.seed === 42, "Export architecture/representative seed mismatch");
  const calibration = manifest.evaluation.calibration;
  validateCalibration(calibration);
  assert(manifest.threshold === calibration.threshold && manifest.margin === calibration.margin, "Manifest thresholds differ from frozen calibration");
  const modelBytes = await boundedRead(resolve(directory, manifest.modelFile.name), MAX_GRAPH_MODEL_BYTES);
  assert(modelBytes.byteLength === manifest.modelFile.bytes && hash(modelBytes) === manifest.modelFile.sha256, "Export model size or integrity hash mismatch");
  const fixtureBytes = await boundedRead(resolve(directory, "parity.json"), 32 * 1024 * 1024);
  const fixture = JSON.parse(fixtureBytes);
  assert(fixture.kind === "validation pose runtime parity; not final test" && fixture.featureContract === manifest.featureContract, "Only matching validation parity fixtures are permitted");
  validateFeatures(fixture.features);
  assert(Array.isArray(fixture.probabilities) && fixture.probabilities.length === fixture.features.length && fixture.probabilities.every((row) => row?.length === manifest.labels.length), "Validation output shape mismatch");
  const started = performance.now();
  const session = await runtime.InferenceSession.create(new Uint8Array(modelBytes), { executionProviders: ["wasm"] });
  const sessionStartupMs = performance.now() - started;
  const tensors = [];
  try {
    assert(session.inputNames.length === 1 && session.inputNames[0] === manifest.input.name && session.outputNames.includes(manifest.output.name), "ONNX tensor names differ from the manifest");
    for (const sample of fixture.features) tensors.push(new runtime.Tensor("float32", new Float32Array(sample.flat(2)), [1, 32, 75, 3]));
    async function infer(input) {
      const outputs = await session.run({ [manifest.input.name]: input });
      try {
        const output = outputs[manifest.output.name];
        assert(output?.type === "float32" && output.dims.length === 2 && output.dims[0] === 1 && output.dims[1] === manifest.labels.length, "ONNX probabilities have an incompatible shape or type");
        return Array.from(output.data);
      } finally { for (const output of Object.values(outputs)) output.dispose?.(); }
    }
    const actual = [];
    for (const tensor of tensors) actual.push(await infer(tensor));
    const parity = compareProbabilityParity(actual, fixture.probabilities, calibration);
    for (let index = 0; index < warmup; index++) await infer(tensors[index % tensors.length]);
    const timings = [];
    for (let index = 0; index < iterations; index++) {
      const start = performance.now(); await infer(tensors[index % tensors.length]); timings.push(performance.now() - start);
    }
    return { signLanguage: language, architecture, seed: 42, modelId: manifest.modelId, modelVersion: manifest.modelVersion,
      manifestSha256: hash(manifestBytes), modelSha256: hash(modelBytes), fixtureSha256: hash(fixtureBytes), modelBytes: modelBytes.byteLength,
      inputShape: manifest.input.shape, classes: manifest.labels.length, threshold: calibration.threshold, margin: calibration.margin,
      calibratedAcceptanceEnabled: calibration.acceptanceEnabled, applicationAcceptanceEnabled: manifest.acceptanceEnabled,
      ...parity, tolerance: TOLERANCE, sessionStartupMs, warmupIterations: warmup,
      nodeWasmInference: { ...summarizeTimings(timings), measured: "Warm session.run plus output validation/copy/disposal; prepared input tensors, sequential batch1, cycling validation fixtures" },
      promoted: false, browserParityVerified: false, browserPerformanceVerified: false };
  } finally {
    for (const tensor of tensors) tensor.dispose();
    await session.release();
  }
}

export async function checkOnnxExports({ exportsRoot, iterations = 50, warmup = 10 }) {
  assert(Number.isSafeInteger(iterations) && iterations >= 50 && iterations <= 1000 && Number.isSafeInteger(warmup) && warmup >= 10 && warmup <= 1000, "Use at least 50 measured iterations and 10 warmups within bounded limits");
  const installed = JSON.parse(await readFile(resolve(repository, "node_modules/onnxruntime-web/package.json"), "utf8"));
  assert(installed.version === "1.30.0", "This frozen check requires onnxruntime-web 1.30.0");
  const runtime = await import("onnxruntime-web/wasm");
  runtime.env.wasm.numThreads = 1; runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmPaths = pathToFileURL(resolve(repository, "node_modules/onnxruntime-web/dist") + "/").href;
  const checks = [];
  for (const language of ["isl", "asl"]) for (const architecture of ["gru75", "stgcn"]) checks.push(await checkExport(runtime, resolve(exportsRoot, language, architecture), language, architecture, { iterations, warmup }));
  return { format: "signbridge-node-wasm-runtime-parity-v1", evaluatedAt: new Date().toISOString(),
    scope: "Trained seed42 exports: PyTorch versus actual Node single-thread ONNX Web WASM on validation fixtures; aggregate report only",
    runtime: { package: "onnxruntime-web", version: installed.version, provider: "wasm", threads: 1, proxy: false, node: process.version,
      platform: platform(), osRelease: release(), architecture: arch(), cpuModel: cpus()[0]?.model || "unavailable", logicalCpus: cpus().length },
    checks, passed: checks.every((check) => check.passed), promoted: false, browserParityVerified: false, browserPerformanceVerified: false,
    limits: ["Node timings are observed local engineering measurements, not Chrome or camera performance",
      "Three validation clips per export do not establish recognition accuracy or unseen-signer performance",
      "This command does not inspect final-test poses, alter thresholds, promote models or enable app acceptance",
      "Real input fixtures and per-clip probabilities remain in ignored local exports"] };
}

async function main(args) {
  let exportsRoot, reportPath, iterations = 50, warmup = 10;
  while (args.length) {
    const option = args.shift();
    assert(args.length > 0, "Missing option value"); const value = args.shift();
    if (option === "--exports-root") exportsRoot = resolve(value);
    else if (option === "--report") reportPath = resolve(value);
    else if (option === "--iterations") iterations = Number(value);
    else if (option === "--warmup") warmup = Number(value);
    else throw new Error("Usage: node training/check-onnx-parity.mjs --exports-root PATH --report PATH [--iterations N] [--warmup N]");
  }
  assert(exportsRoot && reportPath, "An exports root and a new aggregate report path are required");
  try { await access(reportPath); throw new Error("Report exists; use a fresh report path"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const report = await checkOnnxExports({ exportsRoot, iterations, warmup });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
