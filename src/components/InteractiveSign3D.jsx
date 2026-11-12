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
  { id: "warm", label: "Real Skin", color: 0xdba07e, sheen: 0xffb89c, emissive: 0x2b1109, roughness: 0.45, metalness: 0.01 },
  { id: "cyber", label: "Cyber Holo", color: 0x1ee6a8, sheen: 0x56c8ff, emissive: 0x09382c, roughness: 0.22, metalness: 0.48 },
  { id: "gold", label: "Sculpt Gold", color: 0xe6b873, sheen: 0xffe4b5, emissive: 0x2e1f08, roughness: 0.30, metalness: 0.55 },
];

// Exact bind-pose 21 joint coordinates measured inside hand.fbx (scaled by S = 0.11)
const FBX_BIND_JOINTS = [
  [0.000, -0.820, -0.030],  // 0: Wrist
  [-0.380, -0.490, 0.160],  // 1: Thumb CMC (deep inside radial thenar base)
  [-0.690, -0.330, 0.340],  // 2: Thumb MCP
  [-0.915, -0.155, 0.470],  // 3: Thumb IP
  [-1.093, -0.044, 0.546],  // 4: Thumb Tip
  [-0.442, 0.232, -0.103],  // 5: Index MCP
  [-0.478, 0.517, -0.084],  // 6: Index PIP
  [-0.536, 0.784, -0.065],  // 7: Index DIP
  [-0.567, 0.984, -0.070],  // 8: Index Tip
  [-0.108, 0.273, -0.101],  // 9: Middle MCP
  [-0.118, 0.590, -0.106],  // 10: Middle PIP
  [-0.100, 0.891, -0.078],  // 11: Middle DIP
  [-0.107, 1.116, -0.063],  // 12: Middle Tip
  [0.205, 0.234, -0.094],   // 13: Ring MCP
  [0.246, 0.501, -0.081],   // 14: Ring PIP
  [0.314, 0.758, -0.052],   // 15: Ring DIP
  [0.355, 0.957, -0.050],   // 16: Ring Tip
  [0.461, 0.148, -0.069],   // 17: Pinky MCP
  [0.531, 0.298, -0.053],   // 18: Pinky PIP
  [0.617, 0.450, -0.032],   // 19: Pinky DIP
  [0.670, 0.579, -0.025],   // 20: Pinky Tip
];

// 16 anatomical bones in strict parent-before-child order for Forward Kinematics (FK)
const BONE_SPECS = [
  { id: 0, ja: 0, jb: 9, parent: -1 },   // 0: Palm
  { id: 1, ja: 1, jb: 2, parent: 0 },    // 1: Thumb CMC -> MCP
  { id: 2, ja: 2, jb: 3, parent: 1 },    // 2: Thumb MCP -> IP
  { id: 3, ja: 3, jb: 4, parent: 2 },    // 3: Thumb IP -> Tip
  { id: 4, ja: 5, jb: 6, parent: 0 },    // 4: Index MCP -> PIP
  { id: 5, ja: 6, jb: 7, parent: 4 },    // 5: Index PIP -> DIP
  { id: 6, ja: 7, jb: 8, parent: 5 },    // 6: Index DIP -> Tip
  { id: 7, ja: 9, jb: 10, parent: 0 },   // 7: Middle MCP -> PIP
  { id: 8, ja: 10, jb: 11, parent: 7 },  // 8: Middle PIP -> DIP
  { id: 9, ja: 11, jb: 12, parent: 8 },  // 9: Middle DIP -> Tip
  { id: 10, ja: 13, jb: 14, parent: 0 }, // 10: Ring MCP -> PIP
  { id: 11, ja: 14, jb: 15, parent: 10 },// 11: Ring PIP -> DIP
  { id: 12, ja: 15, jb: 16, parent: 11 },// 12: Ring DIP -> Tip
  { id: 13, ja: 17, jb: 18, parent: 0 }, // 13: Pinky MCP -> PIP
  { id: 14, ja: 18, jb: 19, parent: 13 },// 14: Pinky PIP -> DIP
  { id: 15, ja: 19, jb: 20, parent: 14 },// 15: Pinky DIP -> Tip
];

function segLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function stepDir(origin, len, dx, dy, dz) {
  const n = Math.max(1e-6, Math.hypot(dx, dy, dz));
  return [
    origin[0] + (dx / n) * len,
    origin[1] + (dy / n) * len,
    origin[2] + (dz / n) * len,
  ];
}

/**
 * Generates a realistic 21-joint 3D human hand pose with exact FBX segment lengths
 * and distributed joint angles so fingers curl into a true fist and the thumb moves naturally.
 */
