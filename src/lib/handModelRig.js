/**
 * Sculpted hand model rig for the SignBridge 3D stage.
 *
 * Source asset: public/hand3d/left.glb — the WebXR "generic-hand" model from
 * @webxr-input-profiles/assets (MIT licence, Copyright (c) 2019 Amazon).
 *
 * The asset ships 25 joints as flat siblings in WebXR world space. This module:
 *   1. re-aligns it into SignBridge hand space (+Y fingers, +Z palm, -X thumb),
 *   2. smooths the low-poly surface with one level of Phong tessellation,
 *   3. rebuilds a hierarchical skeleton whose bone frames have +Y along each bone and +X as the
 *      flexion axis, so the existing sign poses (`rotation.set(curl, 0, splay)`) drive it directly,
 *   4. paints subtle skin-tone variation and measures where the fingernails and cuff belong.
 */
import { THUMB_SPEC } from "./handSkinMesh.js";

export const HAND_MODEL_URL = "hand3d/left.glb";

const FINGER_NAMES = ["index", "middle", "ring", "pinky"];
const fingerJoints = (name) => [
  `${name}-finger-metacarpal`,
  `${name}-finger-phalanx-proximal`,
  `${name}-finger-phalanx-intermediate`,
  `${name}-finger-phalanx-distal`,
  `${name}-finger-tip`,
];
const THUMB_JOINTS = ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"];

/** Overall size: wrist to middle fingertip, in stage units. */
const HAND_LENGTH = 1.86;
const WRIST_Y = -0.46;

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Pulls raw arrays out of a loaded glTF scene so the rest of this module is plain math. */
export function extractHandModelData(THREE, scene) {
  let mesh = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isSkinnedMesh && !mesh) mesh = o;
  });
  if (!mesh) throw new Error("hand model has no skinned mesh");
  const g = mesh.geometry;
  const count = g.attributes.position.count;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(mesh.matrixWorld);
    positions.set([v.x, v.y, v.z], i * 3);
    if (g.attributes.uv) uvs.set([g.attributes.uv.getX(i), g.attributes.uv.getY(i)], i * 2);
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = g.attributes.skinIndex.getComponent(i, k);
      skinWeight[i * 4 + k] = g.attributes.skinWeight.getComponent(i, k);
    }
  }
  const q = new THREE.Quaternion();
  return {
    positions,
    uvs,
    skinIndex,
    skinWeight,
    index: Array.from(g.index.array),
    jointNames: mesh.skeleton.bones.map((b) => b.name),
    jointPositions: mesh.skeleton.bones.map((b) => b.getWorldPosition(new THREE.Vector3()).toArray()),
    jointQuaternions: mesh.skeleton.bones.map((b) => b.getWorldQuaternion(q).toArray()),
  };
}

/** Smooth normals that ignore UV seams: vertices sharing a position share a normal. */
function weldedNormals(positions, index) {
  const count = positions.length / 3;
  const weld = new Uint32Array(count);
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(positions[i * 3] * 2e4)},${Math.round(positions[i * 3 + 1] * 2e4)},${Math.round(positions[i * 3 + 2] * 2e4)}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = seen.size;
      seen.set(key, id);
    }
    weld[i] = id;
  }
  const acc = new Float64Array(seen.size * 3);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const corner of [index[t], index[t + 1], index[t + 2]]) {
      const w = weld[corner] * 3;
      acc[w] += nx;
      acc[w + 1] += ny;
      acc[w + 2] += nz;
    }
  }
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const w = weld[i] * 3;
    const len = Math.hypot(acc[w], acc[w + 1], acc[w + 2]) || 1;
    normals[i * 3] = acc[w] / len;
    normals[i * 3 + 1] = acc[w + 1] / len;
    normals[i * 3 + 2] = acc[w + 2] / len;
  }
  return normals;
}

/**
 * One level of Phong tessellation: every triangle splits into four, and each new edge midpoint is
 * pushed out toward the tangent planes of its two end vertices. Original vertices do not move, so
 * the sculpted shape keeps its volume while the silhouette loses its facets.
 */
