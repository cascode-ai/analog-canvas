import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HeadlessFontFile } from "./headless-text.js";

/**
 * Where the WebAssembly rasterizer reads its renderer and fonts from in a
 * checkout. The headless bundle (scripts/lib/headless-bundle.mjs) replaces
 * this module with one that carries the same bytes inline, so the one-file
 * bundle needs no files beside it.
 */

export async function loadResvgWasm(): Promise<Uint8Array> {
  return readFile(
    fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm")),
  );
}

export async function loadHeadlessFont(
  font: HeadlessFontFile,
): Promise<Uint8Array> {
  if (font.source === "dejavu") {
    const root = dirname(
      fileURLToPath(import.meta.resolve("dejavu-fonts-ttf/package.json")),
    );
    return readFile(resolve(root, "ttf", font.file));
  }
  return readFile(
    fileURLToPath(new URL(`../fonts/${font.file}`, import.meta.url)),
  );
}
