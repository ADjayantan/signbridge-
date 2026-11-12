/**
 * Live camera mirror: turns tracked hand landmarks into pose specs for the 3D stage.
 *
 * Coordinates. The webcam preview is shown mirrored (CSS scaleX(-1)), but MediaPipe reports raw
 * sensor coordinates, so everything here converts once to what the user actually sees:
 *   screenX = 1 - lm.x   (0 = left edge of the preview, 1 = right edge)
 *   screenY = -lm.y      (up is positive)
 * On the stage +X is screen right, +Y is up and +Z points at the viewer (palm side).
 *
 * Landmarks are normalised separately by frame width and height, so on a 16:9 camera a sideways
 * distance looks only 56% as long as the same distance upward. Every measurement below is taken
 * after stretching x (and z) back by the frame's aspect ratio; without that a relaxed hand reads
 * as a pinch and tilts are under-reported.
 */
import { makeHandSpec } from "./handPoseSpec.js";

/** In "up" mode the rig's thumb sits this far (radians) from the finger axis, on the thumb side. */
const UP_THUMB_ANGLE = 1.15;

/**
 * Where the stage hand's thumb tip sits for each thumb pose it can show, in the palm frame:
 * [mode, along the hand (wrist -> middle knuckle = 1), across the hand (+ = pinky side)].
 * The live thumb is shown in whichever of these poses puts the 3D thumb tip closest to the user's.
 * Measured on the sculpted model; tests/liveHandMirror.test.js re-measures them.
 */
export const THUMB_TIP_REFERENCES = [
  ["open", 1.15, -0.7],
  ["wide", 0.83, -1.02],
  ["tucked", 0.83, 0.15],
];

/**
 * The curl measurement below is not proportional: it stays at 0 for the first tenth of a curl,
 * races through the middle and flattens out for a nearly closed finger, so a slowly closing hand
 * used to look open, then snap shut. These [measured value, real curl] pairs were taken by posing
 * the stage hand at known curls and reading it back; looking a measurement up in them gives the
 * curl that makes the 3D finger reproduce what the camera saw. The two ends are deliberately not
 * followed all the way (the measurement is flat there, and chasing it would amplify tracker noise).
 */
const CURL_RESPONSE = [
  [0, 0.04],
  [0.047, 0.2],
  [0.14, 0.3],
  [0.267, 0.4],
  [0.409, 0.45],
  [0.561, 0.5],
  [0.709, 0.55],
  [0.808, 0.6],
  [0.87, 0.65],
  [0.914, 0.74],
  [0.955, 0.88],
  [1, 1],
];

