import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BONE_COUNT, buildHandSkinGeometry } from "../src/lib/handSkinMesh.js";
import { MODEL_PINCH_POSE, createHandModelBones, prepareHandModel } from "../src/lib/handModelRig.js";
import { mirrorHandModelData, readHandModelData } from "./helpers/handModel.js";

// Stage units: the hand is normalised to 1.86 from wrist to middle fingertip, so 0.01 is about 1 mm.
const data = readHandModelData(new URL("../public/hand3d/left.glb", import.meta.url));
const template = prepareHandModel(THREE, data);
const joint = (name) => template.joints.find((entry) => entry.name === name);

function assertValidSkin(geometry, boneCount) {
  const { position, skinIndex, skinWeight } = geometry.attributes;
  for (const value of position.array) assert.ok(Number.isFinite(value), "vertex positions must be finite");
  for (let i = 0; i < position.count; i++) {
    let total = 0;
    for (let k = 0; k < 4; k++) {
      total += skinWeight.getComponent(i, k);
      assert.ok(skinIndex.getComponent(i, k) < boneCount, "bone index out of range");
    }
    assert.ok(Math.abs(total - 1) < 1e-3, `vertex ${i} has skin weights summing to ${total}`);
  }
  for (const vertex of geometry.index.array) assert.ok(vertex < position.count, "triangle index out of range");
}

/** Positive when the triangles wind counter-clockwise seen from outside, i.e. the surface faces out. */
function signedVolume(geometry) {
  const p = geometry.attributes.position;
  const index = geometry.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let t = 0; t < index.length; t += 3) {
    a.fromBufferAttribute(p, index[t]);
    b.fromBufferAttribute(p, index[t + 1]);
    c.fromBufferAttribute(p, index[t + 2]);
    volume += a.dot(b.cross(c)) / 6;
  }
  return volume;
}

test("the sculpted hand is aligned into SignBridge hand space", () => {
  const wrist = joint("wrist").position;
  const middle = ["proximal", "intermediate", "distal"].map((part) => joint(`middle-finger-phalanx-${part}`).position);
  middle.push(joint("middle-finger-tip").position);

  // Fingers point up (+Y) and the wrist-to-fingertip chain is normalised to the stage size.
  assert.ok(wrist.y < middle[0].y && middle[0].y < middle[3].y);
  let reach = wrist.distanceTo(middle[0]);
  for (let i = 0; i < 3; i++) reach += middle[i].distanceTo(middle[i + 1]);
  assert.ok(Math.abs(reach - 1.86) < 1e-6, `hand length is ${reach}`);

  // Thumb on -X, pinky on +X, and the thumb sits in front of the palm (+Z faces the viewer).
  const thumbTip = joint("thumb-tip").position;
  const indexKnuckle = joint("index-finger-phalanx-proximal").position;
  const pinkyKnuckle = joint("pinky-finger-phalanx-proximal").position;
  assert.ok(thumbTip.x < indexKnuckle.x && indexKnuckle.x < pinkyKnuckle.x);
  assert.ok(thumbTip.z > 0.2);
  assert.equal(template.reflected, false);

  assertValidSkin(template.geometry, template.joints.length);
  assert.equal(template.geometry.index.count, data.index.length * 4, "one tessellation level splits each triangle in four");
  assert.ok(signedVolume(template.geometry) > 0, "the skin must face outward");
  assert.equal(template.landmarkJoints.length, 21);
});

test("an opposite-handed model file produces the same hand", () => {
  const mirrored = prepareHandModel(THREE, mirrorHandModelData(data));
  assert.equal(mirrored.reflected, true);

  template.joints.forEach((entry, i) => {
    assert.ok(entry.position.distanceTo(mirrored.joints[i].position) < 1e-5, `${entry.name} moved`);
    assert.ok(entry.frame.angleTo(mirrored.joints[i].frame) < 1e-4, `${entry.name} is oriented differently`);
  });
  // The model's own vertices come first and are not moved by tessellation.
  const original = template.geometry.attributes.position.array;
  const reflected = mirrored.geometry.attributes.position.array;
  for (let i = 0; i < data.positions.length; i++) assert.ok(Math.abs(original[i] - reflected[i]) < 1e-5);
  assert.ok(signedVolume(mirrored.geometry) > 0, "reflection must not turn the skin inside out");
  template.nails.forEach((nail, i) => assert.ok(nail.position.distanceTo(mirrored.nails[i].position) < 1e-4));
});

