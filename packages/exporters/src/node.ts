import { Resvg } from "@resvg/resvg-js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FormalExportSource, RasterExport } from "./index.js";
import { DEFAULT_EXPORT_SCALE } from "./index.js";
import { createPdfFromPng } from "./pdf.js";
import {
  headlessFontPlan,
  withHeadlessSerif,
  withHeadlessTextCompatibility,
  type HeadlessFontFile,
} from "./headless-text.js";

const BUNDLED_FONT_PACKAGE = fileURLToPath(
  import.meta.resolve("dejavu-fonts-ttf/package.json"),
);
const BUNDLED_FONT_DIRECTORY = resolve(dirname(BUNDLED_FONT_PACKAGE), "ttf");

function fontPath({ source, file }: HeadlessFontFile): string {
  return source === "dejavu"
    ? resolve(BUNDLED_FONT_DIRECTORY, file)
    : fileURLToPath(new URL(`../fonts/${file}`, import.meta.url));
}

export interface NodeExportArtifacts {
  svg: Uint8Array;
  png: RasterExport;
  pdf: Uint8Array;
}

function resvg(svg: string, fitTo: { mode: "zoom" | "width"; value: number }) {
  const plan = headlessFontPlan(svg);
  return new Resvg(withHeadlessTextCompatibility(svg), {
    fitTo,
    font: {
      // Formal export goldens must not depend on whichever fonts happen to be
      // installed on the developer machine or GitHub runner.
      loadSystemFonts: false,
      fontFiles: plan.files.map(fontPath),
      defaultFontFamily: plan.defaultFontFamily,
      sansSerifFamily: plan.sansSerifFamily,
      serifFamily: plan.serifFamily,
    },
  }).render();
}

export function rasterizeSvgBytes(svg: string, width: number): Uint8Array {
  if (!Number.isInteger(width) || width < 1 || width > 8192) {
    throw new Error("Raster width must be an integer from 1 through 8192");
  }
  return resvg(svg, { mode: "width", value: width }).asPng();
}

export async function exportFormalArtifacts(
  source: FormalExportSource,
  scale = DEFAULT_EXPORT_SCALE,
): Promise<NodeExportArtifacts> {
  if (!Number.isInteger(scale) || scale < 1 || scale > 8) {
    throw new Error("Export scale must be an integer from 1 through 8");
  }
  const rendered = resvg(withHeadlessSerif(source.svg), {
    mode: "zoom",
    value: scale,
  });
  const png: RasterExport = {
    bytes: rendered.asPng(),
    width: rendered.width,
    height: rendered.height,
    mediaType: "image/png",
  };
  return {
    svg: new TextEncoder().encode(source.svg),
    png,
    pdf: await createPdfFromPng(png, source.bounds),
  };
}
