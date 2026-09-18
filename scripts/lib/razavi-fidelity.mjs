// Core fidelity comparison for the Razavi raster reference.
//
// For each raster-owned device (MOS, voltage-source, current-source, ground),
// compare the rendered symbol (resvg at pixelsPerLogical) against a crop of
// razavi-six-panel.png centered on the device's originPx. Produces:
//   - IoU score (binary, threshold = manifest pixelThreshold)
//   - miss / extra pixel counts
//   - a 3-channel diff PNG (red=miss, green=extra, gray=overlap)
//   - per-part attribution (gate-bar / channel / source-arrow / bulk-lead) by
//     testing the rendered primitives' logical regions
//
// Everything here is pure: it takes inputs and returns a report object. The CLI
// wraps it for I/O.

import {
  cropRaster,
  toLuminance,
  binarize,
  iou,
  softInk,
  softIou,
  edgeShellRatio,
  composeDiff,
  encodePng,
  luminanceToRaster,
} from "./png-io.mjs";
import { rasterizeSymbol } from "./symbol-rasterize.mjs";

/**
 * Search ±maxShift pixels for the (dx,dy) translation that maximizes IoU of the
 * rendered mask against the reference. Returns the best IoU and the lift over the
 * unshifted score. A large lift means the residual error is dominated by
 * sub-pixel registration / anti-alias contour position rather than geometry —
 * the score is fragile, not a clean geometry signal.
 *
 * @param {Uint8Array} refMask
 * @param {Uint8Array} renderedMask
 * @param {number} width
 * @param {number} height
 * @param {number} maxShift
 * @param {number} baselineIou
 * @returns {{bestIou:number, bestDx:number, bestDy:number, lift:number}}
 */
function bestTranslation(
  refMask,
  renderedMask,
  width,
  height,
  maxShift,
  baselineIou,
) {
  let best = { bestIou: baselineIou, bestDx: 0, bestDy: 0, lift: 0 };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      if (dx === 0 && dy === 0) continue;
      let inter = 0;
      let uni = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const ri = refMask[y * width + x] === 1;
          const sy = y - dy;
          const sx = x - dx;
          const di =
            sy >= 0 && sy < height && sx >= 0 && sx < width
              ? renderedMask[sy * width + sx] === 1
              : false;
          if (ri && di) inter++;
          if (ri || di) uni++;
        }
      }
      const sc = uni === 0 ? 1 : inter / uni;
      if (sc > best.bestIou) {
        best = { bestIou: sc, bestDx: dx, bestDy: dy, lift: sc - baselineIou };
      }
    }
  }
  return best;
}

/**
 * Classify a device as anti-alias sensitive: hollow circles, polarity glyphs,
 * and text-bearing symbols have thin strokes whose ink footprint is dominated
 * by rasterizer anti-aliasing rather than geometry, so their absolute IoU is a
 * poor correctness gate.
 *
 * @param {import("../../packages/symbols/src/schema.js").SymbolDefinition} definition
 * @returns {boolean}
 */
function isAntiAliasSensitive(definition) {
  const hasCircle = (definition.primitives ?? []).some(
    (p) => p.kind === "circle",
  );
  // voltage/current source carry +/- polarity glyphs (short line primitives);
  // ground has three short bars. MOS has filled arrow polygons (less sensitive).
  const id = definition.id ?? "";
  return hasCircle || id === "voltage-source" || id === "current-source";
}

/**
 * @typedef {Object} DeviceSpec
 * @property {string} symbolId           e.g. "nmos"
 * @property {number} pixelsPerLogical   e.g. 1.72
 * @property {{x:number,y:number}} originPx  device origin in reference pixels
 * @property {number} threshold           binarization threshold (default 160)
 * @property {boolean} useVariant          apply the symbol's first variant
 * @property {{width:number,height:number}} [window]  override pixel window
 *   (default: tight geometry-derived window via pixelWindowFromGeometry)
 * @property {number} [windowPadding]  logical padding around geometry bbox
 *   when deriving the window (default 0 — window bounds pin tips exactly)
 */

/**
 * Derive a tight pixel window from the symbol's actual geometry — pins and
 * primitive vertices — rather than its viewBox. The viewBox often extends past
 * the pin tips (e.g. MOS viewBox is ±24 but pins sit at ±20), and the reference
 * raster has ink (external wires, labels) in that gap. A window bounded by the
 * real geometry stops at the pin tips, so both sides agree on where ink ends
 * and the diff isn't flooded by reference-only content outside the symbol.
 *
 * The window is made symmetric about the origin (max extent on either side) so
 * the origin maps to a central pixel.
 *
 * @param {import("../../packages/symbols/src/schema.js").SymbolDefinition} definition
 * @param {number} pixelsPerLogical
 * @param {number} padding  logical-unit padding added around the geometry bbox
 * @returns {{width:number,height:number}}
 */
