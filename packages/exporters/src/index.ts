import type { Rect, SchematicDocument } from "@icm/model";
import { renderDocumentSvg } from "@icm/render-svg";
import type { SvgRenderOptions } from "@icm/render-svg";
import type { SymbolResolver } from "@icm/symbols";

export const EXPORT_VERSION = "0.1";
export const DEFAULT_EXPORT_SCALE = 3;
/** Roughly one canonical 1.6-unit wire width around formal file exports. */
export const DEFAULT_FORMAL_EXPORT_MARGIN = 2;

export interface FormalExportSource {
  svg: string;
  bounds: Rect;
}

export interface RasterExport {
  bytes: Uint8Array;
  width: number;
  height: number;
  mediaType: "image/png";
}

export function createFormalExportSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: Pick<
    SvgRenderOptions,
    "title" | "margin" | "objectIds" | "background"
  > = {},
): FormalExportSource {
  const svg = renderDocumentSvg(document, resolver, {
    ...options,
    margin: options.margin ?? DEFAULT_FORMAL_EXPORT_MARGIN,
  });
  const match = /viewBox="([^"]+)"/u.exec(svg);
  if (!match) throw new Error("Formal SVG has no viewBox");
  const values = match[1]!.split(/\s+/u).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Formal SVG viewBox is invalid");
  }
  const [x, y, width, height] = values as [number, number, number, number];
  return { svg, bounds: { x, y, width, height } };
}

/** One measured source for browser SVG, PNG, PDF, clipboard and Agent files. */
export async function createBrowserFormalExportSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: Parameters<typeof createFormalExportSource>[2] = {},
): Promise<FormalExportSource> {
  const source = createFormalExportSource(document, resolver, options);
  const { measureFormalExportSource } = await import("./browser-bounds.js");
  return measureFormalExportSource(
    source,
    options.margin ?? DEFAULT_FORMAL_EXPORT_MARGIN,
  );
}

export function safeExportBaseName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/giu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .toLowerCase();
  return normalized || "schematic";
}
