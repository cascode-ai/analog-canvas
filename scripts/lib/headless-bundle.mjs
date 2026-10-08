// The headless drawing workspace (#1498) as one Node module:
// apps/editor/src/headless with every @icm package it reaches, from source.
// scripts/package-headless.mjs writes it for the workspace build and
// scripts/package-mcp.mjs beside the MCP release's bin.
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");

const HEADLESS_BUNDLE_NAME = "analog-canvas-headless.mjs";

/**
 * One file, with no chunks beside it, so it can be copied on its own. What
 * the editor loads only on demand (formula typesetting, browser-only export)
 * is inlined and still evaluated only when called.
 */
export async function bundleHeadless(outDir, { emptyOutDir = true } = {}) {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    resolve: { conditions: ["development"] },
    ssr: {
      noExternal: true,
      resolve: {
        conditions: ["development"],
        externalConditions: ["development"],
      },
    },
    build: {
      ssr: resolve(root, "apps/editor/src/headless/index.ts"),
      outDir,
      emptyOutDir,
      target: "node24",
      minify: false,
      rollupOptions: {
        output: { entryFileNames: HEADLESS_BUNDLE_NAME, codeSplitting: false },
      },
    },
  });
  return resolve(outDir, HEADLESS_BUNDLE_NAME);
}
