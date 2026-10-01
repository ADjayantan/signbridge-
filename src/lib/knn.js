// k-nearest-neighbour classifier for signs the user teaches.
// Pure JavaScript, unit-tested in tests/knn.test.js.
import { FEATURE_SIZE, mirrorFeatures } from "./features.js";

export const MAX_SAMPLES_PER_SIGN = 150;
// Rejection: a frame counts as a sign only if it is about as close to that sign's samples as
// the samples are to each other (90th percentile), and never stricter than MIN_THRESHOLD.
// Tuned on real MediaPipe landmarks from HaGRID photos of different people (see README).
const MIN_THRESHOLD = 1.0;
const THRESHOLD_FACTOR = 1.0;
const CALIBRATION_SAMPLES = 40;

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function isValidVector(v) {
  return Array.isArray(v) && v.length === FEATURE_SIZE && v.every(Number.isFinite);
}

/** Sign names are shown as glosses: trimmed, single-spaced, upper case. */
export function normalizeLabel(label) {
  return String(label ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, 40);
}

function evenlySpaced(list, n) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

export class SignClassifier {
  #signs = new Map();
  #index = [];
  #thresholds = new Map();

  constructor({ signs = {}, mirror = true } = {}) {
    this.mirror = mirror;
    for (const [label, list] of Object.entries(signs)) {
      const valid = list.filter(isValidVector).map((v) => [...v]);
      if (valid.length) this.#signs.set(label, valid.slice(-MAX_SAMPLES_PER_SIGN));
    }
    this.#rebuild();
  }

  get size() {
    return this.#signs.size;
  }

  /** Distance beyond which a frame is not counted as this sign. */
  thresholdFor(label) {
    return this.#thresholds.get(label) ?? MIN_THRESHOLD;
  }

  labels() {
    return [...this.#signs].map(([label, list]) => ({ label, count: list.length }));
  }

  /** Adds samples to a sign (creating it if new). Keeps the newest MAX_SAMPLES_PER_SIGN. */
  addSamples(label, vectors) {
    const name = normalizeLabel(label);
    const clean = vectors.filter(isValidVector).map((v) => [...v]);
    if (!name || !clean.length) return 0;
    const list = [...(this.#signs.get(name) || []), ...clean].slice(-MAX_SAMPLES_PER_SIGN);
    this.#signs.set(name, list);
    this.#rebuild();
    return clean.length;
  }

  remove(label) {
    const removed = this.#signs.delete(label);
    if (removed) this.#rebuild();
    return removed;
  }

  #rebuild() {
    this.#index = [];
    for (const [label, list] of this.#signs) {
      for (const v of list) {
        this.#index.push({ label, v });
        if (this.mirror) this.#index.push({ label, v: mirrorFeatures(v) });
      }
    }
    this.#calibrate();
  }

  // Samples of one sign may be taught with either hand, so compare against the mirror too.
  #pairDistance(a, b) {
    return this.mirror ? Math.min(distance(a, b), distance(a, mirrorFeatures(b))) : distance(a, b);
  }

  // Per-sign rejection distance, from how much that sign's samples differ from each other.
  #calibrate() {
    this.#thresholds = new Map();
    for (const [label, list] of this.#signs) {
      const pick = evenlySpaced(list, CALIBRATION_SAMPLES);
      const within = [];
      for (let i = 0; i < pick.length; i++) {
        for (let j = i + 1; j < pick.length; j++) within.push(this.#pairDistance(pick[i], pick[j]));
      }
      let threshold = MIN_THRESHOLD;
      if (within.length) {
        within.sort((a, b) => a - b);
        threshold = Math.max(MIN_THRESHOLD, THRESHOLD_FACTOR * within[Math.floor(0.9 * (within.length - 1))]);
      }
      this.#thresholds.set(label, threshold);
    }
  }

  /**
   * → { label, confidence, distance } or null when nothing is taught.
   * label is null when the frame is far from every taught sign.
   */
  predict(vector, k = 5) {
    if (!this.#index.length) return null;
    const scored = this.#index.map(({ label, v }) => ({ label, d: distance(vector, v) }));
    scored.sort((a, b) => a.d - b.d);

    const votes = new Map();
    let total = 0;
    for (const { label, d } of scored.slice(0, k)) {
      const weight = 1 / (d + 0.05);
      votes.set(label, (votes.get(label) || 0) + weight);
      total += weight;
    }
    let best = null;
    let bestVotes = 0;
    for (const [label, w] of votes) {
      if (w > bestVotes) {
        best = label;
        bestVotes = w;
      }
    }
    const nearest = scored.find((s) => s.label === best).d;
    if (nearest > this.thresholdFor(best)) return { label: null, confidence: 0, distance: nearest };
    return { label: best, confidence: bestVotes / total, distance: nearest };
  }

  toJSON() {
    const signs = {};
    for (const [label, list] of this.#signs) signs[label] = list.map((v) => v.map((x) => Math.round(x * 1000) / 1000));
    return { app: "signbridge", version: 1, featureSize: FEATURE_SIZE, signs };
  }

  /** Loads a saved or imported signs file. Throws a readable Error if it isn't one. */
  static fromJSON(data, options) {
    if (!data || data.version !== 1 || typeof data.signs !== "object" || data.signs === null) {
      throw new Error("This isn't a SignBridge signs file.");
    }
    if (data.featureSize && data.featureSize !== FEATURE_SIZE) {
      throw new Error("This signs file was made by a different version of SignBridge.");
    }
    const signs = {};
    for (const [label, list] of Object.entries(data.signs)) {
      const name = normalizeLabel(label);
      if (!name || !Array.isArray(list)) continue;
      const valid = list.filter(isValidVector);
      if (valid.length) signs[name] = [...(signs[name] || []), ...valid];
    }
    return new SignClassifier({ ...options, signs });
  }
}