function buildProceduralHand({
  thumb = "open", // "open" | "tucked" | "up" | "down" | "pinch"
  index = 0,      // 0 = extended, 1 = curled, 0.5 = pinch
  middle = 0,
  ring = 0,
  pinky = 0,
  mirrorX = 1,
  offset = [0, 0, 0],
  tiltZ = 0,
  tiltY = 0,
} = {}) {
  const pts = FBX_BIND_JOINTS.map((p) => [...p]);
  const fistLike = index > 0.6 && middle > 0.6;

  // Thumb (1..4) with smooth distributed rotations across CMC (1->2), MCP (2->3), IP (3->4)
  const tL1 = segLength(FBX_BIND_JOINTS[1], FBX_BIND_JOINTS[2]);
  const tL2 = segLength(FBX_BIND_JOINTS[2], FBX_BIND_JOINTS[3]);
  const tL3 = segLength(FBX_BIND_JOINTS[3], FBX_BIND_JOINTS[4]);

  if (thumb === "tucked") {
    if (fistLike) {
      pts[2] = stepDir(pts[1], tL1, -0.32, 0.78, 0.52);
      pts[3] = stepDir(pts[2], tL2, 0.72, 0.45, 0.52);
      pts[4] = stepDir(pts[3], tL3, 0.92, 0.12, 0.25);
    } else {
      pts[2] = stepDir(pts[1], tL1, -0.22, 0.86, 0.45);
      pts[3] = stepDir(pts[2], tL2, 0.68, 0.65, 0.32);
      pts[4] = stepDir(pts[3], tL3, 0.86, 0.48, 0.14);
    }
  } else if (thumb === "up") {
    pts[2] = stepDir(pts[1], tL1, -0.42, 0.88, 0.20);
    pts[3] = stepDir(pts[2], tL2, -0.08, 0.99, 0.08);
    pts[4] = stepDir(pts[3], tL3, 0.02, 0.99, 0.04);
  } else if (thumb === "pinch") {
    pts[2] = stepDir(pts[1], tL1, -0.45, 0.78, 0.42);
    pts[3] = stepDir(pts[2], tL2, 0.05, 0.85, 0.52);
    pts[4] = stepDir(pts[3], tL3, 0.48, 0.72, 0.48);
  } else {
    pts[2] = stepDir(pts[1], tL1, -0.78, 0.52, 0.34);
    pts[3] = stepDir(pts[2], tL2, -0.68, 0.68, 0.26);
    pts[4] = stepDir(pts[3], tL3, -0.60, 0.76, 0.20);
  }

  const fingerConfigs = [
    { joints: [5, 6, 7, 8], curl: index },
    { joints: [9, 10, 11, 12], curl: middle },
    { joints: [13, 14, 15, 16], curl: ring },
    { joints: [17, 18, 19, 20], curl: pinky },
  ];

  for (const cfg of fingerConfigs) {
    const [mcp, pip, dip, tip] = cfg.joints;
    const base = FBX_BIND_JOINTS[mcp];
    pts[mcp] = [...base];

    const s1 = segLength(FBX_BIND_JOINTS[mcp], FBX_BIND_JOINTS[pip]);
    const s2 = segLength(FBX_BIND_JOINTS[pip], FBX_BIND_JOINTS[dip]);
    const s3 = segLength(FBX_BIND_JOINTS[dip], FBX_BIND_JOINTS[tip]);

    if (thumb === "pinch" && mcp === 5) {
      pts[pip] = stepDir(base, s1, -0.05, 0.68, 0.73);
      pts[dip] = stepDir(pts[pip], s2, 0.04, -0.18, 0.98);
      pts[tip] = stepDir(pts[dip], s3, 0.12, -0.82, 0.55);
      continue;
    }

    const c = cfg.curl;
    if (c <= 0.001) {
      pts[pip] = [...FBX_BIND_JOINTS[pip]];
      pts[dip] = [...FBX_BIND_JOINTS[dip]];
      pts[tip] = [...FBX_BIND_JOINTS[tip]];
      continue;
    }

    const bindDirX = (FBX_BIND_JOINTS[tip][0] - FBX_BIND_JOINTS[mcp][0]) / (s1 + s2 + s3);

    const a1 = c * 1.54;
    const a2 = c * 2.84;
    const a3 = c * 3.70;

    pts[pip] = stepDir(base, s1, bindDirX * (1 - c * 0.85), Math.cos(a1), Math.sin(a1));
    pts[dip] = stepDir(pts[pip], s2, bindDirX * (1 - c * 0.92), Math.cos(a2), Math.sin(a2));
    pts[tip] = stepDir(pts[dip], s3, bindDirX * (1 - c * 0.96), Math.cos(a3), Math.sin(a3));
  }

  const cosZ = Math.cos(tiltZ), sinZ = Math.sin(tiltZ);
  const cosY = Math.cos(tiltY), sinY = Math.sin(tiltY);

  return pts.map(([rawX, rawY, rawZ]) => {
    const x = rawX * mirrorX;
    const y = rawY;
    const z = rawZ;
    const rx = x * cosZ - y * sinZ;
    const ry = x * sinZ + y * cosZ;
    const fx = rx * cosY + z * sinY;
    const fz = -rx * sinY + z * cosY;
    return [fx + offset[0], ry + offset[1], fz + offset[2]];
  });
}

/**
 * Maps each of the 20 Daily Conversation Signs to 1-hand or 2-hand 3D joint coordinates.
 */
