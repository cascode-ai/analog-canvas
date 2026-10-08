// The headless drawing workspace (#1498) as one Node module:
// apps/editor/src/headless with every @icm package it reaches, from source.
// scripts/package-headless.mjs writes it for the workspace build and
// scripts/package-mcp.mjs beside the MCP release's bin.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");
// The MCP version the editor's Agent code reports, given as the MCP bundle
// gives it. Left to the code's fallback, the bundle would carry the whole
// distribution declaration, release digest included, so stamping the digest
// would change the very package it describes.
const { version } = JSON.parse(
  readFileSync(resolve(root, "config/agent-mcp-distribution.json"), "utf8"),
);

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
    define: { __ANALOG_CANVAS_MCP_VERSION__: JSON.stringify(version) },
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
