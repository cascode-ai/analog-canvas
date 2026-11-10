import { deviceDescriptor } from "@icm/devices";
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

/**
 * The devices a Gallery circuit holds, by kind: the parts its top Cell draws
 * and those of each Cell it calls, counted once per call, so a Cell called
 * twice counts twice. A part bound to a Cell is that Cell's parts, not a
 * block; a block with a behavioral body (an op-amp, a gate not bound to a
 * Cell) counts as one block. Ports, supply and ground markers and parts the
 * sheet does not draw are not counted, as for the part count. Its
 * transistors are its MOS, BJT and JFET parts.
 *
 * Kept per entry beside this rule's version (gallery-store-stats.ts), so a
 * changed rule leaves exactly the stale counts for the scheduled pass.
 */
export const DEVICE_COUNT_RULE_VERSION = 2;

export const GALLERY_DEVICE_KINDS = [
  "nmos",
  "pmos",
  "bjt",
  "jfet",
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "source",
  "switch",
  "block",
  "other",
] as const;
export type GalleryDeviceKind = (typeof GALLERY_DEVICE_KINDS)[number];

const SOURCE_CLASSES = new Set([
  "voltage-source",
  "current-source",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
]);
const DIRECT_CLASSES = new Set([
  "bjt",
  "jfet",
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "switch",
]);
const BLOCK_CATEGORIES = new Set(["analog-block", "logic", "signal-flow"]);

export type GalleryDeviceCounts = Partial<Record<GalleryDeviceKind, number>>;

export function galleryDeviceCounts(
  project: CircuitProject,
): GalleryDeviceCounts {
  const counted = new Map<string, GalleryDeviceCounts>();
  const kindOf = (
    instance: CircuitProject["documents"][number]["instances"][number],
  ): GalleryDeviceKind | null => {
    const category = getRazaviCatalogEntry(instance.symbolId)?.category ?? "";
    if (NOT_PARTS.has(category)) return null;
    const descriptor = deviceDescriptor(instance.symbolId, project);
    const deviceClass = descriptor?.deviceClass ?? "";
    if (deviceClass === "net-marker") return null;
    if (deviceClass === "mos")
      return descriptor?.mosBulkClass === "pmos" ? "pmos" : "nmos";
    if (DIRECT_CLASSES.has(deviceClass))
      return deviceClass as GalleryDeviceKind;
    if (SOURCE_CLASSES.has(deviceClass)) return "source";
    return BLOCK_CATEGORIES.has(category) ? "block" : "other";
  };
  const count = (documentId: string): GalleryDeviceCounts => {
    const known = counted.get(documentId);
    if (known !== undefined) return known;
    // A Cell that calls itself, however far down, adds nothing more.
    counted.set(documentId, {});
    const document = project.documents.find((item) => item.id === documentId);
    const total: GalleryDeviceCounts = {};
    const add = (kind: GalleryDeviceKind, amount: number) => {
      if (amount > 0) total[kind] = (total[kind] ?? 0) + amount;
    };
    for (const instance of document?.instances ?? []) {
      if (instance.placement === null) continue;
      const binding = instance.netlist?.binding;
      if (binding?.kind === "subcircuit") {
        for (const [kind, amount] of Object.entries(
          count(binding.childDocumentId),
        ))
          add(kind as GalleryDeviceKind, amount);
        continue;
      }
      const kind = kindOf(instance);
      if (kind) add(kind, 1);
    }
    counted.set(documentId, total);
    return total;
  };
  const top =
    project.documents.find(
      (document) => document.id === project.topDocumentId,
    ) ?? project.documents[0];
  return top ? count(top.id) : {};
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
