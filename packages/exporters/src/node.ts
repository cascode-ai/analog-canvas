import { Resvg } from "@resvg/resvg-js";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FormalExportSource, RasterExport } from "./index.js";
import { DEFAULT_EXPORT_SCALE } from "./index.js";
import { createPdfFromPng } from "./pdf.js";
import { globalSchematicTypography } from "@icm/derived";

const BUNDLED_FONT_PACKAGE = fileURLToPath(
  import.meta.resolve("dejavu-fonts-ttf/package.json"),
);
const BUNDLED_FONT_DIRECTORY = resolve(dirname(BUNDLED_FONT_PACKAGE), "ttf");
const BUNDLED_FONTS = [
  "DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSans-Oblique.ttf",
  "DejaVuSans-BoldOblique.ttf",
  "DejaVuSerif.ttf",
  "DejaVuSerif-Bold.ttf",
  "DejaVuSerif-Italic.ttf",
  "DejaVuSerif-BoldItalic.ttf",
].map((file) => resolve(BUNDLED_FONT_DIRECTORY, file));
const SCHEMATIC_FONTS = ["Regular", "Bold", "RegularItalic", "BoldItalic"].map(
  (face) =>
    fileURLToPath(
      new URL(`../fonts/ICMSchematic-${face}.ttf`, import.meta.url),
    ),
);

export interface NodeExportArtifacts {
  svg: Uint8Array;
  png: RasterExport;
  pdf: Uint8Array;
}

/** resvg can reshape a mixed-family run with one fallback face. The composed
 * face keeps each style's Latin, symbols and period together. */
function withHeadlessTextCompatibility(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const family = globalSchematicTypography.fontFamily;
  for (const style of Array.from(document.getElementsByTagName("style")))
    style.textContent =
      style.textContent?.replaceAll(
        `font-family:${family}`,
        'font-family:"ICM Schematic"',
      ) ?? "";
  for (const element of Array.from(document.getElementsByTagName("*")))
    if (element.getAttribute("font-family") === family)
      element.setAttribute("font-family", "ICM Schematic");
  // resvg 2.6 ignores relative glyph spacing when measuring a text anchor.
  // Label formulas use flat flowing runs; include their dx in the anchor so
  // operators clear adjoining fraction bars and scripts remain centered.
  for (const formula of Array.from(document.getElementsByTagName("g"))) {
    if (formula.getAttribute("data-role") !== "formula") continue;
    for (const text of Array.from(formula.getElementsByTagName("text"))) {
      const anchor = text.getAttribute("text-anchor");
      const factor = anchor === "end" ? 1 : anchor === "middle" ? 0.5 : 0;
      if (factor === 0) continue;
      const spans = Array.from(text.getElementsByTagName("tspan"));
      if (
        spans.some((span) => span.parentNode !== text || span.hasAttribute("x"))
      )
        continue;
      const spacing = spans.reduce(
        (sum, span) => sum + Number(span.getAttribute("dx") ?? 0),
        0,
      );
      const x = Number(text.getAttribute("x"));
      if (Number.isFinite(spacing) && Number.isFinite(x) && spacing !== 0)
        text.setAttribute("x", String(x - factor * spacing));
    }
  }
  return new XMLSerializer().serializeToString(document);
}

function resvg(svg: string, fitTo: { mode: "zoom" | "width"; value: number }) {
  return new Resvg(withHeadlessTextCompatibility(svg), {
    fitTo,
    font: {
      // Formal export goldens must not depend on whichever fonts happen to be
      // installed on the developer machine or GitHub runner.
      loadSystemFonts: false,
      fontFiles: [...SCHEMATIC_FONTS, ...BUNDLED_FONTS],
      defaultFontFamily: "ICM Schematic",
      sansSerifFamily: "ICM Schematic",
      serifFamily: "DejaVu Serif",
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
  const rasterSvg = source.svg.replace(
    "Georgia,'Times New Roman',serif",
    "DejaVu Serif",
  );
  const rendered = resvg(rasterSvg, { mode: "zoom", value: scale });
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
