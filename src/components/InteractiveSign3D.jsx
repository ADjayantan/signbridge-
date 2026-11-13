import { useEffect, useRef, useState } from "react";
import { DAILY_CONVERSATION_SIGNS } from "../lib/handPoseShortcuts.js";
import { BONE_COUNT, BONE, FINGER_SPECS, THUMB_SPEC, buildHandSkinGeometry } from "../lib/handSkinMesh.js";
import { MODEL_PINCH_POSE, createHandModelBones, createSkinBumpTexture } from "../lib/handModelRig.js";
import { loadHandTemplate } from "../lib/handModelLoader.js";
import { createPrintUniforms, printAsHalftone, readPrintInks } from "../lib/halftoneShader.js";
import { FINGER_INKS, PRINT_INKS } from "../lib/printPalette.js";
import { FINGER_CURL_GAINS, makeHandSpec, thumbAnglesFor } from "../lib/handPoseSpec.js";
import { liveHandSpecs } from "../lib/liveHandMirror.js";
import { resolveColor, subscribeTheme } from "../lib/theme.js";
import HalftoneField from "./HalftoneField.jsx";

// Joint marker colours: the wrist shares the thumb's ink, then one ink per finger.
const FINGER_COLORS = Array.from({ length: 21 }, (_, joint) => FINGER_INKS[joint === 0 ? 0 : Math.floor((joint - 1) / 4)]);

