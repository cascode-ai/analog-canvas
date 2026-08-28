import { jsPDF } from "jspdf";

import type { FormalExportSource, RasterExport } from "./index.js";
import { DEFAULT_EXPORT_SCALE, EXPORT_VERSION } from "./index.js";
import { normalizeFormalSvgForSvg2Pdf } from "./svg2pdf-compat.js";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Browser could not rasterize SVG"));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Browser could not encode PNG"));
    }, "image/png");
  });
}

export async function rasterizeFormalSvgInBrowser(
  source: FormalExportSource,
  scale = DEFAULT_EXPORT_SCALE,
): Promise<RasterExport> {
  const width = Math.max(1, Math.round(source.bounds.width * scale));
  const height = Math.max(1, Math.round(source.bounds.height * scale));
  const svgUrl = URL.createObjectURL(
    new Blob([source.svg], { type: "image/svg+xml" }),
  );
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const bytes = new Uint8Array(
      await (await canvasBlob(canvas)).arrayBuffer(),
    );
    return { bytes, width, height, mediaType: "image/png" };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
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

/**
 * Converts the canonical formal SVG into a vector PDF in the browser. This is
 * deliberately separate from PNG rasterization: PDF paths and text are
 * emitted by svg2pdf, while PNG remains the explicit raster artifact.
 */
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

export async function exportFormalArtifactsInBrowser(
  source: FormalExportSource,
): Promise<{ png: RasterExport; pdf: Uint8Array }> {
  const png = await rasterizeFormalSvgInBrowser(source);
  return { png, pdf: await vectorizeFormalSvgInBrowser(source) };
}
