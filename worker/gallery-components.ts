import type { CircuitProject } from "@icm/model";
import { getRazaviCatalogEntry } from "@icm/symbols";
import taxonomy from "../config/gallery-taxonomy.json";

/**
 * How big a Gallery circuit is: the parts its top Cell draws — devices,
 * sources, switches, blocks and gates. Ports and supply and ground markers
 * name Nets rather than add parts, so they are left out; a subcircuit block
 * counts once, and drafting objects and parts the sheet does not draw are
 * not counted.
 *
 * Stored with each entry beside the version of this rule, so a changed rule
 * leaves exactly the stale rows for the scheduled refresh to recount.
 */
export const COMPONENT_COUNT_RULE_VERSION = 1;

const NOT_PARTS = new Set(["interface", "power"]);

export function galleryComponentCount(project: CircuitProject): number {
  const top =
    project.documents.find(
      (document) => document.id === project.topDocumentId,
    ) ?? project.documents[0];
  if (!top) return 0;
  return top.instances.filter(
    (instance) =>
      instance.placement !== null &&
      !NOT_PARTS.has(getRazaviCatalogEntry(instance.symbolId)?.category ?? ""),
  ).length;
}

/** One size a reader may filter the wall by, in parts; open above when no max. */
export interface GalleryComponentRange {
  key: string;
  min: number;
  max: number | null;
}

export const GALLERY_COMPONENT_RANGES: readonly GalleryComponentRange[] =
  taxonomy.componentRanges.map((range) => ({
    key: range.key,
    min: "min" in range && typeof range.min === "number" ? range.min : 0,
    max: "max" in range && typeof range.max === "number" ? range.max : null,
  }));

/**
 * The sizes a request names, in the taxonomy's order. Several at once mean
 * any of them; a key this build does not know narrows nothing.
 */
export function requestedComponentRanges(
  value: unknown,
): GalleryComponentRange[] {
  const keys = new Set(
    Array.isArray(value)
      ? value.filter((key): key is string => typeof key === "string")
      : [],
  );
  return GALLERY_COMPONENT_RANGES.filter((range) => keys.has(range.key));
}

/** The SQL test that a row's stored count falls in one of `ranges`. */
export function componentRangeSql(
  column: string,
  ranges: readonly GalleryComponentRange[],
): { sql: string; bindings: number[] } {
  const bindings: number[] = [];
  const tests = ranges.map((range) => {
    bindings.push(range.min);
    if (range.max === null) return `${column} >= ?`;
    bindings.push(range.max);
    return `${column} BETWEEN ? AND ?`;
  });
  return { sql: `(${tests.join(" OR ")})`, bindings };
}
