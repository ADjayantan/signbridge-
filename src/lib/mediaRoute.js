const CANDIDATE_TYPES = new Set(["host", "srflx", "prflx", "relay"]);

/** Classify selected transports only; never retain or return candidate details. */
export function mediaRoute(stats) {
  if (!stats || typeof stats.forEach !== "function") return "unknown";
  const entries = new Map();
  stats.forEach((entry) => { if (entry && typeof entry.id === "string") entries.set(entry.id, entry); });
  const transports = [...entries.values()].filter((entry) => entry.type === "transport");
  if (!transports.length) return "unknown";
  const routes = new Set();
  for (const transport of transports) {
    // Nominated/succeeded pairs can be historical. Only the transport's current
    // selectedCandidatePairId establishes which pair it actually uses.
    if (!transport.selectedCandidatePairId || (transport.dtlsState && transport.dtlsState !== "connected")) return "unknown";
    const pair = entries.get(transport.selectedCandidatePairId);
    if (pair?.type !== "candidate-pair" || pair.state !== "succeeded") return "unknown";
    const local = entries.get(pair.localCandidateId), remote = entries.get(pair.remoteCandidateId);
    if (local?.type !== "local-candidate" || remote?.type !== "remote-candidate" ||
      !CANDIDATE_TYPES.has(local.candidateType) || !CANDIDATE_TYPES.has(remote.candidateType)) return "unknown";
    routes.add(local.candidateType === "relay" || remote.candidateType === "relay" ? "relay" : "direct");
  }
  return routes.size > 1 ? "mixed" : [...routes][0] || "unknown";
}