const SKIN_THEMES = [
  {
    id: "warm",
    label: "Real Skin",
    color: 0xe0a382,
    nailColor: 0xdda492,
    creaseColor: 0xb87658,
    sheen: 0xffc6ad,
    emissive: 0x240f08,
    roughness: 0.42,
    metalness: 0.02,
    skinGlow: 0.6, // warm light scattered under the skin at the edges and fingertips
  },
  {
    id: "halftone",
    label: "Halftone",
    color: 0xf0e2d3,
    nailColor: 0xfbf3ea,
    creaseColor: 0x3b2a20,
    sheen: 0xffffff,
    emissive: 0x000000,
    roughness: 0.55,
    metalness: 0,
    halftone: true,
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
      // Thumb + Index form a clean circle, Middle + Ring + Pinky extended & fanned out (👌).
      // The ring lies almost edge-on to the palm, so the hand turns its thumb side toward the
      // viewer; from straight ahead the "O" would be hidden behind the index finger.
      return {
        primary: makeHandSpec({
          thumb: "pinch",
          index: 0.68,
          middle: 0,
          ring: 0,
          pinky: 0,
          splay: 0.08,
          pos: [0.04, -0.18, 0.04],
          rot: [0.05, 0.95, 0],
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

export default function InteractiveSign3D({
  activeMeaning = "HELLO",
  holdingMeaning = "",
  recognized = false,
  liveHandsRef = null,
  cameraOn = false,
  cameraAspect = null, // camera frame width / height, so the live mirror measures in square units
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
    cameraAspect: 1,
    manualSymbolUntil: 0,
    clickLockMeaning: "",
    clickLockUntil: 0,
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
    // A sign the user clicked stays locked on the stage; camera recognition cannot replace it until the lock ends.
    const clickLocked = performance.now() < stateRef.current.clickLockUntil;
    if (clickLocked) {
      stateRef.current.recognized = Boolean(recognized) && activeMeaning === stateRef.current.clickLockMeaning;
      stateRef.current.holding = false;
      return;
    }
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

  useEffect(() => {
    stateRef.current.cameraAspect = Number.isFinite(cameraAspect) && cameraAspect > 0 ? cameraAspect : 1;
  }, [cameraAspect]);

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
    let unsubscribeTheme = () => {};
    const resources = new Set();
    const own = (res) => {
      resources.add(res);
      return res;
    };

    const init = async () => {
      try {
        const [THREE, environments] = await Promise.all([
          import("three"),
          import("three/examples/jsm/environments/RoomEnvironment.js").catch(() => null),
        ]);
        if (disposed) return;

        // Sculpted hand model (public/hand3d). If it cannot be loaded, the procedural hand takes over.
        let handTemplate = null;
        try {
          handTemplate = await loadHandTemplate(THREE);
        } catch (error) {
          console.warn("[InteractiveSign3D] sculpted hand model unavailable, using the built-in procedural hand", error);
        }
        if (disposed) {
          handTemplate?.geometry.dispose();
          return;
        }

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.domElement.className = "sign3d-canvas";
        renderer.domElement.setAttribute("aria-hidden", "true");
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 50);
        camera.position.set(0, 0.08, 4.75);

        // Warm 3-point studio lighting for realistic human skin & clear finger depth
        scene.add(new THREE.HemisphereLight(0xfff7f0, 0x2a1c16, 1.1));
        const keyLight = new THREE.DirectionalLight(0xfff9f4, 2.5);
        keyLight.position.set(3.4, 4.8, 5.8);
        // Soft self-shadowing: fingers shade the palm and each other, which is what gives the hand depth
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.left = -2.6;
        keyLight.shadow.camera.right = 2.6;
        keyLight.shadow.camera.top = 2.2;
        keyLight.shadow.camera.bottom = -2.2;
        keyLight.shadow.camera.near = 2;
        keyLight.shadow.camera.far = 16;
        keyLight.shadow.bias = -0.0006;
        keyLight.shadow.normalBias = 0.022;
        keyLight.shadow.radius = 5;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xe4ecff, 0.9);
        fillLight.position.set(-4.2, 1.8, 4.4);
        scene.add(fillLight);

        const rimLight = new THREE.PointLight(0xffc4a3, 2.4, 15);
        rimLight.position.set(-2.2, 2.8, -3.6);
        scene.add(rimLight);

        // Soft studio reflections: skin, nails and gold pick up a room's light instead of reading as
        // plastic. The lights alone still make a good hand if this is unavailable.
        if (environments) {
          try {
            const room = new environments.RoomEnvironment();
            const pmrem = new THREE.PMREMGenerator(renderer);
            scene.environment = own(pmrem.fromScene(room, 0.04).texture);
            scene.environmentIntensity = 0.45;
            pmrem.dispose();
            room.dispose();
          } catch {
            scene.environment = null;
          }
        }

        const rootGroup = new THREE.Group();
        scene.add(rootGroup);

        // Stage markings beneath the forearm, printed in the page's inks (re-read on a theme change)
        const ringGeo = own(new THREE.RingGeometry(1.52, 1.60, 72));
        const ringMat = own(new THREE.MeshBasicMaterial({ color: PRINT_INKS.spot1, side: THREE.DoubleSide, transparent: true, opacity: 0.44 }));
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2.25;
        ringMesh.position.y = -1.28;
        rootGroup.add(ringMesh);

        const outerRingGeo = own(new THREE.RingGeometry(1.88, 1.92, 72));
        const outerRingMat = own(new THREE.MeshBasicMaterial({ color: PRINT_INKS.ink, side: THREE.DoubleSide, transparent: true, opacity: 0.3 }));
        const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRingMesh.rotation.x = Math.PI / 2.25;
        outerRingMesh.position.y = -1.30;
        rootGroup.add(outerRingMesh);
        const stageColors = {
          ring: new THREE.Color(PRINT_INKS.spot1),
          hold: new THREE.Color(PRINT_INKS.spot3),
          ok: new THREE.Color(PRINT_INKS.spot2),
        };

        // Materials: Skin, Fingernails, Knuckle Creases, and Studio Sleeve Cuff
        const SkinMatClass = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
        const skinMat = own(
          new SkinMatClass({
            color: SKIN_THEMES[0].color,
            roughness: SKIN_THEMES[0].roughness,
            metalness: SKIN_THEMES[0].metalness,
            vertexColors: true, // per-vertex tint: pinker palm and fingertips, redder knuckles, darker creases
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
            roughness: 0.3,
            metalness: 0.02,
            ...(THREE.MeshPhysicalMaterial ? { clearcoat: 0.35, clearcoatRoughness: 0.22 } : {}),
          })
        );

        const cuffMat = own(
          new THREE.MeshStandardMaterial({
            color: PRINT_INKS.spot1,
            roughness: 0.78,
            metalness: 0.0,
          })
        );
        const cuffTrimMat = own(new THREE.MeshBasicMaterial({ color: PRINT_INKS.spot2 }));

        // "Halftone" skin: the lit colour reprinted as dot screens in the page's print inks.
        const halftoneUniforms = createPrintUniforms(THREE, { pixelRatio: renderer.getPixelRatio(), enabled: false });
        printAsHalftone(skinMat, halftoneUniforms);
        printAsHalftone(nailMat, halftoneUniforms);

        const readStageColors = () => {
          stageColors.ring.setStyle(resolveColor(host, "--stage-ring", PRINT_INKS.spot1));
          stageColors.hold.setStyle(resolveColor(host, "--stage-ring-hold", PRINT_INKS.spot3));
          stageColors.ok.setStyle(resolveColor(host, "--stage-ring-ok", PRINT_INKS.spot2));
          outerRingMat.color.setStyle(resolveColor(host, "--stage-outer", PRINT_INKS.ink));
          cuffMat.color.setStyle(resolveColor(host, "--stage-cuff", PRINT_INKS.spot1));
          cuffTrimMat.color.setStyle(resolveColor(host, "--stage-trim", PRINT_INKS.spot2));
          readPrintInks(THREE, host, halftoneUniforms);
        };
        readStageColors();
        unsubscribeTheme = subscribeTheme(readStageColors);

        const overlayJointMat = own(
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
          })
        );

        // Shared geometries: one continuous skinned hand surface + rigid nails, cuff and joint pins.
        // The sculpted model is preferred; the procedural hand is the offline / missing-asset fallback.
        const handSkinGeo = own(handTemplate ? handTemplate.geometry : buildHandSkinGeometry(THREE));
        const nailGeo = own(new THREE.SphereGeometry(1, 20, 14));
        const pinSphereGeo = own(new THREE.SphereGeometry(1, 14, 12));
        const cuffGeo = own(new THREE.CylinderGeometry(1, 1.07, 1, 40, 1));
        const trimGeo = own(new THREE.TorusGeometry(1, 0.045, 10, 48));
        if (handTemplate) {
          skinMat.bumpMap = own(createSkinBumpTexture(THREE));
          skinMat.bumpScale = 0.38;
        }

        /** Bones for the sculpted model: the 25 model joints rebuilt as a posable hierarchy. */
        const buildModelRig = () => {
          const bones = createHandModelBones(THREE, handTemplate);
          const fingers = {};
          for (const spec of FINGER_SPECS) {
            const ids = handTemplate.fingers[spec.name];
            fingers[spec.name] = {
              spec,
              mcpPivot: bones[ids.mcp],
              pipPivot: bones[ids.pip],
              dipPivot: bones[ids.dip],
              curCurl: 0,
              curSplay: spec.baseSplayZ,
            };
          }
          const rim = handTemplate.cuff;
          return {
            root: bones[handTemplate.wrist],
            bones,
            thumbCmcPivot: bones[handTemplate.thumb.cmc],
            thumbMcpPivot: bones[handTemplate.thumb.mcp],
            thumbIpPivot: bones[handTemplate.thumb.ip],
            fingers,
            jointAnchors: handTemplate.landmarkJoints.map((id) => bones[id]),
            nails: handTemplate.nails.map((nail) => ({ ...nail, bone: bones[nail.joint] })),
            pinchPose: MODEL_PINCH_POSE,
            // The model ends in an open wrist; the sleeve starts just above that edge and hides it.
            cuff: { x: rim.x, z: rim.z, top: rim.y + 0.1, height: 0.36, radiusX: rim.radiusX * 1.17, radiusZ: rim.radiusZ * 1.2 },
          };
        };

        /** Bones for the procedural fallback hand (16 bones, see handSkinMesh.js). */
        const buildProceduralRig = () => {
          const bones = new Array(BONE_COUNT);
          const jointAnchors = new Array(21);
          const nails = [];
          const nailTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07, 0, 0));
          const addNail = (bone, len, rTip, widthScale = 1) =>
            nails.push({
              bone,
              quaternion: nailTilt,
              position: new THREE.Vector3(0, len * 0.74, -rTip * 0.69),
              scale: [rTip * 0.74 * widthScale, len * 0.37, rTip * 0.2],
            });

          const palmBone = new THREE.Bone();
          bones[BONE.palm] = palmBone;
          const wristAnchor = new THREE.Object3D();
          wristAnchor.position.set(0, -0.42, 0);
          palmBone.add(wristAnchor);
          jointAnchors[0] = wristAnchor;

          // Thumb chain (Joints 1: CMC -> 2: MCP -> 3: IP -> 4: Tip)
          const [tLen1, tLen2, tLen3] = THUMB_SPEC.lengths;
          const thumbCmcPivot = new THREE.Bone();
          thumbCmcPivot.position.set(...THUMB_SPEC.mountPos);
          thumbCmcPivot.rotation.set(...THUMB_SPEC.bindRotation);
          palmBone.add(thumbCmcPivot);
          const thumbMcpPivot = new THREE.Bone();
          thumbMcpPivot.position.set(0, tLen1, 0);
          thumbCmcPivot.add(thumbMcpPivot);
          const thumbIpPivot = new THREE.Bone();
          thumbIpPivot.position.set(0, tLen2, 0);
          thumbMcpPivot.add(thumbIpPivot);
          const thumbTip = new THREE.Object3D();
          thumbTip.position.set(0, tLen3, 0);
          thumbIpPivot.add(thumbTip);
          jointAnchors[1] = thumbCmcPivot;
          jointAnchors[2] = thumbMcpPivot;
          jointAnchors[3] = thumbIpPivot;
          jointAnchors[4] = thumbTip;
          addNail(thumbIpPivot, tLen3, THUMB_SPEC.radii[3], 1.06);
          bones[BONE.thumb[0]] = thumbCmcPivot;
          bones[BONE.thumb[1]] = thumbMcpPivot;
          bones[BONE.thumb[2]] = thumbIpPivot;

          // Four fingers (Index, Middle, Ring, Pinky)
          const fingers = {};
          for (const spec of FINGER_SPECS) {
            const [jMcp, jPip, jDip, jTip] = spec.jointIndices;
            const [len1, len2, len3] = spec.lengths;
            const mcpPivot = new THREE.Bone();
            mcpPivot.position.set(...spec.mountPos);
            palmBone.add(mcpPivot);
            const pipPivot = new THREE.Bone();
            pipPivot.position.set(0, len1, 0);
            mcpPivot.add(pipPivot);
            const dipPivot = new THREE.Bone();
            dipPivot.position.set(0, len2, 0);
            pipPivot.add(dipPivot);
            const tipAnchor = new THREE.Object3D();
            tipAnchor.position.set(0, len3, 0);
            dipPivot.add(tipAnchor);
            jointAnchors[jMcp] = mcpPivot;
            jointAnchors[jPip] = pipPivot;
            jointAnchors[jDip] = dipPivot;
            jointAnchors[jTip] = tipAnchor;
            addNail(dipPivot, len3, spec.radii[3]);
            const [b0, b1, b2] = BONE[spec.name];
            bones[b0] = mcpPivot;
            bones[b1] = pipPivot;
            bones[b2] = dipPivot;
            fingers[spec.name] = { spec, mcpPivot, pipPivot, dipPivot, curCurl: 0, curSplay: spec.baseSplayZ };
          }

          return {
            root: palmBone,
            bones,
            thumbCmcPivot,
            thumbMcpPivot,
            thumbIpPivot,
            fingers,
            jointAnchors,
            nails,
            pinchPose: null, // the generic pinch angles below were made for this rig
            cuff: { x: 0, z: 0, top: -0.7, height: 0.26, radiusX: 0.39, radiusZ: 0.29 },
          };
        };

        /**
         * Builds a complete hierarchical 3D Hand + Wrist rig: bones driving one continuous skinned
         * skin surface, with fingernails and a studio sleeve cuff.
         * mirrorX = 1 (Right hand: thumb on -X left side when palm faces viewer)
         * mirrorX = -1 (Left hand: thumb on +X right side when palm faces viewer)
         */
        const createArticulatedHandSlot = (mirrorX = 1) => {
          const handRoot = new THREE.Group(); // Controlled by pos & rot
          const mirrorGroup = new THREE.Group();
          mirrorGroup.scale.x = mirrorX;
          handRoot.add(mirrorGroup);

          const rig = handTemplate ? buildModelRig() : buildProceduralRig();
          mirrorGroup.add(rig.root);

          // Rigid fingernail plates on the dorsal side of each distal phalanx
          for (const nail of rig.nails) {
            const plate = new THREE.Mesh(nailGeo, nailMat);
            plate.position.copy(nail.position);
            plate.quaternion.copy(nail.quaternion);
            plate.scale.set(...nail.scale);
            plate.castShadow = true;
            nail.bone.add(plate);
          }

          // Studio sleeve cuff around the wrist / lower forearm
          const { cuff } = rig;
          const cuffMesh = new THREE.Mesh(cuffGeo, cuffMat);
          cuffMesh.position.set(cuff.x, cuff.top - cuff.height / 2, cuff.z);
          cuffMesh.scale.set(cuff.radiusX, cuff.height, cuff.radiusZ);
          cuffMesh.castShadow = true;
          mirrorGroup.add(cuffMesh);

          const trimMesh = new THREE.Mesh(trimGeo, cuffTrimMat);
          trimMesh.position.set(cuff.x, cuff.top, cuff.z);
          trimMesh.rotation.x = Math.PI / 2;
          trimMesh.scale.set(cuff.radiusX, cuff.radiusZ, cuff.radiusX);
          mirrorGroup.add(trimMesh);

          // Bind the continuous skin surface to the bones in the rest pose
          const skinMesh = new THREE.SkinnedMesh(handSkinGeo, skinMat);
          skinMesh.castShadow = true;
          skinMesh.receiveShadow = true;
          skinMesh.frustumCulled = false;
          mirrorGroup.add(skinMesh);
          handRoot.updateMatrixWorld(true);
          const skeleton = own(new THREE.Skeleton(rig.bones));
          skinMesh.bind(skeleton);

          // 21 Joint Marker Overlay Pins
          const overlayPins = own(new THREE.InstancedMesh(pinSphereGeo, overlayJointMat, 21));
          const c = new THREE.Color();
          for (let i = 0; i < 21; i++) {
            c.set(FINGER_COLORS[i]);
            overlayPins.setColorAt(i, c);
          }
          overlayPins.instanceColor.needsUpdate = true;
          overlayPins.visible = false;
          rootGroup.add(overlayPins);

          return {
            handRoot,
            mirrorGroup,
            thumbCmcPivot: rig.thumbCmcPivot,
            thumbMcpPivot: rig.thumbMcpPivot,
            thumbIpPivot: rig.thumbIpPivot,
            fingers: rig.fingers,
            jointAnchors: rig.jointAnchors,
            pinchPose: rig.pinchPose,
            overlayPins,
            curPos: new THREE.Vector3(0, -0.18, 0),
            curRot: new THREE.Vector3(0, 0, 0),
            curThumbCmc: new THREE.Vector3(...THUMB_SPEC.bindRotation),
            curThumbMcp: new THREE.Vector3(0, 0, 0),
            curThumbIp: new THREE.Vector3(0, 0, 0),
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
          const pinching = spec.thumb === "pinch";
          const thumbTarget = (pinching && slot.pinchPose?.thumb) || thumbAnglesFor(spec.thumb);
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

            if (pinching && fName === "index") {
              // Round O-pinch: the index arcs forward so its pad meets the thumb pad (OK 👌).
              // Each rig brings its own solved angles; the generic ones suit the procedural hand.
              const solved = slot.pinchPose?.index;
              const [pinchMcp, pinchPip, pinchDip] = solved || [1.05, 1.25, 0.85];
              const sideways = solved ? solved[3] : fObj.curSplay - 0.05;
              const pScale = fObj.curCurl / 0.68;
              fObj.mcpPivot.rotation.set(pinchMcp * pScale, 0, sideways);
              fObj.pipPivot.rotation.set(pinchPip * pScale, 0, 0);
              fObj.dipPivot.rotation.set(pinchDip * pScale, 0, 0);
            } else {
              // A living hand is never ruler-straight: extended fingers keep a slight natural bend.
              const relax = 1 - fObj.curCurl;
              const [gainMcp, gainPip, gainDip] = FINGER_CURL_GAINS;
              fObj.mcpPivot.rotation.set(fObj.curCurl * gainMcp + relax * 0.02, 0, fObj.curSplay);
              fObj.pipPivot.rotation.set(fObj.curCurl * gainPip + relax * 0.06, 0, 0);
              fObj.dipPivot.rotation.set(fObj.curCurl * gainDip + relax * 0.04, 0, 0);
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
            halftoneUniforms.uHalftone.value = themeObj.halftone ? 1 : 0;
            halftoneUniforms.uSkinGlow.value = themeObj.skinGlow ?? 0;
            // Skin grain would speckle the dot screens, so the printed hand is smooth.
            if (skinMat.bumpMap) skinMat.bumpScale = themeObj.halftone ? 0 : 0.38;
          }

          // Determine whether to mirror raw webcam fingers or show the clean 3D Sign Symbol
          const liveHands = liveHandsRef?.current;
          const hasLiveHands = Array.isArray(liveHands) && liveHands.length > 0;
          const manualLocked = now < (st.manualSymbolUntil || 0);
          const useLiveMirror = st.mirrorLiveHand && hasLiveHands && !st.holding && !manualLocked;
          let targetPrimary = null;
          let targetSecondary = null;

          if (useLiveMirror) {
            // Primary = the hand on the LEFT of the mirrored preview, secondary = the one on the right.
            ({ primary: targetPrimary, secondary: targetSecondary } = liveHandSpecs(liveHands, { aspect: st.cameraAspect }));
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

          // Stage ring: spot 1 at rest, spot 3 while a sign is held, spot 2 when recognised
          const pulse = st.recognized ? 0.74 + Math.sin(t * 7) * 0.20 : st.holding ? 0.62 : 0.44;
          ringMat.opacity = pulse;
          ringMat.color.copy(st.recognized ? stageColors.ok : st.holding ? stageColors.hold : stageColors.ring);
          outerRingMesh.rotation.z = t * 0.32;

          camera.position.z += (4.75 / st.zoom - camera.position.z) * Math.min(1, dt * 12);
          renderer.render(scene, camera);
          frameId = window.requestAnimationFrame(tick);
        };
        frameId = window.requestAnimationFrame(tick);
      } catch (error) {
        // Fall back peacefully if WebGL fails, but leave a trace so a broken stage is diagnosable
        console.warn("[InteractiveSign3D] 3D stage failed to start", error);
      }
    };

    init();

    return () => {
      disposed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect?.();
      unsubscribeTheme();
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
    const nextYaw = stateRef.current.baseYaw + dx * 0.011; // unclamped: keeps spinning past 360°
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
        {/* Printed spotlight behind the hand; still while the camera runs. */}
        <HalftoneField pattern="spot" cell={8} fps={24} animate={!cameraOn} />
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
                stateRef.current.clickLockMeaning = item.meaning;
                stateRef.current.clickLockUntil = performance.now() + 6000;
                stateRef.current.holding = false;
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
