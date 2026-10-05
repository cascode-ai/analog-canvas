import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { localNetlistConversion } from "./dev/netlist-conversion";
import { localAgentRelay } from "./dev/agent-relay";
import { localSimulation } from "./dev/local-simulation.js";
import { localReplica } from "./dev/local-replica";
import { editorPreload } from "./build/editor-preload";

function isolateDevDependencyCache(): Plugin {
  return {
    name: "isolate-dev-dependency-cache",
    apply: "serve",
    config(config) {
      // A test server must not replace a running editor's optimized modules.
      // Mixing its cached eager imports with new lazy imports duplicates
      // CodeMirror's state classes and crashes Properties on selection.
      const port = config.server?.port ?? 5173;
      return {
        cacheDir: `node_modules/.vite/dev-${port}`,
        // Keep the cache owner unambiguous instead of silently changing ports.
        server: { strictPort: true },
      };
    },
  };
}

function versionStaticServiceWorker(): Plugin {
  // The browser-test build writes elsewhere (build:e2e), so follow outDir.
  let outDir = "";
  return {
    name: "version-static-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const indexPath = resolve(outDir, "index.html");
      const workerPath = resolve(outDir, "sw.js");
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
  plugins: [
    isolateDevDependencyCache(),
    react(),
    localAgentRelay(),
    localSimulation(process.env.ICM_SIMULATION_URL),
    localNetlistConversion(),
    // After the Agent relay, whose narrower /api/agent/ proxy must win.
    localReplica(),
    editorPreload(),
    versionStaticServiceWorker(),
  ],
});
