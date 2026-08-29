import { jsPDF } from "jspdf";

import type { FormalExportSource, RasterExport } from "./index.js";
import { EXPORT_VERSION } from "./index.js";
import { rasterizeFormalSvgInBrowser } from "./browser-raster.js";
import { normalizeFormalSvgForSvg2Pdf } from "./svg2pdf-compat.js";

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
    title: "Interactive Circuit Maker schematic",
    author: "Interactive Circuit Maker",
    creator: `Interactive Circuit Maker exporter ${EXPORT_VERSION}`,
  });
  pdf.setCreationDate(new Date("2000-01-01T00:00:00.000Z"));

  const { host, svg } = formalSvgElement(source);
  try {
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
