import react from "@vitejs/plugin-react";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createChatMiddleware } from "./server/nodeChatMiddleware.js";

/**
 * Serves POST /api/chat during `npm run dev` and `npm run preview`, using the same
 * handler as the Vercel Function (api/chat.js). Reads GEMINI_API_KEY from .env.local.
 */
function apiPlugin(env) {
  return {
    name: "signbridge-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", createChatMiddleware(() => server.ssrLoadModule("/server/chat.js"), env));
    },
    configurePreviewServer(server) {
      const handlerUrl = pathToFileURL(path.resolve("server/chat.js")).href;
      server.middlewares.use("/api/chat", createChatMiddleware(() => import(handlerUrl), env));
    },
  };
}

// Installable app (PWA): the app shell is cached on install; the 12 MB hand-tracking runtime and
// the 8 MB model are cached the first time sign mode opens, so later launches are instant and
// sign recognition works offline. AI answers (/api/chat) always need the network.
const pwa = (mode) => VitePWA({
  registerType: "prompt",
  injectRegister: false, // AppUpdateNotice owns registration and the user's update choice.
  includeAssets: ["icons/apple-touch-icon.png"],
  manifest: {
    name: "SignBridge — connect your way",
    short_name: "SignBridge",
    description: "Connect with another person through text, voice or live sign video, using your communication preferences.",
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
      { name: "Connect your way", short_name: "Connect", url: "/#connect", description: "Start or join a conversation" },
      { name: "Voice mode", short_name: "Voice", url: "/#voice", description: "Speak and hear the answer" },
      { name: "Sign Workspace", short_name: "Sign", url: "/#trained-sign", description: "Recognize words locally and build a reviewed message" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
    globIgnores: ["**/vision_wasm*", "**/onnx/**", "**/models/**"], // Runtime assets load on demand; research weights never precache.
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: /\/models\//,
        handler: mode === "public-demo" ? "NetworkOnly" : "NetworkFirst",
        ...(mode === "public-demo" ? {} : { options: { cacheName: "trained-sign-models-v2", cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 4 } } }),
      },
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
  // The training environment/data contain thousands of files; keep them out of
  // the dev watcher while still watching public/models for newly trained weights.
  server: {
    watch: { ignored: ["**/.training-venv/**", "**/.training-data/**", "**/training/artifacts/**"] },
    proxy: {
      "/api/rooms": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/api/health": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:3001", ws: true },
    },
  },
  // loadEnv with prefix "" returns every variable (process.env wins over .env files).
  // They are only used by the server middleware above, never sent to the browser.
  plugins: [react(), apiPlugin(loadEnv(mode, process.cwd(), "")), pwa(mode)],
}));
