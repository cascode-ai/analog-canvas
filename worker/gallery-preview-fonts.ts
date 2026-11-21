import subsetWasm from "../node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm";
import regular from "../packages/exporters/fonts/ICMSchematic-Regular.ttf";
import bold from "../packages/exporters/fonts/ICMSchematic-Bold.ttf";
import italic from "../packages/exporters/fonts/ICMSchematic-RegularItalic.ttf";
import boldItalic from "../packages/exporters/fonts/ICMSchematic-BoldItalic.ttf";
import {
  embedSvgFontSubsets,
  type SvgFontEmbedSources,
} from "../packages/exporters/src/svg-font-embed";

/**
 * The Worker's way to the faces a Gallery preview embeds (#2427): the
 * subsetter and the four ICM Schematic faces travel in the Worker bundle
 * (wrangler.jsonc rules), so a preview needs no fetch to draw the same on
 * every computer.
 */
// The editor's types read a font import as its URL; wrangler's Data rule
// hands the Worker the file's bytes.
const FILES = {
  "ICMSchematic-Regular.ttf": regular,
  "ICMSchematic-Bold.ttf": bold,
  "ICMSchematic-RegularItalic.ttf": italic,
  "ICMSchematic-BoldItalic.ttf": boldItalic,
} as unknown as Readonly<Record<string, ArrayBuffer | undefined>>;

const sources: SvgFontEmbedSources = {
  wasm: async () => subsetWasm,
  readFont: async (file) => {
    const bytes = FILES[file];
    if (!bytes) throw new Error(`The Worker carries no font ${file}`);
    return new Uint8Array(bytes);
  },
};

export function embedPreviewFonts(svg: string): Promise<string> {
  return embedSvgFontSubsets(svg, sources);
}