export function get3DPoseForSign(meaning = "HELLO") {
  switch (meaning) {
    case "HELLO":
      return { primary: buildProceduralHand({ thumb: "open", index: 0, middle: 0, ring: 0, pinky: 0 }), secondary: null };
    case "HOW ARE YOU":
      return {
        primary: buildProceduralHand({ thumb: "open", index: 0, middle: 0, ring: 0, pinky: 0, offset: [-1.12, 0, 0.08], tiltY: 0.20 }),
        secondary: buildProceduralHand({ thumb: "open", index: 0, middle: 0, ring: 0, pinky: 0, mirrorX: -1, offset: [1.12, 0, 0.08], tiltY: -0.20 }),
      };
    case "I AM FINE":
      return {
        primary: buildProceduralHand({ thumb: "up", index: 1, middle: 1, ring: 1, pinky: 1, offset: [-1.02, -0.05, 0.1] }),
        secondary: buildProceduralHand({ thumb: "up", index: 1, middle: 1, ring: 1, pinky: 1, mirrorX: -1, offset: [1.02, -0.05, 0.1] }),
      };
    case "GOOD MORNING":
      return {
        primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 0, pinky: 0, offset: [-0.92, -0.04, 0.12], tiltZ: -0.10, tiltY: 0.28 }),
        secondary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 0, pinky: 0, mirrorX: -1, offset: [0.92, -0.04, 0.12], tiltZ: 0.10, tiltY: -0.28 }),
      };
    case "NICE TO MEET YOU":
      return {
        primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 1, pinky: 1, offset: [-1.02, 0, 0.1] }),
        secondary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 1, pinky: 1, mirrorX: -1, offset: [1.02, 0, 0.1] }),
      };
    case "THANK YOU":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 0, pinky: 0 }), secondary: null };
    case "PLEASE":
      return { primary: buildProceduralHand({ thumb: "open", index: 0, middle: 0, ring: 1, pinky: 1 }), secondary: null };
    case "SORRY":
      return {
        primary: buildProceduralHand({ thumb: "tucked", index: 1, middle: 1, ring: 1, pinky: 1, offset: [-0.96, -0.08, 0.1] }),
        secondary: buildProceduralHand({ thumb: "tucked", index: 1, middle: 1, ring: 1, pinky: 1, mirrorX: -1, offset: [0.96, -0.08, 0.1] }),
      };
    case "BYE":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 1, pinky: 1 }), secondary: null };
    case "I LOVE YOU":
      return { primary: buildProceduralHand({ thumb: "open", index: 0, middle: 1, ring: 1, pinky: 0 }), secondary: null };
    case "YES":
      return { primary: buildProceduralHand({ thumb: "up", index: 1, middle: 1, ring: 1, pinky: 1 }), secondary: null };
    case "NO":
      return { primary: buildProceduralHand({ thumb: "up", index: 1, middle: 1, ring: 1, pinky: 1, tiltZ: Math.PI, offset: [0, 0.25, 0] }), secondary: null };
    case "OK":
      return { primary: buildProceduralHand({ thumb: "pinch", index: 0.5, middle: 0, ring: 0, pinky: 0 }), secondary: null };
    case "GOOD":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 1, ring: 1, pinky: 0 }), secondary: null };
    case "WAIT":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 1, ring: 1, pinky: 1 }), secondary: null };
    case "HELP":
      return {
        primary: buildProceduralHand({ thumb: "open", index: 0, middle: 0, ring: 0, pinky: 0, offset: [-1.04, 0, 0.1] }),
        secondary: buildProceduralHand({ thumb: "up", index: 1, middle: 1, ring: 1, pinky: 1, mirrorX: -1, offset: [1.04, -0.05, 0.1] }),
      };
    case "WATER":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 0, middle: 0, ring: 0, pinky: 1 }), secondary: null };
    case "FOOD":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 1, middle: 1, ring: 1, pinky: 0 }), secondary: null };
    case "COME HERE":
      return { primary: buildProceduralHand({ thumb: "open", index: 0, middle: 1, ring: 1, pinky: 1 }), secondary: null };
    case "CALL ME":
      return { primary: buildProceduralHand({ thumb: "open", index: 1, middle: 1, ring: 1, pinky: 0 }), secondary: null };
    case "STOP":
      return { primary: buildProceduralHand({ thumb: "tucked", index: 1, middle: 1, ring: 1, pinky: 1 }), secondary: null };
    default:
      return { primary: buildProceduralHand({ thumb: "open", index: 0, middle: 0, ring: 0, pinky: 0 }), secondary: null };
  }
}

/**
 * Converts normalized MediaPipe 2D/3D hand landmarks (0..1) into Three.js scene space.
 */
function normalizeLiveHandTo3D(landmarks, handIndex = 0, totalHands = 1) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const cx = landmarks[9].x;
  const cy = landmarks[9].y;
  const palm = Math.max(0.06, Math.hypot(landmarks[9].x - landmarks[0].x, landmarks[9].y - landmarks[0].y));
  const scale = 1.08 / palm;
  const baseOffsetX = totalHands > 1 ? (handIndex === 0 ? -1.05 : 1.05) : 0;
  return landmarks.map((pt) => [
    -(pt.x - cx) * scale + baseOffsetX,
    -(pt.y - cy) * scale + 0.25,
    -(pt.z || 0) * scale * 1.35,
  ]);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function distToSegment3D(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const wx = p[0] - a[0], wy = p[1] - a[1], wz = p[2] - a[2];
  const c1 = vx * wx + vy * wy + vz * wz;
  const c2 = vx * vx + vy * vy + vz * vz;
  const t = Math.max(0, Math.min(1, c1 / Math.max(1e-6, c2)));
  const dx = p[0] - (a[0] + t * vx);
  const dy = p[1] - (a[1] + t * vy);
  const dz = p[2] - (a[2] + t * vz);
  return { d: Math.hypot(dx, dy, dz), t };
}

function distToChain(p, j0, j1, j2, j3) {
  const s1 = distToSegment3D(p, j0, j1);
  const s2 = distToSegment3D(p, j1, j2);
  const s3 = distToSegment3D(p, j2, j3);
  return Math.min(s1.d, s2.d, s3.d);
}

