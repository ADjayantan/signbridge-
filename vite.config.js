import react from "@vitejs/plugin-react";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade"]);

/**
 * Serves POST /api/chat during `npm run dev` and `npm run preview`, using the same
 * handler as the Vercel Function (api/chat.js). Reads GEMINI_API_KEY from .env.local.
 */
function apiPlugin(env) {
  async function toWebRequest(req, signal) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key) || value == null) continue;
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else headers.set(key, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const url = new URL(req.originalUrl || req.url, `http://${req.headers.host || "localhost"}`);
    return new Request(url, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined, signal });
  }

  async function sendWebResponse(res, response) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) {
      res.end();
      return;
    }
    for await (const chunk of response.body) res.write(chunk);
    res.end();
  }

  const middleware = (loadHandler) => async (req, res, next) => {
    try {
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const { handleChat } = await loadHandler();
      const response = await handleChat(await toWebRequest(req, controller.signal), env);
      await sendWebResponse(res, response);
    } catch (err) {
      if (res.headersSent) res.end();
      else next(err);
    }
  };

  return {
    name: "signbridge-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", middleware(() => server.ssrLoadModule("/server/chat.js")));
    },
    configurePreviewServer(server) {
      const handlerUrl = pathToFileURL(path.resolve("server/chat.js")).href;
      server.middlewares.use("/api/chat", middleware(() => import(handlerUrl)));
    },
  };
}

// Installable app (PWA): the app shell is cached on install; the 12 MB hand-tracking runtime and
// the 8 MB model are cached the first time sign mode opens, so later launches are instant and
// sign recognition works offline. AI answers (/api/chat) always need the network.
const pwa = VitePWA({
  registerType: "autoUpdate",
  injectRegister: false, // registered in src/main.jsx
  includeAssets: ["icons/apple-touch-icon.png"],
  manifest: {
    name: "SignBridge — sign or speak to AI",
    short_name: "SignBridge",
    description: "An AI assistant for Deaf and blind people: sign to the camera or speak, and get answers in text or speech.",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#05080f",
    theme_color: "#05080f",
    categories: ["accessibility", "productivity", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Voice mode", short_name: "Voice", url: "/#voice", description: "Speak and hear the answer" },
      { name: "Sign mode", short_name: "Sign", url: "/#sign", description: "Sign to the camera and read the answer" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
    globIgnores: ["**/vision_wasm*"], // large; cached on first use instead (below)
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: /\/assets\/vision_wasm[^/]*\.(?:wasm|js)$/,
        handler: "CacheFirst",
        options: { cacheName: "mediapipe-runtime", expiration: { maxEntries: 8 } },
      },
      {
        urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\//,
        handler: "CacheFirst",
        options: { cacheName: "mediapipe-model", cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 4 } },
      },
      {
        urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
        handler: "StaleWhileRevalidate",
        options: { cacheName: "fonts", cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 20 } },
      },
    ],
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // loadEnv with prefix "" returns every variable (process.env wins over .env files).
  // They are only used by the server middleware above, never sent to the browser.
  plugins: [react(), apiPlugin(loadEnv(mode, process.cwd(), "")), pwa],
}));
