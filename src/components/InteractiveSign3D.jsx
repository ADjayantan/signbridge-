import { useEffect, useRef, useState } from "react";
import { DAILY_CONVERSATION_SIGNS } from "../lib/handPoseShortcuts.js";

const FINGER_COLORS = [
  0xffbe55, // 0: Wrist
  0xffbe55, 0xffbe55, 0xffbe55, 0xffbe55, // 1-4: Thumb
  0x56c8ff, 0x56c8ff, 0x56c8ff, 0x56c8ff, // 5-8: Index
  0x65e6a5, 0x65e6a5, 0x65e6a5, 0x65e6a5, // 9-12: Middle
  0xc9a3ff, 0xc9a3ff, 0xc9a3ff, 0xc9a3ff, // 13-16: Ring
  0xff9ab8, 0xff9ab8, 0xff9ab8, 0xff9ab8, // 17-20: Pinky
];

const SKIN_THEMES = [
  {
    id: "warm",
    label: "Real Skin",
    color: 0xe0a382,
    nailColor: 0xf4cfc0,
    creaseColor: 0xb87658,
    sheen: 0xffc6ad,
    emissive: 0x240f08,
    roughness: 0.42,
    metalness: 0.02,
  },
  {
    id: "cyber",
    label: "Cyber Holo",
    color: 0x1ee6a8,
    nailColor: 0x8cf7d8,
    creaseColor: 0x0d7a58,
    sheen: 0x56c8ff,
    emissive: 0x09382c,
    roughness: 0.22,
    metalness: 0.48,
  },
  {
    id: "gold",
    label: "Sculpt Gold",
    color: 0xe6b873,
    nailColor: 0xffe6bd,
    creaseColor: 0x9e7232,
    sheen: 0xffe4b5,
    emissive: 0x2e1f08,
    roughness: 0.28,
    metalness: 0.58,
  },
];

/**
 * Anatomical specification of the 4 fingers in local hand space.
 * In local hand space:
 *  +Y = Up along extended fingers
 *  +Z = Palm side (facing viewer by default)
 *  -Z = Back of hand (dorsal side, where fingernails sit)
 *  -X = Thumb / Radial side (for right hand, mirrored for left hand)
 *  +X = Pinky / Ulnar side
 */
const FINGER_SPECS = [
  {
    name: "index",
    jointIndices: [5, 6, 7, 8],
    mountPos: [-0.36, 0.42, 0.0],
    baseSplayZ: 0.045,
    lengths: [0.39, 0.25, 0.19],
    radii: [0.102, 0.088, 0.076, 0.066],
  },
  {
    name: "middle",
    jointIndices: [9, 10, 11, 12],
    mountPos: [-0.11, 0.46, 0.0],
    baseSplayZ: 0.008,
    lengths: [0.44, 0.28, 0.20],
    radii: [0.106, 0.092, 0.079, 0.068],
  },
  {
    name: "ring",
    jointIndices: [13, 14, 15, 16],
    mountPos: [0.14, 0.43, -0.01],
    baseSplayZ: -0.032,
    lengths: [0.40, 0.26, 0.19],
    radii: [0.099, 0.085, 0.074, 0.064],
  },
  {
    name: "pinky",
    jointIndices: [17, 18, 19, 20],
    mountPos: [0.37, 0.36, -0.02],
    baseSplayZ: -0.075,
    lengths: [0.31, 0.20, 0.16],
    radii: [0.088, 0.076, 0.066, 0.056],
  },
];

/**
 * Exact articulated bone pose specification for a single hand.
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
function makeHandSpec({
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
 * Returns the exact 1-hand or 2-hand articulated pose configuration for all 20 Daily Conversation Signs.
 * Also maintains backward compatibility with get3DPoseForSign callers.
 */
