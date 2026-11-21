import subsetWasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import regularUrl from "../fonts/ICMSchematic-Regular.ttf?url";
import boldUrl from "../fonts/ICMSchematic-Bold.ttf?url";
import italicUrl from "../fonts/ICMSchematic-RegularItalic.ttf?url";
import boldItalicUrl from "../fonts/ICMSchematic-BoldItalic.ttf?url";

import {
  embedSvgFontSubsets,
  type SvgFontEmbedSources,
} from "./svg-font-embed.js";

/**
 * The browser's way to the faces an exported SVG embeds (#2427): the files
 * are fetched only when an SVG is exported, once per page.
 */
const URLS: Readonly<Record<string, string>> = {
  "ICMSchematic-Regular.ttf": regularUrl,
  "ICMSchematic-Bold.ttf": boldUrl,
  "ICMSchematic-RegularItalic.ttf": italicUrl,
  "ICMSchematic-BoldItalic.ttf": boldItalicUrl,
};

async function bytes(
  url: string | undefined,
  what: string,
): Promise<Uint8Array> {
  if (!url) throw new Error(`No font ${what} for SVG export`);
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${what} unavailable (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

const read = new Map<string, Promise<Uint8Array>>();
const cached = (key: string, url: string | undefined) => {
  let value = read.get(key);
  if (!value) {
    value = bytes(url, key);
    read.set(key, value);
    value.catch(() => read.delete(key));
  }
  return value;
};

const sources: SvgFontEmbedSources = {
  wasm: () => cached("subset", subsetWasmUrl),
  readFont: (file) => cached(file, URLS[file]),
};

/** A formal SVG whose text draws the same on every computer. */
export function embedFormalSvgFontsInBrowser(svg: string): Promise<string> {
  return embedSvgFontSubsets(svg, sources);
}
