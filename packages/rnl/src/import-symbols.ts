import {
  bindsProjectCell,
  callsClockedSwitchBody,
  deviceDescriptor,
  drawnSwitchControl,
  matchGateCellPins,
} from "@icm/devices";
import {
  type ComponentDefinition,
  type ExternalSubcircuitDefinition,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import {
  builtInSymbols,
  createBlockSymbol,
  createHierarchicalBlockSymbol,
  externalSubcircuitSymbolId,
  type SymbolDefinition,
  type SymbolPrimitive,
} from "@icm/symbols";

import { callSymbolFromDefinition } from "./call-symbols.js";
import {
  composeOrient,
  inverseOrient as inverse,
  type RnlOrient,
} from "./orientation.js";
import { AC_UNITS_PER_RNL_UNIT } from "./place.js";
import { RNL_SYMBOLS, type RnlSymbol } from "./symbol-map.js";
import { matchesInlineRnlSymbol } from "./inline-symbols.js";
import {
  type RnlSymbolRef,
  type RnlSymbolDefinitionView,
  type RnlObjectView,
  acPoint,
  terminalOf,
} from "./rnl-snapshot.js";

/**
 * The Analog Canvas symbol a part RNL draws with `symbol`, turned `orient`,
 * reads back as: of the symbol's rows, the one the file names (`variant`,
 * `$CANVAS_VARIANT`), else the one whose Analog Canvas orientation needs no
 * mirror (an op-amp turned MX is the plain op-amp, unturned the
 * inputs-swapped one), the part's own symbol first, and only a symbol whose
 * pins keep the part's pin names, so its connections stand.
 */
export function acSymbolFor(
  symbol: RnlSymbolRef,
  orient: RnlOrient,
  instance: Pick<Instance, "symbolId"> &
    Partial<Pick<Instance, "importProvenance">>,
  pinNames: readonly string[],
  variant?: string,
): {
  row: RnlSymbol;
  orient: RnlOrient;
  /** The part's pins by the names this symbol gives them, where they differ. */
  pins?: ReadonlyMap<string, string>;
} | null {
  // A terminal the part's own symbol has no pin for, such as a PDK device's
  // substrate, is set as a property: no symbol draws it, its own included.
  const own = builtInSymbols.find((item) => item.id === instance.symbolId);
  const property = (pin: string) =>
    own !== undefined && !own.pins.some((item) => item.name === pin);
  const rows: { row: RnlSymbol; pins?: ReadonlyMap<string, string> }[] =
    RNL_SYMBOLS.flatMap((row) => {
      if (
        row.ac === null ||
        row.symbol !== symbol.name ||
        !(row.inline
          ? symbol.package === null &&
            symbol.level !== null &&
            matchesInlineRnlSymbol(row, symbol.definition)
          : family(row.package) === family(symbol.package))
      )
        return [];
      if (
        pinNames.every(
          (pin) =>
            (row.ac === instance.symbolId && property(pin)) ||
            row.pins.some((item) => item.acPin === pin) ||
            row.undrawnPins.some((item) => item.acPin === pin),
        )
      )
        return [{ row }];
      const pins = positionalPins(row, instance);
      return pins ? [{ row, pins }] : [];
    });
  const ranked = rows
    .map((found) => ({
      ...found,
      orient: composeOrient(orient, inverse(found.row.orient)),
    }))
    .sort(
      (a, b) =>
        Number(a.row.ac !== variant) - Number(b.row.ac !== variant) ||
        Number(a.orient.startsWith("M")) - Number(b.orient.startsWith("M")) ||
        Number(a.pins !== undefined) - Number(b.pins !== undefined) ||
        Number(a.row.ac !== instance.symbolId) -
          Number(b.row.ac !== instance.symbolId),
    );
  return ranked[0] ?? null;
}

/**
 * A part's pins as a symbol of the same kind of device names them, by the
 * terminal each is printed at, as RNL binds pins (9.2.4): the netlist import
 * names a capacitor's 1 and 2 where a varactor's are P1 and P2. Only where
 * that symbol's own netlist order prints each pin at the same place, so the
 * netlist stays the same; null otherwise.
 */
function positionalPins(
  row: RnlSymbol,
  instance: Pick<Instance, "symbolId"> &
    Partial<Pick<Instance, "importProvenance">>,
): ReadonlyMap<string, string> | null {
  const printed = instance.importProvenance?.terminalMapping;
  const target = row.ac ? deviceDescriptor(row.ac) : undefined;
  const source = deviceDescriptor(instance.symbolId);
  if (
    !printed?.length ||
    !target ||
    !source ||
    target.deviceClass !== source.deviceClass ||
    target.pinOrder.length !== printed.length
  )
    return null;
  const names = new Map<string, string>();
  for (const { sourcePosition, pinName } of printed) {
    const pin = [...row.pins, ...row.undrawnPins].find(
      (item) => item.terminal === sourcePosition + 1,
    );
    if (!pin || target.pinOrder[sourcePosition] !== pin.acPin) return null;
    names.set(pinName, pin.acPin);
  }
  return new Set(names.values()).size === names.size ? names : null;
}

/**
 * A source drawn with another source's symbol, as an RNL solver draws an AC
 * source with the sine source's, keeps the waveform its card gives: where
 * the card names none, the new symbol's own default would stand in for it,
 * so the part states the one it had (rich-netlist/rnl-gallery's examples).
 */
export function keepSourceWaveform(
  instance: Pick<Instance, "symbolId" | "netlist">,
  before: string,
): void {
  const had = deviceDescriptor(before)?.sourceWaveformDefault;
  const now = deviceDescriptor(instance.symbolId)?.sourceWaveformDefault;
  const parameters = instance.netlist?.parameters;
  if (!had || !now || had === now || !parameters) return;
  if (Object.keys(parameters).some((name) => name.toLowerCase() === "waveform"))
    return;
  parameters["waveform"] = had;
}

/** What closes a switch Analog Canvas draws: the phase its label names, its CTRL pin, or a chopper's or SPDT's clock. */
export const switchControl = (symbolId: string) => {
  const definition = deviceDescriptor(symbolId);
  return definition ? drawnSwitchControl(definition) : null;
};

/** Whether a part is clocked by the phase its label names, as switches, choppers and SPDTs are. */
export const clockedByLabel = (instance: Pick<Instance, "symbolId">) => {
  const control = switchControl(instance.symbolId);
  return control === "phase" || callsClockedSwitchBody(control);
};

/**
 * The symbol of a switch the netlist import brought in with a CTRL pin that
 * RNL draws as one its label clocks: every switch Analog Canvas draws prints
 * the same card, so only the drawing says which it was.
 */
export function phaseSwitchSymbol(
  symbol: RnlSymbolRef,
  orient: RnlOrient,
  instance: Pick<Instance, "symbolId">,
  variant?: string,
): ReturnType<typeof acSymbolFor> {
  if (switchControl(instance.symbolId) !== "pin") return null;
  const found = acSymbolFor(symbol, orient, instance, ["1", "2"], variant);
  return found?.row.ac && switchControl(found.row.ac) === "phase"
    ? found
    : null;
}

/**
 * The Library part (a gate, an op-amp) a Cell's call reads back as when RNL
 * draws it with the call symbol the export defines for it (`symbolForCall`)
 * or with a standard symbol of that part, as an RNL solver draws an op-amp
 * Cell's call with `$OPAMP`, and the part's pin each Pin of its Cell
 * becomes: by name, as a part meets its Cell (#1450), and only when each pin
 * the symbol draws is bound to the terminal the call prints that Pin at, so
 * every wire stays on its net. Of a symbol two variants draw, the one the
 * file names (`$CANVAS_VARIANT`), else the one that needs no mirror.
 */
export function gateCallSymbol(
  symbol: RnlSymbolRef,
  orient: RnlOrient,
  instance: Pick<Instance, "netlist" | "importProvenance">,
  drawn: RnlObjectView["pins"],
  variant?: string,
): {
  row: RnlSymbol;
  orient: RnlOrient;
  pins: ReadonlyMap<string, string>;
} | null {
  if (instance.netlist?.binding?.kind !== "subcircuit") return null;
  const own = callSymbolFromDefinition(symbol);
  const rows = own
    ? [own]
    : RNL_SYMBOLS.filter(
        (item) =>
          !item.inline &&
          !item.definition &&
          item.symbol === symbol.name &&
          family(item.package) === family(symbol.package),
      );
  const printed = [...(instance.importProvenance?.terminalMapping ?? [])].sort(
    (a, b) => a.sourcePosition - b.sourcePosition,
  );
  // The printed terminal the drawn pin at a symbol's pin is bound to.
  const printedAt = ([x, y]: readonly [number, number]) => {
    const pin = drawn.find(
      (item) => item.local_at?.[0] === x && item.local_at?.[1] === y,
    );
    const terminal =
      pin?.terminals.length === 1 ? terminalOf(pin.terminals[0]!) : null;
    return terminal
      ? printed.find((item) => item.sourcePosition === terminal.n - 1)
      : undefined;
  };
  const found = rows.flatMap((row) => {
    if (!row.ac || !bindsProjectCell(row.ac)) return [];
    const gate = matchGateCellPins(row.ac, {
      name: symbol.name,
      portNames: printed.map((terminal) => terminal.pinName),
    });
    if (!gate?.ok || drawn.length !== row.pins.length) return [];
    const pins = new Map(gate.pins.map((pin) => [pin.portName, pin.pinName]));
    const fits = row.pins.every((pin) => {
      const terminal = printedAt(pin.at);
      return terminal && pins.get(terminal.pinName) === pin.acPin;
    });
    return fits
      ? [{ row, orient: composeOrient(orient, inverse(row.orient)), pins }]
      : [];
  });
  return (
    found.sort(
      (a, b) =>
        Number(a.row.ac !== variant) - Number(b.row.ac !== variant) ||
        Number(a.orient.startsWith("M")) - Number(b.orient.startsWith("M")),
    )[0] ?? null
  );
}

/**
 * The standard package and its parts are one family: a build may bring them
 * as one file, as the toolkit's preview does, and their names never clash.
 */
export const family = (name: string | null) =>
  name?.startsWith("rnl-std") ? "rnl-std" : name;

/**
 * A part's colour as its record writes it (`@SET-STYLE`): its line colour is
 * the Instance's foreground, as the export writes it.
 */
export function paintOf(
  object: RnlObjectView,
): { styleOverride: { foreground: string } } | Record<string, never> {
  const linecolor = object.style?.["linecolor"];
  return typeof linecolor === "string" && /^#[0-9a-f]{6}$/iu.test(linecolor)
    ? { styleOverride: { foreground: linecolor } }
    : {};
}

export type CellSymbol = NonNullable<
  SchematicDocument["presentation"]["cellSymbol"]
>;

/** Analog Canvas's block pins and bodies keep to its 10-unit grid. */
const onGrid = (value: number) => Math.round(value / 10) * 10 + 0;

/** The side of a block a pin leaving at `dir` degrees stands on. */
const SIDE: Readonly<Record<number, "east" | "north" | "west" | "south">> = {
  0: "east",
  90: "north",
  180: "west",
  270: "south",
};

/**
 * The side of a block a pin leaves by: its direction, or, for a pin that
 * writes none (9.2.4), the side of the symbol's box it stands nearest, left
 * and right before top and bottom.
 */
function sideOf(
  pin: RnlSymbolDefinitionView["pins"][number],
  box: RnlSymbolDefinitionView["box"],
): "east" | "north" | "west" | "south" | undefined {
  if (pin.dir !== null) return SIDE[pin.dir];
  const [x1, y1, x2, y2] = box;
  const [x, y] = pin.at;
  const distances = [
    ["west", Math.abs(x - Math.min(x1, x2))],
    ["east", Math.abs(x - Math.max(x1, x2))],
    ["north", Math.abs(y - Math.max(y1, y2))],
    ["south", Math.abs(y - Math.min(y1, y2))],
  ] as const;
  return distances.reduce((best, next) => (next[1] < best[1] ? next : best))[0];
}

/** A rectangle centred on a symbol's origin: the body a block's layout draws. */
const isBlockBody = (prim: RnlSymbolDefinitionView["prims"][number]) =>
  prim.shape === "rectangle" &&
  prim.points.length === 1 &&
  prim.points[0]![0] === 0 &&
  prim.points[0]![1] === 0;

/**
 * A Cell's block layout from the symbol the file defines for it: each pin on
 * the side it leaves by, at its distance along that side, and the body the
 * symbol's centred rectangle draws. Exact for a block Analog Canvas wrote; a
 * symbol drawn otherwise, or off the grid, comes in as the nearest box.
 */
export function cellSymbolOf(
  child: SchematicDocument,
  definition: RnlSymbolDefinitionView,
): { cellSymbol: CellSymbol; exact: boolean } {
  const terminals = child.netlist?.terminals ?? [];
  let exact = true;
  // A block has one pin per terminal and one per slot: a symbol that draws
  // a terminal again (an IO ring's ground on every pad) keeps its first.
  const placedTerminals = new Set<string>();
  const slots = new Set<string>();
  const pinPlacements = definition.pins.flatMap((pin) => {
    const key = pin.terminals[0] ?? "";
    const terminal = /^\d+$/u.test(key)
      ? terminals[Number(key) - 1]
      : terminals.find((item) => item.name.toLowerCase() === key.toLowerCase());
    const side = sideOf(pin, definition.box);
    if (!terminal || !side) {
      exact = false;
      return [];
    }
    const { x, y } = acPoint(pin.at);
    const along = side === "east" || side === "west" ? y : x;
    if (onGrid(along) !== along) exact = false;
    const slot = `${side}:${onGrid(along)}`;
    if (placedTerminals.has(terminal.id) || slots.has(slot)) {
      exact = false;
      return [];
    }
    placedTerminals.add(terminal.id);
    slots.add(slot);
    return [{ terminalId: terminal.id, side, offset: onGrid(along) }];
  });
  const body = definition.prims.find(isBlockBody);
  const width = onGrid(Number(body?.params?.["width"]) * 10);
  const height = onGrid(Number(body?.params?.["height"]) * 10);
  if (!body || !(width > 0) || !(height > 0)) exact = false;
  return {
    cellSymbol: {
      pinPlacements,
      ...(body && width > 0 && height > 0
        ? { minimumBodySize: { width, height } }
        : {}),
    },
    exact,
  };
}

/**
 * A Cell's block drawn as its symbol in the file draws it, where that has no
 * box (a rectangle centred on its origin, as a block's layout draws its
 * body): the block keeps its generated pins, each where the file has it,
 * and takes the shapes as its artwork, as the export writes an author's
 * (`cellSymbol.artwork`, a Circuit Component's). Null for any other symbol,
 * or one with a shape Analog Canvas does not draw in a symbol, which the
 * Cell's block layout draws.
 */
export function cellArtwork(
  cell: SchematicDocument,
  definition: RnlSymbolDefinitionView,
): ComponentDefinition | null {
  if (!definition.prims.length) return null;
  if (definition.prims.some(isBlockBody)) return null;
  const block = createHierarchicalBlockSymbol(cell);
  return block
    ? blockArtwork(block, cell.netlist?.terminals ?? [], definition, false)
    : null;
}

/**
 * An external subcircuit's block drawn as the symbol the file defines for
 * it (the export defines one in the file level for every call): its
 * generated pins, each where the file has it, and the file's artwork, its
 * box included. Null where the artwork has a shape Analog Canvas does not
 * draw in a symbol (an ellipse), which leaves the generated block.
 */
export function externalArtwork(
  definition: ExternalSubcircuitDefinition,
  drawn: RnlSymbolDefinitionView,
): ComponentDefinition | null {
  if (!drawn.prims.length) return null;
  const block = createBlockSymbol({
    id: externalSubcircuitSymbolId(definition.id),
    name: definition.name,
    terminals: definition.terminals,
    presentation: definition.presentation,
  });
  return blockArtwork(block, definition.terminals, drawn, drawn.box_written);
}

/**
 * A generated block with the pins and artwork of a symbol the file defines:
 * each pin the file draws where it draws it (by terminal number or name),
 * the others where the block has them; the box the file writes, where
 * `box` says to take it.
 */
function blockArtwork(
  block: SymbolDefinition,
  terminals: readonly { name: string }[],
  definition: RnlSymbolDefinitionView,
  box: boolean,
): ComponentDefinition | null {
  const primitives = symbolPrimitives(definition.prims);
  if (!primitives) return null;
  const pins = block.pins.map((pin) => {
    const drawn = definition.pins.find((item) => {
      const key = item.terminals[0] ?? "";
      const terminal = /^\d+$/u.test(key)
        ? terminals[Number(key) - 1]
        : terminals.find(
            (candidate) => candidate.name.toLowerCase() === key.toLowerCase(),
          );
      return terminal?.name === pin.name;
    });
    const side = drawn && sideOf(drawn, definition.box);
    if (!drawn || !side) return pin;
    return {
      ...pin,
      at: acPoint(drawn.at),
      direction: side,
      presentation: { ...pin.presentation, showName: Boolean(drawn.label) },
    };
  });
  const [x1, y1, x2, y2] = definition.box;
  const [a, b] = [acPoint([x1, y1]), acPoint([x2, y2])];
  const viewBox = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
  return {
    symbol: {
      ...block,
      pins,
      primitives,
      ...(box && viewBox.width > 0 && viewBox.height > 0 ? { viewBox } : {}),
    },
  } as ComponentDefinition;
}

/**
 * A three-point arc (9.2.5), from `a` through `m` to `b`, as an SVG path's
 * circular arc, with the bounds of the curve; null for three points on a
 * line, which make no circle.
 */
function arcPath(
  a: { x: number; y: number },
  m: { x: number; y: number },
  b: { x: number; y: number },
): SymbolPrimitive | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return null;
  const square = (p: { x: number; y: number }) => p.x * p.x + p.y * p.y;
  const cx =
    (square(a) * (m.y - b.y) +
      square(m) * (b.y - a.y) +
      square(b) * (a.y - m.y)) /
    d;
  const cy =
    (square(a) * (b.x - m.x) +
      square(m) * (a.x - b.x) +
      square(b) * (m.x - a.x)) /
    d;
  const round = (value: number) => Math.round(value * 1e6) / 1e6 + 0;
  const radius = Math.hypot(a.x - cx, a.y - cy);
  // The arc through m is the long way round where m sees the chord at an
  // acute angle; it turns the way a, m, b turn.
  const large = (a.x - m.x) * (b.x - m.x) + (a.y - m.y) * (b.y - m.y) > 0;
  const sweep = (m.x - a.x) * (b.y - a.y) - (m.y - a.y) * (b.x - a.x) > 0;
  const start = Math.atan2(a.y - cy, a.x - cx);
  let turn = Math.atan2(b.y - cy, b.x - cx) - start;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  if (!sweep && turn > 0) turn -= 2 * Math.PI;
  const samples = Array.from({ length: 33 }, (_, index) => {
    const angle = start + (turn * index) / 32;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
  const xs = samples.map((point) => point.x);
  const ys = samples.map((point) => point.y);
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  return {
    kind: "path",
    data: `M ${a.x} ${a.y} A ${round(radius)} ${round(radius)} 0 ${Number(large)} ${Number(sweep)} ${b.x} ${b.y}`,
    bounds: {
      x: round(left),
      y: round(top),
      width: round(Math.max(...xs) - left),
      height: round(Math.max(...ys) - top),
    },
    style: { lineCap: "butt", lineJoin: "miter", strokeRole: "normal" },
  };
}

/**
 * A symbol's graphics as Analog Canvas primitives: a line of two points as
 * a line, a closed one as an outline, any other as a path; a rectangle as
 * its outline; a circle; a Bézier as a path of cubic legs; an arc as a path
 * of its circular arc. A filled shape is filled with the foreground, an
 * unstroked one draws no line. Null where a shape has no such primitive (an
 * ellipse).
 */
function symbolPrimitives(
  prims: RnlSymbolDefinitionView["prims"],
): SymbolPrimitive[] | null {
  const primitives: SymbolPrimitive[] = [];
  const xy = ({ x, y }: { x: number; y: number }) => `${x} ${y}`;
  const path = (
    points: readonly { x: number; y: number }[],
    cubic: boolean,
  ) => {
    const [start, ...rest] = points;
    const legs: string[] = [];
    if (cubic)
      for (let index = 0; index < rest.length; index += 3)
        legs.push(
          `C ${xy(rest[index]!)} ${xy(rest[index + 1]!)} ${xy(rest[index + 2]!)}`,
        );
    else for (const point of rest) legs.push(`L ${xy(point)}`);
    return {
      kind: "path" as const,
      data: [`M ${xy(start!)}`, ...legs].join(" "),
      style: {
        lineCap: "butt" as const,
        lineJoin: "miter" as const,
        strokeRole: "normal" as const,
      },
    };
  };
  for (const prim of prims) {
    const points = prim.points.map(acPoint);
    const filled =
      prim.params["fill"] !== undefined && prim.params["fill"] !== "none";
    const stroked = prim.style["linestyle"] !== "none";
    const paint = {
      fill: filled ? ("foreground" as const) : ("none" as const),
      stroke: stroked ? ("foreground" as const) : ("none" as const),
    };
    const [first, last] = [points[0], points.at(-1)];
    if (!first || !last) return null;
    if (prim.shape === "line") {
      if (points.length === 2)
        primitives.push({ kind: "line", from: first, to: last });
      else if (points.length > 3 && first.x === last.x && first.y === last.y)
        primitives.push({
          kind: "polygon",
          points: points.slice(0, -1),
          ...paint,
        });
      else primitives.push(path(points, false));
    } else if (prim.shape === "rectangle") {
      const width = Number(prim.params["width"]) * AC_UNITS_PER_RNL_UNIT;
      const height = Number(prim.params["height"]) * AC_UNITS_PER_RNL_UNIT;
      if (!(width > 0) || !(height > 0)) return null;
      const [left, right] = [first.x - width / 2, first.x + width / 2];
      const [top, bottom] = [first.y - height / 2, first.y + height / 2];
      primitives.push({
        kind: "polygon",
        points: [
          { x: left, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        ...paint,
      });
    } else if (prim.shape === "circle") {
      const radius = Number(prim.params["radius"]) * AC_UNITS_PER_RNL_UNIT;
      if (!(radius > 0)) return null;
      primitives.push({
        kind: "circle",
        center: first,
        radius,
        ...paint,
      });
    } else if (prim.shape === "bezier" && points.length % 3 === 1)
      primitives.push(path(points, true));
    else if (prim.shape === "arc" && points.length === 3 && !filled) {
      const arc = arcPath(first, points[1]!, last);
      if (!arc) return null;
      primitives.push(arc);
    } else return null;
  }
  return primitives;
}
