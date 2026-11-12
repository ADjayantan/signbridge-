/**
 * Procedural, bone-skinned human hand surface for the SignBridge 3D stage.
 *
 * Builds ONE continuous BufferGeometry (palm + wrist + forearm, four fingers, thumb) with
 * skinIndex / skinWeight attributes, so the skin stretches smoothly across every joint
 * instead of being assembled from rigid cylinders.
 *
 * Hand space (right hand, rest pose = open palm):
 *   +Y = up along extended fingers      +Z = palm side (toward viewer)
 *   -Z = back of hand (fingernails)     -X = thumb side
 */

export const FINGER_SPECS = [
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

export const THUMB_SPEC = {
  mountPos: [-0.34, -0.18, 0.06],
  lengths: [0.34, 0.27, 0.22],
  radii: [0.138, 0.106, 0.09, 0.074],
  // The thumb is skinned in its relaxed open-palm pose so the thenar web stretches naturally
  // both when it abducts wide and when it folds across the palm.
  bindRotation: [0.16, 0.14, 0.56],
};

/** Skeleton layout: 16 bones. */
export const BONE = {
  palm: 0,
  thumb: [1, 2, 3],
  index: [4, 5, 6],
  middle: [7, 8, 9],
  ring: [10, 11, 12],
  pinky: [13, 14, 15],
};
export const BONE_COUNT = 16;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (d, sigma) => Math.exp(-(d * d) / (2 * sigma * sigma));
const gauss2 = (dx, dy, sx, sy) => Math.exp(-((dx * dx) / (2 * sx * sx) + (dy * dy) / (2 * sy * sy)));
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

/** Smooth (cubic Hermite) interpolation through [x, ...values] key rows sorted by x. */
function sampleKeys(keys, x) {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0].slice(1);
  if (x >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && x > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const h = k2[0] - k1[0];
  const t = (x - k1[0]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const out = [];
  for (let c = 1; c < k1.length; c++) {
    const m1 = ((k2[c] - k0[c]) / Math.max(1e-6, k2[0] - k0[0])) * h;
    const m2 = ((k3[c] - k1[c]) / Math.max(1e-6, k3[0] - k1[0])) * h;
    out.push(
      (2 * t3 - 3 * t2 + 1) * k1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[c] + (t3 - t2) * m2
    );
  }
  return out;
}

function createSink() {
  return { pos: [], col: [], skinIdx: [], skinW: [], index: [] };
}

function pushVertex(sink, x, y, z, color, bones, weights) {
  sink.pos.push(x, y, z);
  sink.col.push(color[0], color[1], color[2]);
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += weights[i] || 0;
  for (let i = 0; i < 4; i++) {
    sink.skinIdx.push(bones[i] || 0);
    sink.skinW.push((weights[i] || 0) / (sum || 1));
  }
  return sink.pos.length / 3 - 1;
}

function stitchRings(sink, ringA, ringB, count) {
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    sink.index.push(ringA + i, ringB + i, ringA + j);
    sink.index.push(ringA + j, ringB + i, ringB + j);
  }
}

/**
 * One digit (finger or thumb) as a single tapered tube with a rounded fingertip.
 * `toHand(x, y, z)` maps digit-local coordinates (+Y along the digit) into hand space.
 */
function addDigit(sink, { toHand, lengths, radii, bones, baseDepth, baseProfile, radial = 20, isThumb = false }) {
  const [l1, l2, l3] = lengths;
  const [r0, r1, r2, r3] = radii;
  const j1 = 0;
  const j2 = l1;
  const j3 = l1 + l2;
  const end = l1 + l2 + l3;
  const capLen = r3 * 1.05;

  const radiusKeys = [
    ...baseProfile.map(([t, scale]) => [-baseDepth * t, r0 * scale]),
    [l1 * 0.2, r0 * 1.02],
    [l1 * 0.5, (r0 + r1) * 0.5 * 0.985],
    [j2, r1],
    [j2 + l2 * 0.5, (r1 + r2) * 0.5 * 0.985],
    [j3, r2],
    [j3 + l3 * 0.55, (r2 + r3) * 0.5 * 1.02],
    [end, r3],
  ];

  // Ring stations: denser near the joints so creases and bends stay smooth.
  const stations = [];
  const step = 0.022;
  for (let s = -baseDepth; s < end - 1e-4; s += step) stations.push(s);
  stations.push(end);
  const capRings = 6;
  for (let k = 1; k < capRings; k++) stations.push(end + capLen * Math.sin((k / capRings) * (Math.PI / 2)));

  const blend = (joint, r) => [joint - r * 0.75, joint + r * 0.75];
  let prevRing = -1;

  for (const s of stations) {
    let r = sampleKeys(radiusKeys, Math.min(s, end))[0];
    let capScale = 1;
    if (s > end) capScale = Math.sqrt(Math.max(0, 1 - ((s - end) / capLen) ** 2));

    // The thumb's root blends over a long span so the thenar web stretches instead of hinging.
    const w1 = isThumb ? smooth(-0.17, 0.1, s) : smooth(...blend(j1, r0), s);
    const w2 = smooth(...blend(j2, r1), s);
    const w3 = smooth(...blend(j3, r2), s);
    const weights = [1 - w1, w1 - w2, w2 - w3, w3];

    // Distance to the nearest interphalangeal joint drives knuckles and creases.
    const dPip = s - j2;
    const dDip = s - j3;
    const knuckle = Math.max(gauss(dPip, 0.04), gauss(dDip, 0.034) * 0.8);
    const crease = Math.max(gauss(dPip, 0.011), gauss(dDip, 0.01), gauss(s - (j1 + r0 * 0.9), 0.012) * 0.8);
    const segMid = Math.max(
      gauss(s - l1 * 0.5, l1 * 0.22),
      gauss(s - (j2 + l2 * 0.5), l2 * 0.22),
      gauss(s - (j3 + l3 * 0.6), l3 * 0.3) * 1.5
    );
    const tipness = smooth(j3 + l3 * 0.25, end, s);

    const ring = sink.pos.length / 3;
    for (let i = 0; i < radial; i++) {
      const th = (i / radial) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const front = Math.max(0, sn);
      const back = Math.max(0, -sn);

      let rx = r * capScale;
      let rz = r * capScale * (isThumb ? 0.92 : 0.9);
      // Dorsal knuckle bulge, palmar crease pinch, fleshy pads between the joints.
      rz *= 1 + back * knuckle * 0.09 - front * crease * 0.1 + front * segMid * 0.06;
      rx *= 1 + knuckle * 0.035 - crease * 0.02;
      // Fingertip: slightly flattened nail side, fuller pad.
      rz *= 1 - back * tipness * 0.1 + front * tipness * 0.05;

      // Thumb root: flatten and slide under the palm so the buried metacarpal never pokes through.
      const root = isThumb && s < 0 ? smooth(0, 0.7, -s / baseDepth) : 0;
      rz *= 1 - root * 0.62;
      const lx = rx * c * (1 - root * 0.25) + root * 0.085;
      const lz = rz * sn + tipness * r * 0.03 - root * 0.02;
      const [hx, hy, hz] = toHand(lx, s, lz);

      // Skin tone variation: pinker palm side and fingertip, redder knuckles, darker creases.
      const palmar = front;
      let cr = 1 + palmar * 0.03 + tipness * palmar * 0.03;
      let cg = 1 - palmar * 0.05 - tipness * palmar * 0.07 - back * knuckle * 0.09;
      let cb = 1 - palmar * 0.07 - tipness * palmar * 0.08 - back * knuckle * 0.11;
      const dark = 1 - front * crease * 0.2 - back * knuckle * Math.abs(Math.sin(s * 150)) * 0.05;
      cr *= dark;
      cg *= dark;
      cb *= dark;

      pushVertex(sink, hx, hy, hz, [cr, cg, cb], [BONE.palm, bones[0], bones[1], bones[2]], weights);
    }
    if (prevRing >= 0) stitchRings(sink, prevRing, ring, radial);
    prevRing = ring;
  }

  // Fingertip apex closes the tube.
  const [ax, ay, az] = toHand(0, end + capLen, r3 * 0.03);
  const apex = pushVertex(sink, ax, ay, az, [1.04, 0.9, 0.87], [bones[2], 0, 0, 0], [1, 0, 0, 0]);
  for (let i = 0; i < radial; i++) {
    sink.index.push(prevRing + i, apex, prevRing + ((i + 1) % radial));
  }
}

/** Height of the knuckle line (where the palm ends and the fingers begin) at hand-space x. */
function knuckleLineY(x) {
  const pts = [
    [-0.52, 0.33],
    [-0.36, 0.42],
    [-0.11, 0.46],
    [0.14, 0.43],
    [0.37, 0.36],
    [0.52, 0.26],
  ];
  return sampleKeys(pts, x)[0];
}

/** Palm creases (heart, head and life lines) as a 0..1 mask on the palmar surface. */
function palmCreaseMask(x, y) {
  const heart = gauss(y - (0.2 + 0.06 * x - 0.18 * x * x), 0.014) * smooth(-0.3, -0.12, x) * smooth(0.5, 0.4, x);
  const head = gauss(y - (0.06 - 0.16 * x - 0.1 * x * x), 0.014) * smooth(-0.46, -0.3, x) * smooth(0.36, 0.2, x);
  const lifeR = Math.hypot(x + 0.5, y + 0.14);
  const life = gauss(lifeR - 0.38, 0.014) * smooth(-0.36, -0.22, y) * smooth(0.24, 0.12, y) * smooth(-0.5, -0.4, x);
  return Math.min(1, Math.max(heart, head, life));
}

/** Palm, wrist and lower forearm as one lofted surface with sculpted pads and knuckles. */
function addPalm(sink) {
  const radial = 96;
  // y, halfWidth, frontDepth, backDepth, centerX, superellipse exponent
  const keys = [
    [-0.94, 0.345, 0.225, 0.225, 0.0, 1.0],
    [-0.66, 0.335, 0.208, 0.208, 0.0, 1.0],
    [-0.45, 0.33, 0.172, 0.168, 0.0, 0.96],
    [-0.3, 0.405, 0.172, 0.152, -0.02, 0.88],
    [-0.12, 0.45, 0.172, 0.136, -0.008, 0.82],
    [0.07, 0.48, 0.162, 0.126, 0.0, 0.8],
    [0.25, 0.474, 0.148, 0.12, 0.004, 0.8],
  ];
  const yBottom = keys[0][0];
  const yShoulder = keys[keys.length - 1][0];
  const mainRings = 58;
  const domeRings = 12;
  const knuckles = FINGER_SPECS.map((f) => f.mountPos);

  const rows = [];
  for (let k = 0; k <= mainRings; k++) rows.push({ y: yBottom + ((yShoulder - yBottom) * k) / mainRings, phi: 0 });
  for (let k = 1; k <= domeRings; k++) rows.push({ y: yShoulder, phi: (k / domeRings) * (Math.PI / 2) * 0.985 });

  let prevRing = -1;
  for (const row of rows) {
    const [w, dFront, dBack, cx, exp] = sampleKeys(keys, row.y);
    const depthScale = Math.cos(row.phi);
    const lift = Math.sin(row.phi);
    const ring = sink.pos.length / 3;

    for (let i = 0; i < radial; i++) {
      const th = (i / radial) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const front = Math.max(0, sn);
      const back = Math.max(0, -sn);

      const x = cx + w * spow(c, exp);
      const y = row.y + (knuckleLineY(x) + 0.055 - row.y) * lift;
      let z = (sn >= 0 ? dFront : dBack) * spow(sn, exp) * depthScale;

      // Palmar anatomy: thenar eminence, hypothenar pad, hollow centre, pads under the fingers.
      const thenar = gauss2(x + 0.26, y + 0.12, 0.15, 0.2);
      const hypothenar = gauss2(x - 0.31, y + 0.1, 0.12, 0.21);
      const hollow = gauss2(x - 0.03, y - 0.06, 0.17, 0.16);
      const fingerPads = gauss(y - 0.31, 0.07) * (0.6 + 0.4 * Math.cos(x * 25.5 + 0.4));
      const crease = palmCreaseMask(x, y);
      z += front * (thenar * 0.085 + hypothenar * 0.04 - hollow * 0.026 + fingerPads * 0.016 - crease * 0.007);

      // Dorsal anatomy: knuckle heads and faint extensor tendons fanning from the wrist.
      let knuckle = 0;
      let tendon = 0;
      for (const [kx, ky] of knuckles) {
        knuckle = Math.max(knuckle, gauss2(x - kx, y - (ky - 0.03), 0.062, 0.06));
        const along = clamp01((y + 0.3) / (ky + 0.3));
        tendon = Math.max(tendon, gauss(x - kx * (0.35 + 0.65 * along), 0.022) * smooth(-0.3, -0.05, y) * smooth(ky, ky - 0.12, y));
      }
      z -= back * (knuckle * 0.028 + tendon * 0.007);
      // Ulnar styloid: the small wrist bone on the pinky side of the back of the wrist.
      z -= back * gauss2(x - 0.2, y + 0.47, 0.06, 0.06) * 0.018;

      const palmar = front * smooth(-0.5, -0.36, y);
      let cr = 1 + palmar * 0.035;
      let cg = 1 - palmar * 0.055 - back * knuckle * 0.09 - front * (thenar + hypothenar) * 0.025;
      let cb = 1 - palmar * 0.075 - back * knuckle * 0.11 - front * (thenar + hypothenar) * 0.03;
      const dark = 1 - front * crease * 0.2 - front * gauss(y + 0.43, 0.012) * 0.14;
      cr *= dark;
      cg *= dark;
      cb *= dark;

      pushVertex(sink, x, y, z, [cr, cg, cb], [BONE.palm, 0, 0, 0], [1, 0, 0, 0]);
    }
    if (prevRing >= 0) stitchRings(sink, prevRing, ring, radial);
    prevRing = ring;
  }

  // Close the forearm end (hidden inside the sleeve cuff).
  const cap = pushVertex(sink, 0, yBottom, 0, [1, 1, 1], [BONE.palm, 0, 0, 0], [1, 0, 0, 0]);
  for (let i = 0; i < radial; i++) sink.index.push(i, (i + 1) % radial, cap);
}

/**
 * Builds the shared skinned hand geometry. Both hands use the same geometry; the left hand
 * is produced by mirroring its parent group on X.
 */
export function buildHandSkinGeometry(THREE) {
  const sink = createSink();
  addPalm(sink);

  for (const spec of FINGER_SPECS) {
    const [mx, my, mz] = spec.mountPos;
    addDigit(sink, {
      toHand: (x, y, z) => [mx + x, my + y, mz + z],
      lengths: spec.lengths,
      radii: spec.radii,
      bones: BONE[spec.name],
      baseDepth: 0.2,
      // Flared root: neighbouring finger bases overlap inside the palm and read as skin webbing.
      baseProfile: [[1, 1.12], [0.5, 1.2], [0, 1.16]],
    });
  }

  const thumbFrame = new THREE.Matrix4().compose(
    new THREE.Vector3(...THUMB_SPEC.mountPos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...THUMB_SPEC.bindRotation)),
    new THREE.Vector3(1, 1, 1)
  );
  const v = new THREE.Vector3();
  addDigit(sink, {
    toHand: (x, y, z) => {
      v.set(x, y, z).applyMatrix4(thumbFrame);
      return [v.x, v.y, v.z];
    },
    lengths: THUMB_SPEC.lengths,
    radii: THUMB_SPEC.radii,
    bones: BONE.thumb,
    baseDepth: 0.34,
    // The thumb metacarpal tapers down into the wrist, buried under the thenar pad.
    baseProfile: [[1, 0.12], [0.7, 0.34], [0.45, 0.6], [0.2, 0.88], [0, 1.03]],
    radial: 24,
    isThumb: true,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(sink.col, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(sink.skinIdx, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sink.skinW, 4));
  geometry.setIndex(sink.index);
  geometry.computeVertexNormals();
  return geometry;
}