test("the rebuilt bones start on the model's joints and curl toward the palm", () => {
  const bones = createHandModelBones(THREE, template);
  const root = bones[template.wrist];
  root.updateMatrixWorld(true);
  const world = (bone) => bone.getWorldPosition(new THREE.Vector3());
  bones.forEach((bone, i) => assert.ok(world(bone).distanceTo(template.joints[i].position) < 1e-9, `${bone.name} is off its joint`));

  // A finger bone's +Y axis runs along its phalanx...
  const { mcp, pip, dip, tip } = template.fingers.index;
  const along = world(bones[pip]).sub(world(bones[mcp])).normalize();
  const boneY = new THREE.Vector3(0, 1, 0).applyQuaternion(bones[mcp].getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(along.dot(boneY) > 0.999999);

  // ...so a positive X rotation can only bend the finger forward, toward the palm side (+Z).
  const restZ = world(bones[tip]).z;
  bones[mcp].rotation.set(0.8, 0, 0);
  bones[pip].rotation.set(0.9, 0, 0);
  bones[dip].rotation.set(0.5, 0, 0);
  root.updateMatrixWorld(true);
  assert.ok(world(bones[tip]).z > restZ + 0.3);
});

test("the OK pinch pose brings the thumb and index finger pads together", () => {
  const bones = createHandModelBones(THREE, template);
  const root = bones[template.wrist];
  // A point just inside the pad surface near the fingertip, and the direction the pad faces.
  const pad = (name) => {
    const tip = template.fingertips[name];
    const bone = bones[tip.joint];
    return {
      point: bone.localToWorld(new THREE.Vector3(0, tip.length * 0.72, tip.palmarRadius * 0.85).applyQuaternion(tip.toBone)),
      facing: new THREE.Vector3(0, 0.5, 0.87).normalize().applyQuaternion(tip.toBone).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion())),
    };
  };
  const measure = (pose) => {
    bones[template.thumb.cmc].rotation.set(...pose.thumb.cmc);
    bones[template.thumb.mcp].rotation.set(...pose.thumb.mcp);
    bones[template.thumb.ip].rotation.set(...pose.thumb.ip);
    bones[template.fingers.index.mcp].rotation.set(pose.index[0], 0, pose.index[3]);
    bones[template.fingers.index.pip].rotation.set(pose.index[1], 0, 0);
    bones[template.fingers.index.dip].rotation.set(pose.index[2], 0, 0);
    root.updateMatrixWorld(true);
    const thumb = pad("thumb");
    const index = pad("index");
    return { gap: thumb.point.distanceTo(index.point), facing: thumb.facing.dot(index.facing) };
  };

  const solved = measure(MODEL_PINCH_POSE);
  assert.ok(solved.gap < 0.03, `pads are ${solved.gap.toFixed(3)} apart (about ${(solved.gap * 100).toFixed(0)} mm)`);
  assert.ok(solved.facing < -0.25, "the two pads should face each other");

  // The generic angles were made for the procedural hand; on this model they miss by centimetres,
  // which is why the model carries its own solved pose.
  const generic = measure({
    thumb: { cmc: [0.5, -0.1, 0.12], mcp: [0.24, 0, -0.18], ip: [0.38, 0, -0.15] },
    index: [1.05, 1.25, 0.85, 0.0125],
  });
  assert.ok(generic.gap > 0.15);
});

test("the procedural fallback hand is a valid outward-facing skinned surface", () => {
  const geometry = buildHandSkinGeometry(THREE);
  assertValidSkin(geometry, BONE_COUNT);
  assert.ok(signedVolume(geometry) > 0);
});
