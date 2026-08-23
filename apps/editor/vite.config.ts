import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function versionStaticServiceWorker() {
  return {
    name: "version-static-service-worker",
    apply: "build" as const,
    async writeBundle() {
      const indexPath = new URL("./dist/index.html", import.meta.url);
      const workerPath = new URL("./dist/sw.js", import.meta.url);
      const index = await readFile(indexPath);
      const buildId = createHash("sha256")
        .update(index)
        .digest("hex")
        .slice(0, 12);
      const worker = await readFile(workerPath, "utf8");
      if (!worker.includes("__ICM_BUILD_ID__")) {
        throw new Error("Static service worker cache placeholder is missing");
      }
      await writeFile(workerPath, worker.replace("__ICM_BUILD_ID__", buildId));
    },
  };
}

export default defineConfig({
  // The Worker serves the editor from a domain root, so assets are absolute.
  base: "/",
  plugins: [react(), versionStaticServiceWorker()],
});
