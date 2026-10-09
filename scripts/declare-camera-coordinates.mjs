import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateTrainedModel } from "../src/lib/trainedSignModel.js";

const sha = (value) => createHash("sha256").update(value).digest("hex");

/** Create a separate audited compatibility artifact; never infer scales or overwrite files. */
export async function declareCameraCoordinates(inputPath, outputPath, scaleX, scaleY) {
  const bytes = await readFile(inputPath), original = JSON.parse(bytes.toString("utf8"));
  validateTrainedModel(original);
  if (original.format !== "signbridge-gru-v1") throw new Error("Choose an unmodified v1 artifact as the migration source.");
  const model = { ...original, format: "signbridge-gru-v2", cameraInput: {
    format: "signbridge-camera-coordinates-v1", space: scaleX === 1 && scaleY === 1 ? "normalized-image" : "axis-scaled-image", scaleX, scaleY,
  } };
  validateTrainedModel(model);
  const output = `${JSON.stringify(model)}\n`;
  const unchanged = (value) => { const { format, cameraInput, ...trainingAndWeights } = value; return JSON.stringify(trainingAndWeights); };
  if (unchanged(original) !== unchanged(JSON.parse(output))) throw new Error("Migration changed learned model content.");
  await writeFile(outputPath, output, { flag: "wx" });
  return { sourceSha256: sha(bytes), outputSha256: sha(output), weightsAndThresholdsUnchanged: true, cameraInput: model.cameraInput };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, outputPath, scaleX, scaleY, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputPath || scaleX === undefined || scaleY === undefined || extra.length) {
    console.error("Usage: node scripts/declare-camera-coordinates.mjs INPUT.json NEW_OUTPUT.json AUDITED_SCALE_X AUDITED_SCALE_Y");
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await declareCameraCoordinates(inputPath, outputPath, Number(scaleX), Number(scaleY)))); }
    catch (cause) { console.error(cause.message); process.exitCode = 1; }
  }
}
