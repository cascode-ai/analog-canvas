// Render a single Razavi symbol definition to an RGBA raster at a fixed
// pixels-per-logical scale, matching the reference raster's coordinate system.
//
// The reference (razavi-six-panel.png) was measured at pixelsPerLogical = 1.72:
// 1 logical unit === 1.72 px. To compare apples-to-apples, we rasterize the
// symbol at that exact scale into a pixel footprint that is bit-for-bit the same
// size as the reference crop. The reference crop is a W×H window centered on
// the device's originPx; the rendered SVG uses a viewBox whose logical extent
// is exactly W/ppl × H/ppl centered on the logical origin (0,0). Thus:
//   - resvg renders stroke-width (in logical units) at 1.72× → correct px width
//   - logical origin (0,0) lands at the crop center on both sides
//   - no padding mismatch, no aspect-ratio drift

import { razaviTextbookProfile } from "../../packages/derived/dist/style-profile.js";
import {
  renderSignalFlowFormula,
  renderSymbolDefinitionBody,
  renderVisiblePinNames,
} from "../../packages/render-svg/dist/index.js";
import { rasterizeSvgBytes } from "../../packages/exporters/dist/node.js";
import { decodePng } from "./png-io.mjs";

/**
 * A pixel window: an integer W×H region of the reference raster centered on a
 * device's originPx. Both the reference crop and the rendered symbol rasterize
 * into exactly this footprint.
 * @typedef {Object} PixelWindow
 * @property {number} width   pixel width
 * @property {number} height   pixel height
 */

/**
 * Build a complete standalone SVG for one symbol, sized so that 1 logical unit
 * maps to `pixelsPerLogical` device pixels and the pixel footprint equals
 * `window` (W×H). The logical origin (0,0) is placed at `originInWindow` (in
 * device pixels from the top-left of the rendered raster) so it can be aligned
 * with the reference crop's subpixel origin position.
 *
 * @param {import("../../packages/symbols/src/schema.js").SymbolDefinition} definition
 * @param {PixelWindow} window
 * @param {number} pixelsPerLogical
 * @param {boolean} useVariant  whether to apply the symbol's first variant
 *   (e.g. 3-terminal MOS hiding the bulk lead and showing the source arrow).
 * @param {{x:number,y:number}} [originInWindow]  device-pixel position of
 *   logical (0,0) within the window; defaults to the window center.
 * @returns {{svg: string, pixelWidth: number, pixelHeight: number}}
 */
function buildSymbolSvg(
  definition,
  window,
  pixelsPerLogical,
  useVariant = false,
  originInWindow,
  rotation = 0,
) {
  const profile = razaviTextbookProfile;
  const pixelWidth = window.width;
  const pixelHeight = window.height;

  // Place logical origin at originInWindow (device px from top-left). The viewBox
  // top-left maps to device (0,0), so viewBoxX = -(originX_in_logical_units).
  const ox = originInWindow?.x ?? pixelWidth / 2;
  const oy = originInWindow?.y ?? pixelHeight / 2;
  const logicalWidth = pixelWidth / pixelsPerLogical;
  const logicalHeight = pixelHeight / pixelsPerLogical;
  const viewBoxX = -ox / pixelsPerLogical;
  const viewBoxY = -oy / pixelsPerLogical;

  const variant = definition.variants?.[0];
  const hiddenPrimitiveParts = useVariant
    ? (variant?.hiddenPrimitiveParts ?? [])
    : [];
  const additionalPrimitives = useVariant
    ? (variant?.additionalPrimitives ?? [])
    : [];
  const body = renderSymbolDefinitionBody(
    definition,
    hiddenPrimitiveParts,
    additionalPrimitives,
    profile,
  );
  const formula = renderSignalFlowFormula(
    definition.formulaPresentation,
    undefined,
    { foreground: profile.foreground, profile },
  );
  const pinNames = renderVisiblePinNames(
    definition,
    useVariant ? (variant?.hiddenPinNames ?? []) : [],
    {
      id: "fidelity-instance",
      symbolId: definition.id,
      placement: {
        position: { x: 0, y: 0 },
        rotation,
        mirror: "none",
      },
    },
    profile,
  );

  // Wrap exactly like render.ts:470: <g fill none stroke fg stroke-width=symbol
  // linecap linejoin miterlimit>...primitives...</g>
  const miterAttr = ` stroke-miterlimit="${profile.miterLimit}"`;
  const artwork = `${body}${formula}`;
  const transformedArtwork =
    rotation === 0
      ? artwork
      : `<g transform="rotate(${rotation})">${artwork}</g>`;
  const group = `<g fill="none" stroke="${profile.foreground}" stroke-width="${profile.strokes.symbol}" stroke-linecap="${profile.lineCap}" stroke-linejoin="${profile.lineJoin}"${miterAttr}>${transformedArtwork}</g>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${logicalWidth} ${logicalHeight}" ` +
    `width="${pixelWidth}" height="${pixelHeight}">` +
    `<rect x="${viewBoxX}" y="${viewBoxY}" width="${logicalWidth}" height="${logicalHeight}" fill="${profile.background}"/>` +
    `${group}${pinNames}</svg>`;

  return { svg, pixelWidth, pixelHeight };
}

/**
 * Rasterize a symbol definition to an RGBA raster at the reference scale, into
 * the given pixel window footprint.
 *
 * Goes through the exporters `rasterizeSvgBytes` wrapper (which owns the resvg
 * dependency and bundled fonts) and decodes the resulting PNG back to RGBA via
 * pngjs, keeping the harness decoupled from resvg's package resolution.
 *
 * @param {import("../../packages/symbols/src/schema.js").SymbolDefinition} definition
 * @param {PixelWindow} window
 * @param {number} pixelsPerLogical
 * @param {boolean} useVariant
 * @param {{x:number,y:number}} [originInWindow]  device-pixel origin position
 * @returns {Promise<{width:number,height:number,data:Uint8Array}>}
 */
export async function rasterizeSymbol(
  definition,
  window,
  pixelsPerLogical,
  useVariant = false,
  originInWindow,
  rotation = 0,
) {
  const { svg, pixelWidth } = buildSymbolSvg(
    definition,
    window,
    pixelsPerLogical,
    useVariant,
    originInWindow,
    rotation,
  );
  const pngBytes = rasterizeSvgBytes(svg, pixelWidth);
  return decodePng(pngBytes);
}
