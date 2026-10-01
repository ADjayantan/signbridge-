/**
 * Turns noisy per-frame predictions into words.
 *
 * - A word is committed once it has been the steady prediction for holdMs.
 * - The same word is committed again only after the hands change for releaseMs,
 *   so holding a sign doesn't repeat it, but signing "NO", relaxing, "NO" gives two.
 *
 * update(label | null, nowMs) → { candidate, progress (0..1), committed (label | null) }
 */
export function createSignSmoother({ holdMs = 700, releaseMs = 250, windowSize = 6, agreement = 0.67 } = {}) {
  let recent = [];
  let candidate = null;
  let since = 0;
  let locked = null;
  let releaseSince = 0;

  function steadyLabel() {
    const counts = new Map();
    for (const label of recent) counts.set(label, (counts.get(label) || 0) + 1);
    for (const [label, count] of counts) {
      if (label !== null && count / recent.length >= agreement) return label;
    }
    return null;
  }

  return {
    update(label, now) {
      recent.push(label ?? null);
      if (recent.length > windowSize) recent.shift();
      const steady = steadyLabel();

      if (steady !== candidate) {
        candidate = steady;
        since = now;
      }

      if (locked !== null) {
        if (steady === locked) releaseSince = 0;
        else {
          releaseSince ||= now;
          if (now - releaseSince >= releaseMs) {
            locked = null;
            releaseSince = 0;
          }
        }
      }

      let progress = 0;
      let committed = null;
      if (candidate !== null && candidate !== locked) {
        progress = Math.min(1, (now - since) / holdMs);
        if (progress >= 1) {
          committed = candidate;
          locked = candidate;
          releaseSince = 0;
        }
      }
      return { candidate, progress, committed };
    },

    reset() {
      recent = [];
      candidate = null;
      since = 0;
      locked = null;
      releaseSince = 0;
    },
  };
}
