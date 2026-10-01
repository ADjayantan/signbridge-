// Turns MediaPipe hand landmarks into a fixed-size feature vector for the sign classifier.
// Pure functions, unit-tested in tests/features.test.js.
//
// Each hand is described in its own coordinate frame (built from the wrist, the middle-finger
// knuckle and the knuckles across the palm), so the same handshape gives the same numbers
// wherever the hand is, however big it looks, and however it is rotated. Because orientation
// still matters in sign language (thumb up vs thumb down), the hand's direction and palm
// direction are added as separate, lighter features.

export const LANDMARKS = 21;
const ORIENTATION_WEIGHT = 1;
const HAND = 1 + LANDMARKS * 3 + 6; // presence + handshape (x, y, z per landmark) + orientation = 70
const BETWEEN = 2 * HAND; // offset of the wrist-to-wrist vector
export const FEATURE_SIZE = BETWEEN + 3; // two hand slots + wrist-to-wrist vector = 143
const BETWEEN_WEIGHT = 0.5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);

/** GestureRecognizer result → [{ landmarks, world, handedness: "Left" | "Right", score, gesture }] */
export function handsFromResult(result) {
  const hands = [];
  const all = result?.landmarks || [];
  for (let i = 0; i < all.length; i++) {
    const side = (result.handedness || result.handednesses)?.[i]?.[0];
    const gesture = result.gestures?.[i]?.[0];
    hands.push({
      landmarks: all[i],
      world: result.worldLandmarks?.[i] || null,
      handedness: side?.categoryName === "Left" ? "Left" : "Right",
      score: side?.score ?? 0,
      gesture: gesture ? { name: gesture.categoryName, score: gesture.score } : null,
    });
  }
  return hands;
}

// Slot 0 holds the hand MediaPipe labels "Right", slot 1 the "Left" one.
// If both get the same label, the second goes into the free slot.
function assignSlots(hands) {
  const slots = [null, null];
  const best = [...hands].sort((a, b) => b.score - a.score).slice(0, 2);
  for (const hand of best) {
    const want = hand.handedness === "Left" ? 1 : 0;
    if (!slots[want]) slots[want] = hand;
    else if (!slots[1 - want]) slots[1 - want] = hand;
  }
  return slots;
}

// 3D points for one hand: MediaPipe's world landmarks (metres) when present, otherwise the
// image landmarks with x and z scaled by the aspect ratio so all axes use the same unit.
function points(hand, aspect) {
  if (hand.world?.length === LANDMARKS) return hand.world.map((p) => [p.x, p.y, p.z]);
  return hand.landmarks.map((p) => [p.x * aspect, p.y, (p.z ?? 0) * aspect]);
}

function writeHand(out, base, hand, aspect) {
  const P = points(hand, aspect);
  const rel = P.map((p) => sub(p, P[0]));
  const size = length(rel[9]) || 1e-6;
  const y = scale(rel[9], 1 / size); // wrist → middle knuckle
  const across = sub(rel[5], rel[17]); // pinky knuckle → index knuckle
  let x = sub(across, scale(y, dot(across, y)));
  const xLength = length(x);
  x = xLength > 1e-9 ? scale(x, 1 / xLength) : Math.abs(y[0]) < 0.9 ? cross(y, [1, 0, 0]) : cross(y, [0, 1, 0]);
  const z = cross(x, y); // palm normal

  out[base] = 1;
  for (let j = 0; j < LANDMARKS; j++) {
    out[base + 1 + j * 3] = dot(rel[j], x) / size;
    out[base + 2 + j * 3] = dot(rel[j], y) / size;
    out[base + 3 + j * 3] = dot(rel[j], z) / size;
  }
  const o = base + 1 + LANDMARKS * 3;
  for (let k = 0; k < 3; k++) {
    out[o + k] = y[k] * ORIENTATION_WEIGHT;
    out[o + 3 + k] = z[k] * ORIENTATION_WEIGHT;
  }
}

/**
 * Feature vector for up to two hands.
 * @param aspect video width / height (used for image-space measurements).
 */
export function toFeatures(hands, aspect = 4 / 3) {
  const out = Array.from({ length: FEATURE_SIZE }, () => 0);
  const slots = assignSlots(hands);
  slots.forEach((hand, slot) => {
    if (hand) writeHand(out, slot * HAND, hand, aspect);
  });

  if (slots[0] && slots[1]) {
    // Where the hands are relative to each other, in image space, in hand sizes.
    const size = (lm) => Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y) || 1e-6;
    const a = slots[0].landmarks;
    const b = slots[1].landmarks;
    const unit = (size(a) + size(b)) / 2 / BETWEEN_WEIGHT;
    out[BETWEEN] = ((b[0].x - a[0].x) * aspect) / unit;
    out[BETWEEN + 1] = (b[0].y - a[0].y) / unit;
  }
  return out;
}

/**
 * Features of the left-right mirror image, so a sign taught with one hand is also recognized
 * with the other. Mirroring swaps the two hand slots and, in each hand's own frame, only flips
 * the palm-normal axis; the orientation vectors flip like a reflection.
 */
export function mirrorFeatures(vector) {
  const out = Array.from({ length: FEATURE_SIZE }, () => 0);
  for (let slot = 0; slot < 2; slot++) {
    const from = slot * HAND;
    const to = (1 - slot) * HAND;
    out[to] = vector[from];
    for (let j = 0; j < LANDMARKS; j++) {
      out[to + 1 + j * 3] = vector[from + 1 + j * 3];
      out[to + 2 + j * 3] = vector[from + 2 + j * 3];
      out[to + 3 + j * 3] = -vector[from + 3 + j * 3];
    }
    const of = from + 1 + LANDMARKS * 3;
    const ot = to + 1 + LANDMARKS * 3;
    out[ot] = -vector[of]; // hand direction: x flips
    out[ot + 1] = vector[of + 1];
    out[ot + 2] = vector[of + 2];
    out[ot + 3] = vector[of + 3]; // palm normal: y and z flip
    out[ot + 4] = -vector[of + 4];
    out[ot + 5] = -vector[of + 5];
  }
  // Swapping the slots reverses the wrist-to-wrist vector; mirroring flips x back.
  out[BETWEEN] = vector[BETWEEN];
  out[BETWEEN + 1] = -vector[BETWEEN + 1];
  out[BETWEEN + 2] = -vector[BETWEEN + 2];
  return out;
}

/** How many hands a feature vector contains (0, 1 or 2). */
export function handCount(vector) {
  return (vector[0] ? 1 : 0) + (vector[HAND] ? 1 : 0);
}
