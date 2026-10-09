import { build } from "vite";
import { copyFile, cp, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Do not copy research-only models from public/, even on this local checkout.
// Filter before building, so the PWA also precaches the safe icons/assets.
const temporaryPublic = await mkdtemp(path.join(os.tmpdir(), "signbridge-public-"));
try {
  for (const entry of await readdir("public", { withFileTypes: true })) {
    if (entry.name === "models") continue;
    const source = path.join("public", entry.name), target = path.join(temporaryPublic, entry.name);
    if (entry.isDirectory()) await cp(source, target, { recursive: true });
    else if (entry.isFile()) await copyFile(source, target);
  }
  await build({ mode: "public-demo", publicDir: temporaryPublic });
} finally {
  const resolved = path.resolve(temporaryPublic);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("signbridge-public-")) throw new Error("Unexpected temporary build path.");
  await rm(resolved, { recursive: true, force: true });
}
console.log("Public demo built. Local research model artifacts were excluded.");
