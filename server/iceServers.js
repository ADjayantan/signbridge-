const UNAVAILABLE = { iceServers: [], relayAvailable: false,
  notice: "Video relay is unavailable. Text remains available; direct video may still work." };

function cleanIceServers(value) {
  if (!Array.isArray(value) || value.length > 12) throw new Error("Invalid relay response");
  return value.map((entry) => {
    const urls = typeof entry?.urls === "string" ? [entry.urls] : entry?.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some((url) => typeof url !== "string" || url.length > 512 || !/^(?:stun|stuns|turn|turns):[^\s]+$/.test(url))) throw new Error("Invalid relay address");
    const relay = urls.some((url) => /^turns?:/.test(url));
    if (relay && (typeof entry.username !== "string" || !entry.username || entry.username.length > 1024 || typeof entry.credential !== "string" || !entry.credential || entry.credential.length > 1024)) throw new Error("Missing relay credentials");
    return { urls, ...(relay ? { username: entry.username, credential: entry.credential } : {}) };
  });
}

/** Server-side Metered credentials; shared cache avoids an upstream call per peer. */
export function createIceProvider({ env = {}, clock = Date.now, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  let cached;
  let expiresAt = 0;
  let pending;
  let domain = String(env.METERED_DOMAIN || "").trim().toLowerCase();
  if (domain && !domain.includes(".")) domain += ".metered.live";
  const key = env.METERED_TURN_API_KEY;
  const configured = Boolean(key && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.metered\.live$/.test(domain));

  async function load() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(`https://${domain}/api/v1/turn/credentials`);
      url.searchParams.set("apiKey", key);
      const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Relay unavailable");
      const text = await response.text();
      if (text.length > 32_768) throw new Error("Relay response too large");
      const iceServers = cleanIceServers(JSON.parse(text));
      const relayAvailable = iceServers.some((server) => server.urls.some((url) => /^turns?:/.test(url)));
      cached = { iceServers, relayAvailable, notice: relayAvailable ? "" : UNAVAILABLE.notice };
      expiresAt = clock() + (relayAvailable ? 5 * 60_000 : 30_000);
    } catch {
      // Never expose the upstream URL, API key or raw error text to the browser.
      cached = UNAVAILABLE; expiresAt = clock() + 30_000;
    } finally { clearTimeout(timeout); }
    return structuredClone(cached);
  }

  return async function getIceConfig() {
    if (!configured) return { ...UNAVAILABLE, iceServers: [], notice: "Video relay is not configured. Text remains available; direct video may still work." };
    if (cached && expiresAt > clock()) return structuredClone(cached);
    if (!pending) pending = load().finally(() => { pending = undefined; });
    return structuredClone(await pending);
  };
}