function tessellate(mesh, alpha = 0.6) {
  const { positions, uvs, skinIndex, skinWeight, index } = mesh;
  const normals = weldedNormals(positions, index);
  const pos = Array.from(positions);
  const uv = Array.from(uvs);
  const si = Array.from(skinIndex);
  const sw = Array.from(skinWeight);
  const midpoints = new Map();

  const midpoint = (a, b) => {
    const key = a < b ? a * 1e6 + b : b * 1e6 + a;
    const hit = midpoints.get(key);
    if (hit !== undefined) return hit;
    const m = [0, 1, 2].map((k) => (positions[a * 3 + k] + positions[b * 3 + k]) / 2);
    const out = [0, 0, 0];
    for (const e of [a, b]) {
      const d =
        (m[0] - positions[e * 3]) * normals[e * 3] +
        (m[1] - positions[e * 3 + 1]) * normals[e * 3 + 1] +
        (m[2] - positions[e * 3 + 2]) * normals[e * 3 + 2];
      for (let k = 0; k < 3; k++) out[k] += (m[k] - d * normals[e * 3 + k]) / 2;
    }
    const id = pos.length / 3;
    for (let k = 0; k < 3; k++) pos.push(m[k] * (1 - alpha) + out[k] * alpha);
    uv.push((uvs[a * 2] + uvs[b * 2]) / 2, (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2);
    // Blend the bone influences of both ends and keep the four strongest.
    const merged = new Map();
    for (const e of [a, b]) {
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[e * 4 + k] / 2;
        if (w > 0) merged.set(skinIndex[e * 4 + k], (merged.get(skinIndex[e * 4 + k]) || 0) + w);
      }
    }
    const top = [...merged.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      si.push(top[k] ? top[k][0] : 0);
      sw.push(top[k] ? top[k][1] / total : 0);
    }
    midpoints.set(key, id);
    return id;
  };

  const nextIndex = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    nextIndex.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
  }
  return {
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    skinIndex: new Uint16Array(si),
    skinWeight: new Float32Array(sw),
    index: nextIndex,
  };
}

/**
 * Turns raw model data into everything the stage needs: skinned geometry in hand space, the joint
 * hierarchy with pose-friendly bone frames, the 21 landmark joints, nail mounts and cuff size.
 */
