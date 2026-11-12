#!/usr/bin/env node
// Text-only Razavi typography calibration harness.
//
// The reference image is intentionally supplied at invocation time rather than
// copied into the repository. It compares isolated raster crops for five math
// labels against the same SVG composition used by the formal renderer. The
// score is a relative candidate-selection aid: font rasterizers can disagree
// at anti-aliased edges, so it never acts as an absolute visual gate.
//
// Usage:
//   node scripts/calibration/razavi/text-fidelity-diff.mjs --reference C:/.../ota.png
//     [--font Arial] [--subscript-face upright-bold] [--out output/calibration/razavi-text]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";
import { rasterizeSvgBytes } from "../../../packages/exporters/dist/node.js";
import {
  binarize,
  composeDiff,
  cropRaster,
  decodePng,
  encodePng,
  iou,
  toLuminance,
} from "../../../scripts/lib/png-io.mjs";

const args = process.argv.slice(2);
const referenceIndex = args.indexOf("--reference");
if (referenceIndex < 0 || !args[referenceIndex + 1]) {
  throw new Error("Usage: --reference <Razavi PNG path> [--out <directory>]");
}
const referencePath = resolve(args[referenceIndex + 1]);
const outIndex = args.indexOf("--out");
const outDirectory = resolve(
  outIndex >= 0 && args[outIndex + 1]
    ? args[outIndex + 1]
    : "output/calibration/razavi-text",
);
const engineIndex = args.indexOf("--engine");
const engine = engineIndex >= 0 ? args[engineIndex + 1] : "browser";
if (engine !== "browser" && engine !== "resvg") {
  throw new Error("--engine must be browser or resvg");
}
const fontIndex = args.indexOf("--font");
const requestedFont = fontIndex >= 0 ? args[fontIndex + 1] : undefined;
if (fontIndex >= 0 && !requestedFont) {
  throw new Error("--font requires a font-family value");
}
const subscriptFaceIndex = args.indexOf("--subscript-face");
const requestedSubscriptFace =
  subscriptFaceIndex >= 0 ? args[subscriptFaceIndex + 1] : undefined;
const subscriptFaces = ["italic-bold", "upright-bold", "upright-plain"];
if (
  subscriptFaceIndex >= 0 &&
  (!requestedSubscriptFace || !subscriptFaces.includes(requestedSubscriptFace))
) {
  throw new Error(
    `--subscript-face must be one of ${subscriptFaces.join(", ")}`,
  );
}

// These windows intentionally exclude adjacent wires/nodes. Coordinates are
// measured from the supplied 237 x 273 user reference screenshot.
const REFERENCE_TARGETS = {
  "1204x794": [
    // Panel (b): these isolated instance labels have no adjacent node/route
    // ink inside their crop windows, unlike the crowded labels in panel (a).
    {
      id: "m3",
      crop: { x: 550, y: 67, width: 54, height: 35 },
      base: "M",
      sub: "3",
    },
    {
      id: "m2",
      crop: { x: 550, y: 150, width: 54, height: 35 },
      base: "M",
      sub: "2",
    },
    {
      id: "m1",
      crop: { x: 550, y: 237, width: 54, height: 35 },
      base: "M",
      sub: "1",
    },
    // Panel (b) supply title exercises the same power-label semantic parser.
    {
      id: "vdd",
      crop: { x: 561, y: 7, width: 66, height: 38 },
      base: "V",
      sub: "DD",
    },
  ],
  "237x273": [
    {
      id: "vdd",
      crop: { x: 196, y: 31, width: 39, height: 25 },
      base: "V",
      sub: "DD",
    },
    {
      id: "rd",
      crop: { x: 37, y: 70, width: 35, height: 23 },
      base: "R",
      sub: "D",
    },
    {
      id: "vout",
      // This label touches an output node and polarity marker in the source
      // crop. Keep the diagnostic, but never let surrounding circuit ink select
      // the default text tokens.
      diagnosticOnly: true,
      crop: { x: 101, y: 102, width: 43, height: 24 },
      base: "V",
      sub: "out",
    },
    {
      id: "m1",
      crop: { x: 83, y: 142, width: 37, height: 27 },
      base: "M",
      sub: "1",
    },
    {
      id: "m2",
      crop: { x: 143, y: 142, width: 38, height: 27 },
      base: "M",
      sub: "2",
    },
  ],
  "546x522": [
    {
      id: "vdd",
      crop: { x: 282, y: 7, width: 82, height: 51 },
      base: "V",
      sub: "DD",
    },
    {
      id: "vb3",
      crop: { x: 48, y: 84, width: 82, height: 50 },
      base: "V",
      sub: "b3",
    },
    {
      id: "m3",
      crop: { x: 255, y: 96, width: 67, height: 48 },
      base: "M",
      sub: "3",
    },
    {
      id: "vb1",
      crop: { x: 48, y: 199, width: 82, height: 50 },
      base: "V",
      sub: "b1",
    },
    {
      id: "m2",
      crop: { x: 255, y: 211, width: 67, height: 48 },
      base: "M",
      sub: "2",
    },
    {
      id: "ix",
      crop: { x: 360, y: 246, width: 52, height: 45 },
      base: "I",
      sub: "X",
    },
    {
      id: "vx",
      crop: { x: 474, y: 372, width: 66, height: 53 },
      base: "V",
      sub: "X",
    },
    {
      id: "m1",
      crop: { x: 255, y: 351, width: 67, height: 48 },
      base: "M",
      sub: "1",
    },
  ],
  "694x446": [
    {
      id: "vdd",
      crop: { x: 294, y: 56, width: 70, height: 39 },
      base: "V",
      sub: "DD",
    },
    {
      id: "vin",
      crop: { x: 103, y: 127, width: 58, height: 36 },
      base: "V",
      sub: "in",
    },
    {
      id: "m1",
      crop: { x: 272, y: 134, width: 52, height: 39 },
      base: "M",
      sub: "1",
    },
    {
      id: "m2",
      crop: { x: 343, y: 207, width: 53, height: 39 },
      base: "M",
      sub: "2",
    },
    {
      id: "m3",
      crop: { x: 274, y: 303, width: 51, height: 39 },
      base: "M",
      sub: "3",
    },
    {
      id: "rout",
      crop: { x: 508, y: 83, width: 76, height: 39 },
      base: "R",
      sub: "out",
    },
  ],
};
const THRESHOLD = 190;

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function subscriptStyle(candidate) {
  switch (candidate.subscriptFace) {
    case "upright-bold":
      return "font-style:normal;font-weight:700";
    case "upright-plain":
      return "font-style:normal;font-weight:400";
    default:
      return "font-style:italic;font-weight:700";
  }
}

