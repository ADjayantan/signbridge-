import test from "node:test";
import assert from "node:assert/strict";
import { validateTasksExtractionSelection, tasksTrainingSampleTimes, tasksTrainingFrame,
  TASKS_TRAINING_CONFIG, TASKS_TRAINING_LIMITS, extractTasksTraining } from "../scripts/extract-tasks-training.browser.js";
import { validateCameraTurn } from "../src/lib/graphSignModel.js";

const sha = "a".repeat(64);
const row = (id, split = "train") => ({ clipId: `Greetings/48. Hello/${id}.MOV`,
  localFile: `${id}.MOV`, sha256: sha, split, label: "HELLO" });
const file = (name, size = 123) => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });
const wrap = (clips) => ({ format: "signbridge-tasks-video-study-manifest-v1", clips });
const manifest = { format: "signbridge-tasks-video-study-manifest-v1", clips: [row("train"), row("val", "val"), row("unknown", "unknown_train"), row("test", "test")] };
const files = ["train.MOV", "val.MOV", "unknown.MOV"].map((name) => file(name));

test("bulk extraction is local DEV only even when imported in plain Node", async () => {
  await assert.rejects(extractTasksTraining(), /Local development only/);
});

test("strict learning selection cannot include final clips and follows frozen manifest order", () => {
  const chosen = validateTasksExtractionSelection(manifest, files.slice().reverse(), { partitionGroup: "learning" });
  assert.deepEqual(chosen.map(({ row: selected }) => selected.clipId), manifest.clips.slice(0, 3).map((selected) => selected.clipId));
  assert.throws(() => validateTasksExtractionSelection(manifest, [file("test.MOV")],
    { partitionGroup: "learning", clipIds: [manifest.clips[3].clipId] }), /partition group/);
  const final = validateTasksExtractionSelection(manifest, [file("test.MOV")], { partitionGroup: "test" });
  assert.equal(final.length, 1); assert.equal(final[0].row.split, "test");
});

test("explicit chunk selection requires exactly its File names and identities", () => {
  assert.equal(validateTasksExtractionSelection(manifest, [file("val.MOV")],
    { partitionGroup: "learning", clipIds: [manifest.clips[1].clipId] }).length, 1);
  for (const [selected, subset] of [[files, [manifest.clips[1].clipId]], [[file("other.MOV")], [manifest.clips[1].clipId]],
    [[file("val.MOV")], []], [[file("val.MOV")], [manifest.clips[1].clipId, manifest.clips[1].clipId]]]) {
    assert.throws(() => validateTasksExtractionSelection(manifest, selected, { partitionGroup: "learning", clipIds: subset }));
  }
});

test("legacy keys, aliases, traversal and ambiguous case variants fail closed", () => {
  const faults = [
    { ...row("x"), clip_id: row("x").clipId, clipId: undefined },
    { ...row("x"), local_file: "x.MOV", localFile: undefined },
    { ...row("x"), split: "unknown_validation" },
    { ...row("x"), clipId: "../x.MOV" },
    { ...row("x"), localFile: "nested/x.MOV" },
    { ...row("x"), sha256: "A".repeat(64) },
    { ...row("x"), label: undefined },
    { ...row("x"), label: " HELLO" },
    { ...row("x"), label: "HELLO\nOTHER" },
    { ...row("x"), label: "X".repeat(81) },
    { ...row("x"), localFile: "C:\\private\\x.MOV" },
  ];
  for (const fault of faults) assert.throws(() => validateTasksExtractionSelection(wrap([fault]), [file("x.MOV")], { partitionGroup: "learning" }));
  assert.throws(() => validateTasksExtractionSelection(wrap([row("x"), { ...row("X"), clipId: "other/X.MOV" }]),
    [file("x.MOV"), file("X.MOV")], { partitionGroup: "learning" }), /ambiguous/);
});

