import react from "@vitejs/plugin-react";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, loadEnv } from "vite";

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

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // loadEnv with prefix "" returns every variable (process.env wins over .env files).
  // They are only used by the server middleware above, never sent to the browser.
  plugins: [react(), apiPlugin(loadEnv(mode, process.cwd(), ""))],
}));
