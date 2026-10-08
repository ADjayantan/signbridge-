import { POSE_JOINTS } from "../../src/lib/trainedSignModel.js";

// A deliberately biased synthetic model reveals whether a bad capture reached inference.
export function legacyCameraModel() {
  return {
    format: "signbridge-gru-v1", signLanguage: "asl", labels: ["BOOK", "DRINK"],
    frames: 32, inputSize: 81, hiddenSize: 1, joints: [...POSE_JOINTS],
    threshold: .98, margin: .3, mean: Array(81).fill(0), std: Array(81).fill(1),
    weights: {
      weight_ih_l0: Array.from({ length: 3 }, () => Array(81).fill(0)),
      weight_hh_l0: [[0], [0], [0]], bias_ih_l0: [0, 0, 0], bias_hh_l0: [0, 0, 0],
      head_weight: [[0], [0]], head_bias: [20, -20],
    },
  };
}

export function legacyCameraFrame({ hand = true, shoulders = true, atMs = 0 } = {}) {
  const keypoints = Array.from({ length: 75 }, () => [.5, .5, 0]);
  const confidences = Array(75).fill(1);
  keypoints[11] = [.3, .5, 0]; keypoints[12] = [.7, .5, 0];
  confidences[11] = confidences[12] = shoulders ? 1 : 0;
  if (!hand) confidences.fill(0, 33);
  return { keypoints, confidences, atMs };
}

export const legacyCameraFrames = (count = 4) => Array.from({ length: count }, (_, index) => legacyCameraFrame({ atMs: index * 125 }));