export function pixelWindowFromGeometry(
  definition,
  pixelsPerLogical,
  padding = 2,
) {
  const xs = [];
  const ys = [];
  for (const pin of definition.pins ?? []) {
    if (pin.at) {
      xs.push(pin.at.x);
      ys.push(pin.at.y);
    }
  }
  const collect = (pts) => {
    for (const p of pts) {
      xs.push(p.x);
      ys.push(p.y);
    }
  };
  for (const primitive of definition.primitives ?? []) {
    if (primitive.kind === "line") collect([primitive.from, primitive.to]);
    else if (primitive.kind === "polygon" || primitive.kind === "polyline")
      collect(primitive.points);
    else if (primitive.kind === "circle") {
      // Include the stroke's outer extent: a stroked circle's ink reaches
      // radius + halfStrokeWidth, and the geometry window must bound that or
      // the circle gets clipped at the window edge.
      const r = primitive.radius + 1.5; // ~half of the thickest stroke (emphasis 2.16)
      xs.push(primitive.center.x - r, primitive.center.x + r);
      ys.push(primitive.center.y - r, primitive.center.y + r);
    }
  }
  const minX = Math.min(...xs) - padding;
  const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding;
  const maxY = Math.max(...ys) + padding;
  // Asymmetric window: bounds the actual geometry, so a device whose ink sits
  // off-center (e.g. voltage-source: polarity symbols on the left, circle on
  // the right) doesn't force a symmetric extension that crops in neighbors.
  // The origin lands at |minX| from the left edge (handled by compareDevice's
  // originInWindow), not necessarily at the center.
  const width = makeOdd(Math.ceil((maxX - minX) * pixelsPerLogical));
  const height = makeOdd(Math.ceil((maxY - minY) * pixelsPerLogical));
  return {
    width,
    height,
    // logical offset of the window's top-left from the origin
    minX,
    minY,
  };
}

function makeOdd(n) {
  return n % 2 === 0 ? n + 1 : n;
}

/**
 * Run the fidelity comparison for one device.
 *
 * @param {DeviceSpec} spec
 * @param {{width:number,height:number,data:Uint8Array}} referenceRaster  full six-panel PNG
 * @param {import("../../packages/symbols/src/schema.js").SymbolDefinition} definition
 * @returns {Promise<object>}  report with iou, counts, diff raster, ref/rendered rasters
 */
