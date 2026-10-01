// Synthetic MediaPipe-style hands for unit tests.
// curl: one value per finger (thumb → pinky), 0 = straight, 1 = fully bent.
export const SHAPES = {
  open: [0, 0, 0, 0, 0],
  fist: [1, 1, 1, 1, 1],
  point: [1, 0, 1, 1, 1],
  victory: [1, 0, 0, 1, 1],
  call: [0, 1, 1, 1, 0],
};

const FINGER_ANGLES = [-0.9, -0.3, 0, 0.25, 0.5]; // radians from straight up
const KNUCKLE = [0.45, 0.95, 1, 0.95, 0.85]; // wrist → knuckle distance, in hand sizes
const SEGMENT = 0.38;

/**
 * Landmarks in pixels for a right hand, wrist at (cx, cy), `size` px from wrist to the middle
 * knuckle, rotated `rotate` radians in the image plane.
 */
export function handPixels({ cx = 320, cy = 360, size = 80, curl = SHAPES.open, rotate = 0, jitter = 0, rand = Math.random } = {}) {
  const noise = () => (rand() - 0.5) * 2 * jitter * size;
  const local = [{ x: 0, y: 0, z: 0 }];
  for (let f = 0; f < 5; f++) {
    let angle = FINGER_ANGLES[f];
    let x = Math.sin(angle) * KNUCKLE[f] * size;
    let y = -Math.cos(angle) * KNUCKLE[f] * size;
    let z = 0;
    local.push({ x, y, z });
    for (let k = 0; k < 3; k++) {
      angle += curl[f] * (f === 0 ? -0.66 : 1.1);
      x += Math.sin(angle) * SEGMENT * size;
      y -= Math.cos(angle) * SEGMENT * size;
      z -= curl[f] * 0.25 * size;
      local.push({ x, y, z });
    }
  }
  const c = Math.cos(rotate);
  const s = Math.sin(rotate);
  return local.map((p) => ({
    x: cx + p.x * c - p.y * s + noise(),
    y: cy + p.x * s + p.y * c + noise(),
    z: p.z + noise(),
  }));
}

/** Pixel landmarks → MediaPipe normalized image landmarks for a W×H frame. */
export function normalize(pixels, width, height) {
  return pixels.map((p) => ({ x: p.x / width, y: p.y / height, z: p.z / width }));
}

/** Pixel landmarks → world-style landmarks (metres around the hand, camera-aligned axes). */
export function world(pixels) {
  const cx = pixels.reduce((a, p) => a + p.x, 0) / pixels.length;
  const cy = pixels.reduce((a, p) => a + p.y, 0) / pixels.length;
  return pixels.map((p) => ({ x: (p.x - cx) * 0.001, y: (p.y - cy) * 0.001, z: p.z * 0.001 }));
}

/** A hand as handsFromResult returns it. Pass `withWorld: false` to test the image-only path. */
export function makeHand(pixels, { side = "Right", width = 640, height = 480, gesture = null, withWorld = true } = {}) {
  return {
    landmarks: normalize(pixels, width, height),
    world: withWorld ? world(pixels) : null,
    handedness: side,
    score: 0.95,
    gesture,
  };
}

/** The same hands seen in a horizontally flipped image. */
export function mirrorHands(hands) {
  return hands.map((h) => ({
    ...h,
    handedness: h.handedness === "Right" ? "Left" : "Right",
    landmarks: h.landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
    world: h.world ? h.world.map((p) => ({ x: -p.x, y: p.y, z: p.z })) : null,
  }));
}

/** Seeded random numbers so tests are repeatable. */
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
