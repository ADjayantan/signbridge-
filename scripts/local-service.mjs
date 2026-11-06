// Started by the Windows launcher; keep both listeners on this laptop.
import path from "node:path";
import { fileURLToPath } from "node:url";

const [service] = process.argv.slice(2);
if (!["web", "rooms"].includes(service)) throw new Error("Expected web or rooms.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

if (service === "rooms") {
  const { createRoomServer } = await import("../server/roomServer.js");
  const app = createRoomServer();
  app.server.on("error", (error) => { console.error(error.message); process.exit(1); });
  app.server.listen(3001, "127.0.0.1", () => console.log("SignBridge rooms: http://127.0.0.1:3001"));
  for (const event of ["SIGINT", "SIGTERM"]) {
    process.once(event, () => { void app.close().then(() => process.exit(0)); });
  }
} else {
  await import("./prepare-onnx-runtime.mjs");
  const { createServer } = await import("vite");
  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.js"),
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  });
  await server.listen();
  server.printUrls();
  for (const event of ["SIGINT", "SIGTERM"]) {
    process.once(event, () => { void server.close().then(() => process.exit(0)); });
  }
}
