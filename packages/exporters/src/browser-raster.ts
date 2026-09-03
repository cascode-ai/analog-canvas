import type { FormalExportSource, RasterExport } from "./index.js";
import { DEFAULT_EXPORT_SCALE } from "./index.js";

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

/** Rasterizes the canonical formal SVG without loading the PDF toolchain. */
export async function rasterizeFormalSvgInBrowser(
  source: FormalExportSource,
  scale = DEFAULT_EXPORT_SCALE,
  options: {
    background?: "white" | "transparent";
    maxPixels?: number;
    maxDimension?: number;
  } = {},
): Promise<RasterExport> {
  const width = Math.max(1, Math.round(source.bounds.width * scale));
  const height = Math.max(1, Math.round(source.bounds.height * scale));
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width > (options.maxDimension ?? 16384) ||
    height > (options.maxDimension ?? 16384) ||
    width * height > (options.maxPixels ?? 64_000_000)
  ) {
    throw new Error(
      "Image is too large to rasterize safely; select fewer objects or use SVG",
    );
  }
  let canvas: HTMLCanvasElement | undefined;
  const svgUrl = URL.createObjectURL(
    new Blob([source.svg], { type: "image/svg+xml" }),
  );
  try {
    const image = await loadImage(svgUrl);
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    if (options.background !== "transparent") {
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const bytes = new Uint8Array(
      await (await canvasBlob(canvas)).arrayBuffer(),
    );
    return { bytes, width, height, mediaType: "image/png" };
  } finally {
    URL.revokeObjectURL(svgUrl);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
