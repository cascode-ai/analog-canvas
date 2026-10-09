import dejaVuSansUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import dejaVuSansBoldUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import dejaVuSansBoldObliqueUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url";
import dejaVuSansObliqueUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url";
import { jsPDF } from "jspdf";
import { schematicRoundPeriodFontBase64 } from "@icm/derived";
import metropolisUrl from "../fonts/metropolis/Metropolis-Regular.ttf?url";
import metropolisBoldUrl from "../fonts/metropolis/Metropolis-Bold.ttf?url";
import metropolisItalicUrl from "../fonts/metropolis/Metropolis-RegularItalic.ttf?url";
import metropolisBoldItalicUrl from "../fonts/metropolis/Metropolis-BoldItalic.ttf?url";
import { metropolisGlyphs } from "./metropolis-coverage.generated.js";

import type { FormalExportSource, RasterExport } from "./index.js";
import { EXPORT_VERSION } from "./index.js";
import { rasterizeFormalSvgInBrowser } from "./browser-raster.js";
import {
  normalizeFormalSvgForSvg2Pdf,
  setTextInFamilies,
  type PdfFontStyle,
} from "./svg2pdf-compat.js";

/**
 * Embed the same stack the canvas draws: Metropolis, DejaVu for glyphs it
 * lacks, and the round period. Load only the faces used by this export.
 */
const SCHEMATIC_FAMILY = "ICM Schematic";
const SYMBOL_FAMILY = "ICM Symbols";
const PERIOD_FAMILY = "ICM Round Period";
const periodUrl = `data:font/ttf;base64,${schematicRoundPeriodFontBase64}`;
const SCHEMATIC_FACES: Record<string, Record<PdfFontStyle, string>> = {
  [SCHEMATIC_FAMILY]: {
    normal: metropolisUrl,
    bold: metropolisBoldUrl,
    italic: metropolisItalicUrl,
    bolditalic: metropolisBoldItalicUrl,
  },
  [SYMBOL_FAMILY]: {
    normal: dejaVuSansUrl,
    bold: dejaVuSansBoldUrl,
    italic: dejaVuSansObliqueUrl,
    bolditalic: dejaVuSansBoldObliqueUrl,
  },
  [PERIOD_FAMILY]: {
    normal: periodUrl,
    bold: periodUrl,
    italic: periodUrl,
    bolditalic: periodUrl,
  },
};
const primaryGlyphs = new Set(metropolisGlyphs);
function familyForGlyph(glyph: string): string {
  return glyph === "."
    ? PERIOD_FAMILY
    : primaryGlyphs.has(glyph)
      ? SCHEMATIC_FAMILY
      : SYMBOL_FAMILY;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/**
 * Embed each face in the PDF, and add it to the page for the conversion:
 * svg2pdf measures text in the page to place what follows it, so the page
 * must measure with the face the PDF draws. Returns the page's release.
 */
async function embedSchematicFaces(
  pdf: jsPDF,
  families: ReadonlyMap<string, ReadonlySet<PdfFontStyle>>,
): Promise<() => void> {
  const faces: FontFace[] = [];
  // svg2pdf measures in a text element of its own that names the family,
  // but the scene's stylesheet, once in the page, sets every text element's
  // family; give that element back the family it names.
  const measuring = document.createElement("style");
  measuring.textContent = [...families.keys()]
    .map((family) => `text[font-family="${family}"]{font-family:"${family}"}`)
    .join("");
  const release = () => {
    for (const face of faces) document.fonts.delete(face);
    measuring.remove();
  };
  document.head.append(measuring);
  try {
    for (const [family, styles] of families) {
      const sources = SCHEMATIC_FACES[family];
      if (!sources) throw new Error(`Unknown schematic font ${family}`);
      for (const style of styles) {
        const response = await fetch(sources[style]);
        if (!response.ok) {
          throw new Error(
            `Vector PDF could not load the schematic font (HTTP ${response.status})`,
          );
        }
        const bytes = await response.arrayBuffer();
        const file = `${family}-${style}.ttf`;
        pdf.addFileToVFS(file, base64(new Uint8Array(bytes)));
        pdf.addFont(file, family, style);
        const face = new FontFace(family, bytes, {
          weight: style.startsWith("bold") ? "700" : "400",
          style: style.endsWith("italic") ? "italic" : "normal",
        });
        await face.load();
        document.fonts.add(face);
        faces.push(face);
      }
    }
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

function formalSvgElement(source: FormalExportSource): {
  host: HTMLDivElement;
  svg: SVGSVGElement;
} {
  const template = document.createElement("template");
  template.innerHTML = source.svg;
  const svg = template.content.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("Formal export did not produce an SVG element");
  }

  // svg2pdf reads inherited styles and computed geometry from the live DOM. The
  // formal scene is renderer-generated, not user-supplied SVG, and this hidden
  // host is removed immediately after conversion.
  svg.setAttribute("width", String(source.bounds.width));
  svg.setAttribute("height", String(source.bounds.height));
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;";
  host.append(svg);
  document.body.append(host);
  normalizeFormalSvgForSvg2Pdf(svg);
  return { host, svg };
}

/** Converts the canonical formal SVG into a vector PDF in the browser. */
export async function vectorizeFormalSvgInBrowser(
  source: FormalExportSource,
): Promise<Uint8Array> {
  const widthPoints = source.bounds.width * 0.75;
  const heightPoints = source.bounds.height * 0.75;
  const pdf = new jsPDF({
    orientation: widthPoints > heightPoints ? "landscape" : "portrait",
    unit: "pt",
    format: [widthPoints, heightPoints],
    compress: true,
    precision: 16,
  });
  pdf.setProperties({
    title: "Analog Canvas schematic",
    author: "Analog Canvas",
    creator: `Analog Canvas exporter ${EXPORT_VERSION}`,
  });
  pdf.setCreationDate(new Date("2000-01-01T00:00:00.000Z"));

  const { host, svg } = formalSvgElement(source);
  let releaseFaces = () => {};
  try {
    releaseFaces = await embedSchematicFaces(
      pdf,
      setTextInFamilies(svg, familyForGlyph),
    );
    // svg2pdf's published UMD entry reads browser globals while it is loaded.
    // Loading it only for an actual browser PDF request keeps the exporter
    // module usable in Node-based editor tests and headless tooling.
    const { svg2pdf } = await import("svg2pdf.js");
    await svg2pdf(svg, pdf, {
      x: 0,
      y: 0,
      width: widthPoints,
      height: heightPoints,
      loadExternalStyleSheets: false,
      loadImages: false,
    });
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    releaseFaces();
    host.remove();
  }
}

/** Backward-compatible combined export for callers that explicitly need both. */
export async function exportFormalArtifactsInBrowser(
  source: FormalExportSource,
): Promise<{ png: RasterExport; pdf: Uint8Array }> {
  const png = await rasterizeFormalSvgInBrowser(source);
  return { png, pdf: await vectorizeFormalSvgInBrowser(source) };
}
