/**
 * Halftone maths, kept free of the DOM so it can be tested.
 *
 * A halftone screen is a grid of dots whose size, not opacity, carries the tone. Each ink gets its
 * own screen at its own angle (15° and 75°, as on a two-colour press, so the grids do not beat
 * into a moiré pattern). A pattern says how much ink each dot should carry (coverage 0..1); the
 * dot's radius grows with the square root of that coverage, so the inked AREA tracks the tone.
 */

export const SCREEN_ANGLES = Object.freeze([Math.PI / 12, (5 * Math.PI) / 12]); // 15°, 75°

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
export const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Dot radius for a coverage, in the same units as `cell`. Full coverage just closes the gaps. */
export function dotRadius(coverage, cell) {
  return cell * 0.5 * Math.sqrt(clamp01(coverage)) * 1.18;
}

/**
 * The dot centres of one screen that can touch a width x height box: a grid rotated by `angle`
 * around the box centre. Returned packed as [x, y, u, v, ...] where u, v are the centre's
 * position across the box (0..1) — what patterns are written in.
 */
export function buildScreen(width, height, cell, angle) {
  if (!(width > 0 && height > 0 && cell > 0)) return new Float32Array(0);
  const cx = width / 2;
  const cy = height / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const reach = Math.ceil(Math.hypot(width, height) / 2 / cell) + 1;
  const margin = cell;
  const points = [];
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) {
      const x = cx + (i * cos - j * sin) * cell;
      const y = cy + (i * sin + j * cos) * cell;
      if (x < -margin || y < -margin || x > width + margin || y > height + margin) continue;
      points.push(x, y, x / width, y / height);
    }
  }
  return Float32Array.from(points);
}

/**
 * Patterns: (u, v, time, ink, scene) -> coverage. `u`, `v` run 0..1 across the box, `scene.aspect`
 * is width / height, so distances are measured in box heights and circles stay round.
 * `scene.energy` scales the motion (voice states use it); `scene.pointer` is {u, v, strength} or null.
 */
export const PATTERNS = Object.freeze({
  /** A halftone sun rising from the bottom edge, rings rippling outward. Ink 1 hugs the horizon. */
  sun(u, v, time, ink, scene) {
    const dx = (u - 0.5) * scene.aspect;
    const dy = v - 1.12;
    const d = Math.hypot(dx, dy);
    const rings = 0.5 + 0.5 * Math.sin(d * 15 - time * 1.1 * scene.energy + ink * 0.9);
    if (ink === 0) return smoothstep(1.2, 0.2, d) * (0.5 + 0.32 * rings);
    return smoothstep(0.7, 0.15, d) * smoothstep(0.1, 0.55, rings) * 0.72;
  },

  /** Diagonal swells travelling across the box, fading toward the bottom. */
  waves(u, v, time, ink, scene) {
    const along = u * scene.aspect * 0.86 + v * 0.5;
    const swell = 0.5 + 0.5 * Math.sin(along * 7.5 - time * 0.9 * scene.energy + ink * 1.7);
    const fade = smoothstep(1.05, 0.05, v) * (ink === 0 ? 1 : 0.55);
    return swell * swell * fade;
  },

  /** Two inks travelling in from opposite sides and overprinting where they meet. */
  meet(u, v, time, ink, scene) {
    const from = ink === 0 ? u : 1 - u;
    const pulse = 0.5 + 0.5 * Math.sin(from * 16 - time * 1.3 * scene.energy);
    const reach = smoothstep(0.66, 0.0, from);
    const settle = smoothstep(1.0, 0.25, Math.abs(v - 0.5) * 2);
    return reach * (0.55 + 0.45 * pulse) * (0.35 + 0.65 * settle);
  },

  /** A soft spotlight that breathes, with a thin orbit in the second ink. */
  spot(u, v, time, ink, scene) {
    const d = Math.hypot((u - 0.5) * scene.aspect, v - 0.48);
    if (ink === 0) return smoothstep(0.92, 0.05, d) * (0.5 + 0.08 * Math.sin(time * 1.1 * scene.energy));
    const orbit = 0.36 + 0.025 * Math.sin(time * 0.8 * scene.energy);
    return smoothstep(0.075, 0.0, Math.abs(d - orbit)) * 0.7;
  },

  /** Rings leaving the centre, with a quiet hole in the middle for whatever sits on top. */
  ripple(u, v, time, ink, scene) {
    const d = Math.hypot((u - 0.5) * scene.aspect, v - 0.5);
    const rings = 0.5 + 0.5 * Math.sin(d * 24 - time * 2.4 * scene.energy - ink * 1.1);
    const envelope = smoothstep(0.5, 0.2, d) * smoothstep(0.15, 0.26, d);
    return envelope * rings * (ink === 0 ? 1 : 0.6);
  },
});

/** Coverage for one dot, pointer swell included, clamped to 0..1. */
export function coverageAt(pattern, u, v, time, ink, scene) {
  let coverage = pattern(u, v, time, ink, scene);
  const pointer = scene.pointer;
  if (pointer && pointer.strength > 0) {
    const d2 = ((u - pointer.u) * scene.aspect) ** 2 + (v - pointer.v) ** 2;
    coverage += Math.exp(-d2 / 0.022) * 0.6 * pointer.strength * (ink === 0 ? 1 : 0.55);
  }
  return clamp01(coverage);
}
