// Built-in gestures (recognized by MediaPipe's model out of the box) and the per-frame decision.
import { toFeatures } from "./features.js";
import { normalizeLabel } from "./knn.js";

// These are gesture shortcuts, not Indian Sign Language. Users can rename or switch them off,
// and teach real ISL signs in "Teach signs".
export const BUILT_IN_GESTURES = [
  { id: "Open_Palm", emoji: "✋", name: "Open palm", word: "HELLO" },
  { id: "Thumb_Up", emoji: "👍", name: "Thumb up", word: "YES" },
  { id: "Thumb_Down", emoji: "👎", name: "Thumb down", word: "NO" },
  { id: "Closed_Fist", emoji: "✊", name: "Closed fist", word: "STOP" },
  { id: "Pointing_Up", emoji: "☝️", name: "Pointing up", word: "WAIT" },
  { id: "Victory", emoji: "✌️", name: "Victory", word: "BYE" },
  { id: "ILoveYou", emoji: "🤟", name: "I love you", word: "I LOVE YOU" },
];

export const MIN_SIGN_CONFIDENCE = 0.6;
// Real photos: true gestures score 0.51–0.92 (median 0.77); relaxed hands misread as a
// gesture score ≤ 0.56. The smoother adds a hold time on top of this.
export const MIN_GESTURE_SCORE = 0.55;

/** Saved gesture settings merged over the defaults; unknown or broken entries are ignored. */
export function gestureMap(saved) {
  const map = {};
  for (const g of BUILT_IN_GESTURES) {
    const s = saved?.[g.id];
    const word = typeof s?.word === "string" ? normalizeLabel(s.word) : "";
    map[g.id] = { word: word || g.word, enabled: typeof s?.enabled === "boolean" ? s.enabled : true };
  }
  return map;
}

/**
 * Which word (if any) the current frame shows. Taught signs win over built-in gestures.
 * → { label, source: "taught" | "gesture" | null, confidence }
 */
export function decideSign(hands, aspect, classifier, gestures) {
  if (!hands.length) return { label: null, source: null, confidence: 0 };

  if (classifier?.size) {
    const p = classifier.predict(toFeatures(hands, aspect));
    if (p?.label && p.confidence >= MIN_SIGN_CONFIDENCE) {
      return { label: p.label, source: "taught", confidence: p.confidence };
    }
  }

  let best = null;
  for (const hand of hands) {
    const g = hand.gesture;
    if (g && g.name !== "None" && (!best || g.score > best.score)) best = g;
  }
  const mapped = best && gestures[best.name];
  if (mapped?.enabled && mapped.word && best.score >= MIN_GESTURE_SCORE) {
    return { label: mapped.word, source: "gesture", confidence: best.score };
  }
  return { label: null, source: null, confidence: 0 };
}
