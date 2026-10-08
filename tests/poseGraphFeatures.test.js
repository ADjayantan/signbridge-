import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { normalizePoseGraphForParity, poseGraphTensorData, preprocessPoseGraph, validateGraphNormalization } from "../src/lib/poseGraphFeatures.js";
import { GRAPH_ADJACENCY_HASH, GRAPH_CONTRACT_HASH } from "../src/lib/graphSignModel.js";
import { graphFrames, graphManifest } from "./helpers/graph.js";

test("frozen contract and anatomical adjacency hashes match the browser constants", () => {
  const bytes = fs.readFileSync(new URL("../training/graph-contract-v1.json", import.meta.url)), contract = JSON.parse(bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), GRAPH_CONTRACT_HASH);
  assert.equal(createHash("sha256").update(JSON.stringify({ nodes: contract.nodes, edges: contract.edges, selfLoops: contract.selfLoops, undirected: contract.undirected })).digest("hex"), GRAPH_ADJACENCY_HASH);
});
test("Python and JS features, nearest missing masks and training coordinate normalization agree", () => {
  const fixture = JSON.parse(fs.readFileSync(new URL("fixtures/graph-features.json", import.meta.url)));
  assert.equal(fixture.contractHash, GRAPH_CONTRACT_HASH); assert.equal(fixture.adjacencyHash, GRAPH_ADJACENCY_HASH);
  for (const sample of fixture.cases) {
    const actual = preprocessPoseGraph(sample.frames);
    if (sample.error) { assert.deepEqual(actual, [], sample.name); continue; }
    const expected = sample.features.flat(2);
    const error = Math.max(...actual.flat(2).map((value, index) => Math.abs(value - expected[index])));
    assert.ok(error <= 1e-5, `${sample.name} raw error ${error}`);
    const normalized = normalizePoseGraphForParity(actual, sample.normalization);
    const normalizedExpected = sample.normalized.flat(2);
    assert.ok(Math.max(...normalized.flat(2).map((value, index) => Math.abs(value - normalizedExpected[index]))) <= 1e-5, sample.name);
    actual.forEach((frame, at) => frame.forEach((point, node) => { assert.equal(point[2] >= .5, sample.mask[at][node]); if (!sample.mask[at][node]) assert.deepEqual(point, [0, 0, 0]); }));
  }
});
test("all75 joints stay in TVC order, unmapped depth is excluded, and missing values remain zero after parity normalization", () => {
  const frames = graphFrames(); frames.forEach((frame) => { frame.keypoints[74] = [.7, .8, 900]; frame.confidences[73] = .49; });
  const features = preprocessPoseGraph(frames), data = poseGraphTensorData(features);
  assert.equal(data.length, 32 * 75 * 3); assert.equal(features[0][74][2], 1); assert.deepEqual(features[0][73], [0, 0, 0]);
  const normalization = graphManifest().normalization; normalization.mean[73] = [3, 4]; normalization.mean[74] = [.5, .1];
  assert.deepEqual(normalizePoseGraphForParity(features, normalization)[0][73], [0, 0, 0]);
  assert.equal(normalizePoseGraphForParity(features, normalization)[0][74][2], 1);
  assert.equal(data[74 * 3 + 2], 1);
  assert.throws(() => validateGraphNormalization({ ...normalization, stage: "browser" }), /once inside the model/);
});
test("disjoint hand/shoulder visibility cannot create a zero-valid model input", () => {
  const base = graphFrames()[0];
  const frames = Array.from({ length: 10 }, (_, index) => {
    const frame = structuredClone(base); frame.confidences.fill(0);
    if ([0, 3, 6, 9].includes(index)) frame.confidences[33] = 1;
    if ([1, 2, 7, 8].includes(index)) frame.confidences[11] = frame.confidences[12] = .2;
    return frame;
  });
  assert.deepEqual(preprocessPoseGraph(frames), []);
});
