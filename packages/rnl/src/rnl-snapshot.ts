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

/** The glyph symbols a Cell Pin is drawn with, whatever usage draws them. */
const PORT_SYMBOLS: ReadonlySet<string> = new Set([
  "$IO_PORT_SYMBOL",
  "$CANVAS_PORT_FILLED",
]);

/**
 * A level as the import reads it, the language 0.4 told in the terms the
 * phases use: a wire's vertex on a pin (`%gnd1::pin`, `#M1::d`) as the
 * usage's role or the instance's terminal that pin binds; a net label drawn
 * with a port's symbol (the export's form of a Cell Pin on a net that is no
 * port) as the port tag it shows; the name of a glyph's net (`netname`) as
 * the glyph's name label; and the texts the file writes: one its style hides
 * (`textvisible=false`) is a hidden label, but a label a package hides
 * (`rnl-std-no-labels`) or a glyph's own net name hidden is none, nor is the
 * centred label of a standard block (`label`), which the editor's symbol
 * draws itself. A bundle (`@BUNDLE`), whose members one symbol
 * draws, is its first member, which Analog Canvas draws for them all: the
 * bundle's place, pins, wires and texts are that member's (`host` still
 * names every member).
 */
export function readableLevel(level: RnlLevelSnapshot): RnlLevelSnapshot {
  const model = level.model;
  if (!model) return level;
  const symbols = new Map(model.symbols.map((symbol) => [symbol.id, symbol]));
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const firstMember = new Map(
    model.objects.flatMap((object) =>
      object.kind === "bundle" && object.host[0]
        ? [[object.id, object.host[0]] as const]
        : [],
    ),
  );
  /** An id or terminal (`%bundle_0:2`) of a bundle as its first member's. */
  const member = (id: string) => {
    const first = firstMember.get(id);
    if (first !== undefined) return first;
    const colon = id.lastIndexOf(":");
    const owner = colon > 0 ? firstMember.get(id.slice(0, colon)) : undefined;
    return owner === undefined ? id : `${owner}${id.slice(colon)}`;
  };
  const vertex = (item: RnlSnapshotVertex): RnlSnapshotVertex => {
    if ("terminal" in item) return { terminal: member(item.terminal) };
    if (!("owner" in item)) return item;
    const owner = objects.get(item.owner);
    const pin =
      owner?.pins.find((candidate) => candidate.index === item.pin) ??
      owner?.pins[item.pin];
    const bound = pin?.terminals[0];
    if (!owner || bound === undefined) return item;
    return owner.kind === "usage"
      ? { usage: owner.id, role: bound }
      : { terminal: member(bound) };
  };
  // A usage attached to a bundle, or to its pin, is attached to its member.
  const attached = (object: RnlObjectView): RnlObjectView =>
    firstMember.size && object.attach
      ? {
          ...object,
          attach: Object.fromEntries(
            Object.entries(object.attach).map(([role, value]) => [
              role,
              typeof value === "string"
                ? member(value)
                : value.map((item) =>
                    typeof item === "string" ? member(item) : item,
                  ),
            ]),
          ) as RnlObjectView["attach"],
        }
      : object;
  return {
    ...level,
    model: {
      ...model,
      objects: model.objects.map((object) =>
        object.kind === "bundle" && object.host[0]
          ? {
              ...object,
              kind: "instance",
              id: object.host[0],
              pins: object.pins.map((pin) => ({
                ...pin,
                terminals: pin.terminals.map(member),
              })),
            }
          : attached(
              object.kind === "usage" &&
                object.definition === "$NET_LABEL" &&
                PORT_SYMBOLS.has(
                  symbols.get(object.symbol.value ?? "")?.name ?? "",
                )
                ? { ...object, definition: "$IO_PORT" }
                : object,
            ),
      ),
      wires: model.wires.map((wire) => ({
        ...wire,
        via: wire.via.map(vertex),
      })),
      texts: model.texts.flatMap((text) => {
        const on = text.attach ? objects.get(text.attach) : undefined;
        // A hidden text the file wrote is a hidden label; one a package's
        // rule hides, or a glyph's own net name hidden (`${p}`), is none.
        if (
          (text.visible === false &&
            (!text.written ||
              (text.key === "netname" && text.markup.value === "${p}"))) ||
          (text.key === "label" &&
            (on?.kind === "instance" || on?.kind === "bundle"))
        )
          return [];
        if (on?.kind === "bundle") return [{ ...text, attach: member(on.id) }];
        return text.key === "netname" && on?.kind === "usage"
          ? [{ ...text, key: "name" }]
          : [text];
      }),
    },
  };
}

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