export function prepareHandModel(THREE, data, { levels = 1 } = {}) {
  const V = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);
  const jointId = (name) => {
    const id = data.jointNames.indexOf(name);
    if (id < 0) throw new Error(`hand model is missing joint "${name}"`);
    return id;
  };
  const raw = (name) => V(data.jointPositions[jointId(name)]);

  // --- 1. Alignment: model space -> hand space -------------------------------------------------
  const wrist = raw("wrist");
  const middle = fingerJoints("middle").map(raw);
  const up = middle[1].clone().sub(wrist).normalize();
  const lateral = raw("pinky-finger-phalanx-proximal").sub(raw("index-finger-phalanx-proximal"));
  lateral.addScaledVector(up, -lateral.dot(up)).normalize(); // toward the pinky = +X
  const palmward = new THREE.Vector3().crossVectors(lateral, up);
  // The thumb always sits on the palm side. If it does not, this is the opposite-handed model:
  // reflect it (and flip the triangle winding) so one code path serves either file.
  const reflected = raw("thumb-tip").sub(wrist).dot(palmward) < 0;
  if (reflected) palmward.negate();

  let reach = middle[1].distanceTo(wrist);
  for (let i = 1; i < 4; i++) reach += middle[i + 1].distanceTo(middle[i]);
  const scale = HAND_LENGTH / reach;

  const toHandDir = (v) => new THREE.Vector3(v.dot(lateral), v.dot(up), v.dot(palmward));
  const offset = new THREE.Vector3(0, WRIST_Y, 0);
  const toHand = (v) => toHandDir(v.clone().sub(wrist)).multiplyScalar(scale).add(offset);
  // Centre the knuckle row on the stage axis.
  const knuckles = FINGER_NAMES.map((n) => toHand(raw(`${n}-finger-phalanx-proximal`)));
  offset.x -= (knuckles[0].x + knuckles[3].x) / 2;
  offset.z -= knuckles.reduce((s, k) => s + k.z, 0) / 4;

  const jointPos = data.jointNames.map((_, i) => toHand(V(data.jointPositions[i])));
  const at = (name) => jointPos[jointId(name)];

  // --- 2. Surface: transform, smooth, re-normal --------------------------------------------------
  let mesh = {
    positions: new Float32Array(data.positions.length),
    uvs: data.uvs,
    skinIndex: data.skinIndex,
    skinWeight: data.skinWeight,
    index: data.index.slice(),
  };
  const tmp = new THREE.Vector3();
  for (let i = 0; i < data.positions.length; i += 3) {
    const h = toHand(tmp.set(data.positions[i], data.positions[i + 1], data.positions[i + 2]));
    mesh.positions.set([h.x, h.y, h.z], i);
  }
  if (reflected) {
    for (let t = 0; t < mesh.index.length; t += 3) {
      const swap = mesh.index[t + 1];
      mesh.index[t + 1] = mesh.index[t + 2];
      mesh.index[t + 2] = swap;
    }
  }
  for (let l = 0; l < levels; l++) mesh = tessellate(mesh);
  const normals = weldedNormals(mesh.positions, mesh.index);
  const vertexCount = mesh.positions.length / 3;

  // --- 3. Skeleton: hierarchy + bone frames ------------------------------------------------------
  // Each posed bone frame has +Y along the bone and +Z toward the palm side, so +X is the flexion
  // axis and a positive X rotation curls toward the palm - the convention the sign poses use.
  const identity = new THREE.Quaternion();
  const joints = data.jointNames.map((name, i) => ({ name, parent: -1, position: jointPos[i], frame: identity.clone() }));
  const wristId = jointId("wrist");
  const direction = (a, b) => at(b).clone().sub(at(a)).normalize();
  const propagate = (parentFrame, dir) => {
    const parentY = new THREE.Vector3(0, 1, 0).applyQuaternion(parentFrame);
    return new THREE.Quaternion().setFromUnitVectors(parentY, dir).multiply(parentFrame);
  };

  const fingers = {};
  for (const name of FINGER_NAMES) {
    const [meta, prox, inter, distal, tip] = fingerJoints(name);
    joints[jointId(meta)].parent = wristId;
    const y = direction(prox, inter);
    const z = new THREE.Vector3(0, 0, 1).addScaledVector(y, -y.z).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const proxFrame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const interFrame = propagate(proxFrame, direction(inter, distal));
    const distalFrame = propagate(interFrame, direction(distal, tip));
    Object.assign(joints[jointId(prox)], { parent: wristId, frame: proxFrame });
    Object.assign(joints[jointId(inter)], { parent: jointId(prox), frame: interFrame });
    Object.assign(joints[jointId(distal)], { parent: jointId(inter), frame: distalFrame });
    Object.assign(joints[jointId(tip)], { parent: jointId(distal), frame: distalFrame.clone() });
    fingers[name] = { mcp: jointId(prox), pip: jointId(inter), dip: jointId(distal), tip: jointId(tip) };
  }

  // Thumb: its rest pose stands in for the rig's relaxed "open" thumb. Only the swing between the
  // two directions is absorbed into the frame, so the sculpted thumb keeps its natural axial twist.
  const openThumb = new THREE.Quaternion().setFromEuler(new THREE.Euler(...THUMB_SPEC.bindRotation));
  const cmcFrame = propagate(openThumb, direction(THUMB_JOINTS[0], THUMB_JOINTS[1]));
  const thumbMcpFrame = propagate(cmcFrame, direction(THUMB_JOINTS[1], THUMB_JOINTS[2]));
  const thumbIpFrame = propagate(thumbMcpFrame, direction(THUMB_JOINTS[2], THUMB_JOINTS[3]));
  const [tCmc, tMcp, tIp, tTip] = THUMB_JOINTS.map(jointId);
  Object.assign(joints[tCmc], { parent: wristId, frame: cmcFrame });
  Object.assign(joints[tMcp], { parent: tCmc, frame: thumbMcpFrame });
  Object.assign(joints[tIp], { parent: tMcp, frame: thumbIpFrame });
  Object.assign(joints[tTip], { parent: tIp, frame: thumbIpFrame.clone() });
  const thumb = { cmc: tCmc, mcp: tMcp, ip: tIp, tip: tTip };

  // MediaPipe landmark order 0..20
  const landmarkJoints = [wristId, tCmc, tMcp, tIp, tTip];
  for (const name of FINGER_NAMES) landmarkJoints.push(fingers[name].mcp, fingers[name].pip, fingers[name].dip, fingers[name].tip);

  // --- 4. Fingernail mounts, measured from the surface itself -----------------------------------
  const weightOn = (vertex, a, b) => {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      const j = mesh.skinIndex[vertex * 4 + k];
      if (j === a || j === b) w += mesh.skinWeight[vertex * 4 + k];
    }
    return w;
  };
  const nails = [];
  const digits = [...FINGER_NAMES.map((n) => ({ distal: fingers[n].dip, tip: fingers[n].tip, dorsal: null })), { distal: tIp, tip: tTip, dorsal: "model" }];
  for (const digit of digits) {
    const boneFrame = joints[digit.distal].frame;
    let nailFrame = boneFrame;
    if (digit.dorsal === "model") {
      // The thumb's nail side comes from the model's own joint orientation (WebXR: local +Y = dorsal).
      const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(boneFrame);
      const dorsal = toHandDir(new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...data.jointQuaternions[digit.distal])));
      const zAxis = dorsal.negate(); // palm side of the thumb = opposite its nail side
      zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis)).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
      nailFrame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    }
    const inverse = nailFrame.clone().invert();
    const local = [];
    let length = 0;
    for (let i = 0; i < vertexCount; i++) {
      if (weightOn(i, digit.distal, digit.tip) < 0.6) continue;
      tmp.set(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]).sub(joints[digit.distal].position).applyQuaternion(inverse);
      local.push([tmp.x, tmp.y, tmp.z]);
      length = Math.max(length, tmp.y);
    }
    let dorsalRadius = 0;
    let halfWidth = 0;
    for (const [x, y, z] of local) {
      if (y < length * 0.4 || y > length * 0.85) continue;
      dorsalRadius = Math.max(dorsalRadius, -z);
      halfWidth = Math.max(halfWidth, Math.abs(x));
    }
    const toBone = boneFrame.clone().invert().multiply(nailFrame);
    nails.push({
      joint: digit.distal,
      quaternion: toBone,
      // Sunk into the fingertip so only a thin plate shows above the skin.
      position: new THREE.Vector3(0, length * 0.62, -dorsalRadius * 0.78).applyQuaternion(toBone),
      scale: [halfWidth * 0.66, length * 0.29, dorsalRadius * 0.2],
    });
  }

  // --- 5. Skin tone variation (multiplies the theme colour) --------------------------------------
  const bendJoints = [];
  for (const name of FINGER_NAMES) {
    const [, prox, inter, distal, tip] = fingerJoints(name);
    bendJoints.push({ id: jointId(prox), axis: direction(prox, inter), mcp: true });
    bendJoints.push({ id: jointId(inter), axis: direction(inter, distal) });
    bendJoints.push({ id: jointId(distal), axis: direction(distal, tip) });
  }
  bendJoints.push({ id: tMcp, axis: direction(THUMB_JOINTS[1], THUMB_JOINTS[2]) });
  bendJoints.push({ id: tIp, axis: direction(THUMB_JOINTS[2], THUMB_JOINTS[3]) });
  const tipJoints = new Set([tIp, tTip, ...FINGER_NAMES.flatMap((n) => [fingers[n].dip, fingers[n].tip])]);

  const colors = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    tmp.set(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
    const nz = normals[i * 3 + 2];
    const palmar = smooth(-0.1, 0.5, nz);
    const dorsal = smooth(-0.1, 0.5, -nz);
    let tipWeight = 0;
    for (let k = 0; k < 4; k++) if (tipJoints.has(mesh.skinIndex[i * 4 + k])) tipWeight += mesh.skinWeight[i * 4 + k];
    let knuckle = 0;
    let crease = 0;
    for (const joint of bendJoints) {
      const rel = tmp.clone().sub(joints[joint.id].position);
      const dist = rel.length();
      if (dist > 0.22) continue;
      knuckle = Math.max(knuckle, Math.exp(-(dist * dist) / (2 * 0.06 * 0.06)));
      const along = rel.dot(joint.axis) - (joint.mcp ? 0.07 : 0);
      crease = Math.max(crease, Math.exp(-(along * along) / (2 * 0.016 * 0.016)) * smooth(0.2, 0.12, dist));
    }
    const shade = 1 - palmar * crease * 0.16 - dorsal * knuckle * 0.04;
    colors[i * 3] = (1 + palmar * 0.035 + palmar * tipWeight * 0.03) * shade;
    colors[i * 3 + 1] = (1 - palmar * 0.05 - palmar * tipWeight * 0.06 - dorsal * knuckle * 0.085) * shade;
    colors[i * 3 + 2] = (1 - palmar * 0.07 - palmar * tipWeight * 0.07 - dorsal * knuckle * 0.105) * shade;
  }

  // --- 6. Where the sleeve cuff must sit to hide the open wrist end ------------------------------
  let minY = Infinity;
  for (let i = 0; i < vertexCount; i++) minY = Math.min(minY, mesh.positions[i * 3 + 1]);
  const rim = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < vertexCount; i++) {
    if (mesh.positions[i * 3 + 1] > minY + 0.14) continue;
    rim.minX = Math.min(rim.minX, mesh.positions[i * 3]);
    rim.maxX = Math.max(rim.maxX, mesh.positions[i * 3]);
    rim.minZ = Math.min(rim.minZ, mesh.positions[i * 3 + 2]);
    rim.maxZ = Math.max(rim.maxZ, mesh.positions[i * 3 + 2]);
  }
  const cuff = {
    y: minY,
    x: (rim.minX + rim.maxX) / 2,
    z: (rim.minZ + rim.maxZ) / 2,
    radiusX: (rim.maxX - rim.minX) / 2,
    radiusZ: (rim.maxZ - rim.minZ) / 2,
  };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(mesh.skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(mesh.skinWeight, 4));
  geometry.setIndex(mesh.index);

  return { geometry, joints, wrist: wristId, thumb, fingers, landmarkJoints, nails, cuff, reflected, scale };
}

