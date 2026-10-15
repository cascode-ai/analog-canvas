import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";

import { localNetlistConversion } from "./dev/netlist-conversion";
import { localAgentRelay } from "./dev/agent-relay";
import { localSimulation } from "./dev/local-simulation.js";
import { localReplica } from "./dev/local-replica";
import { editorPreload } from "./build/editor-preload";
import { galleryEarlyFetch } from "./build/gallery-early-fetch";

/**
 * The folder the rnl runtime's files are really in. A linked build of rnl
 * lives outside this workspace, and the dev server serves the runtime's
 * Worker and WebAssembly only from folders it allows.
 */
function rnlRuntimeFolders(): string[] {
  try {
    const manifest = createRequire(import.meta.url).resolve(
      "@rich-netlist/runtime/package.json",
    );
    return [dirname(realpathSync(manifest))];
  } catch {
    return [];
  }
}

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
  // The rnl runtime's Worker awaits at its top level, so Workers bundle as
  // ES modules; every Worker here is a module Worker already.
  worker: { format: "es" },
  // Pre-bundling would rewrite the runtime's import.meta.url for its Worker
  // and WebAssembly; serve it as the package ships it.
  optimizeDeps: { exclude: ["@rich-netlist/runtime"] },
  server: {
    fs: {
      allow: [
        searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))),
        ...rnlRuntimeFolders(),
      ],
    },
  },
  plugins: [
    isolateDevDependencyCache(),
    react(),
    localAgentRelay(),
    localSimulation(process.env.ICM_SIMULATION_URL),
    localNetlistConversion(),
    // After the Agent relay, whose narrower /api/agent/ proxy must win.
    localReplica(),
    editorPreload(),
    galleryEarlyFetch(),
    versionStaticServiceWorker(),
  ],
});
