import {
  bindsProjectCell,
  deviceDescriptor,
  drawnSwitchControl,
  matchGateCellPins,
} from "@icm/devices";
import {
  type ComponentDefinition,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, createHierarchicalBlockSymbol } from "@icm/symbols";

import { callSymbolFromDefinition } from "./call-symbols.js";
import {
  composeOrient,
  inverseOrient as inverse,
  type RnlOrient,
} from "./orientation.js";
import { RNL_SYMBOLS, type RnlSymbol } from "./symbol-map.js";
import { matchesInlineRnlSymbol } from "./inline-symbols.js";
import {
  type RnlSymbolRef,
  type RnlSymbolDefinitionView,
  type RnlObjectView,
  acPoint,
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

/** What closes a switch Analog Canvas draws: the phase its label names, its CTRL pin, or a chopper's clock. */
export const switchControl = (symbolId: string) => {
  const definition = deviceDescriptor(symbolId);
  return definition ? drawnSwitchControl(definition) : null;
};

/** Whether a part is clocked by the phase its label names, as switches and choppers are. */
export const clockedByLabel = (instance: Pick<Instance, "symbolId">) => {
  const control = switchControl(instance.symbolId);
  return control === "phase" || control === "chopper";
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
): ReturnType<typeof acSymbolFor> {
  if (switchControl(instance.symbolId) !== "pin") return null;
  const found = acSymbolFor(symbol, orient, instance, ["1", "2"]);
  return found?.row.ac && switchControl(found.row.ac) === "phase"
    ? found
    : null;
}

/**
 * The Library gate a Cell's call reads back as when RNL draws it with the
 * call symbol the export defines for it (`symbolForCall`), or with the
 * standard package's own gate where the call prints its pins in that
 * symbol's terminal order, and the gate pin each Pin of its Cell becomes: by
 * name, as a gate meets its Cell (#1450), and only when each drawn pin is on
 * the position that Pin is printed at.
 */
export function gateCallSymbol(
  symbol: RnlSymbolRef,
  orient: RnlOrient,
  instance: Pick<Instance, "netlist" | "importProvenance">,
): {
  row: RnlSymbol;
  orient: RnlOrient;
  pins: ReadonlyMap<string, string>;
} | null {
  const row =
    callSymbolFromDefinition(symbol) ??
    RNL_SYMBOLS.find(
      (item) =>
        !item.inline &&
        !item.definition &&
        item.symbol === symbol.name &&
        family(item.package) === family(symbol.package),
    );
  if (
    !row?.ac ||
    !bindsProjectCell(row.ac) ||
    instance.netlist?.binding?.kind !== "subcircuit"
  )
    return null;
  const printed = [...(instance.importProvenance?.terminalMapping ?? [])].sort(
    (a, b) => a.sourcePosition - b.sourcePosition,
  );
  if (printed.length !== row.terminals.length) return null;
  const gate = matchGateCellPins(row.ac, {
    name: symbol.name,
    portNames: printed.map((terminal) => terminal.pinName),
  });
  if (!gate?.ok) return null;
  const pins = new Map(gate.pins.map((pin) => [pin.portName, pin.pinName]));
  const fits = row.pins.every((pin) => {
    const terminal = printed.find(
      (item) => item.sourcePosition === pin.terminal - 1,
    );
    return terminal && pins.get(terminal.pinName) === pin.acPin;
  });
  return fits
    ? { row, orient: composeOrient(orient, inverse(row.orient)), pins }
    : null;
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
  const pinPlacements = definition.pins.flatMap((pin) => {
    const key = pin.terminals[0] ?? "";
    const terminal = /^\d+$/u.test(key)
      ? terminals[Number(key) - 1]
      : terminals.find((item) => item.name.toLowerCase() === key.toLowerCase());
    const side = pin.dir === null ? undefined : SIDE[pin.dir];
    if (!terminal || !side) {
      exact = false;
      return [];
    }
    const { x, y } = acPoint(pin.at);
    const along = side === "east" || side === "west" ? y : x;
    if (onGrid(along) !== along) exact = false;
    return [{ terminalId: terminal.id, side, offset: onGrid(along) }];
  });
  const body = definition.prims.find(
    (prim) =>
      prim.shape === "rectangle" &&
      prim.points.length === 1 &&
      prim.points[0]![0] === 0 &&
      prim.points[0]![1] === 0,
  );
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
 * A Cell's block drawn as its symbol in the file draws it, where that is lines
 * and no box: the block keeps its generated pins, each where the file has it,
 * and takes the lines as its artwork. Null for any other symbol, which the
 * Cell's block layout draws.
 */
export function cellArtwork(
  cell: SchematicDocument,
  definition: RnlSymbolDefinitionView,
): ComponentDefinition | null {
  if (!definition.prims.length) return null;
  if (definition.prims.some((prim) => prim.shape !== "line")) return null;
  const block = createHierarchicalBlockSymbol(cell);
  const terminals = cell.netlist?.terminals ?? [];
  if (!block) return null;
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
    const side = drawn?.dir === null ? undefined : SIDE[drawn?.dir ?? -1];
    if (!drawn || !side) return pin;
    return {
      ...pin,
      at: acPoint(drawn.at),
      direction: side,
      presentation: { ...pin.presentation, showName: Boolean(drawn.label) },
    };
  });
  const primitives = definition.prims.map((prim) => {
    const points = prim.points.map(acPoint);
    const [first, last] = [points[0]!, points.at(-1)!];
    if (points.length === 2)
      return { kind: "line" as const, from: first, to: last };
    return points.length > 3 && first.x === last.x && first.y === last.y
      ? {
          kind: "polygon" as const,
          points: points.slice(0, -1),
          fill: "none" as const,
          stroke: "foreground" as const,
        }
      : {
          kind: "path" as const,
          data: points
            .map(({ x, y }, index) => `${index ? "L" : "M"} ${x} ${y}`)
            .join(" "),
          style: {
            lineCap: "butt" as const,
            lineJoin: "miter" as const,
            strokeRole: "normal" as const,
          },
        };
  });
  return { symbol: { ...block, pins, primitives } } as ComponentDefinition;
}
