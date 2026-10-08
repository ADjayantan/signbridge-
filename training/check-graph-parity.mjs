// Explicit local feature parity; never loads a camera, model, or final test split.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { preprocessPoseGraph, normalizePoseGraphForParity } from "../src/lib/poseGraphFeatures.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), languages = [];
let fixturesDirectory = resolve(repository, ".training-data/graph-v1/parity"), reportPath;
while (args.length) {
  const value = args.shift();
  if (value === "--fixtures-dir") { assert.ok(args.length, "Missing fixtures directory"); fixturesDirectory = resolve(args.shift()); }
  else if (value === "--report") { assert.ok(args.length, "Missing report path"); reportPath = resolve(args.shift()); }
  else if (["isl", "asl"].includes(value)) languages.push(value);
  else throw new Error("Usage: node training/check-graph-parity.mjs [--fixtures-dir PATH] [--report PATH] [isl] [asl]");
}
if (!languages.length) languages.push("isl", "asl");
if (reportPath) {
  try { await access(reportPath); throw new Error("Report exists; use a new report path"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const contractBytes = await readFile(resolve(repository, "training/graph-contract-v1.json"));
const contract = JSON.parse(contractBytes);
const expectedContractHash = hash(contractBytes);
const expectedAdjacencyHash = hash(JSON.stringify({ nodes: contract.nodes, edges: contract.edges, selfLoops: true, undirected: true }));
const tolerance = 1e-5;
const compare = (actual, expected) => {
  const a = actual.flat(2), b = expected.flat(2);
  assert.equal(a.length, b.length);
  let error = 0;
  for (let i = 0; i < a.length; i++) {
    assert.ok(Number.isFinite(a[i]) && Number.isFinite(b[i]), "Parity arrays must be finite");
    error = Math.max(error, Math.abs(a[i] - b[i]));
  }
  assert.ok(error <= tolerance, `Feature error ${error} exceeds ${tolerance}`);
  return error;
};
async function check(path, real = false) {
  const bytes = await readFile(path);
  assert.ok(bytes.byteLength <= 32 * 1024 * 1024, "Parity fixture exceeds its size bound");
  const fixture = JSON.parse(bytes);
  assert.equal(fixture.format, "signbridge-graph-feature-fixtures-v1");
  assert.equal(fixture.featureContract, contract.id);
  assert.equal(fixture.contractHash, expectedContractHash);
  assert.equal(fixture.adjacencyHash, expectedAdjacencyHash);
  if (real) assert.equal(fixture.synthetic, false);
  let rawError = 0, normalizedError = 0, positiveCases = 0, negativeCases = 0;
  for (const item of fixture.cases) {
    if (real) assert.equal(item.split, "val", "Real parity must not inspect final test poses");
    if (item.error) {
      let rejected = false;
      try { rejected = preprocessPoseGraph(item.frames).length === 0; } catch { rejected = true; }
      assert.ok(rejected, "Quality failure must not produce graph features"); negativeCases++; continue;
    }
    const features = preprocessPoseGraph(item.frames);
    assert.equal(features.length, 32); assert.ok(features.every(frame => frame.length === 75 && frame.every(point => point.length === 3)));
    rawError = Math.max(rawError, compare(features, item.features));
    const mask = features.map(frame => frame.map(point => point[2] >= .5));
    assert.deepEqual(mask, item.mask, "Missingness must agree exactly");
    normalizedError = Math.max(normalizedError, compare(normalizePoseGraphForParity(features, item.normalization), item.normalized));
    positiveCases++;
  }
  if (real) assert.ok(positiveCases >= 3, "Three real validation poses per language are required");
  return { signLanguage: fixture.signLanguage ?? "synthetic", synthetic: fixture.synthetic, positiveCases, negativeCases,
    maximumRawFeatureError: rawError, maximumNormalizationError: normalizedError, tolerance, passed: true };
}
const checks = [await check(resolve(repository, "tests/fixtures/graph-features.json"))];
for (const language of languages) checks.push(await check(resolve(fixturesDirectory, `${language}-features.json`), true));
const report = { evaluatedAt: new Date().toISOString(), scope: "Python versus actual JavaScript graph preprocessing; validation poses and synthetic quality cases only",
  featureContract: contract.id, contractHash: expectedContractHash, adjacencyHash: expectedAdjacencyHash,
  checks, limits: ["Feature parity is not recognition accuracy", "No camera or final-test classification was performed", "Real raw fixture inputs remain local and ignored"] };
if (reportPath) { await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); }
console.log(JSON.stringify(report));
