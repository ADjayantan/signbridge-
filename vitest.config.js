import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    // Let focused mocks resolve the installed API without registering a real worker.
    alias: {
      "virtual:pwa-register/react": fileURLToPath(new URL("./node_modules/vite-plugin-pwa/dist/client/build/react.js", import.meta.url)),
    },
    environment: "jsdom",
    include: ["tests/ui/**/*.test.jsx"],
    restoreMocks: true,
  },
});
