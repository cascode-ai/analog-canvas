#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sourceDirectory, runtimeDirectory, entryFile, outputFile] = process.argv.slice(2);
if (!sourceDirectory || !runtimeDirectory || !entryFile || !outputFile) {
  throw new Error("Usage: node BUILD.mjs SOURCE_DIRECTORY RUNTIME_DIRECTORY ENTRY_FILE OUTPUT_FILE");
}
const source = path.resolve(sourceDirectory);
const runtime = path.resolve(runtimeDirectory);
const esbuild = await import(pathToFileURL(path.join(runtime, "node_modules/esbuild/lib/main.js")));
const alias = {};
for (const dir of fs.readdirSync(path.join(source, "packages"))) {
  const packageDir = path.join(source, "packages", dir);
  const manifestPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (!target.development) continue;
    alias[manifest.name + (key === "." ? "" : key.slice(1))] = path.resolve(packageDir, target.development);
  }
}
await esbuild.build({
  absWorkingDir: source,
  entryPoints: [path.resolve(entryFile)],
  outfile: path.resolve(outputFile),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  alias,
  nodePaths: [path.join(runtime, "node_modules")],
  logLevel: "info",
});
