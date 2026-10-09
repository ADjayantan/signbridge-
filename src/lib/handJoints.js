// MediaPipe's real 21-joint hand layout, shared by preview and feature adapters.
export const HAND_JOINT_COUNT = 21;
export const HAND_JOINT_NAMES = Object.freeze([
  "Wrist", "Thumb base", "Thumb knuckle", "Thumb joint", "Thumb tip",
  "Index knuckle", "Index middle joint", "Index outer joint", "Index tip",
  "Middle knuckle", "Middle middle joint", "Middle outer joint", "Middle tip",
  "Ring knuckle", "Ring middle joint", "Ring outer joint", "Ring tip",
  "Pinky knuckle", "Pinky middle joint", "Pinky outer joint", "Pinky tip",
]);
export const HAND_FINGERS = Object.freeze([
  { name: "Thumb", color: "#ffbe55", joints: [0, 1, 2, 3, 4] },
  { name: "Index", color: "#56c8ff", joints: [0, 5, 6, 7, 8] },
  { name: "Middle", color: "#65e6a5", joints: [0, 9, 10, 11, 12] },
  { name: "Ring", color: "#c9a3ff", joints: [0, 13, 14, 15, 16] },
  { name: "Pinky", color: "#ff9ab8", joints: [0, 17, 18, 19, 20] },
].map((finger) => Object.freeze({ ...finger, joints: Object.freeze(finger.joints) })));
export const HAND_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
].map(Object.freeze));

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** A missing, sparse or malformed hand is absent, never a skeleton of zero joints. */
export function isCompleteHandLandmarks(points) {
  return Array.isArray(points) && points.length === HAND_JOINT_COUNT &&
    Array.from(points).every((point) => point && finite(point.x) && finite(point.y) &&
      (point.z == null || finite(point.z)));
}

/** Body33 + left21 + right21 pose → complete, actually tracked preview hands. */
export function handsFromPoseFrame(pose) {
  if (!Array.isArray(pose?.keypoints) || !Array.isArray(pose?.confidences)) return [];
  const hands = [];
  for (const [handedness, offset] of [["Left", 33], ["Right", 54]]) {
    const points = pose.keypoints.slice(offset, offset + HAND_JOINT_COUNT);
    const confidences = pose.confidences.slice(offset, offset + HAND_JOINT_COUNT);
    if (points.length !== HAND_JOINT_COUNT || confidences.length !== HAND_JOINT_COUNT ||
      !Array.from(confidences).every((value) => finite(value) && value >= .5) ||
      !Array.from(points).every((point) => Array.isArray(point) && point.length === 3 && Array.from(point).every(finite))) continue;
    const landmarks = points.map(([x, y, z]) => ({ x, y, z }));
    hands.push({ landmarks, handedness, score: Math.min(1, ...confidences) });
  }
  return hands;
}

/** Counts refer to complete tracked hands; they do not establish a word or accuracy. */
export function handJointCounts(pose) {
  const hands = handsFromPoseFrame(pose);
  const left = hands.some((hand) => hand.handedness === "Left") ? HAND_JOINT_COUNT : 0;
  const right = hands.some((hand) => hand.handedness === "Right") ? HAND_JOINT_COUNT : 0;
  return { left, right, total: left + right, hands: hands.length };
}
