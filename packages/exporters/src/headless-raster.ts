import { initWasm, Resvg } from "@resvg/resvg-wasm";

import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { FormalExportSource, RasterExport } from "./index.js";
import {
  DEFAULT_EXPORT_SCALE,
  DEFAULT_FORMAL_EXPORT_MARGIN,
  createFormalExportSource,
} from "./index.js";
import { loadHeadlessFont, loadResvgWasm } from "./headless-raster-assets.js";
import {
  headlessFontPlan,
  withHeadlessSerif,
  withHeadlessTextCompatibility,
  type HeadlessFontFile,
} from "./headless-text.js";

/**
 * Formal figures with no browser and no native module (#1498 local mode):
 * resvg compiled to WebAssembly draws the formal SVG in the same fonts as
 * ./node.ts, and measures its crop as the browser does (browser-bounds.ts),
 * from the glyphs actually drawn.
 */

let ready: Promise<void> | undefined;
const fonts = new Map<string, Promise<Uint8Array>>();

function fontBytes(font: HeadlessFontFile): Promise<Uint8Array> {
  const key = `${font.source}/${font.file}`;
  let bytes = fonts.get(key);
  if (!bytes) {
    bytes = loadHeadlessFont(font);
    fonts.set(key, bytes);
  }
  return bytes;
}

async function renderer(
  svg: string,
  fitTo: { mode: "zoom"; value: number },
): Promise<InstanceType<typeof Resvg>> {
  ready ??= loadResvgWasm().then((bytes) => initWasm(bytes));
  await ready;
  const raster = withHeadlessSerif(svg);
  const plan = headlessFontPlan(raster);
  return new Resvg(withHeadlessTextCompatibility(raster), {
    fitTo,
    font: {
      loadSystemFonts: false,
      fontBuffers: await Promise.all(plan.files.map(fontBytes)),
      defaultFontFamily: plan.defaultFontFamily,
      sansSerifFamily: plan.sansSerifFamily,
      serifFamily: plan.serifFamily,
    },
  });
}

const VIEW_BOX = /(<svg\b[^>]*\sviewBox=")([^"]+)(")/u;
/** A formal background is the root's first rect, the size of the view box. */
const BACKGROUND =
  /(<\/title>)<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*"( fill="[^"]*"\/>)/u;

/**
 * Crop a formal source to what it draws plus `margin`, measured in the faces
 * the PNG is drawn in, as the browser measures it for its own exports.
 */
export async function measureFormalExportSourceHeadless(
  source: FormalExportSource,
  margin: number,
): Promise<FormalExportSource> {
  // Measure on a canvas wider than the estimated one, without the background
  // that fills it, so a label the estimate cut short is measured whole.
  const pad = Math.max(source.bounds.width, source.bounds.height);
  const wide = {
    x: source.bounds.x - pad,
    y: source.bounds.y - pad,
    width: source.bounds.width + pad * 2,
    height: source.bounds.height + pad * 2,
  };
  const scene = source.svg
    .replace(BACKGROUND, "$1")
    .replace(VIEW_BOX, `$1${wide.x} ${wide.y} ${wide.width} ${wide.height}$3`);
  const resvg = await renderer(scene, { mode: "zoom", value: 1 });
  // getBBox, in the SVG's own user units; innerBBox in resvg 2.6 keeps only
  // a group's last child. It leaves strokes out: reserve the widest one's
  // envelope, miter joins included, as the browser measurement does.
  const box = resvg.getBBox();
  resvg.free();
  if (!box) return source;
  const outset =
    margin +
    Math.max(
      0,
      ...Array.from(
        scene.matchAll(/stroke-width(?:="|:)([0-9.]+)/gu),
        (match) => Number(match[1]),
      ).filter(Number.isFinite),
    );
  const bounds = {
    x: box.x - outset,
    y: box.y - outset,
    width: Math.max(1, box.width + outset * 2),
    height: Math.max(1, box.height + outset * 2),
  };
  box.free();
  const viewBox = `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`;
  const svg = source.svg
    .replace(VIEW_BOX, `$1${viewBox}$3`)
    .replace(
      BACKGROUND,
      `$1<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}"$2`,
    );
  return { svg, bounds };
}

/** One measured source for headless SVG and PNG files, as
 * createBrowserFormalExportSource makes one in a browser. */
export async function createHeadlessFormalExportSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: Parameters<typeof createFormalExportSource>[2] = {},
): Promise<FormalExportSource> {
  const source = createFormalExportSource(document, resolver, options);
  if (options.bounds) return source;
  return measureFormalExportSourceHeadless(
    source,
    options.margin ?? DEFAULT_FORMAL_EXPORT_MARGIN,
  );
}

/** The formal PNG at `scale` pixels per unit, as ./node.ts draws it. */
export async function rasterizeFormalSvgHeadless(
  source: FormalExportSource,
  scale = DEFAULT_EXPORT_SCALE,
): Promise<RasterExport> {
  if (!Number.isInteger(scale) || scale < 1 || scale > 8)
    throw new Error("Export scale must be an integer from 1 through 8");
  const resvg = await renderer(source.svg, { mode: "zoom", value: scale });
  const image = resvg.render();
  resvg.free();
  const png: RasterExport = {
    bytes: image.asPng(),
    width: image.width,
    height: image.height,
    mediaType: "image/png",
  };
  image.free();
  return png;
}
