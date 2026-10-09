import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { declareCameraCoordinates } from "../scripts/declare-camera-coordinates.mjs";
import { legacyCameraModel } from "./helpers/legacyCamera.js";

test("artifact declaration preserves learned data and the original, refuses overwrite and rejects unsafe metadata", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "signbridge-coordinate-test-"));
  try {
    const input = path.join(temporary, "original.json"), output = path.join(temporary, "declared.json");
    const model = legacyCameraModel(), original = JSON.stringify(model, null, 2);
    await writeFile(input, original);
    const result = await declareCameraCoordinates(input, output, 1080, 1920);
    const migrated = JSON.parse(await readFile(output, "utf8"));
    assert.equal(migrated.format, "signbridge-gru-v2");
    assert.deepEqual(migrated.cameraInput, { format: "signbridge-camera-coordinates-v1", space: "axis-scaled-image", scaleX: 1080, scaleY: 1920 });
    delete migrated.cameraInput; migrated.format = "signbridge-gru-v1";
    assert.deepEqual(migrated, model);
    assert.equal(await readFile(input, "utf8"), original);
    assert.equal(result.weightsAndThresholdsUnchanged, true); assert.notEqual(result.sourceSha256, result.outputSha256);
    await assert.rejects(declareCameraCoordinates(input, output, 1, 1), { code: "EEXIST" });
    assert.equal(JSON.parse(await readFile(output, "utf8")).cameraInput.scaleY, 1920);
    for (const badScale of [0, -1, NaN, 1.5, 16385]) await assert.rejects(declareCameraCoordinates(input, path.join(temporary, "invalid.json"), badScale, 1920), /camera-coordinate metadata/);
    await assert.rejects(declareCameraCoordinates(output, path.join(temporary, "again.json"), 1080, 1920), /unmodified v1/);
  } finally {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("signbridge-coordinate-test-")) throw new Error("Unexpected test directory.");
    await rm(resolved, { recursive: true, force: true });
  }
});
