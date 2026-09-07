import { strToU8, zipSync } from "fflate";

export type SimulationPlotExportFormat = "svg" | "png";

export interface SimulationPlotDownload {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
  readonly plotCount: number;
}

const PRESENTATION_PROPERTIES = [
  "color",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
] as const;

function safeName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "plot"
  );
}

function dimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0)
    return { width: viewBox.width, height: viewBox.height };
  const bounds = svg.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(bounds.width || 760)),
    height: Math.max(1, Math.round(bounds.height || 395)),
  };
}

/** Serialize the currently visible plot with its computed presentation. */
export function standaloneSimulationPlotSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sourceElements = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  const clonedElements = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  for (let index = 0; index < sourceElements.length; index++) {
    const source = sourceElements[index];
    const target = clonedElements[index];
    if (!source || !target) continue;
    // Definitions and structural containers do not paint content themselves.
    // Copying their inherited fill would turn the standalone image black.
    if (source.closest("defs") || source.matches("svg, g")) continue;
    const computed = getComputedStyle(source);
    for (const property of PRESENTATION_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  }
  clone
    .querySelectorAll(".ac-trace-hit, .ac-cursor-hit")
    .forEach((element) => element.remove());
  clone.querySelectorAll<SVGElement>(".ac-frame").forEach((element) => {
    // The live frame is transparent. Give the standalone artifact an explicit
    // background because SVG-to-Canvas otherwise resolves `fill: none` to the
    // inherited default in Chromium and produces a black plot panel.
    element.setAttribute("fill", "white");
    element.style.setProperty("fill", "white");
  });
  const size = dimensions(svg);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(size.width));
  clone.setAttribute("height", String(size.height));
  const background = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "white");
  clone.insertBefore(background, clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The exported SVG could not be rasterized"));
    };
    image.src = url;
  });
}

async function pngBytes(
  svg: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const image = await loadSvgImage(svg);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas export is unavailable");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("The PNG encoder returned no data");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildVisibleSimulationPlotDownload(
  root: HTMLElement,
  format: SimulationPlotExportFormat,
): Promise<SimulationPlotDownload | null> {
  const plots = [...root.querySelectorAll<SVGSVGElement>("svg[role='img']")];
  if (!plots.length) return null;
  const entries: { name: string; bytes: Uint8Array }[] = [];
  for (let index = 0; index < plots.length; index++) {
    const plot = plots[index]!;
    const label = plot.getAttribute("aria-label") ?? `Plot ${index + 1}`;
    const name = `${String(index + 1).padStart(2, "0")}-${safeName(label)}.${format}`;
    const svg = standaloneSimulationPlotSvg(plot);
    const size = dimensions(plot);
    entries.push({
      name,
      bytes:
        format === "svg"
          ? strToU8(svg)
          : await pngBytes(svg, size.width, size.height),
    });
  }
  if (entries.length === 1)
    return {
      name: entries[0]!.name,
      type: format === "svg" ? "image/svg+xml" : "image/png",
      bytes: entries[0]!.bytes,
      plotCount: 1,
    };
  return {
    name: `simulation-plots-${format}.zip`,
    type: "application/zip",
    bytes: zipSync(
      Object.fromEntries(entries.map((entry) => [entry.name, entry.bytes])),
      { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") },
    ),
    plotCount: entries.length,
  };
}

export function downloadSimulationPlot(download: SimulationPlotDownload): void {
  const url = URL.createObjectURL(
    new Blob([download.bytes as BlobPart], { type: download.type }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