export function get3DPoseForSign(meaning = "HELLO") {
  switch (meaning) {
    case "HELLO":
      return {
        primary: makeHandSpec({
          thumb: "open",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.05,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.08, 0],
          anim: "wave",
        }),
        secondary: null,
      };

    case "HOW ARE YOU":
      return {
        primary: makeHandSpec({
          thumb: "open",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.05,
          pos: [-0.88, -0.18, 0.06],
          rot: [0.08, 0.24, 0.06],
          anim: "welcome",
          mirrorX: 1,
        }),
        secondary: makeHandSpec({
          thumb: "open",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.05,
          pos: [0.88, -0.18, 0.06],
          rot: [0.08, -0.24, -0.06],
          anim: "welcome",
          mirrorX: -1,
        }),
      };

    case "I AM FINE":
      // Both thumbs up (👍👍): hands oriented so upright thumbs (+Y) and curled fingers are crystal clear
      return {
        primary: makeHandSpec({
          thumb: "up",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [-0.82, -0.10, 0.08],
          rot: [0.06, 0.28, -1.15],
          anim: "nod",
          mirrorX: 1,
        }),
        secondary: makeHandSpec({
          thumb: "up",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [0.82, -0.10, 0.08],
          rot: [0.06, -0.28, 1.15],
          anim: "nod",
          mirrorX: -1,
        }),
      };

    case "GOOD MORNING":
      // Namaste hands (🙏): both flat hands angled together at center
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.01,
          pos: [-0.46, -0.18, 0.12],
          rot: [0.06, 0.42, -0.16],
          anim: "bow",
          mirrorX: 1,
        }),
        secondary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.01,
          pos: [0.46, -0.18, 0.12],
          rot: [0.06, -0.42, 0.16],
          anim: "bow",
          mirrorX: -1,
        }),
      };

    case "NICE TO MEET YOU":
      // Both peace signs (✌️✌️)
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 1,
          pinky: 1,
          splay: 0.13,
          pos: [-0.82, -0.18, 0.06],
          rot: [0.04, 0.22, 0.04],
          anim: "meet",
          mirrorX: 1,
        }),
        secondary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 1,
          pinky: 1,
          splay: 0.13,
          pos: [0.82, -0.18, 0.06],
          rot: [0.04, -0.22, -0.04],
          anim: "meet",
          mirrorX: -1,
        }),
      };

    case "THANK YOU":
      // 4 fingers straight up together, thumb tucked into palm, nodding forward (🤚)
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.01,
          pos: [0, -0.18, 0.05],
          rot: [0.14, 0, 0],
          anim: "forwardNod",
        }),
        secondary: null,
      };

    case "PLEASE":
      // Thumb + Index + Middle extended, Ring + Pinky curled (🖐️)
      return {
        primary: makeHandSpec({
          thumb: "wide",
          index: 0,
          middle: 0,
          ring: 1,
          pinky: 1,
          splay: 0.09,
          pos: [0.05, -0.18, 0],
          rot: [0.04, -0.06, 0],
          anim: "circle",
        }),
        secondary: null,
      };

    case "SORRY":
      // Both closed fists (✊✊)
      return {
        primary: makeHandSpec({
          thumb: "fist",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [-0.76, -0.14, 0.08],
          rot: [0.08, 0.18, 0],
          anim: "circle",
          mirrorX: 1,
        }),
        secondary: makeHandSpec({
          thumb: "fist",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [0.76, -0.14, 0.08],
          rot: [0.08, -0.18, 0],
          anim: "circle",
          mirrorX: -1,
        }),
      };

    case "BYE":
      // Victory / V-sign (✌️) + wave
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 1,
          pinky: 1,
          splay: 0.15,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.06, 0],
          anim: "wave",
        }),
        secondary: null,
      };

    case "I LOVE YOU":
      // Thumb wide + Index up + Pinky up, Middle & Ring curled (🤟)
      return {
        primary: makeHandSpec({
          thumb: "wide",
          index: 0,
          middle: 1,
          ring: 1,
          pinky: 0,
          splay: 0.07,
          pos: [0.04, -0.18, 0],
          rot: [0.04, -0.08, 0],
          anim: "pulse",
        }),
        secondary: null,
      };

    case "YES":
      // Single-hand Thumbs Up (👍): hand rotated -66° on Z so the 70°-abducted thumb points straight UP (+Y)
      return {
        primary: makeHandSpec({
          thumb: "up",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [0.10, -0.06, 0.08],
          rot: [0.06, 0.25, -1.15],
          anim: "nod",
        }),
        secondary: null,
      };

    case "NO":
      // Single-hand Thumbs Down (👎): hand rotated +112° on Z so the 70°-abducted thumb points straight DOWN (-Y)
      return {
        primary: makeHandSpec({
          thumb: "up",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [-0.10, 0.14, 0.08],
          rot: [0.06, -0.25, 1.95],
          anim: "shake",
        }),
        secondary: null,
      };

    case "OK":
      // Thumb + Index form a clean circle, Middle + Ring + Pinky extended & fanned out (👌)
      return {
        primary: makeHandSpec({
          thumb: "pinch",
          index: 0.68,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.08,
          pos: [0.04, -0.18, 0.04],
          rot: [0.05, -0.22, 0],
          anim: "pulse",
        }),
        secondary: null,
      };

    case "GOOD":
      // Index + Pinky up, Middle + Ring curled, Thumb tucked (🤘)
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 1,
          ring: 1,
          pinky: 0,
          splay: 0.06,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.06, 0],
          anim: "nod",
        }),
        secondary: null,
      };

    case "WAIT":
      // Only Index finger pointing straight up (☝️)
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.06, 0],
          anim: "idle",
        }),
        secondary: null,
      };

    case "HELP":
      // Left open palm + Right thumbs-up fist (✋👍)
      return {
        primary: makeHandSpec({
          thumb: "open",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.04,
          pos: [-0.78, -0.20, 0.04],
          rot: [0.08, 0.22, 0.05],
          anim: "lift",
          mirrorX: 1,
        }),
        secondary: makeHandSpec({
          thumb: "up",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [0.76, -0.10, 0.10],
          rot: [0.06, -0.28, 1.22],
          anim: "lift",
          mirrorX: -1,
        }),
      };

    case "WATER":
      // W-Sign: Index + Middle + Ring extended & spread, Pinky curled, Thumb tucked (3️⃣)
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 1,
          splay: 0.11,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.05, 0],
          anim: "forwardNod",
        }),
        secondary: null,
      };

    case "FOOD":
      // Pinky finger extended straight up, Index + Middle + Ring curled, Thumb tucked (🍽️)
      return {
        primary: makeHandSpec({
          thumb: "tucked",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 0,
          splay: 0.04,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.08, 0],
          anim: "forwardNod",
        }),
        secondary: null,
      };

    case "COME HERE":
      // L-Shape hand: Thumb wide + Index straight up, Middle + Ring + Pinky curled (👆)
      return {
        primary: makeHandSpec({
          thumb: "wide",
          index: 0,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0.04,
          pos: [0.06, -0.18, 0],
          rot: [0.04, -0.08, 0],
          anim: "beckon",
        }),
        secondary: null,
      };

    case "CALL ME":
      // Shaka sign: Thumb wide + Pinky up, Index + Middle + Ring curled (🤙)
      return {
        primary: makeHandSpec({
          thumb: "wide",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 0,
          splay: 0.08,
          pos: [0.06, -0.14, 0.04],
          rot: [0.05, 0.14, -0.28],
          anim: "callRock",
        }),
        secondary: null,
      };

    case "STOP":
      return {
        primary: makeHandSpec({
          thumb: "fist",
          index: 1,
          middle: 1,
          ring: 1,
          pinky: 1,
          splay: 0,
          pos: [0, -0.14, 0.05],
          rot: [0.05, 0, 0],
          anim: "idle",
        }),
        secondary: null,
      };

    default:
      return {
        primary: makeHandSpec({
          thumb: "open",
          index: 0,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.05,
          pos: [0, -0.18, 0],
          rot: [0.04, -0.08, 0],
          anim: "wave",
        }),
        secondary: null,
      };
  }
}

/**
 * Extracts clean, stable anatomical joint curls and screen-space orientation from 21 MediaPipe landmarks
 * so live webcam mirroring never flips inside-out or bends fingers backwards.
 */
function extractLiveHandSpec(landmarks, handIndex = 0, totalHands = 1) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const p = landmarks;
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, ((a.z || 0) - (b.z || 0)) * 0.6);
  const palm = Math.max(0.04, d2(p[0], p[9]));

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

  const indexCurl = computeFingerCurl(5, 6, 7, 8);
  const middleCurl = computeFingerCurl(9, 10, 11, 12);
  const ringCurl = computeFingerCurl(13, 14, 15, 16);
  const pinkyCurl = computeFingerCurl(17, 18, 19, 20);

  const thumbIndexTip = d2(p[4], p[8]);
  const thumbIndexMcp = d2(p[4], p[5]);
  const thumbMiddleMcp = d2(p[4], p[9]);
  const thumbPinkyMcp = d2(p[4], p[17]);
  const palmWidth = Math.max(d2(p[5], p[17]), palm * 0.5);

  const allCurled = indexCurl > 0.62 && middleCurl > 0.62 && ringCurl > 0.62 && pinkyCurl > 0.62;
  let thumbMode = "open";
  let rollZ = 0;

  // Determine whether the user's thumb is on the left (-X) or right (+X) side in the mirrored webcam preview
  const thumbOnLeftScreen = (1 - p[4].x) <= (1 - p[17].x);
  const mirrorX = totalHands > 1 ? (handIndex === 1 ? -1 : 1) : (thumbOnLeftScreen ? 1 : -1);

  if (thumbIndexTip < palm * 0.44 && middleCurl < 0.45 && ringCurl < 0.45) {
    thumbMode = "pinch";
  } else if (allCurled) {
    const thumbUp = p[2].y - p[4].y > palm * 0.14 && p[5].y - p[4].y > palm * 0.04;
    const thumbDown = p[4].y - p[2].y > palm * 0.14 && p[4].y - p[5].y > palm * 0.04;
    if (thumbUp) {
      thumbMode = "up";
      rollZ = -1.15 * mirrorX;
    } else if (thumbDown) {
      thumbMode = "up";
      rollZ = 1.95 * mirrorX;
    } else {
      thumbMode = "fist";
    }
  } else if (thumbMiddleMcp < palm * 0.38 || thumbPinkyMcp < palmWidth * 0.68) {
    thumbMode = "tucked";
  } else if (thumbIndexMcp > palm * 0.42) {
    thumbMode = "wide";
  } else {
    thumbMode = "open";
  }

  // Screen-space orientation matching the mirrored webcam preview:
  // In mirrored webcam view, screenX = 1 - x, screenY = -y.
  // Vector from wrist (0) to middle knuckle (9) in screen space:
  const dxScreen = (1 - p[9].x) - (1 - p[0].x); // -(p[9].x - p[0].x)
  const dyScreen = -(p[9].y - p[0].y);
  // In Three.js (+X right, +Y up), tilting top of hand toward +X (dxScreen > 0) is a negative Z rotation:
  const wristTilt = Math.max(-0.65, Math.min(0.65, Math.atan2(dxScreen, Math.max(0.05, dyScreen)) * 0.7));
  if (thumbMode !== "up") {
    rollZ = -wristTilt;
  }

  const baseOffsetX = totalHands > 1 ? (handIndex === 0 ? -0.82 : 0.82) : 0;
  const screenOffsetX = Math.max(-0.45, Math.min(0.45, (0.5 - p[9].x) * 0.85));
  const screenOffsetY = Math.max(-0.35, Math.min(0.35, (0.52 - p[9].y) * 0.65));

  return makeHandSpec({
    thumb: thumbMode,
    index: thumbMode === "pinch" ? 0.68 : indexCurl,
    middle: middleCurl,
    ring: ringCurl,
    pinky: pinkyCurl,
    splay: 0.045,
    pos: [baseOffsetX + (totalHands > 1 ? 0 : screenOffsetX), -0.18 + screenOffsetY, 0.04],
    rot: [0.05, mirrorX === -1 ? -0.15 : 0.15, rollZ],
    anim: "none",
    mirrorX,
  });
}