function curlFromMeasurement(measured) {
  for (let i = 1; i < CURL_RESPONSE.length; i++) {
    const [x0, y0] = CURL_RESPONSE[i - 1];
    const [x1, y1] = CURL_RESPONSE[i];
    if (measured <= x1) return y0 + ((Math.max(x0, measured) - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

/**
 * Converts the on-screen direction of the user's hand (wrist -> middle knuckle, in the mirrored
 * webcam preview: +dx = toward the right of the screen, +dy = up) into the 3D hand's Z roll.
 * In Three.js a NEGATIVE Z rotation tilts the top of the hand toward +X (screen right).
 */
export function liveWristRoll(dxScreen, dyScreen) {
  // TODO(human): decide how faithfully the 3D hand should follow the user's wrist tilt.
  // Current behaviour (kept from the original rig): 70% of the real tilt, capped at about 37°,
  // and hands pointing sideways or downward are treated as upright.
  const wristTilt = Math.max(-0.65, Math.min(0.65, Math.atan2(dxScreen, Math.max(0.05, dyScreen)) * 0.7));
  return -wristTilt;
}

/**
 * Roll for a fist with the thumb out (thumbs up / down): turns the hand so the 3D thumb points
 * exactly where the user's thumb points on screen. Straight up gives the YES sign's -66°, straight
 * down the NO sign's +112°, and everything in between follows continuously.
 */
function thumbPointingRoll(dxScreen, dyScreen, mirrorX) {
  const pointing = Math.atan2(-dxScreen, dyScreen); // counter-clockwise from straight up
  let roll = pointing - UP_THUMB_ANGLE * mirrorX;
  // Keep thumbs-up and thumbs-down both far from the wrap-around so the hand never spins a full turn.
  const centre = (Math.PI / 2 - UP_THUMB_ANGLE) * mirrorX;
  while (roll > centre + Math.PI) roll -= 2 * Math.PI;
  while (roll <= centre - Math.PI) roll += 2 * Math.PI;
  return roll;
}

/** Screen-space X of a hand in the mirrored webcam preview (0 = left edge, 1 = right edge). */
export function liveScreenX(hand) {
  const lm = hand?.landmarks;
  return Array.isArray(lm) && lm.length === 21 ? 1 - lm[9].x : 0.5;
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.6); // depth counts for less: it is noisy

/**
 * The measurements everything else is built on: the landmarks in square units, the hand's size,
 * and the palm frame. `along` runs wrist -> middle knuckle and `across` points at the pinky side,
 * so anything expressed in that frame stays the same however the hand is turned, sized or placed
 * in the picture, and whichever hand it is.
 */
function measurePalm(landmarks, aspect) {
  const stretch = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // Image points in frame heights. x still runs along the raw sensor, y downward.
  const p = landmarks.map((lm) => ({ x: lm.x * stretch, y: lm.y, z: (lm.z || 0) * stretch }));
  const palm = Math.max(0.02, d2(p[0], p[9]));
  const palmWidth = Math.max(d2(p[5], p[17]), palm * 0.5);
  // Hand size that survives the palm being foreshortened (hand tipped toward the camera).
  const size = Math.max(palm, palmWidth * 1.45);

  const axisLength = d2(p[0], p[9]);
  const along = axisLength > 1e-6 ? { x: (p[9].x - p[0].x) / axisLength, y: (p[9].y - p[0].y) / axisLength } : { x: 0, y: -1 };
  let across = { x: -along.y, y: along.x };
  const knuckleRow = (p[17].x - p[5].x) * across.x + (p[17].y - p[5].y) * across.y;
  const pinkyOnTurnedSide = knuckleRow < 0;
  if (pinkyOnTurnedSide) across = { x: -across.x, y: -across.y };

  return {
    p,
    size,
    knuckleRow,
    pinkyOnTurnedSide,
    thumbAlong: ((p[4].x - p[0].x) * along.x + (p[4].y - p[0].y) * along.y) / size,
    thumbAcross: ((p[4].x - p[0].x) * across.x + (p[4].y - p[0].y) * across.y) / size,
  };
}

/** The tracked thumb tip in the palm frame, in the same units as THUMB_TIP_REFERENCES. */
export function thumbTipInPalmFrame(landmarks, { aspect = 1 } = {}) {
  const { thumbAlong, thumbAcross } = measurePalm(landmarks, aspect);
  return [thumbAlong, thumbAcross];
}

/**
 * Reads one tracked hand (21 MediaPipe landmarks, raw sensor coordinates) into a stage pose:
 * finger curls, thumb pose, which way round the hand is, its tilt and where it is on screen.
 * Fingers can only come out curled toward the palm (0..1), never bent backwards.
 *
 * options.aspect: frame width / height of the camera the landmarks came from. 1 = unknown.
 */
export function extractLiveHandSpec(landmarks, handIndex = 0, totalHands = 1, { aspect = 1 } = {}) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const { p, size, knuckleRow, pinkyOnTurnedSide, thumbAlong, thumbAcross } = measurePalm(landmarks, aspect);

  const computeFingerCurl = (mcp, pip, dip, tip) => {
    const chain = Math.max(1e-4, d3(p[mcp], p[pip]) + d3(p[pip], p[dip]) + d3(p[dip], p[tip]));
    const direct = d3(p[mcp], p[tip]);
    const straightness = direct / chain; // ~0.92 when straight, ~0.45 when curled
    const tipWrist = d2(p[tip], p[0]);
    const pipWrist = Math.max(1e-4, d2(p[pip], p[0]));
    const ratio = tipWrist / pipWrist; // ~1.30 when straight, <0.95 when curled
    const curlFromStraightness = 1 - Math.max(0, Math.min(1, (straightness - 0.50) / 0.38));
    const curlFromRatio = 1 - Math.max(0, Math.min(1, (ratio - 0.88) / 0.36));
    return Math.max(0, Math.min(1, curlFromStraightness * 0.55 + curlFromRatio * 0.45));
  };

  // Raw measurements: used for the yes/no decisions below. The pose itself gets calibrated curls.
  const indexCurl = computeFingerCurl(5, 6, 7, 8);
  const middleCurl = computeFingerCurl(9, 10, 11, 12);
  const ringCurl = computeFingerCurl(13, 14, 15, 16);
  const pinkyCurl = computeFingerCurl(17, 18, 19, 20);
  const allCurled = indexCurl > 0.62 && middleCurl > 0.62 && ringCurl > 0.62 && pinkyCurl > 0.62;

  // Which way round the hand is. Judged from the order wrist -> index knuckle -> pinky knuckle,
  // which does not change when the hand rotates in the picture (comparing left/right positions
  // does: a thumbs-down used to come out as the opposite hand). Only a hand seen edge-on, where
  // the knuckle row collapses onto the hand axis, falls back to the thumb's side of the screen.
  const thumbOnLeftScreen = (1 - landmarks[4].x) <= (1 - landmarks[17].x);
  const edgeOn = Math.abs(knuckleRow) < size * 0.12;
  const mirrorX = (edgeOn ? thumbOnLeftScreen : pinkyOnTurnedSide) ? 1 : -1;

  // Thumb pose: a real pinch first, otherwise the stage pose whose thumb tip is nearest.
  let thumbMode = "open";
  let nearest = Infinity;
  for (const [mode, refAlong, refAcross] of THUMB_TIP_REFERENCES) {
    const gap = Math.hypot(thumbAlong - refAlong, thumbAcross - refAcross);
    if (gap < nearest) {
      nearest = gap;
      thumbMode = mode;
    }
  }
  // Fingertips touching (OK pinch). The two tips must meet in the picture; depth is only allowed
  // to veto a gross mismatch, because tracked depth is too noisy to be the main evidence. In
  // square units a relaxed, half-closed hand keeps its index tip well clear of the thumb tip.
  const pinching = d2(p[4], p[8]) < size * 0.3 && d3(p[4], p[8]) < size * 0.45 && middleCurl < 0.45 && ringCurl < 0.45;

  // Screen-space directions matching the mirrored webcam preview (x flipped, y up).
  const dxScreen = -(p[9].x - p[0].x);
  const dyScreen = -(p[9].y - p[0].y);
  let rollZ = 0;

  if (pinching) {
    thumbMode = "pinch";
  } else if (allCurled) {
    // A closed hand. The thumb is either held against the fist or sticking out of it.
    let thumbToFist = Infinity;
    for (const joint of [6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20]) thumbToFist = Math.min(thumbToFist, d2(p[4], p[joint]));
    if (thumbToFist < size * 0.36 || thumbMode === "tucked") {
      thumbMode = "fist";
    } else {
      // Thumb out. It is a thumbs up / down when the thumb tip is the very top or the very bottom
      // of the hand; a thumb merely sticking out sideways stays an open or wide thumb.
      const others = p.filter((_, i) => i !== 4).map((point) => point.y);
      const tolerance = size * 0.03;
      const thumbHighest = p[4].y < Math.min(...others) - tolerance;
      const thumbLowest = p[4].y > Math.max(...others) + tolerance;
      if (thumbHighest || thumbLowest) {
        thumbMode = "up";
        rollZ = thumbPointingRoll(-(p[4].x - p[2].x), -(p[4].y - p[2].y), mirrorX);
      }
    }
  }
  if (thumbMode !== "up") {
    rollZ = liveWristRoll(dxScreen, dyScreen);
  }

  // Position follows the hand on screen: left in the preview = -X, right = +X, up = +Y.
  // With two hands the stage is wider, and each hand keeps to its own half so they never merge.
  const previewX = landmarks[9].x;
  const previewY = landmarks[9].y;
  let stageX = Math.max(-0.45, Math.min(0.45, (0.5 - previewX) * 0.85));
  if (totalHands > 1) {
    const wideX = Math.max(-1.2, Math.min(1.2, (0.5 - previewX) * 2.6));
    stageX = handIndex === 0 ? Math.min(-0.5, wideX) : Math.max(0.5, wideX);
  }
  const screenOffsetY = Math.max(-0.35, Math.min(0.35, (0.52 - previewY) * 0.65));

  return makeHandSpec({
    thumb: thumbMode,
    index: thumbMode === "pinch" ? 0.68 : curlFromMeasurement(indexCurl),
    middle: curlFromMeasurement(middleCurl),
    ring: curlFromMeasurement(ringCurl),
    pinky: curlFromMeasurement(pinkyCurl),
    splay: 0.045,
    pos: [stageX, -0.18 + screenOffsetY, 0.04],
    rot: [0.05, mirrorX === -1 ? -0.15 : 0.15, rollZ],
    anim: "none",
    mirrorX,
  });
}

/**
 * Pose specs for the hands the tracker currently sees (at most two). The primary slot is always
 * the hand on the LEFT of the mirrored preview and the secondary the one on the right, whatever
 * order the tracker reports them in.
 */
export function liveHandSpecs(liveHands, options = {}) {
  const hands = Array.isArray(liveHands) ? liveHands.slice(0, 2) : [];
  if (!hands.length) return { primary: null, secondary: null };
  if (hands.length > 1) hands.sort((a, b) => liveScreenX(a) - liveScreenX(b));
  let primary = extractLiveHandSpec(hands[0]?.landmarks, 0, hands.length, options);
  let secondary = hands.length > 1 ? extractLiveHandSpec(hands[1]?.landmarks, 1, hands.length, options) : null;
  if (!primary) {
    primary = secondary;
    secondary = null;
  }
  return { primary, secondary };
}