export async function compareDevice(spec, referenceRaster, definition) {
  const derived =
    spec.window ??
    pixelWindowFromGeometry(
      definition,
      spec.pixelsPerLogical,
      spec.windowPadding ?? 0,
    );
  // Support both symmetric (width/height only) and asymmetric (with minX/minY)
  // windows. For symmetric windows the origin sits at the center; for asymmetric
  // ones it sits at -minX from the left (the geometry's left bound).
  const window = { width: derived.width, height: derived.height };
  const minX = derived.minX ?? -window.width / 2 / spec.pixelsPerLogical;
  const minY = derived.minY ?? -window.height / 2 / spec.pixelsPerLogical;

  // --- reference side: crop with top-left at originPx + minX*ppl ---
  // Floor (not round) so the origin's subpixel position within the crop is
  // preserved; the rendered side is aligned to that same position.
  const refX = Math.floor(spec.originPx.x + minX * spec.pixelsPerLogical);
  const refY = Math.floor(spec.originPx.y + minY * spec.pixelsPerLogical);
  const refCrop = cropRaster(
    referenceRaster,
    refX,
    refY,
    window.width,
    window.height,
  );

  // --- rendered side: rasterize symbol with origin aligned to the reference
  // crop's origin position. originPx in crop coords = originPx - (refX, refY).
  const originInWindow = {
    x: spec.originPx.x - refX,
    y: spec.originPx.y - refY,
  };
  const rendered = spec.rasterize
    ? await spec.rasterize(window, originInWindow)
    : await rasterizeSymbol(
        definition,
        window,
        spec.pixelsPerLogical,
        spec.useVariant ?? false,
        originInWindow,
        spec.rotation ?? 0,
      );

  // Guard: footprints must match for a meaningful pixel diff.
  if (rendered.width !== window.width || rendered.height !== window.height) {
    throw new Error(
      `rendered footprint ${rendered.width}x${rendered.height} != window ${window.width}x${window.height} for ${spec.symbolId}`,
    );
  }

  // --- binarize + compare ---
  const refLum = toLuminance(refCrop);
  const renderedLum = toLuminance(rendered);
  const refMask = binarize(refLum, spec.threshold);
  const renderedMask = binarize(renderedLum, spec.threshold);
  const result = iou(refMask, renderedMask);

  // Soft (anti-alias-weighted) IoU: edges contribute fractionally, so a 1px
  // edge difference between rasterizers doesn't read as a full miss/extra.
  const soft = softIou(
    softInk(refLum, spec.threshold),
    softInk(renderedLum, spec.threshold),
  );

  const diff = composeDiff(refMask, renderedMask, window.width, window.height);

  // --- diagnostics: is the residual error geometry or anti-alias? ---
  // 1. Registration lift: how much does ±2px translation improve IoU? A large
  //    lift means sub-pixel / edge-contour differences dominate, not geometry.
  const reg = bestTranslation(
    refMask,
    renderedMask,
    window.width,
    window.height,
    2,
    result.iou,
  );
  // 2. Edge-shell ratio: of the miss+extra pixels, how many hug the other
  //    side's ink contour (≤2px)? High → thin-shell edge disagreement (AA);
  //    low → solid blocks of mismatch (true geometry error).
  // miss pixels = ref ink absent in render; extra = render ink absent in ref.
  // An edge-shell disagreement hugs the *opposite* side's contour: a missed
  // pixel near the rendered ink contour (anti-alias), an extra pixel near the
  // reference contour. Measure each against the opposite mask.
  const missMask = new Uint8Array(refMask.length);
  const extraMask = new Uint8Array(refMask.length);
  for (let i = 0; i < refMask.length; i++) {
    if (refMask[i] === 1 && renderedMask[i] !== 1) missMask[i] = 1;
    if (renderedMask[i] === 1 && refMask[i] !== 1) extraMask[i] = 1;
  }
  const shellMiss = edgeShellRatio(
    missMask,
    renderedMask,
    window.width,
    window.height,
    2,
  );
  const shellExtra = edgeShellRatio(
    extraMask,
    refMask,
    window.width,
    window.height,
    2,
  );
  const totalDisagree = shellMiss.total + shellExtra.total;
  const shellRatio =
    totalDisagree === 0
      ? 0
      : (shellMiss.near + shellExtra.near) / totalDisagree;
  // 3. Device anti-alias sensitivity flag.
  const aaSensitive =
    spec.antiAliasSensitive ?? isAntiAliasSensitive(definition);

  return {
    symbolId: spec.symbolId,
    window,
    threshold: spec.threshold,
    refPixels: refMask.reduce((s, v) => s + v, 0),
    renderedPixels: renderedMask.reduce((s, v) => s + v, 0),
    iou: result.iou,
    softIou: soft.iou,
    intersection: result.intersection,
    union: result.union,
    miss: result.miss,
    extra: result.extra,
    missPct: refMask.length ? (result.miss / refMask.length) * 100 : 0,
    extraPct: renderedMask.length
      ? (result.extra / renderedMask.length) * 100
      : 0,
    // diagnostics
    regLift: reg.lift,
    regBestIou: reg.bestIou,
    regBestShift: { dx: reg.bestDx, dy: reg.bestDy },
    edgeShellRatio: shellRatio,
    aaSensitive,
    // conclusion: which error class dominates
    verdict: classifyVerdict(reg.lift, shellRatio, aaSensitive),
    // rasters for side-by-side output
    refRaster: luminanceToRaster(refLum, window.width, window.height),
    renderedRaster: luminanceToRaster(renderedLum, window.width, window.height),
    diffRaster: diff,
  };
}

/**
 * Turn the diagnostics into a human-readable verdict. Three classes:
 *   - "anti-alias" : residual is edge-contour / sub-pixel; absolute IoU is not a
 *     correctness gate (compare relative movement, not the raw number)
 *   - "geometry"   : solid blocks of mismatch; the IoU is a real correctness
 *     signal — geometry needs fixing
 *   - "marginal"   : mixed; neither class dominates
 *
 * The edge-shell ratio is the primary signal: if most disagreement pixels hug
 * the opposite contour (≤2px), the error is a thin shell — anti-alias / sub-pixel.
 * regLift (translation-search gain) is secondary: a large lift on top of a high
 * shell ratio reinforces the anti-alias call, but a large lift alone does NOT,
 * because translating also partially recovers a real geometry offset. Only a
 * low shell ratio (disagreement in solid blocks away from the contour) reliably
 * flags geometry.
 *
 * @param {number} regLift
 * @param {number} shellRatio
 * @param {boolean} aaSensitive
 * @returns {"anti-alias"|"geometry"|"marginal"}
 */
function classifyVerdict(regLift, shellRatio, aaSensitive) {
  // Solid blocks of disagreement away from the contour → real geometry mismatch.
  if (shellRatio < 0.5) return "geometry";
  // Most disagreement hugging the contour → anti-alias / sub-pixel shell.
  if (shellRatio > 0.7) return "anti-alias";
  return "marginal";
}

/**
 * Encode all comparison rasters for a report to PNG bytes, keyed by suffix.
 * @param {object} report  output of compareDevice
 * @returns {Promise<{ref:Buffer, rendered:Buffer, diff:Buffer}>}
 */
export async function encodeReportRasters(report) {
  return {
    ref: await encodePng(report.refRaster),
    rendered: await encodePng(report.renderedRaster),
    diff: await encodePng(report.diffRaster),
  };
}