export default function InteractiveSign3D({
  activeMeaning = "HELLO",
  holdingMeaning = "",
  recognized = false,
  liveHandsRef = null,
  cameraOn = false,
  onSelectSign = null,
  sentencePlan = null,
  sentencePlayToken = 0,
  onCloseSentencePlayer = null,
}) {
  const hostRef = useRef(null);
  const [viewPreset, setViewPreset] = useState("orbit"); // "orbit" | "front" | "side"
  const [skinTheme, setSkinTheme] = useState("warm");
  const [showJointOverlay, setShowJointOverlay] = useState(false);
  const [autoTour, setAutoTour] = useState(false);
  const [mirrorLiveHand, setMirrorLiveHand] = useState(true);
  const [selectedMeaning, setSelectedMeaning] = useState(activeMeaning || "HELLO");
  const [seqPlaying, setSeqPlaying] = useState(false);
  const [seqStepIdx, setSeqStepIdx] = useState(0);
  const [seqSpeed, setSeqSpeed] = useState(1);

  const stateRef = useRef({
    targetMeaning: activeMeaning || "HELLO",
    viewPreset: "orbit",
    skinTheme: "warm",
    showJointOverlay: false,
    mirrorLiveHand: true,
    manualSymbolUntil: 0,
    recognized: false,
    holding: false,
    yaw: 0,
    pitch: 0.06,
    baseYaw: 0,
    basePitch: 0.06,
    zoom: 1,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const nextMeaning = holdingMeaning || activeMeaning || selectedMeaning || "HELLO";
    const changedMeaning = nextMeaning !== stateRef.current.targetMeaning;
    setSelectedMeaning(nextMeaning);
    stateRef.current.targetMeaning = nextMeaning;
    stateRef.current.recognized = Boolean(recognized);
    stateRef.current.holding = Boolean(holdingMeaning);
    if (changedMeaning || recognized) {
      stateRef.current.manualSymbolUntil = performance.now() + 4200;
    }
  }, [activeMeaning, holdingMeaning, recognized]);

  useEffect(() => {
    stateRef.current.mirrorLiveHand = mirrorLiveHand;
  }, [mirrorLiveHand]);

  // When a sentence sequence play is triggered from Step 3, start playing from step 0
  useEffect(() => {
    if (!sentencePlan?.matchedSigns?.length || sentencePlayToken <= 0) return;
    setAutoTour(false);
    setMirrorLiveHand(false);
    setSeqStepIdx(0);
    const firstSign = sentencePlan.matchedSigns[0];
    setSelectedMeaning(firstSign.meaning);
    stateRef.current.targetMeaning = firstSign.meaning;
    setSeqPlaying(sentencePlan.matchedSigns.length > 1);
  }, [sentencePlan, sentencePlayToken]);

  // Advance through sentence sequence steps on timer
  useEffect(() => {
    if (!seqPlaying || !sentencePlan?.matchedSigns?.length || import.meta.env?.MODE === "test") return undefined;
    const steps = sentencePlan.matchedSigns;
    const intervalMs = Math.max(700, Math.round(1600 / seqSpeed));
    const timer = window.setInterval(() => {
      setSeqStepIdx((prev) => {
        const nextIdx = prev + 1;
        if (nextIdx >= steps.length) {
          setSeqPlaying(false);
          return prev;
        }
        const nextSign = steps[nextIdx];
        setSelectedMeaning(nextSign.meaning);
        stateRef.current.targetMeaning = nextSign.meaning;
        return nextIdx;
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [seqPlaying, sentencePlan, seqSpeed]);

  const jumpToSentenceStep = (idx) => {
    const steps = sentencePlan?.matchedSigns || [];
    if (idx < 0 || idx >= steps.length) return;
    setAutoTour(false);
    setMirrorLiveHand(false);
    setSeqPlaying(false);
    setSeqStepIdx(idx);
    const step = steps[idx];
    setSelectedMeaning(step.meaning);
    stateRef.current.targetMeaning = step.meaning;
  };

  useEffect(() => {
    stateRef.current.viewPreset = viewPreset;
    if (viewPreset === "front") {
      stateRef.current.baseYaw = 0;
      stateRef.current.basePitch = 0.04;
      stateRef.current.yaw = 0;
      stateRef.current.pitch = 0.04;
    } else if (viewPreset === "side") {
      stateRef.current.baseYaw = 0.72;
      stateRef.current.basePitch = 0.14;
      stateRef.current.yaw = 0.72;
      stateRef.current.pitch = 0.14;
    } else {
      stateRef.current.baseYaw = 0;
      stateRef.current.basePitch = 0.06;
    }
  }, [viewPreset]);

  useEffect(() => {
    stateRef.current.showJointOverlay = showJointOverlay;
  }, [showJointOverlay]);

  useEffect(() => {
    stateRef.current.skinTheme = skinTheme;
  }, [skinTheme]);

  // Auto-Tour: cycle through all 20 daily signs every 2.2 seconds when enabled
  useEffect(() => {
    if (!autoTour || import.meta.env?.MODE === "test") return undefined;
    setMirrorLiveHand(false);
    const timer = window.setInterval(() => {
      setSelectedMeaning((prev) => {
        const idx = DAILY_CONVERSATION_SIGNS.findIndex((s) => s.meaning === prev);
        const nextItem = DAILY_CONVERSATION_SIGNS[(idx + 1) % DAILY_CONVERSATION_SIGNS.length];
        stateRef.current.targetMeaning = nextItem.meaning;
        return nextItem.meaning;
      });
    }, 2200);
    return () => window.clearInterval(timer);
  }, [autoTour]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || (typeof window.WebGLRenderingContext === "undefined" && typeof window.WebGL2RenderingContext === "undefined")) {
      return undefined;
    }
    let disposed = false;
    let renderer;
    let frameId = 0;
    let resizeObserver;
    const resources = new Set();
    const own = (res) => {
      resources.add(res);
      return res;
    };

    const init = async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.domElement.className = "sign3d-canvas";
        renderer.domElement.setAttribute("aria-hidden", "true");
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 50);
        camera.position.set(0, 0.08, 4.75);

        // Warm 3-point studio lighting for realistic human skin & clear finger depth
        scene.add(new THREE.HemisphereLight(0xfff7f0, 0x181412, 1.9));
        const keyLight = new THREE.DirectionalLight(0xfff9f4, 2.8);
        keyLight.position.set(3.4, 4.8, 5.8);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xdff7ef, 1.25);
        fillLight.position.set(-4.2, 1.8, 4.4);
        scene.add(fillLight);

        const rimLight = new THREE.PointLight(0xffc4a3, 2.4, 15);
        rimLight.position.set(-2.2, 2.8, -3.6);
        scene.add(rimLight);

        const rootGroup = new THREE.Group();
        scene.add(rootGroup);

        // Glowing stage platform rings beneath the forearm
        const ringGeo = own(new THREE.RingGeometry(1.52, 1.60, 72));
        const ringMat = own(new THREE.MeshBasicMaterial({ color: 0x3ae6a8, side: THREE.DoubleSide, transparent: true, opacity: 0.44 }));
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2.25;
        ringMesh.position.y = -1.28;
        rootGroup.add(ringMesh);

        const outerRingGeo = own(new THREE.RingGeometry(1.88, 1.92, 72));
        const outerRingMat = own(new THREE.MeshBasicMaterial({ color: 0xffbe55, side: THREE.DoubleSide, transparent: true, opacity: 0.28 }));
        const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRingMesh.rotation.x = Math.PI / 2.25;
        outerRingMesh.position.y = -1.30;
        rootGroup.add(outerRingMesh);

        // Floating 3D energy particles orbiting around the stage
        const particleCount = 68;
        const pCoords = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
          const ang = (i / particleCount) * Math.PI * 2;
          const rad = 1.62 + (i % 5) * 0.21;
          pCoords[i * 3] = Math.cos(ang) * rad;
          pCoords[i * 3 + 1] = -1.05 + ((i * 17) % 24) * 0.095;
          pCoords[i * 3 + 2] = Math.sin(ang) * rad * 0.65;
        }
        const particleGeo = own(new THREE.BufferGeometry());
        particleGeo.setAttribute("position", new THREE.BufferAttribute(pCoords, 3));
        const particleMat = own(new THREE.PointsMaterial({
          color: 0x56f0be,
          size: 0.045,
          transparent: true,
          opacity: 0.62,
        }));
        const particleSystem = new THREE.Points(particleGeo, particleMat);
        rootGroup.add(particleSystem);

        // Materials: Skin, Fingernails, Knuckle Creases, and Studio Sleeve Cuff
        const SkinMatClass = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
        const skinMat = own(
          new SkinMatClass({
            color: SKIN_THEMES[0].color,
            roughness: SKIN_THEMES[0].roughness,
            metalness: SKIN_THEMES[0].metalness,
            ...(THREE.MeshPhysicalMaterial
              ? {
                  clearcoat: 0.14,
                  clearcoatRoughness: 0.42,
                  sheen: 0.45,
                  sheenColor: new THREE.Color(SKIN_THEMES[0].sheen),
                  sheenRoughness: 0.5,
                }
              : {}),
            emissive: SKIN_THEMES[0].emissive,
            emissiveIntensity: 0.12,
          })
        );

        const nailMat = own(
          new SkinMatClass({
            color: SKIN_THEMES[0].nailColor,
            roughness: 0.22,
            metalness: 0.04,
            ...(THREE.MeshPhysicalMaterial ? { clearcoat: 0.55, clearcoatRoughness: 0.18 } : {}),
          })
        );

        const creaseMat = own(
          new THREE.MeshStandardMaterial({
            color: SKIN_THEMES[0].creaseColor,
            roughness: 0.55,
            metalness: 0.02,
          })
        );

        const cuffMat = own(
          new THREE.MeshStandardMaterial({
            color: 0x112620,
            roughness: 0.32,
            metalness: 0.42,
            emissive: 0x071511,
            emissiveIntensity: 0.4,
          })
        );
        const cuffTrimMat = own(new THREE.MeshBasicMaterial({ color: 0x45e3b0 }));

        const overlayJointMat = own(
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
          })
        );

        // Shared unit geometries
        const unitSphereGeo = own(new THREE.SphereGeometry(1, 24, 18));
        const unitCylGeo = own(new THREE.CylinderGeometry(1, 1, 1, 24, 1));
        const pinSphereGeo = own(new THREE.SphereGeometry(1, 14, 12));

        /**
         * Helper to create a smooth tapered anatomical bone segment along +Y from y=0 to y=len.
         */
        const createPhalanxMesh = (rBase, rTip, len, addNail = false) => {
          const segGroup = new THREE.Group();
          const cylGeo = own(new THREE.CylinderGeometry(rTip, rBase, len, 22, 1));
          const cyl = new THREE.Mesh(cylGeo, skinMat);
          cyl.position.y = len * 0.5;
          cyl.scale.set(1.0, 1.0, 0.90); // slightly oval anatomical finger cross-section
          segGroup.add(cyl);

          const tipSphere = new THREE.Mesh(unitSphereGeo, skinMat);
          tipSphere.position.y = len;
          tipSphere.scale.set(rTip, rTip * 1.04, rTip * 0.90);
          segGroup.add(tipSphere);

          if (addNail) {
            // Subtle anatomical fingernail plate on the dorsal (-Z) side AND palmar pad on (+Z)
            const nail = new THREE.Mesh(unitSphereGeo, nailMat);
            nail.position.set(0, len * 0.68, -rTip * 0.76);
            nail.scale.set(rTip * 0.72, len * 0.34, rTip * 0.22);
            nail.rotation.x = 0.08;
            segGroup.add(nail);
          } else {
            // Subtle knuckle crease band at the joint top
            const crease = new THREE.Mesh(unitCylGeo, creaseMat);
            crease.position.set(0, len * 0.96, 0);
            crease.scale.set(rTip * 1.01, 0.012, rTip * 0.92);
            segGroup.add(crease);
          }
          return { segGroup, tipAnchor: tipSphere };
        };

        /**
         * Builds a complete, anatomically sculpted hierarchical 3D Hand + Wrist + Forearm rig.
         * mirrorX = 1 (Right hand: thumb on -X left side when palm faces viewer)
         * mirrorX = -1 (Left hand: thumb on +X right side when palm faces viewer)
         */
        const createArticulatedHandSlot = (mirrorX = 1) => {
          const handRoot = new THREE.Group(); // Controlled by pos & rot
          const mirrorGroup = new THREE.Group();
          mirrorGroup.scale.x = mirrorX;
          handRoot.add(mirrorGroup);

          const jointAnchors = new Array(21);

          // 0. Wrist & Forearm Base
          const wristAnchor = new THREE.Object3D();
          wristAnchor.position.set(0, -0.42, 0);
          mirrorGroup.add(wristAnchor);
          jointAnchors[0] = wristAnchor;

          // Sculpted wrist joint & forearm cylinder + cyber sleeve cuff
          const wristJoint = new THREE.Mesh(unitSphereGeo, skinMat);
          wristJoint.position.set(0, -0.36, -0.01);
          wristJoint.scale.set(0.36, 0.22, 0.21);
          mirrorGroup.add(wristJoint);

          const forearmGeo = own(new THREE.CylinderGeometry(0.34, 0.38, 0.42, 28, 1));
          const forearmMesh = new THREE.Mesh(forearmGeo, skinMat);
          forearmMesh.position.set(0, -0.60, -0.01);
          forearmMesh.scale.set(1.0, 1.0, 0.72);
          mirrorGroup.add(forearmMesh);

          const cuffGeo = own(new THREE.CylinderGeometry(0.39, 0.42, 0.24, 32, 1));
          const cuffMesh = new THREE.Mesh(cuffGeo, cuffMat);
          cuffMesh.position.set(0, -0.76, -0.01);
          cuffMesh.scale.set(1.0, 1.0, 0.74);
          mirrorGroup.add(cuffMesh);

          const trimGeo = own(new THREE.CylinderGeometry(0.398, 0.398, 0.032, 32, 1));
          const trimMesh = new THREE.Mesh(trimGeo, cuffTrimMat);
          trimMesh.position.set(0, -0.64, -0.01);
          trimMesh.scale.set(1.0, 1.0, 0.75);
          mirrorGroup.add(trimMesh);

          // 1. Sculpted Multi-Part Anatomical Palm (Metacarpal body + arched knuckle bridge + rounded sides + thenar/hypothenar pads)
          const palmGroup = new THREE.Group();
          mirrorGroup.add(palmGroup);

          // Four overlapping metacarpal columns forming a smooth, organic palm with natural arch
          const metaColumns = [
            { x: -0.33, yTop: 0.41, yBot: -0.34, rTop: 0.135, rBot: 0.145, z: 0.0 },
            { x: -0.11, yTop: 0.45, yBot: -0.36, rTop: 0.145, rBot: 0.155, z: 0.01 },
            { x: 0.12, yTop: 0.42, yBot: -0.35, rTop: 0.140, rBot: 0.150, z: 0.0 },
            { x: 0.34, yTop: 0.35, yBot: -0.32, rTop: 0.130, rBot: 0.135, z: -0.01 },
          ];
          for (const mc of metaColumns) {
            const h = mc.yTop - mc.yBot;
            const mcGeo = own(new THREE.CylinderGeometry(mc.rTop, mc.rBot, h, 20, 1));
            const mcMesh = new THREE.Mesh(mcGeo, skinMat);
            mcMesh.position.set(mc.x, (mc.yTop + mc.yBot) * 0.5, mc.z);
            mcMesh.scale.set(1.18, 1.0, 0.82);
            palmGroup.add(mcMesh);
          }

          // Central palmar cushion & dorsal bridge
          const palmCore = new THREE.Mesh(unitSphereGeo, skinMat);
          palmCore.position.set(0.01, 0.04, 0.01);
          palmCore.scale.set(0.49, 0.44, 0.175);
          palmGroup.add(palmCore);

          // Upper knuckle bridge connecting Index..Pinky MCPs smoothly
          const knuckleBridge = new THREE.Mesh(unitCylGeo, skinMat);
          knuckleBridge.position.set(0.01, 0.39, -0.005);
          knuckleBridge.rotation.z = Math.PI * 0.5 + 0.07;
          knuckleBridge.scale.set(0.125, 0.78, 0.115);
          palmGroup.add(knuckleBridge);

          // Muscular Thenar Eminence (thumb base pad on the radial palm side)
          const thenarPad = new THREE.Mesh(unitSphereGeo, skinMat);
          thenarPad.position.set(-0.27, -0.10, 0.075);
          thenarPad.rotation.z = -0.38;
          thenarPad.scale.set(0.22, 0.30, 0.165);
          palmGroup.add(thenarPad);

          // Hypothenar Pad (ulnar pinky side of the palm)
          const hypothenarPad = new THREE.Mesh(unitSphereGeo, skinMat);
          hypothenarPad.position.set(0.32, -0.05, 0.045);
          hypothenarPad.rotation.z = 0.18;
          hypothenarPad.scale.set(0.16, 0.32, 0.145);
          palmGroup.add(hypothenarPad);

          // Subtle palmar life-line crease on the front (+Z) of the palm
          const palmCrease = new THREE.Mesh(unitCylGeo, creaseMat);
          palmCrease.position.set(-0.08, 0.08, 0.168);
          palmCrease.rotation.z = 0.92;
          palmCrease.scale.set(0.008, 0.36, 0.008);
          palmGroup.add(palmCrease);

          // 2. Articulated Thumb Chain (Joints 1: CMC -> 2: MCP -> 3: IP -> 4: Tip)
          const thumbCmcMount = new THREE.Group();
          thumbCmcMount.position.set(-0.34, -0.18, 0.06);
          palmGroup.add(thumbCmcMount);

          const thumbCmcPivot = new THREE.Group();
          thumbCmcMount.add(thumbCmcPivot);
          jointAnchors[1] = thumbCmcPivot;

          const cmcKnuckle = new THREE.Mesh(unitSphereGeo, skinMat);
          cmcKnuckle.scale.set(0.135, 0.135, 0.125);
          thumbCmcPivot.add(cmcKnuckle);

          const thumbSeg1 = createPhalanxMesh(0.125, 0.106, 0.34, false);
          thumbCmcPivot.add(thumbSeg1.segGroup);

          const thumbMcpPivot = new THREE.Group();
          thumbMcpPivot.position.set(0, 0.34, 0);
          thumbCmcPivot.add(thumbMcpPivot);
          jointAnchors[2] = thumbMcpPivot;

          const thumbSeg2 = createPhalanxMesh(0.104, 0.090, 0.27, false);
          thumbMcpPivot.add(thumbSeg2.segGroup);

          const thumbIpPivot = new THREE.Group();
          thumbIpPivot.position.set(0, 0.27, 0);
          thumbMcpPivot.add(thumbIpPivot);
          jointAnchors[3] = thumbIpPivot;

          const thumbSeg3 = createPhalanxMesh(0.088, 0.074, 0.22, true);
          thumbIpPivot.add(thumbSeg3.segGroup);
          jointAnchors[4] = thumbSeg3.tipAnchor;

          // 3. Four Articulated Fingers (Index, Middle, Ring, Pinky)
          const fingers = {};
          for (const spec of FINGER_SPECS) {
            const [jMcp, jPip, jDip, jTip] = spec.jointIndices;
            const [len1, len2, len3] = spec.lengths;
            const [r0, r1, r2, r3] = spec.radii;

            const mount = new THREE.Group();
            mount.position.set(...spec.mountPos);
            palmGroup.add(mount);

            const mcpKnuckle = new THREE.Mesh(unitSphereGeo, skinMat);
            mcpKnuckle.scale.set(r0 * 1.06, r0 * 1.06, r0 * 0.96);
            mount.add(mcpKnuckle);

            const mcpPivot = new THREE.Group();
            mount.add(mcpPivot);
            jointAnchors[jMcp] = mcpPivot;

            const seg1 = createPhalanxMesh(r0, r1, len1, false);
            mcpPivot.add(seg1.segGroup);

            const pipPivot = new THREE.Group();
            pipPivot.position.set(0, len1, 0);
            mcpPivot.add(pipPivot);
            jointAnchors[jPip] = pipPivot;

            const seg2 = createPhalanxMesh(r1, r2, len2, false);
            pipPivot.add(seg2.segGroup);

            const dipPivot = new THREE.Group();
            dipPivot.position.set(0, len2, 0);
            pipPivot.add(dipPivot);
            jointAnchors[jDip] = dipPivot;

            const seg3 = createPhalanxMesh(r2, r3, len3, true);
            dipPivot.add(seg3.segGroup);
            jointAnchors[jTip] = seg3.tipAnchor;

            fingers[spec.name] = {
              spec,
              mcpPivot,
              pipPivot,
              dipPivot,
              curCurl: 0,
              curSplay: spec.baseSplayZ,
            };
          }

          // 21 Joint Marker Overlay Pins
          const overlayPins = own(new THREE.InstancedMesh(pinSphereGeo, overlayJointMat, 21));
          const c = new THREE.Color();
          for (let i = 0; i < 21; i++) {
            c.setHex(FINGER_COLORS[i]);
            overlayPins.setColorAt(i, c);
          }
          overlayPins.instanceColor.needsUpdate = true;
          overlayPins.visible = false;
          rootGroup.add(overlayPins);

          return {
            handRoot,
            mirrorGroup,
            thumbCmcPivot,
            thumbMcpPivot,
            thumbIpPivot,
            fingers,
            jointAnchors,
            overlayPins,
            curPos: new THREE.Vector3(0, -0.18, 0),
            curRot: new THREE.Vector3(0, 0, 0),
            curThumbCmc: new THREE.Vector3(0.18, 0.25, 0.58),
            curThumbMcp: new THREE.Vector3(0.08, 0, -0.12),
            curThumbIp: new THREE.Vector3(0.06, 0, -0.08),
            initialized: false,
          };
        };

        const handA = createArticulatedHandSlot(1);
        const handB = createArticulatedHandSlot(-1);
        handB.handRoot.visible = false;
        rootGroup.add(handA.handRoot, handB.handRoot);

        const dummy = new THREE.Object3D();
        const vWorld = new THREE.Vector3();

        /**
         * Returns target Euler angles [rx, ry, rz] for the 3 thumb joints (CMC, MCP, IP)
         * for each anatomical thumb mode.
         * Note: In local right-hand space, thumb starts at (-0.34, -0.18, +0.06).
         *  +rz tilts the thumb outward to the left (-X).
         *  -rz folds the thumb inward across the palm (+X).
         *  +rx tilts the thumb forward toward the viewer (+Z).
         */
        const getThumbTargetAngles = (mode) => {
          switch (mode) {
            case "wide":
              // Abducted wide (~72° outward) for I LOVE YOU 🤟, COME HERE 👆, CALL ME 🤙, PLEASE 🖐️
              return {
                cmc: [0.14, 0.16, 0.94],
                mcp: [0.04, 0, 0.14],
                ip: [0.02, 0, 0.06],
              };
            case "up":
              // Abducted at 70° in the palm plane so when hand rolls -66° (YES 👍) or +112° (NO 👎), thumb points straight UP (+Y) or DOWN (-Y)
              return {
                cmc: [0.06, 0.08, 0.92],
                mcp: [0.02, 0, 0.18],
                ip: [0.0, 0, 0.08],
              };
            case "tucked":
              // Folded neatly across the front of the palm (+Z) without intersecting the palm mesh
              return {
                cmc: [0.46, -0.18, -0.20],
                mcp: [0.22, 0, -0.64],
                ip: [0.16, 0, -0.46],
              };
            case "fist":
              // Wrapped securely in front of (+Z) the curled fingers for SORRY / STOP ✊
              return {
                cmc: [0.74, -0.16, 0.04],
                mcp: [0.28, 0, -0.76],
                ip: [0.22, 0, -0.56],
              };
            case "pinch":
              // Exact forward-kinematic angle so Thumb Tip meets Index Tip at (-0.33, +0.27, +0.51) for OK 👌
              return {
                cmc: [0.50, -0.10, 0.12],
                mcp: [0.24, 0, -0.18],
                ip: [0.38, 0, -0.15],
              };
            case "open":
            default:
              // Natural relaxed open-palm thumb for HELLO ✋, HOW ARE YOU 👐
              return {
                cmc: [0.16, 0.14, 0.56],
                mcp: [0.05, 0, -0.06],
                ip: [0.03, 0, -0.04],
              };
          }
        };

        /**
         * Updates one articulated hand slot toward its target specification with smooth animation.
         */
        const updateHandSlot = (slot, spec, dt, t, showOverlay, isLive = false) => {
          if (!spec) {
            slot.handRoot.visible = false;
            slot.overlayPins.visible = false;
            return;
          }
          slot.handRoot.visible = true;
          slot.mirrorGroup.scale.x = spec.mirrorX || 1;

          const alpha = slot.initialized ? Math.min(1, dt * (isLive ? 22 : 14)) : 1;
          slot.initialized = true;

          // Compute subtle gesture animation offsets (wave, nod, bow, welcome, circle, lift, beckon, callRock)
          let animDx = 0, animDy = 0, animDz = 0;
          let animRx = 0, animRy = 0, animRz = 0;
          let extraIndexCurl = 0;

          if (!isLive) {
            switch (spec.anim) {
              case "wave":
                animRz = Math.sin(t * 4.2) * 0.14;
                break;
              case "welcome":
                animRy = Math.sin(t * 2.8) * 0.08 * (spec.mirrorX || 1);
                animDy = Math.sin(t * 2.8) * 0.03;
                break;
              case "nod":
                animRz = Math.sin(t * 4.0) * 0.08 * (spec.mirrorX || 1);
                animDy = Math.sin(t * 4.0) * 0.04;
                break;
              case "shake":
                animRy = Math.sin(t * 5.0) * 0.14;
                break;
              case "bow":
                animRx = Math.sin(t * 2.4) * 0.07;
                break;
              case "meet":
                animDx = Math.sin(t * 3.0) * 0.06 * (spec.mirrorX || 1);
                break;
              case "forwardNod":
                animRx = (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.16;
                animDz = (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.08;
                break;
              case "circle":
                animDx = Math.cos(t * 3.2) * 0.06;
                animDy = Math.sin(t * 3.2) * 0.06;
                break;
              case "lift":
                animDy = (Math.sin(t * 3.0) * 0.5 + 0.5) * 0.09;
                break;
              case "beckon":
                extraIndexCurl = (Math.sin(t * 4.5) * 0.5 + 0.5) * 0.22;
                break;
              case "callRock":
                animRz = Math.sin(t * 4.2) * 0.12;
                break;
              case "pulse":
                animRy = Math.sin(t * 2.6) * 0.09;
                break;
              default:
                break;
            }
          }

          vWorld.set(
            spec.pos[0] + animDx,
            spec.pos[1] + animDy,
            spec.pos[2] + animDz
          );
          slot.curPos.lerp(vWorld, alpha);
          slot.handRoot.position.copy(slot.curPos);

          vWorld.set(
            spec.rot[0] + animRx,
            spec.rot[1] + animRy,
            spec.rot[2] + animRz
          );
          slot.curRot.lerp(vWorld, alpha);
          slot.handRoot.rotation.set(slot.curRot.x, slot.curRot.y, slot.curRot.z);

          // Update Thumb Joints
          const thumbTarget = getThumbTargetAngles(spec.thumb);
          vWorld.set(...thumbTarget.cmc);
          slot.curThumbCmc.lerp(vWorld, alpha);
          slot.thumbCmcPivot.rotation.set(slot.curThumbCmc.x, slot.curThumbCmc.y, slot.curThumbCmc.z);

          vWorld.set(...thumbTarget.mcp);
          slot.curThumbMcp.lerp(vWorld, alpha);
          slot.thumbMcpPivot.rotation.set(slot.curThumbMcp.x, slot.curThumbMcp.y, slot.curThumbMcp.z);

          vWorld.set(...thumbTarget.ip);
          slot.curThumbIp.lerp(vWorld, alpha);
          slot.thumbIpPivot.rotation.set(slot.curThumbIp.x, slot.curThumbIp.y, slot.curThumbIp.z);

          // Update 4 Fingers (Index, Middle, Ring, Pinky)
          // Positive rotation.x curls the finger forward (+Z) toward the palm!
          const splayMultipliers = { index: 1.15, middle: 0.25, ring: -0.55, pinky: -1.25 };
          for (const fName of ["index", "middle", "ring", "pinky"]) {
            const fObj = slot.fingers[fName];
            const targetCurl = Math.max(0, Math.min(1, (spec[fName] ?? 0) + (fName === "index" ? extraIndexCurl : 0)));
            fObj.curCurl += (targetCurl - fObj.curCurl) * alpha;

            const spreadFactor = (1 - fObj.curCurl * 0.85) * (spec.splay ?? 0.03);
            const targetSplay = fObj.spec.baseSplayZ * (1 - fObj.curCurl * 0.7) + spreadFactor * splayMultipliers[fName];
            fObj.curSplay += (targetSplay - fObj.curSplay) * alpha;

            if (spec.thumb === "pinch" && fName === "index") {
              // Exact round O-pinch curve so index tip meets thumb tip at (-0.32, +0.26, +0.52) for OK 👌
              const pScale = fObj.curCurl / 0.68;
              fObj.mcpPivot.rotation.set(1.05 * pScale, 0, fObj.curSplay - 0.05);
              fObj.pipPivot.rotation.set(1.25 * pScale, 0, 0);
              fObj.dipPivot.rotation.set(0.85 * pScale, 0, 0);
            } else {
              fObj.mcpPivot.rotation.set(fObj.curCurl * 1.42, 0, fObj.curSplay);
              fObj.pipPivot.rotation.set(fObj.curCurl * 1.68, 0, 0);
              fObj.dipPivot.rotation.set(fObj.curCurl * 1.12, 0, 0);
            }
          }

          // Update 21 Joint Marker Overlay Pins if toggled on
          slot.overlayPins.visible = Boolean(showOverlay);
          if (showOverlay) {
            slot.handRoot.updateMatrixWorld(true);
            for (let i = 0; i < 21; i++) {
              const anchor = slot.jointAnchors[i];
              if (!anchor) continue;
              anchor.getWorldPosition(vWorld);
              rootGroup.worldToLocal(vWorld);
              dummy.position.set(vWorld.x, vWorld.y, vWorld.z + 0.09);
              dummy.rotation.set(0, 0, 0);
              dummy.scale.setScalar(0.038);
              dummy.updateMatrix();
              slot.overlayPins.setMatrixAt(i, dummy.matrix);
            }
            slot.overlayPins.instanceMatrix.needsUpdate = true;
          }
        };

        const resize = () => {
          if (disposed || !renderer) return;
          const bounds = host.getBoundingClientRect();
          const w = Math.max(240, Math.round(bounds.width));
          const h = Math.max(200, Math.round(bounds.height));
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        };

        if ("ResizeObserver" in window) {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(host);
        }
        resize();

        let lastTheme = "warm";
        let lastAt = performance.now();
        const tick = (now) => {
          if (disposed) return;
          const dt = Math.min(0.1, Math.max(0.008, (now - lastAt) / 1000));
          lastAt = now;
          const t = now * 0.001;
          const st = stateRef.current;

          // Update skin theme dynamically if changed
          if (st.skinTheme !== lastTheme) {
            lastTheme = st.skinTheme;
            const themeObj = SKIN_THEMES.find((th) => th.id === lastTheme) || SKIN_THEMES[0];
            skinMat.color.setHex(themeObj.color);
            skinMat.roughness = themeObj.roughness;
            skinMat.metalness = themeObj.metalness;
            skinMat.emissive.setHex(themeObj.emissive);
            if (skinMat.sheenColor) skinMat.sheenColor.setHex(themeObj.sheen);
            nailMat.color.setHex(themeObj.nailColor);
            creaseMat.color.setHex(themeObj.creaseColor);
          }

          // Determine whether to mirror raw webcam fingers or show the clean 3D Sign Symbol
          const liveHands = liveHandsRef?.current;
          const hasLiveHands = Array.isArray(liveHands) && liveHands.length > 0;
          const manualLocked = now < (st.manualSymbolUntil || 0);
          const useLiveMirror = st.mirrorLiveHand && hasLiveHands && !st.holding && !manualLocked;
          let targetPrimary = null;
          let targetSecondary = null;

          if (useLiveMirror) {
            targetPrimary = extractLiveHandSpec(liveHands[0].landmarks, 0, liveHands.length);
            if (liveHands.length > 1) {
              targetSecondary = extractLiveHandSpec(liveHands[1].landmarks, 1, liveHands.length);
            }
          } else {
            const pose3d = get3DPoseForSign(st.targetMeaning);
            targetPrimary = pose3d.primary;
            targetSecondary = pose3d.secondary;
            // When holding a recognized sign on camera, gently follow the user's screen hand offset
            if (st.holding && hasLiveHands && targetPrimary && !targetSecondary) {
              const lm0 = liveHands[0].landmarks;
              if (Array.isArray(lm0) && lm0.length === 21) {
                const sx = Math.max(-0.35, Math.min(0.35, (0.5 - lm0[9].x) * 0.65));
                const sy = Math.max(-0.25, Math.min(0.25, (0.52 - lm0[9].y) * 0.50));
                targetPrimary = {
                  ...targetPrimary,
                  pos: [targetPrimary.pos[0] + sx, targetPrimary.pos[1] + sy, targetPrimary.pos[2]],
                };
              }
            }
          }

          updateHandSlot(handA, targetPrimary, dt, t, st.showJointOverlay, useLiveMirror);
          updateHandSlot(handB, targetSecondary, dt, t, st.showJointOverlay, useLiveMirror);

          // Rotate / float smoothly while preserving user 360° drag rotation
          if (!st.dragging && st.viewPreset === "orbit") {
            st.yaw = st.baseYaw + Math.sin(t * 0.55) * 0.22;
            st.pitch = st.basePitch;
          }
          rootGroup.rotation.y += (st.yaw - rootGroup.rotation.y) * Math.min(1, dt * 10);
          rootGroup.rotation.x += (st.pitch - rootGroup.rotation.x) * Math.min(1, dt * 10);
          rootGroup.position.y = Math.sin(t * 1.6) * 0.025;

          // Orbiting 3D particles & stage ring
          particleSystem.rotation.y = t * 0.25;
          const pulse = st.recognized ? 0.74 + Math.sin(t * 7) * 0.20 : st.holding ? 0.58 : 0.40;
          ringMat.opacity = pulse;
          ringMat.color.setHex(st.recognized ? 0x45ffaa : st.holding ? 0xffbe55 : 0x3ae6a8);
          outerRingMesh.rotation.z = t * 0.32;

          camera.position.z += (4.75 / st.zoom - camera.position.z) * Math.min(1, dt * 12);
          renderer.render(scene, camera);
          frameId = window.requestAnimationFrame(tick);
        };
        frameId = window.requestAnimationFrame(tick);
      } catch {
        // Fallback peacefully if WebGL fails
      }
    };

    init();

    return () => {
      disposed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect?.();
      resources.forEach((r) => r.dispose?.());
      resources.clear();
      if (renderer) {
        renderer.dispose?.();
        renderer.forceContextLoss?.();
        renderer.domElement?.remove?.();
      }
    };
  }, []);

  const onPointerDown = (e) => {
    if (e.target?.closest?.("button")) return;
    stateRef.current.dragging = true;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onPointerMove = (e) => {
    if (!stateRef.current.dragging) return;
    const dx = e.clientX - stateRef.current.lastX;
    const dy = e.clientY - stateRef.current.lastY;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
    const nextYaw = Math.max(-Math.PI, Math.min(Math.PI, stateRef.current.baseYaw + dx * 0.011));
    const nextPitch = Math.max(-0.9, Math.min(0.9, stateRef.current.basePitch + dy * 0.009));
    stateRef.current.baseYaw = nextYaw;
    stateRef.current.basePitch = nextPitch;
    stateRef.current.yaw = nextYaw;
    stateRef.current.pitch = nextPitch;
  };
  const onPointerUp = (e) => {
    stateRef.current.dragging = false;
    try {
      e.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const adjustZoom = (delta) => {
    stateRef.current.zoom = Math.max(0.7, Math.min(1.6, stateRef.current.zoom + delta));
  };
  const onWheel = (e) => {
    if (Math.abs(e.deltaY) < 2) return;
    adjustZoom(e.deltaY < 0 ? 0.08 : -0.08);
  };

  const currentSignMeta = DAILY_CONVERSATION_SIGNS.find((s) => s.meaning === selectedMeaning) || DAILY_CONVERSATION_SIGNS[0];

  return (
    <div className="sign3d-stage rb-spotlight-card">
      <div className="sign3d-header">
        <div className="sign3d-title-block">
          <span className="sign3d-kicker rb-shiny-text">THREE.JS ARTICULATED 3D HUMAN HAND · 20 LIVE SIGNS</span>
          <strong>{currentSignMeta.icon} {currentSignMeta.meaning}</strong>
          <small>
            {mirrorLiveHand && cameraOn
              ? "Live Finger Mirror ON · Drag 360° or click any sign below"
              : `${currentSignMeta.howTo} · Drag to rotate 360°`}
          </small>
        </div>
        <div className="sign3d-controls">
          {[
            { id: "orbit", label: "360° Orbit" },
            { id: "front", label: "Front" },
            { id: "side", label: "Side 3D" },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={"sign3d-pill" + (viewPreset === preset.id ? " is-active" : "")}
              onClick={() => setViewPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
          {SKIN_THEMES.map((th) => (
            <button
              key={th.id}
              type="button"
              className={"sign3d-pill" + (skinTheme === th.id ? " is-active" : "")}
              onClick={() => setSkinTheme(th.id)}
            >
              {th.label}
            </button>
          ))}
          {cameraOn && (
            <button
              type="button"
              className={"sign3d-pill" + (mirrorLiveHand ? " is-active" : "")}
              onClick={() => {
                setAutoTour(false);
                setMirrorLiveHand((v) => !v);
              }}
              title="Toggle between showing the exact 3D Sign Symbol vs mirroring raw webcam fingers"
            >
              {mirrorLiveHand ? "🎥 Live Mirror ON" : "🎥 Mirror Hand"}
            </button>
          )}
          <button
            type="button"
            className={"sign3d-pill" + (showJointOverlay ? " is-active" : "")}
            onClick={() => setShowJointOverlay((v) => !v)}
            title="Toggle 21 tracking joint markers on the 3D hand"
          >
            {showJointOverlay ? "21 Joints ON" : "21 Joints"}
          </button>
          <button
            type="button"
            className={"sign3d-pill" + (autoTour ? " is-active" : "")}
            onClick={() => setAutoTour((v) => !v)}
            title="Automatically morph through all 20 daily signs"
          >
            {autoTour ? "⏸ Pause Tour" : "▶ Auto Tour"}
          </button>
        </div>
      </div>
      <div
        ref={hostRef}
        className="sign3d-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className="sign3d-hud-overlay" aria-hidden="true">
          <div className="sign3d-hud-badge">
            <span className="sign3d-hud-dot" />
            <span>{currentSignMeta.category} · {currentSignMeta.hands === 2 || ["HOW ARE YOU", "I AM FINE", "GOOD MORNING", "NICE TO MEET YOU", "SORRY", "HELP"].includes(currentSignMeta.meaning) ? "2-Hand Sign" : "1-Hand Sign"}</span>
          </div>
          <div className="sign3d-zoom-dock">
            <button type="button" tabIndex={-1} onClick={() => adjustZoom(0.15)} title="Zoom in">+</button>
            <button type="button" tabIndex={-1} onClick={() => { stateRef.current.zoom = 1; stateRef.current.baseYaw = 0; stateRef.current.basePitch = 0.06; stateRef.current.yaw = 0; stateRef.current.pitch = 0.06; }} title="Reset 3D view">⟳</button>
            <button type="button" tabIndex={-1} onClick={() => adjustZoom(-0.15)} title="Zoom out">−</button>
          </div>
        </div>
      </div>
      {sentencePlan && (sentencePlan.matchedSigns?.length > 0 || sentencePlan.uncoveredWords?.length > 0) && (
        <div className="sign3d-sequence-bar" role="region" aria-label="3D sentence sign sequence player">
          <div className="sign3d-sequence-top">
            <div className="sign3d-sequence-title">
              <span className="sign3d-sequence-badge">3D SENTENCE PLAYER</span>
              <strong>
                {sentencePlan.matchedSigns.length > 0
                  ? `Sign ${Math.min(seqStepIdx + 1, sentencePlan.matchedSigns.length)} of ${sentencePlan.matchedSigns.length}: ${sentencePlan.matchedSigns[seqStepIdx]?.meaning || ""}`
                  : "No matching 3D signs in sentence"}
              </strong>
            </div>
            <div className="sign3d-sequence-controls">
              {sentencePlan.matchedSigns.length > 0 && (
                <>
                  <button
                    type="button"
                    className="sign3d-seq-btn"
                    disabled={seqStepIdx <= 0}
                    onClick={() => jumpToSentenceStep(seqStepIdx - 1)}
                    title="Previous sign in sentence"
                  >
                    ⏮
                  </button>
                  <button
                    type="button"
                    className="sign3d-seq-btn is-primary"
                    onClick={() => {
                      if (seqPlaying) {
                        setSeqPlaying(false);
                      } else {
                        setAutoTour(false);
                        setMirrorLiveHand(false);
                        if (seqStepIdx >= sentencePlan.matchedSigns.length - 1) {
                          setSeqStepIdx(0);
                          const first = sentencePlan.matchedSigns[0];
                          setSelectedMeaning(first.meaning);
                          stateRef.current.targetMeaning = first.meaning;
                        }
                        setSeqPlaying(true);
                      }
                    }}
                  >
                    {seqPlaying ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button
                    type="button"
                    className="sign3d-seq-btn"
                    disabled={seqStepIdx >= sentencePlan.matchedSigns.length - 1}
                    onClick={() => jumpToSentenceStep(seqStepIdx + 1)}
                    title="Next sign in sentence"
                  >
                    ⏭
                  </button>
                  {[0.75, 1, 1.5].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      className={"sign3d-seq-btn" + (seqSpeed === spd ? " is-active" : "")}
                      onClick={() => setSeqSpeed(spd)}
                    >
                      {spd}x
                    </button>
                  ))}
                </>
              )}
              {onCloseSentencePlayer && (
                <button
                  type="button"
                  className="sign3d-seq-btn"
                  onClick={() => {
                    setSeqPlaying(false);
                    onCloseSentencePlayer();
                  }}
                  title="Close sentence player"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="sign3d-sequence-tokens">
            {sentencePlan.tokens.map((tok, i) =>
              tok.type === "sign" ? (
                <button
                  key={`tok-${i}-${tok.meaning}`}
                  type="button"
                  className={"sign3d-seq-token is-sign" + (tok.stepIndex === seqStepIdx ? " is-current" : "")}
                  onClick={() => jumpToSentenceStep(tok.stepIndex)}
                >
                  <span>{tok.sign.icon}</span>
                  <strong>{tok.meaning}</strong>
                  {tok.rawText.toUpperCase() !== tok.meaning && <small>({tok.rawText})</small>}
                </button>
              ) : (
                <span key={`tok-unc-${i}`} className="sign3d-seq-token is-uncovered" title="No 3D sign in vocabulary for this word">
                  No sign: “{tok.rawText}”
                </span>
              )
            )}
          </div>
        </div>
      )}
      <div className="sign3d-footer">
        <span className="sign3d-hint">Drag 3D hand to inspect any angle · Tap any of the 20 signs below to morph 3D hand + speak aloud:</span>
        <div className="sign3d-quick-strip">
          {DAILY_CONVERSATION_SIGNS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={"sign3d-chip" + (selectedMeaning === item.meaning ? " is-selected" : "")}
              onClick={() => {
                setAutoTour(false);
                setSelectedMeaning(item.meaning);
                stateRef.current.targetMeaning = item.meaning;
                stateRef.current.manualSymbolUntil = performance.now() + 6000;
                onSelectSign?.(item);
              }}
            >
              {item.icon} {item.meaning}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
