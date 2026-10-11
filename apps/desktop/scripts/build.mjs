// Adapted from LXY-freshman/schematic-draft @ 5231840f (AGPL-3.0-only).
// Original author: LXY-freshman. See ../SOURCES.md for exact source and changes.
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { build } from "esbuild";
import { writeDesktopIcon } from "./desktop-icon.mjs";

/**
 * Bundle the main process into one file.
 *
 * The desktop shell depends on workspace packages (`@icm/render-svg` and its
 * friends) that pnpm links into node_modules as symlinks. electron-builder
 * cannot follow that layout reliably, and the packaged app has no reason to
 * carry a node_modules tree at all, so everything except Electron itself is
 * inlined here and the app ships `dist/main.mjs` alone.
 */
const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "dist");
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);

await build({
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  define: { __ICM_DESKTOP_BUILD__: JSON.stringify({ commit, dirty, version }) },
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: resolve(outdir, "main.mjs"),
  external: ["electron"],
  sourcemap: false,
  minify: false,
  legalComments: "inline",
  logLevel: "info",
  // The workspace packages publish `exports` with a `development` condition
  // pointing at TypeScript sources; the built `dist/` is what ships.
  conditions: ["node", "import", "default"],
});
await writeDesktopIcon(
  resolve(root, "../editor/public/icon.svg"),
  resolve(outdir, "app.ico"),
);