function textSvg(target, candidate) {
  const baseStyle = "font-style:italic;font-weight:700";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="72" viewBox="0 0 160 72"><rect width="160" height="72" fill="#fff"/><text x="20" y="46" font-family="${candidate.fontFamily}" font-size="${candidate.baseSize}" fill="#202020"><tspan style="${baseStyle}">${xml(target.base)}</tspan><tspan dx="${candidate.subscriptHorizontalOffsetEm}em" font-size="${Math.round(candidate.subscriptScale * 100)}%" baseline-shift="-${candidate.subscriptShiftEm}em" style="${subscriptStyle(candidate)}">${xml(target.sub)}</tspan></text></svg>`;
}

let browser;
let page;

async function rasterizeText(svg) {
  if (engine === "resvg") return decodePng(rasterizeSvgBytes(svg, 160));
  if (!page) {
    browser = await chromium.launch({ channel: "chrome" });
    page = await browser.newPage({
      viewport: { width: 160, height: 72 },
      deviceScaleFactor: 1,
    });
  }
  await page.setContent(
    `<html><body style="margin:0;overflow:hidden">${svg}</body></html>`,
  );
  return decodePng(await page.screenshot({ type: "png" }));
}

function tightMask(raster) {
  const mask = binarize(toLuminance(raster), THRESHOLD);
  let minX = raster.width;
  let minY = raster.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (mask[y * raster.width + x] !== 1) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error("Text raster has no ink");
  const padding = 2;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const width = Math.min(raster.width - x, maxX - minX + 1 + padding * 2);
  const height = Math.min(raster.height - y, maxY - minY + 1 + padding * 2);
  const cropped = cropRaster(raster, x, y, width, height);
  return { raster: cropped, mask: binarize(toLuminance(cropped), THRESHOLD) };
}

function placedMask(
  mask,
  sourceWidth,
  sourceHeight,
  width,
  height,
  dx = 0,
  dy = 0,
) {
  const output = new Uint8Array(width * height);
  const originX = Math.floor((width - sourceWidth) / 2) + dx;
  const originY = Math.floor((height - sourceHeight) / 2) + dy;
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const destinationX = originX + x;
      const destinationY = originY + y;
      if (
        destinationX < 0 ||
        destinationY < 0 ||
        destinationX >= width ||
        destinationY >= height
      )
        continue;
      output[destinationY * width + destinationX] = mask[y * sourceWidth + x];
    }
  }
  return output;
}

function bestAlignment(reference, rendered) {
  const width = Math.max(reference.raster.width, rendered.raster.width) + 12;
  const height = Math.max(reference.raster.height, rendered.raster.height) + 12;
  const referenceMask = placedMask(
    reference.mask,
    reference.raster.width,
    reference.raster.height,
    width,
    height,
  );
  let best = { iou: -1, dx: 0, dy: 0, renderedMask: null };
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const renderedMask = placedMask(
        rendered.mask,
        rendered.raster.width,
        rendered.raster.height,
        width,
        height,
        dx,
        dy,
      );
      const result = iou(referenceMask, renderedMask);
      if (result.iou > best.iou) best = { ...result, dx, dy, renderedMask };
    }
  }
  return { ...best, referenceMask, width, height };
}

function maskRaster(mask, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const value = mask[i] === 1 ? 32 : 255;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

async function evaluate(reference, candidate, includeRasters = false) {
  const reports = [];
  for (const target of targets) {
    const referenceCrop = tightMask(
      cropRaster(
        reference,
        target.crop.x,
        target.crop.y,
        target.crop.width,
        target.crop.height,
      ),
    );
    const svg = textSvg(target, candidate);
    const rendered = tightMask(await rasterizeText(svg));
    const alignment = bestAlignment(referenceCrop, rendered);
    reports.push({
      id: target.id,
      iou: alignment.iou,
      dx: alignment.dx,
      dy: alignment.dy,
      ...(includeRasters ? { alignment } : {}),
    });
  }
  return {
    candidate,
    score:
      reports
        .filter(
          (item) =>
            !targets.find((target) => target.id === item.id)?.diagnosticOnly,
        )
        .reduce((total, item) => total + item.iou, 0) /
      reports.filter(
        (item) =>
          !targets.find((target) => target.id === item.id)?.diagnosticOnly,
      ).length,
    reports,
  };
}

function candidateKey(candidate) {
  return `${candidate.fontFamily}/${candidate.baseSize}/${candidate.subscriptScale}/${candidate.subscriptShiftEm}/${candidate.subscriptHorizontalOffsetEm}/${candidate.subscriptFace}`;
}

async function choose(reference, candidates, label) {
  const scored = [];
  for (const candidate of candidates)
    scored.push(await evaluate(reference, candidate));
  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  console.log(`${label}:`);
  for (const result of scored.slice(0, 4)) {
    console.log(
      `  ${candidateKey(result.candidate)} score=${result.score.toFixed(4)}`,
    );
  }
  return best.candidate;
}

const reference = await decodePng(await readFile(referencePath));
const targets = REFERENCE_TARGETS[`${reference.width}x${reference.height}`];
if (!targets) {
  throw new Error(
    `Unsupported reference dimensions ${reference.width}x${reference.height}`,
  );
}

let best = await choose(
  reference,
  (requestedFont
    ? [requestedFont]
    : ["Arial", "Arial Narrow", "Times New Roman", "DejaVu Sans"]
  ).flatMap((fontFamily) =>
    (requestedSubscriptFace ? [requestedSubscriptFace] : subscriptFaces).map(
      (subscriptFace) => ({
        fontFamily,
        baseSize: 16,
        subscriptScale: 0.68,
        subscriptShiftEm: 0.3,
        subscriptHorizontalOffsetEm: 0,
        subscriptFace,
      }),
    ),
  ),
  "face",
);
best = await choose(
  reference,
  [14, 15, 16, 17, 18, 22, 26, 30, 34, 38, 42].map((baseSize) => ({
    ...best,
    baseSize,
  })),
  "base size",
);
best = await choose(
  reference,
  [0.64, 0.68, 0.72, 0.76, 0.8, 0.84, 0.88].map((subscriptScale) => ({
    ...best,
    subscriptScale,
  })),
  "subscript scale",
);
best = await choose(
  reference,
  [0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4].map((subscriptShiftEm) => ({
    ...best,
    subscriptShiftEm,
  })),
  "subscript baseline",
);
best = await choose(
  reference,
  [-0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.16].map(
    (subscriptHorizontalOffsetEm) => ({
      ...best,
      subscriptHorizontalOffsetEm,
    }),
  ),
  "subscript attachment",
);

const final = await evaluate(reference, best, true);
await mkdir(outDirectory, { recursive: true });
for (const report of final.reports) {
  const { alignment } = report;
  await writeFile(
    resolve(outDirectory, `ref-${report.id}.png`),
    await encodePng(
      maskRaster(alignment.referenceMask, alignment.width, alignment.height),
    ),
  );
  await writeFile(
    resolve(outDirectory, `rendered-${report.id}.png`),
    await encodePng(
      maskRaster(alignment.renderedMask, alignment.width, alignment.height),
    ),
  );
  await writeFile(
    resolve(outDirectory, `diff-${report.id}.png`),
    await encodePng(
      composeDiff(
        alignment.referenceMask,
        alignment.renderedMask,
        alignment.width,
        alignment.height,
      ),
    ),
  );
}
await writeFile(
  resolve(outDirectory, "report.json"),
  `${JSON.stringify(final, (key, value) => (key === "alignment" ? undefined : value), 2)}\n`,
);
console.log("\nFinal candidate:");
console.log(JSON.stringify(final.candidate, null, 2));
for (const report of final.reports) {
  console.log(
    `  ${report.id.padEnd(5)} ${report.iou.toFixed(4)}  shift=(${report.dx},${report.dy})`,
  );
}
console.log(`Diffs: ${outDirectory}`);
await browser?.close();
