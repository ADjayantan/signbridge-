import { useTrainedModel } from "./useTrainedModel.js";
import { useGraphSignModel } from "./useGraphSignModel.js";
import { predictTrainedCameraSign } from "../lib/cameraWordRecognition.js";

// Model choice is explicit. Unavailable graph weights never select another model.
export function useWordRecognitionModel(signLanguage, engine = "legacy") {
  const legacy = useTrainedModel(signLanguage);
  const graph = useGraphSignModel(signLanguage, { enabled: engine === "graph" });
  if (engine === "graph") return { ...graph, engine, async: true };
  return { ...legacy, engine: "legacy", async: false, cancel: () => {}, predict: (frames, options) => predictTrainedCameraSign(legacy.model, frames, options) };
}