function buildFbxSkinWeights(bindVerts, bindJoints, indices) {
  const nVerts = bindVerts.length;
  const numBones = BONE_SPECS.length;
  let W = new Float32Array(nVerts * numBones);

  const assignChainWeights = (i, p, j0, j1, j2, j3, b1, b2, b3, rootStart = -0.06, rootEnd = 0.14) => {
    const ux = j3[0] - j0[0], uy = j3[1] - j0[1], uz = j3[2] - j0[2];
    const uLen = Math.max(1e-5, Math.hypot(ux, uy, uz));
    const s = ((p[0] - j0[0]) * ux + (p[1] - j0[1]) * uy + (p[2] - j0[2]) * uz) / (uLen * uLen);

    const sPip = segLength(j0, j1) / uLen;
    const sDip = (segLength(j0, j1) + segLength(j1, j2)) / uLen;

    const baseOffset = i * numBones;
    if (s < rootEnd) {
      const w1 = smoothstep(rootStart, rootEnd, s);
      W[baseOffset + 0] = 1 - w1;
      W[baseOffset + b1] = w1;
    } else if (s < (sPip + sDip) * 0.5) {
      const w2 = smoothstep(sPip - 0.09, sPip + 0.09, s);
      W[baseOffset + b1] = 1 - w2;
      W[baseOffset + b2] = w2;
    } else {
      const w3 = smoothstep(sDip - 0.09, sDip + 0.09, s);
      W[baseOffset + b2] = 1 - w3;
      W[baseOffset + b3] = w3;
    }
  };

  for (let i = 0; i < nVerts; i++) {
    const p = bindVerts[i];
    const ax = Math.abs(p[0]);
    const isThumbSide = (bindJoints[1][0] < 0 ? p[0] < -0.28 : p[0] > 0.28);

    const dThumb = distToChain(p, bindJoints[1], bindJoints[2], bindJoints[3], bindJoints[4]);
    const dIndex = distToChain(p, bindJoints[5], bindJoints[6], bindJoints[7], bindJoints[8]);
    const dMiddle = distToChain(p, bindJoints[9], bindJoints[10], bindJoints[11], bindJoints[12]);
    const dRing = distToChain(p, bindJoints[13], bindJoints[14], bindJoints[15], bindJoints[16]);
    const dPinky = distToChain(p, bindJoints[17], bindJoints[18], bindJoints[19], bindJoints[20]);

    if (isThumbSide && p[1] < 0.16 && p[2] > -0.02 && dThumb < 0.28) {
      assignChainWeights(i, p, bindJoints[1], bindJoints[2], bindJoints[3], bindJoints[4], 1, 2, 3, -0.05, 0.22);
    } else if (p[1] > 0.14 && dIndex < dMiddle && dIndex < 0.22) {
      assignChainWeights(i, p, bindJoints[5], bindJoints[6], bindJoints[7], bindJoints[8], 4, 5, 6, -0.06, 0.12);
    } else if (p[1] > 0.16 && dMiddle <= dIndex && dMiddle <= dRing && dMiddle < 0.22) {
      assignChainWeights(i, p, bindJoints[9], bindJoints[10], bindJoints[11], bindJoints[12], 7, 8, 9, -0.06, 0.12);
    } else if (p[1] > 0.14 && dRing < dMiddle && dRing <= dPinky && dRing < 0.22) {
      assignChainWeights(i, p, bindJoints[13], bindJoints[14], bindJoints[15], bindJoints[16], 10, 11, 12, -0.06, 0.12);
    } else if (p[1] > 0.05 && ax > 0.30 && dPinky < dRing && dPinky < 0.22) {
      assignChainWeights(i, p, bindJoints[17], bindJoints[18], bindJoints[19], bindJoints[20], 13, 14, 15, -0.06, 0.12);
    } else {
      W[i * numBones + 0] = 1.0;
    }
  }

  const adj = Array.from({ length: nVerts }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (!adj[a].includes(b)) adj[a].push(b);
    if (!adj[a].includes(c)) adj[a].push(c);
    if (!adj[b].includes(a)) adj[b].push(a);
    if (!adj[b].includes(c)) adj[b].push(c);
    if (!adj[c].includes(a)) adj[c].push(a);
    if (!adj[c].includes(b)) adj[c].push(b);
  }

  for (let iter = 0; iter < 5; iter++) {
    const nextW = new Float32Array(W.length);
    for (let i = 0; i < nVerts; i++) {
      const nbrs = adj[i];
      const nCount = nbrs.length;
      const baseI = i * numBones;
      if (nCount === 0) {
        for (let b = 0; b < numBones; b++) nextW[baseI + b] = W[baseI + b];
        continue;
      }
      for (let b = 0; b < numBones; b++) {
        let sum = W[baseI + b] * 2.0;
        for (let k = 0; k < nCount; k++) {
          sum += W[nbrs[k] * numBones + b];
        }
        nextW[baseI + b] = sum / (nCount + 2.0);
      }
    }
    W = nextW;
  }

  const boneIdx0 = new Uint8Array(nVerts);
  const boneIdx1 = new Uint8Array(nVerts);
  const boneIdx2 = new Uint8Array(nVerts);
  const weight0 = new Float32Array(nVerts);
  const weight1 = new Float32Array(nVerts);
  const weight2 = new Float32Array(nVerts);

  for (let i = 0; i < nVerts; i++) {
    const baseI = i * numBones;
    let b0 = 0, b1 = 0, b2 = 0;
    let w0 = -1, w1 = -1, w2 = -1;
    for (let b = 0; b < numBones; b++) {
      const val = W[baseI + b];
      if (val > w0) {
        w2 = w1; b2 = b1;
        w1 = w0; b1 = b0;
        w0 = val; b0 = b;
      } else if (val > w1) {
        w2 = w1; b2 = b1;
        w1 = val; b1 = b;
      } else if (val > w2) {
        w2 = val; b2 = b;
      }
    }
    w0 = Math.max(0, w0);
    w1 = Math.max(0, w1);
    w2 = Math.max(0, w2);
    const norm = Math.max(1e-6, w0 + w1 + w2);
    boneIdx0[i] = b0;
    boneIdx1[i] = b1;
    boneIdx2[i] = b2;
    weight0[i] = w0 / norm;
    weight1[i] = w1 / norm;
    weight2[i] = w2 / norm;
  }

  return { boneIdx0, boneIdx1, boneIdx2, weight0, weight1, weight2 };
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
  const [selectedMeaning, setSelectedMeaning] = useState(activeMeaning || "HELLO");
  const [seqPlaying, setSeqPlaying] = useState(false);
  const [seqStepIdx, setSeqStepIdx] = useState(0);
  const [seqSpeed, setSeqSpeed] = useState(1);
  const stateRef = useRef({
    targetMeaning: activeMeaning || "HELLO",
    viewPreset: "orbit",
    skinTheme: "warm",
    showJointOverlay: false,
    recognized: false,
    holding: false,
    yaw: 0,
    pitch: 0.08,
    zoom: 1,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const nextMeaning = holdingMeaning || activeMeaning || selectedMeaning || "HELLO";
    setSelectedMeaning(nextMeaning);
    stateRef.current.targetMeaning = nextMeaning;
    stateRef.current.recognized = Boolean(recognized);
    stateRef.current.holding = Boolean(holdingMeaning);
  }, [activeMeaning, holdingMeaning, recognized]);

  // When a sentence sequence play is triggered from Step 3, start playing from step 0
  useEffect(() => {
    if (!sentencePlan?.matchedSigns?.length || sentencePlayToken <= 0) return;
    setAutoTour(false);
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
    setSeqPlaying(false);
    setSeqStepIdx(idx);
    const step = steps[idx];
    setSelectedMeaning(step.meaning);
    stateRef.current.targetMeaning = step.meaning;
  };

  useEffect(() => {
    stateRef.current.viewPreset = viewPreset;
    if (viewPreset === "front") {
      stateRef.current.yaw = 0;
      stateRef.current.pitch = 0.05;
    } else if (viewPreset === "side") {
      stateRef.current.yaw = 0.68;
      stateRef.current.pitch = 0.18;
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
    const own = (res) => { resources.add(res); return res; };

    const init = async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.domElement.className = "sign3d-canvas";
        renderer.domElement.setAttribute("aria-hidden", "true");
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 50);
        camera.position.set(0, 0.08, 5.1);

        // Warm 3-point studio lighting for realistic human skin
        scene.add(new THREE.HemisphereLight(0xfff5ed, 0x1b1412, 1.85));
        const keyLight = new THREE.DirectionalLight(0xfff8f2, 2.75);
        keyLight.position.set(3.2, 4.6, 5.6);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xdff7ef, 1.15);
        fillLight.position.set(-4.0, 1.6, 4.2);
        scene.add(fillLight);

        const rimLight = new THREE.PointLight(0xffbfa0, 2.3, 14);
        rimLight.position.set(-2.4, 2.6, -3.4);
        scene.add(rimLight);

        const rootGroup = new THREE.Group();
        scene.add(rootGroup);

        // Glowing stage platform rings beneath the wrist
        const ringGeo = own(new THREE.RingGeometry(1.55, 1.63, 72));
        const ringMat = own(new THREE.MeshBasicMaterial({ color: 0x3ae6a8, side: THREE.DoubleSide, transparent: true, opacity: 0.42 }));
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2.25;
        ringMesh.position.y = -1.35;
        rootGroup.add(ringMesh);

        const outerRingGeo = own(new THREE.RingGeometry(1.92, 1.95, 72));
        const outerRingMat = own(new THREE.MeshBasicMaterial({ color: 0xffbe55, side: THREE.DoubleSide, transparent: true, opacity: 0.28 }));
        const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRingMesh.rotation.x = Math.PI / 2.25;
        outerRingMesh.position.y = -1.37;
        rootGroup.add(outerRingMesh);

        // 72 floating 3D energy particles orbiting around the hand
        const particleCount = 72;
        const pCoords = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
          const ang = (i / particleCount) * Math.PI * 2;
          const rad = 1.65 + (i % 5) * 0.22;
          pCoords[i * 3] = Math.cos(ang) * rad;
          pCoords[i * 3 + 1] = -1.1 + ((i * 17) % 24) * 0.1;
          pCoords[i * 3 + 2] = Math.sin(ang) * rad * 0.65;
        }
        const particleGeo = own(new THREE.BufferGeometry());
        particleGeo.setAttribute("position", new THREE.BufferAttribute(pCoords, 3));
        const particleMat = own(new THREE.PointsMaterial({
          color: 0x56f0be,
          size: 0.048,
          transparent: true,
          opacity: 0.65,
        }));
        const particleSystem = new THREE.Points(particleGeo, particleMat);
        rootGroup.add(particleSystem);

        // Realistic human skin material
        const SkinMatClass = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
        const skinMat = own(new SkinMatClass({
          color: 0xdba07e,
          roughness: 0.45,
          metalness: 0.01,
          ...(THREE.MeshPhysicalMaterial ? {
            clearcoat: 0.12,
            clearcoatRoughness: 0.45,
            sheen: 0.42,
            sheenColor: new THREE.Color(0xffb89c),
            sheenRoughness: 0.55,
          } : {}),
          emissive: 0x2b1109,
          emissiveIntensity: 0.12,
        }));

        const cuffMat = own(new THREE.MeshStandardMaterial({
          color: 0x132822,
          roughness: 0.34,
          metalness: 0.38,
          emissive: 0x091915,
          emissiveIntensity: 0.35,
        }));
        const cuffTrimMat = own(new THREE.MeshBasicMaterial({ color: 0x45e3b0 }));
        const cuffGeo = own(new THREE.CylinderGeometry(1.02, 0.95, 1, 32, 1, false));

        const overlayJointMat = own(new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.92,
        }));
        const pinSphereGeo = own(new THREE.SphereGeometry(1, 14, 12));

        const createEmptyHandSlot = (mirrorX = 1) => {
          const group = new THREE.Group();

          const cuffMesh = new THREE.Mesh(cuffGeo, cuffMat);
          const cuffTrim = new THREE.Mesh(cuffGeo, cuffTrimMat);
          cuffMesh.visible = false;
          cuffTrim.visible = false;
          group.add(cuffMesh, cuffTrim);

          const overlayPins = own(new THREE.InstancedMesh(pinSphereGeo, overlayJointMat, 21));
          const c = new THREE.Color();
          for (let i = 0; i < 21; i++) {
            c.setHex(FINGER_COLORS[i]);
            overlayPins.setColorAt(i, c);
          }
          overlayPins.instanceColor.needsUpdate = true;
          overlayPins.visible = false;
          group.add(overlayPins);

          return {
            group,
            mirrorX,
            cuffMesh,
            cuffTrim,
            overlayPins,
            fbxSkin: null,
            curRoot: new THREE.Vector3(0, -0.82, -0.03),
            curBoneQuats: Array.from({ length: BONE_SPECS.length }, () => new THREE.Quaternion()),
            initializedQuats: false,
          };
        };

        const handA = createEmptyHandSlot(1);
        const handB = createEmptyHandSlot(-1);
        handB.group.visible = false;
        rootGroup.add(handA.group, handB.group);

        const loadRealHandFbx = async () => {
          if (typeof window.fetch !== "function") return;
          try {
            const [{ FBXLoader }, BufferGeometryUtils, resp] = await Promise.all([
              import("three/examples/jsm/loaders/FBXLoader.js"),
              import("three/examples/jsm/utils/BufferGeometryUtils.js"),
              window.fetch("/models/hand/hand.fbx"),
            ]);
            if (disposed || !resp?.ok) return;
            const ab = await resp.arrayBuffer();
            if (disposed) return;

            const fbxGroup = new FBXLoader().parse(ab, "/models/hand/");
            const srcMesh = fbxGroup.children.find((c) => c.isMesh);
            if (!srcMesh?.geometry) return;

            const rawGeo = srcMesh.geometry.clone();
            rawGeo.deleteAttribute("normal");
            rawGeo.deleteAttribute("uv");
            const weldedGeo = BufferGeometryUtils.mergeVertices(rawGeo, 1e-4);
            const rawPos = weldedGeo.attributes.position;
            const rawIdx = weldedGeo.index.array;
            const nVerts = rawPos.count;
            const S = 0.11;

            const attachSkinnedFbxToSlot = (slot) => {
              const mX = slot.mirrorX;
              const bindVerts = new Array(nVerts);
              const positions = new Float32Array(nVerts * 3);
              for (let i = 0; i < nVerts; i++) {
                const fx = rawPos.getX(i);
                const fy = rawPos.getY(i);
                const fz = rawPos.getZ(i);
                const vx = -fz * S * mX;
                let vy = -fx * S;
                const vz = -fy * S;
                if (vy < -0.88) {
                  vy = -0.88 + (vy + 0.88) * 0.25;
                }
                bindVerts[i] = [vx, vy, vz];
                positions[i * 3] = vx;
                positions[i * 3 + 1] = vy;
                positions[i * 3 + 2] = vz;
              }

              const indices = new Uint16Array(rawIdx.length);
              for (let t = 0; t < rawIdx.length; t += 3) {
                if (mX === 1) {
                  indices[t] = rawIdx[t];
                  indices[t + 1] = rawIdx[t + 2];
                  indices[t + 2] = rawIdx[t + 1];
                } else {
                  indices[t] = rawIdx[t];
                  indices[t + 1] = rawIdx[t + 1];
                  indices[t + 2] = rawIdx[t + 2];
                }
              }

              const bindJoints = FBX_BIND_JOINTS.map(([x, y, z]) => [x * mX, y, z]);
              const weights = buildFbxSkinWeights(bindVerts, bindJoints, indices);

              const bindDirs = BONE_SPECS.map(({ ja, jb }) => {
                return new THREE.Vector3(
                  bindJoints[jb][0] - bindJoints[ja][0],
                  bindJoints[jb][1] - bindJoints[ja][1],
                  bindJoints[jb][2] - bindJoints[ja][2]
                ).normalize();
              });

              const bindPalmUp = new THREE.Vector3().subVectors(
                new THREE.Vector3(...bindJoints[9]),
                new THREE.Vector3(...bindJoints[0])
              ).normalize();
              const bindPalmAcross = new THREE.Vector3().subVectors(
                new THREE.Vector3(...bindJoints[17]),
                new THREE.Vector3(...bindJoints[5])
              );
              bindPalmAcross.addScaledVector(bindPalmUp, -bindPalmAcross.dot(bindPalmUp)).normalize();
              const bindPalmNormal = new THREE.Vector3().crossVectors(bindPalmAcross, bindPalmUp).normalize();
              const bindPalmMat = new THREE.Matrix4().makeBasis(bindPalmAcross, bindPalmUp, bindPalmNormal);
              const bindPalmQuatInv = new THREE.Quaternion().setFromRotationMatrix(bindPalmMat).invert();

              const handGeo = own(new THREE.BufferGeometry());
              handGeo.setIndex(new THREE.BufferAttribute(indices, 1));
              handGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
              handGeo.computeVertexNormals();

              const handMesh = new THREE.Mesh(handGeo, skinMat);
              slot.group.add(handMesh);
              slot.cuffMesh.visible = true;
              slot.cuffTrim.visible = true;

              slot.fbxSkin = {
                handGeo,
                positions,
                bindVerts,
                bindJoints,
                bindDirs,
                bindPalmQuatInv,
                ...weights,
              };
            };

            attachSkinnedFbxToSlot(handA);
            attachSkinnedFbxToSlot(handB);
          } catch {
            // Keep running cleanly if FBX fetch is unavailable in test env
          }
        };
        loadRealHandFbx();

        const dummy = new THREE.Object3D();
        const curPalmUp = new THREE.Vector3();
        const curPalmAcross = new THREE.Vector3();
        const curPalmNormal = new THREE.Vector3();
        const curPalmMat = new THREE.Matrix4();
        const qPalm = new THREE.Quaternion();
        const qSwing = new THREE.Quaternion();
        const vUnbentDir = new THREE.Vector3();
        const vTargetDir = new THREE.Vector3();
        const targetBoneQuats = Array.from({ length: BONE_SPECS.length }, () => new THREE.Quaternion());
        const fkJoints = Array.from({ length: 21 }, () => [0, 0, 0]);
        const vTmp = new THREE.Vector3();
        const vLocal0 = new THREE.Vector3();
        const vLocal1 = new THREE.Vector3();
        const vLocal2 = new THREE.Vector3();

        const evalBoneTransform = (pBind, boneId, bindJoints, curQuats, outVec) => {
          const pivotJoint = BONE_SPECS[boneId].ja;
          const bindOrigin = bindJoints[pivotJoint];
          const fkOrigin = fkJoints[pivotJoint];
          outVec.set(
            pBind[0] - bindOrigin[0],
            pBind[1] - bindOrigin[1],
            pBind[2] - bindOrigin[2]
          ).applyQuaternion(curQuats[boneId]);
          outVec.x += fkOrigin[0];
          outVec.y += fkOrigin[1];
          outVec.z += fkOrigin[2];
        };

        const updateHandSlot = (slot, targetPts, dt, showOverlay, isLive = false) => {
          if (!targetPts) {
            slot.group.visible = false;
            return;
          }
          slot.group.visible = true;
          slot.overlayPins.visible = Boolean(showOverlay);

          const alpha = Math.min(1, dt * (isLive ? 24 : 15));

          curPalmUp.set(
            targetPts[9][0] - targetPts[0][0],
            targetPts[9][1] - targetPts[0][1],
            targetPts[9][2] - targetPts[0][2]
          );
          if (curPalmUp.lengthSq() < 1e-6) curPalmUp.set(0, 1, 0);
          else curPalmUp.normalize();

          curPalmAcross.set(
            targetPts[17][0] - targetPts[5][0],
            targetPts[17][1] - targetPts[5][1],
            targetPts[17][2] - targetPts[5][2]
          );
          curPalmAcross.addScaledVector(curPalmUp, -curPalmAcross.dot(curPalmUp));
          if (curPalmAcross.lengthSq() < 1e-6) curPalmAcross.set(1, 0, 0);
          else curPalmAcross.normalize();

          curPalmNormal.crossVectors(curPalmAcross, curPalmUp).normalize();

          if (slot.fbxSkin) {
            const {
              handGeo,
              positions,
              bindVerts,
              bindJoints,
              bindDirs,
              bindPalmQuatInv,
              boneIdx0,
              boneIdx1,
              boneIdx2,
              weight0,
              weight1,
              weight2,
            } = slot.fbxSkin;

            curPalmMat.makeBasis(curPalmAcross, curPalmUp, curPalmNormal);
            qPalm.setFromRotationMatrix(curPalmMat).multiply(bindPalmQuatInv);
            targetBoneQuats[0].copy(qPalm);

            for (let b = 1; b < BONE_SPECS.length; b++) {
              const { ja, jb, parent } = BONE_SPECS[b];
              vTargetDir.set(
                targetPts[jb][0] - targetPts[ja][0],
                targetPts[jb][1] - targetPts[ja][1],
                targetPts[jb][2] - targetPts[ja][2]
              );
              if (vTargetDir.lengthSq() < 1e-6) {
                targetBoneQuats[b].copy(targetBoneQuats[parent]);
              } else {
                vTargetDir.normalize();
                vUnbentDir.copy(bindDirs[b]).applyQuaternion(targetBoneQuats[parent]);
                qSwing.setFromUnitVectors(vUnbentDir, vTargetDir);
                targetBoneQuats[b].multiplyQuaternions(qSwing, targetBoneQuats[parent]);
              }
            }

            vTmp.set(targetPts[0][0], targetPts[0][1], targetPts[0][2]);
            if (!slot.initializedQuats) {
              slot.curRoot.copy(vTmp);
              for (let b = 0; b < BONE_SPECS.length; b++) {
                slot.curBoneQuats[b].copy(targetBoneQuats[b]);
              }
              slot.initializedQuats = true;
            } else {
              slot.curRoot.lerp(vTmp, alpha);
              for (let b = 0; b < BONE_SPECS.length; b++) {
                slot.curBoneQuats[b].slerp(targetBoneQuats[b], alpha);
              }
            }

            const curQuats = slot.curBoneQuats;

            fkJoints[0][0] = slot.curRoot.x;
            fkJoints[0][1] = slot.curRoot.y;
            fkJoints[0][2] = slot.curRoot.z;

            for (const rootKnuckle of [1, 5, 9, 13, 17]) {
              vTmp.set(
                bindJoints[rootKnuckle][0] - bindJoints[0][0],
                bindJoints[rootKnuckle][1] - bindJoints[0][1],
                bindJoints[rootKnuckle][2] - bindJoints[0][2]
              ).applyQuaternion(curQuats[0]);
              fkJoints[rootKnuckle][0] = fkJoints[0][0] + vTmp.x;
              fkJoints[rootKnuckle][1] = fkJoints[0][1] + vTmp.y;
              fkJoints[rootKnuckle][2] = fkJoints[0][2] + vTmp.z;
            }

            for (let b = 1; b < BONE_SPECS.length; b++) {
              const { ja, jb } = BONE_SPECS[b];
              vTmp.set(
                bindJoints[jb][0] - bindJoints[ja][0],
                bindJoints[jb][1] - bindJoints[ja][1],
                bindJoints[jb][2] - bindJoints[ja][2]
              ).applyQuaternion(curQuats[b]);
              fkJoints[jb][0] = fkJoints[ja][0] + vTmp.x;
              fkJoints[jb][1] = fkJoints[ja][1] + vTmp.y;
              fkJoints[jb][2] = fkJoints[ja][2] + vTmp.z;
            }

            const nVerts = bindVerts.length;
            for (let i = 0; i < nVerts; i++) {
              const pBind = bindVerts[i];
              const w0 = weight0[i];
              evalBoneTransform(pBind, boneIdx0[i], bindJoints, curQuats, vLocal0);
              let fx = vLocal0.x * w0;
              let fy = vLocal0.y * w0;
              let fz = vLocal0.z * w0;

              const w1 = weight1[i];
              if (w1 > 1e-4) {
                evalBoneTransform(pBind, boneIdx1[i], bindJoints, curQuats, vLocal1);
                fx += vLocal1.x * w1;
                fy += vLocal1.y * w1;
                fz += vLocal1.z * w1;
              }

              const w2 = weight2[i];
              if (w2 > 1e-4) {
                evalBoneTransform(pBind, boneIdx2[i], bindJoints, curQuats, vLocal2);
                fx += vLocal2.x * w2;
                fy += vLocal2.y * w2;
                fz += vLocal2.z * w2;
              }

              const i3 = i * 3;
              positions[i3] = fx;
              positions[i3 + 1] = fy;
              positions[i3 + 2] = fz;
            }

            handGeo.attributes.position.needsUpdate = true;
            handGeo.computeVertexNormals();

            vTmp.set(0, -0.09, -0.02).applyQuaternion(curQuats[0]);
            slot.cuffMesh.position.set(
              fkJoints[0][0] + vTmp.x,
              fkJoints[0][1] + vTmp.y,
              fkJoints[0][2] + vTmp.z
            );
            slot.cuffMesh.quaternion.copy(curQuats[0]);
            slot.cuffMesh.scale.set(0.36, 0.16, 0.24);

            vTmp.set(0, -0.015, -0.02).applyQuaternion(curQuats[0]);
            slot.cuffTrim.position.set(
              fkJoints[0][0] + vTmp.x,
              fkJoints[0][1] + vTmp.y,
              fkJoints[0][2] + vTmp.z
            );
            slot.cuffTrim.quaternion.copy(curQuats[0]);
            slot.cuffTrim.scale.set(0.368, 0.024, 0.246);
          }

          if (showOverlay) {
            for (let i = 0; i < 21; i++) {
              const jp = slot.fbxSkin ? fkJoints[i] : targetPts[i];
              dummy.position.set(
                jp[0] + curPalmNormal.x * (slot.mirrorX * 0.11),
                jp[1] + curPalmNormal.y * (slot.mirrorX * 0.11),
                jp[2] + curPalmNormal.z * (slot.mirrorX * 0.11)
              );
              dummy.rotation.set(0, 0, 0);
              dummy.scale.setScalar(0.042);
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
          }

          // Live camera hands vs procedural 3D sign target
          const liveHands = liveHandsRef?.current;
          let targetPrimary = null;
          let targetSecondary = null;
          const hasLiveHands = Array.isArray(liveHands) && liveHands.length > 0;
          if (hasLiveHands) {
            targetPrimary = normalizeLiveHandTo3D(liveHands[0].landmarks, 0, liveHands.length);
            if (liveHands.length > 1) {
              targetSecondary = normalizeLiveHandTo3D(liveHands[1].landmarks, 1, liveHands.length);
            }
          } else {
            const pose3d = get3DPoseForSign(st.targetMeaning);
            targetPrimary = pose3d.primary;
            targetSecondary = pose3d.secondary;
          }

          updateHandSlot(handA, targetPrimary, dt, st.showJointOverlay, hasLiveHands);
          updateHandSlot(handB, targetSecondary, dt, st.showJointOverlay, hasLiveHands);

          // Rotate / float smoothly
          if (!st.dragging && st.viewPreset === "orbit") {
            st.yaw = Math.sin(t * 0.65) * 0.34;
          }
          rootGroup.rotation.y += (st.yaw - rootGroup.rotation.y) * Math.min(1, dt * 8);
          rootGroup.rotation.x += (st.pitch - rootGroup.rotation.x) * Math.min(1, dt * 8);
          rootGroup.position.y = Math.sin(t * 1.8) * 0.035;

          // Orbiting 3D particles
          particleSystem.rotation.y = t * 0.28;
          const pulse = st.recognized ? 0.72 + Math.sin(t * 7) * 0.22 : st.holding ? 0.58 : 0.38;
          ringMat.opacity = pulse;
          ringMat.color.setHex(st.recognized ? 0x45ffaa : st.holding ? 0xffbe55 : 0x3ae6a8);
          outerRingMesh.rotation.z = t * 0.35;

          camera.position.z += (5.1 / st.zoom - camera.position.z) * Math.min(1, dt * 10);
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
    stateRef.current.dragging = true;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
  };
  const onPointerMove = (e) => {
    if (!stateRef.current.dragging) return;
    const dx = e.clientX - stateRef.current.lastX;
    const dy = e.clientY - stateRef.current.lastY;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
    stateRef.current.yaw = Math.max(-1.8, Math.min(1.8, stateRef.current.yaw + dx * 0.01));
    stateRef.current.pitch = Math.max(-0.85, Math.min(0.85, stateRef.current.pitch + dy * 0.008));
  };
  const onPointerUp = () => {
    stateRef.current.dragging = false;
  };
  const adjustZoom = (delta) => {
    stateRef.current.zoom = Math.max(0.7, Math.min(1.55, stateRef.current.zoom + delta));
  };

  const currentSignMeta = DAILY_CONVERSATION_SIGNS.find((s) => s.meaning === selectedMeaning) || DAILY_CONVERSATION_SIGNS[0];

  return (
    <div className="sign3d-stage rb-spotlight-card">
      <div className="sign3d-header">
        <div className="sign3d-title-block">
          <span className="sign3d-kicker rb-shiny-text">THREE.JS REAL 3D HUMAN HAND · REACT BITS STAGE</span>
          <strong>{currentSignMeta.icon} {currentSignMeta.meaning}</strong>
          <small>{cameraOn ? "Mirrors your live hand using rigged hand.fbx · Drag to rotate 360°" : `${currentSignMeta.howTo} · Drag to rotate 360°`}</small>
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
        onPointerLeave={onPointerUp}
      >
        <div className="sign3d-hud-overlay" aria-hidden="true">
          <div className="sign3d-hud-badge">
            <span className="sign3d-hud-dot" />
            <span>{currentSignMeta.category} · {currentSignMeta.hands === 2 ? "2-Hand Sign" : "1-Hand Sign"}</span>
          </div>
          <div className="sign3d-zoom-dock">
            <button type="button" tabIndex={-1} onClick={() => adjustZoom(0.15)} title="Zoom in">+</button>
            <button type="button" tabIndex={-1} onClick={() => { stateRef.current.zoom = 1; stateRef.current.yaw = 0; stateRef.current.pitch = 0.08; }} title="Reset 3D view">⟳</button>
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