test("only the exact frozen final manifest format is accepted", () => {
  for (const format of [undefined, null, "signbridge-tasks-video-study-v1", "signbridge-tasks-video-poses-v1"]) {
    assert.throws(() => validateTasksExtractionSelection({ ...manifest, format }, files, { partitionGroup: "learning" }), /frozen manifest/);
  }
});

test("test extraction selects both known and unsupported final identities but no learning rows", () => {
  const finalManifest = wrap([row("train"), row("unknown-val", "unknown_val"), row("test", "test"), row("unknown-test", "unknown_test")]);
  const chosen = validateTasksExtractionSelection(finalManifest, [file("unknown-test.MOV"), file("test.MOV")], { partitionGroup: "test" });
  assert.deepEqual(chosen.map(({ row: selected }) => selected.split), ["test", "unknown_test"]);
  assert.throws(() => validateTasksExtractionSelection(finalManifest, [file("train.MOV")],
    { partitionGroup: "test", clipIds: [finalManifest.clips[0].clipId] }), /partition group/);
});

test("file and manifest quotas are checked before decoding or hashing", () => {
  assert.throws(() => validateTasksExtractionSelection(manifest, files, {}), /learning or test/);
  assert.throws(() => validateTasksExtractionSelection(wrap(Array.from({ length: 101 }, (_, i) => row(String(i)))), [],
    { partitionGroup: "learning" }), /one hundred/);
  assert.throws(() => validateTasksExtractionSelection(wrap([row("x")]), [file("x.MOV", TASKS_TRAINING_LIMITS.videoBytes + 1)],
    { partitionGroup: "learning" }), /oversized/);
  const clips = Array.from({ length: 30 }, (_, i) => row(String(i)));
  assert.throws(() => validateTasksExtractionSelection(wrap(clips), clips.map((selected) => file(selected.localFile, 40 * 1024 * 1024)),
    { partitionGroup: "learning" }), /one-GB/);
});

test("real source sampling has no repeated end frames or invented holds", () => {
  assert.deepEqual(tasksTrainingSampleTimes(500), [0, 125, 250, 375]);
  const times = tasksTrainingSampleTimes(1960);
  assert.equal(times.length, 16); assert.equal(times.at(-1), 1875);
  assert.ok(times.every((time, index) => time < 1960 && (index === 0 || time > times[index - 1])));
  assert.equal(tasksTrainingSampleTimes(12000).length, 96);
  for (const duration of [349, 350, 12001, Infinity, NaN]) assert.throws(() => tasksTrainingSampleTimes(duration));
});

test("detected hands retain confidence despite absent SDK visibility; exported pose is XY-confidence", () => {
  const points = (count) => Array.from({ length: count }, () => ({ x: .4, y: .6, z: -.7, visibility: 0 }));
  const body = points(33); body[11] = { x: .3, y: .5, visibility: 1 }; body[12] = { x: .7, y: .5, visibility: 1 };
  const detected = { poseLandmarks: [body], leftHandLandmarks: [points(21)] };
  const frames = tasksTrainingSampleTimes(500).map((atMs) => tasksTrainingFrame(detected, atMs));
  assert.deepEqual(frames[0].serialized.pose[33], [.4, .6, 1]);
  assert.deepEqual(frames[0].frame.keypoints[33], [.4, .6, -.7]);
  assert.deepEqual(frames[0].serialized.pose[54], [0, 0, 0]);
  assert.equal(validateCameraTurn(frames.map(({ frame }) => frame), { durationMs: 500 }).ok, true);
  assert.equal(TASKS_TRAINING_CONFIG.width, 1280); assert.equal(TASKS_TRAINING_CONFIG.height, 720);
});

test("empty actual detection remains a rejected measured sequence", () => {
  const frames = tasksTrainingSampleTimes(500).map((atMs) => tasksTrainingFrame({}, atMs).frame);
  const gate = validateCameraTurn(frames, { durationMs: 500 });
  assert.equal(gate.ok, false); assert.equal(gate.code, "framing");
});
