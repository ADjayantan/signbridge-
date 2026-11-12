/**
 * Pose vocabulary shared by the 3D sign stage, the live camera mirror and their tests.
 *
 * A hand spec describes one hand the way the stage poses it:
 * - finger curls: 0 = straight up (+Y), 1 = curled forward (+Z) into a tight fist
 * - finger splays: extra Z spread angle in radians
 * - thumbMode:
 *    "open"   = abducted outward in natural open-palm salute
 *    "wide"   = abducted wide at ~85° (for I LOVE YOU 🤟, COME HERE 👆, CALL ME 🤙, PLEASE 🖐️)
 *    "tucked" = folded flat across the palm (for THANK YOU 🤚, BYE ✌️, GOOD 🤘, WAIT ☝️, WATER 3️⃣, FOOD 🍽️)
 *    "fist"   = wrapped securely across the curled fingers (for SORRY / STOP ✊)
 *    "up"     = extended straight along the radial side for Thumbs Up 👍 / Thumbs Down 👎
 *    "pinch"  = curved forward to touch the index fingertip in a clean round O-circle (for OK 👌)
 */
export function makeHandSpec({
  thumb = "open",
  index = 0,
  middle = 0,
  ring = 0,
  pinky = 0,
  splay = 0.03,
  pos = [0, -0.18, 0],
  rot = [0, 0, 0], // [pitchX, yawY, rollZ] of the whole hand
  anim = "idle",
  mirrorX = 1,
} = {}) {
  return {
    thumb,
    index,
    middle,
    ring,
    pinky,
    splay,
    pos,
    rot,
    anim,
    mirrorX,
  };
}

/**
 * How far each finger joint turns, in radians, at curl = 1: knuckle (MCP), middle joint (PIP),
 * end joint (DIP). All three are positive X rotations, so a finger can only bend toward the palm.
 */
export const FINGER_CURL_GAINS = [1.42, 1.68, 1.12];

/**
 * Target Euler angles [rx, ry, rz] for the three thumb joints (CMC, MCP, IP) in each thumb mode.
 * In local right-hand space the thumb starts on the -X side of the palm:
 *  +rz tilts the thumb outward to the left (-X),
 *  -rz folds the thumb inward across the palm (+X),
 *  +rx tilts the thumb forward toward the viewer (+Z).
 */
export const THUMB_MODE_ANGLES = {
  // Natural relaxed open-palm thumb for HELLO ✋, HOW ARE YOU 👐
  open: { cmc: [0.16, 0.14, 0.56], mcp: [0.05, 0, -0.06], ip: [0.03, 0, -0.04] },
  // Abducted wide (~72° outward) for I LOVE YOU 🤟, COME HERE 👆, CALL ME 🤙, PLEASE 🖐️
  wide: { cmc: [0.14, 0.16, 0.94], mcp: [0.04, 0, 0.14], ip: [0.02, 0, 0.06] },
  // Abducted at 70° in the palm plane so when the hand rolls -66° (YES 👍) or +112° (NO 👎),
  // the thumb points straight UP (+Y) or DOWN (-Y)
  up: { cmc: [0.06, 0.08, 0.92], mcp: [0.02, 0, 0.18], ip: [0.0, 0, 0.08] },
  // Folded neatly across the front of the palm (+Z) without intersecting the palm mesh
  tucked: { cmc: [0.46, -0.18, -0.2], mcp: [0.22, 0, -0.64], ip: [0.16, 0, -0.46] },
  // Wrapped securely in front of (+Z) the curled fingers for SORRY / STOP ✊
  fist: { cmc: [0.74, -0.16, 0.04], mcp: [0.28, 0, -0.76], ip: [0.22, 0, -0.56] },
  // Generic O-pinch toward the index fingertip for OK 👌. A rig can override this with angles
  // solved for its own proportions (see MODEL_PINCH_POSE in handModelRig.js).
  pinch: { cmc: [0.5, -0.1, 0.12], mcp: [0.24, 0, -0.18], ip: [0.38, 0, -0.15] },
};

export function thumbAnglesFor(mode) {
  return THUMB_MODE_ANGLES[mode] || THUMB_MODE_ANGLES.open;
}
