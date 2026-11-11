import { type SchematicDocument } from "@icm/model";
import type { Snapshot } from "@rich-netlist/runtime";

import { type RnlOrient } from "./orientation.js";
import { AC_UNITS_PER_RNL_UNIT } from "./place.js";

export type Junction = SchematicDocument["junctions"][number];

/**
 * The rnl runtime's snapshot
 * (https://github.com/rich-netlist/rnl/blob/main/crates/rnl-view/README.md#snapshots):
 * the host circuit to check against and the model to draw from. Scene
 * coordinates, y up; ids written as RNL writes them.
 */
export type RnlSnapshot = Snapshot;

export type RnlLevelSnapshot = Snapshot["levels"][number];

export type LevelModel = NonNullable<RnlLevelSnapshot["model"]>;

export type Point = readonly [number, number];

export function hasCanvasTypesetting(model: LevelModel) {
  return model.objects.some(
    (object) =>
      object.kind === "usage" && object.definition === "$CANVAS_TYPESETTING",
  );
}

export type RnlShapeView = LevelModel["shapes"][number];

export type RnlSymbolRef = LevelModel["symbols"][number];

export type RnlSymbolDefinitionView = NonNullable<RnlSymbolRef["definition"]>;

export type RnlObjectView = LevelModel["objects"][number];

export type RnlSnapshotVertex = LevelModel["wires"][number]["via"][number];

export type RnlTextView = LevelModel["texts"][number];

/**
 * The name an RNL id names, without its prefix (`#M1` → `M1`), quotes
 * undone (`&"vdd!"` → `vdd!`); null for an id that is not a plain name,
 * such as a statement's place.
 */
export function rnlIdName(id: string, prefix: string): string | null {
  if (!id.startsWith(prefix)) return null;
  const name = id.slice(prefix.length);
  if (name.startsWith('"')) {
    const end = name.lastIndexOf('"');
    return end > 0 ? name.slice(1, end).replaceAll('""', '"') : null;
  }
  return /^[^\s:@]+$/u.test(name) ? name : null;
}

/** An RNL terminal id, `#M1:3`, as its instance's name and terminal number. */
export function terminalOf(id: string): { name: string; n: number } | null {
  const colon = id.lastIndexOf(":");
  const name = colon > 0 ? rnlIdName(id.slice(0, colon), "#") : null;
  const n = Number(id.slice(colon + 1));
  return name && Number.isInteger(n) && n > 0 ? { name, n } : null;
}

/** A scene point as an Analog Canvas point: ten units to one, y down. */
export const acPoint = ([x, y]: Point) => ({
  x: Math.round(x * AC_UNITS_PER_RNL_UNIT * 1e6) / 1e6 + 0,
  y: Math.round(-y * AC_UNITS_PER_RNL_UNIT * 1e6) / 1e6 + 0,
});

export const isOrient = (value: string | null): value is RnlOrient =>
  value !== null &&
  ["R0", "R90", "R180", "R270", "MX", "MY", "MXR90", "MYR90"].includes(value);

/**
 * How near two points are the same, in Analog Canvas units: RNL keeps
 * coordinates to a millionth of its unit, ten of Analog Canvas's.
 */
export const NEAR = 1e-3;

/** Analog Canvas grids: a part's place, and a wire's corner or junction. */
export const PART_GRID = 10;

export const CORNER_GRID = 2;