/** Instantiates the bone hierarchy for one hand from a prepared template (rest pose). */
export function createHandModelBones(THREE, template) {
  const bones = template.joints.map((joint) => {
    const bone = new THREE.Bone();
    bone.name = joint.name;
    return bone;
  });
  template.joints.forEach((joint, i) => {
    const bone = bones[i];
    if (joint.parent < 0) {
      bone.position.copy(joint.position);
      bone.quaternion.copy(joint.frame);
      return;
    }
    const parent = template.joints[joint.parent];
    const parentInverse = parent.frame.clone().invert();
    bone.position.copy(joint.position).sub(parent.position).applyQuaternion(parentInverse);
    bone.quaternion.copy(parentInverse).multiply(joint.frame);
    bones[joint.parent].add(bone);
  });
  return bones;
}

/** Fine tileable bump texture: breaks up the specular highlight so skin stops reading as plastic. */
export function createSkinBumpTexture(THREE, size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const h = (ix, iy) => hash(((ix % period) + period) % period, ((iy % period) + period) % period);
    return (h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx) * (1 - sy) + (h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Two octaves of grain plus a faint diagonal weave, like the fine lattice of skin lines.
      const grain = noise(u * 32, v * 32, 32) * 0.55 + noise(u * 64, v * 64, 64) * 0.3;
      const weave = (Math.abs(Math.sin((u + v) * Math.PI * 16)) + Math.abs(Math.sin((u - v) * Math.PI * 16))) * 0.075;
      const value = Math.max(0, Math.min(255, Math.round((grain + weave) * 255)));
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 9);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
