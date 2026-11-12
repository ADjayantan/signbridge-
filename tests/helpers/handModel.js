import fs from "node:fs";

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/**
 * Minimal binary glTF reader for tests: returns the same plain-array shape that
 * extractHandModelData() produces in the browser, without needing a DOM or GLTFLoader.
 * Assumes what the hand asset uses: one skinned mesh, one skin, joints parented to an
 * untransformed armature (so each joint's local translation/rotation is its world pose).
 */
export function readHandModelData(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString("ascii", 0, 4) !== "glTF") throw new Error(`${file} is not a binary glTF`);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  const binStart = 20 + jsonLength + 8;

  const accessor = (id) => {
    const acc = json.accessors[id];
    const view = json.bufferViews[acc.bufferView];
    const width = COMPONENTS[acc.type];
    const size = BYTES[acc.componentType];
    const stride = view.byteStride || size * width;
    const start = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
    const out = new Array(acc.count * width);
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < width; k++) {
        const at = start + i * stride + k * size;
        out[i * width + k] =
          acc.componentType === 5126 ? buffer.readFloatLE(at)
          : acc.componentType === 5123 ? buffer.readUInt16LE(at)
          : acc.componentType === 5125 ? buffer.readUInt32LE(at)
          : buffer.readUInt8(at);
      }
    }
    return out;
  };

  const primitive = json.meshes[0].primitives[0];
  const joints = json.skins[0].joints.map((id) => json.nodes[id]);
  return {
    positions: new Float32Array(accessor(primitive.attributes.POSITION)),
    uvs: new Float32Array(accessor(primitive.attributes.TEXCOORD_0)),
    skinIndex: new Uint16Array(accessor(primitive.attributes.JOINTS_0)),
    skinWeight: new Float32Array(accessor(primitive.attributes.WEIGHTS_0)),
    index: accessor(primitive.indices),
    jointNames: joints.map((node) => node.name),
    jointPositions: joints.map((node) => node.translation),
    jointQuaternions: joints.map((node) => node.rotation),
  };
}

/**
 * The same model as its opposite-handed file would store it: reflected across the YZ plane, so a
 * left hand becomes a right hand. A reflection turns every triangle's winding around, and a valid
 * glTF keeps its triangles counter-clockwise seen from outside, so the winding is swapped back.
 */
export function mirrorHandModelData(data) {
  const positions = Float32Array.from(data.positions);
  for (let i = 0; i < positions.length; i += 3) positions[i] = -positions[i];
  const index = data.index.slice();
  for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  return {
    ...data,
    positions,
    index,
    jointPositions: data.jointPositions.map(([x, y, z]) => [-x, y, z]),
    // Reflecting a rotation across X keeps its x and w components and negates y and z.
    jointQuaternions: data.jointQuaternions.map(([x, y, z, w]) => [x, -y, -z, w]),
  };
}

const SPLAY_MULTIPLIERS = { index: 1.15, middle: 0.25, ring: -0.55, pinky: -1.25 };
const FINGERS = ["index", "middle", "ring", "pinky"];

/**
 * A stand-in for "a hand in front of the webcam": poses the sculpted model skeleton the way the
 * 3D stage does, then reports what a hand tracker would see.
 *
 *   const hand = createSyntheticHand(THREE, { template, bones, fingerSpecs, curlGains, thumbAngles, pinchPose });
 *   hand.pose({ index: 1, middle: 1, thumb: "tucked" });
 *   const landmarks = hand.landmarks({ screenX: 0.3, roll: 0.4 });
 *
 * landmarks() returns 21 MediaPipe-style points in RAW sensor coordinates (x is NOT mirrored, y
 * grows downward, z is relative to the wrist and negative toward the camera) for a hand that
 * looks, in the MIRRORED preview, like the stage hand: palm to the camera, thumb on the left.
 */
export function createSyntheticHand(THREE, { template, bones, fingerSpecs, curlGains, thumbAngles, pinchPose }) {
  const root = bones[template.wrist];
  const baseSplay = Object.fromEntries(fingerSpecs.map((spec) => [spec.name, spec.baseSplayZ]));
  const point = new THREE.Vector3();

  return {
    /** Curls 0..1 per finger, thumb = mode name, splay as in a hand spec (the stage steady state). */
    pose({ index = 0, middle = 0, ring = 0, pinky = 0, thumb = "open", splay = 0.045 } = {}) {
      const curls = { index, middle, ring, pinky };
      const pinching = thumb === "pinch";
      const thumbPose = pinching ? pinchPose.thumb : thumbAngles(thumb);
      bones[template.thumb.cmc].rotation.set(...thumbPose.cmc);
      bones[template.thumb.mcp].rotation.set(...thumbPose.mcp);
      bones[template.thumb.ip].rotation.set(...thumbPose.ip);
      for (const name of FINGERS) {
        const ids = template.fingers[name];
        if (pinching && name === "index") {
          bones[ids.mcp].rotation.set(pinchPose.index[0], 0, pinchPose.index[3]);
          bones[ids.pip].rotation.set(pinchPose.index[1], 0, 0);
          bones[ids.dip].rotation.set(pinchPose.index[2], 0, 0);
          continue;
        }
        const curl = curls[name];
        const relax = 1 - curl;
        const spread = baseSplay[name] * (1 - curl * 0.7) + (1 - curl * 0.85) * splay * SPLAY_MULTIPLIERS[name];
        bones[ids.mcp].rotation.set(curl * curlGains[0] + relax * 0.02, 0, spread);
        bones[ids.pip].rotation.set(curl * curlGains[1] + relax * 0.06, 0, 0);
        bones[ids.dip].rotation.set(curl * curlGains[2] + relax * 0.04, 0, 0);
      }
      root.updateMatrixWorld(true);
      return this;
    },

    /**
     * screenX / screenY: where the middle knuckle appears in the mirrored preview (0..1, y from the top).
     * size: wrist-to-middle-knuckle length as a fraction of the frame height.
     * roll: radians, positive = the top of the hand leans toward the LEFT of the preview.
     * thumbOnRight: the opposite hand (thumb on the right of the preview).
     * aspect: frame width / height.
     */
    landmarks({ screenX = 0.5, screenY = 0.5, size = 0.22, roll = 0, thumbOnRight = false, aspect = 4 / 3 } = {}) {
      const joints = template.landmarkJoints.map((id) => bones[id].getWorldPosition(new THREE.Vector3()));
      const wrist = joints[0].clone();
      const unitsToHeights = size / joints[9].distanceTo(wrist); // stage units -> frame heights
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      const seen = joints.map((joint) => {
        point.copy(joint).sub(wrist);
        if (thumbOnRight) point.x = -point.x;
        // preview space: +x right, +y up, in frame heights
        return {
          x: (point.x * cos - point.y * sin) * unitsToHeights,
          y: (point.x * sin + point.y * cos) * unitsToHeights,
          z: point.z * unitsToHeights,
        };
      });
      const anchor = seen[9];
      return seen.map((p) => {
        const previewX = screenX + (p.x - anchor.x) / aspect; // normalised by frame width
        const previewY = screenY - (p.y - anchor.y); // y grows downward
        return { x: 1 - previewX, y: previewY, z: -p.z / aspect };
      });
    },
  };
}
