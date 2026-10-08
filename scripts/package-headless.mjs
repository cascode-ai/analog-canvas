// Bundle the headless drawing workspace (#1498) into one Node module:
// apps/editor/src/headless with every @icm package it reaches, from source.
// The MCP's --local mode and the batch runner load this file.
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, process.argv[2] ?? "output/headless");

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
    emptyOutDir: true,
    target: "node24",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "analog-canvas-headless.mjs" },
    },
  },
});
console.log(`Bundled the headless workspace into ${outDir}`);
