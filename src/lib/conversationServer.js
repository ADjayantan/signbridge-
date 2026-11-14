/**
 * Where the conversation server (rooms, AI chat, health) lives.
 *
 * Empty means the page's own origin: local development and the all-in-one Render deployment. A site
 * hosted somewhere else (the Vercel front end) is built with VITE_ROOM_SERVER_URL set to the server's
 * public URL, and the server lists that site in ROOM_ALLOWED_ORIGINS.
 */
export const CONVERSATION_SERVER_URL = String(import.meta.env?.VITE_ROOM_SERVER_URL || "").replace(/\/$/, "");

/**
 * A free server sleeps when nobody uses it. Knock once when the app opens, so it is awake by the time
 * someone starts a conversation. A same-origin deployment needs no knock: loading the page woke it.
 * Returns whether a knock was sent; failures are ignored, the room client retries on its own.
 */
export function wakeConversationServer(baseUrl = CONVERSATION_SERVER_URL, fetchImpl = globalThis.fetch) {
  if (!baseUrl || typeof fetchImpl !== "function") return false;
  Promise.resolve()
    .then(() => fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/health`, { mode: "no-cors", cache: "no-store" }))
    .catch(() => {});
  return true;
}
