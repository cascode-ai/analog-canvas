import type { DesignNetlistInstance, DesignNetlistNode } from "@icm/netlist";
import { builtInSymbols, relocatedPin } from "@icm/symbols";

import { matchesInlineRnlSymbol } from "./inline-symbols.js";
import { toRnlPoint } from "./place.js";
import type { RnlSymbolRef } from "./rnl-snapshot.js";
import { RNL_SYMBOLS, type RnlSymbol } from "./symbol-map.js";

const DIRECTION = { east: 0, north: 90, west: 180, south: 270 } as const;

/** The local symbols drawing a call in its own terminal order start so. */
const CALL_SYMBOL_PREFIX = "$CANVAS_CALL_";

/** The part of a call symbol's name that names the library symbol. */
const callSymbolHead = (row: RnlSymbol) =>
  `${CALL_SYMBOL_PREFIX}${`${row.ac}${row.variant ? `_${row.variant}` : ""}`.toUpperCase().replaceAll("-", "_")}__`;

/**
 * `row`'s artwork with each drawn terminal on the position `order` gives it:
 * for each position of the call, the library terminal drawn there, 0 for
 * none. `names` and `undrawnPins` use the call's printed positions.
 */
function callSymbol(
  row: RnlSymbol,
  order: readonly number[],
  names: readonly string[],
  undrawnPins: RnlSymbol["undrawnPins"],
): RnlSymbol | null {
  const artwork = builtInSymbols.find((symbol) => symbol.id === row.ac);
  if (!artwork) return null;
  const variant = row.variant
    ? artwork.variants.find((candidate) => candidate.id === row.variant)
    : undefined;
  const at = (terminal: number) => order.indexOf(terminal) + 1;
  const pins = row.pins.map((pin) => {
    // Where the variant draws it: the wide chopper's corners (#2170).
    const own =
      relocatedPin(variant, pin.acPin) ??
      artwork.pins.find((item) => item.name === pin.acPin);
    return own
      ? {
          ...pin,
          terminal: at(pin.terminal),
          at: toRnlPoint(own.at),
          dir: DIRECTION[own.direction],
        }
      : null;
  });
  if (pins.some((pin) => !pin || pin.terminal === 0)) return null;
  return {
    ...row,
    symbol: `${callSymbolHead(row)}${order.join("_")}`,
    inline: true,
    package: "",
    orient: "R0",
    offset: [0, 0],
    terminals: order.map((terminal, index) => ({
      n: index + 1,
      name: names[index] ?? String(index + 1),
      drawn: terminal !== 0,
    })),
    pins: pins as RnlSymbol["pins"],
    undrawnPins,
    acNetlistOrder: null,
  };
}

/**
 * The symbol that draws `row`'s artwork on this call. The export binds a
 * package symbol's pins to a call's terminals by their positions in the
 * row's terminal order (`@SET-SYMBOL(terminals=…)`, 11.3), so a library
 * symbol fits a call only when each pin's Analog Canvas pin is printed at the
 * pin's terminal number. A call that prints them elsewhere,
 * such as a gate's or a Delay Cell's Cell whose ports start with its
 * supplies, binds each pin to the position it is printed at. Straight art
 * gets a symbol defined in the file, whose name records the call's terminal
 * order. Diagonal art keeps the package symbol and binds its pins by name.
 */
export function symbolForCall(
  row: RnlSymbol,
  call: DesignNetlistInstance,
  /** The Analog Canvas pin a printed terminal stands for. */
  pinOf: (node: DesignNetlistNode) => string | undefined = (node) =>
    node.canvasPinName ?? node.pinName,
): RnlSymbol {
  if (row.definition || !row.ac) return row;
  const position = (acPin: string) =>
    call.nodes.findIndex((node) => pinOf(node) === acPin) + 1;
  const placed = row.pins.map((pin) => ({ pin, at: position(pin.acPin) }));
  // A pin the call does not print stays as the library draws it.
  if (placed.some(({ at }) => at === 0)) return row;
  if (placed.every(({ pin, at }) => pin.terminal === at)) return row;
  const order = call.nodes.map(
    (_, index) => placed.find(({ at }) => at === index + 1)?.pin.terminal ?? 0,
  );
  const undrawnPins = row.undrawnPins.flatMap((pin) => {
    const terminal = position(pin.acPin);
    return terminal ? [{ ...pin, terminal }] : [];
  });
  if (row.baseRotation) {
    // Keep the package's diagonal artwork. The exporter can bind these pins
    // by name to the positions the call actually prints.
    return {
      ...row,
      terminals: call.nodes.map((node, index) => {
        const terminal = order[index] ?? 0;
        return {
          n: index + 1,
          name: row.terminals[terminal - 1]?.name ?? node.pinName,
          drawn: terminal !== 0,
        };
      }),
      pins: placed.map(({ pin, at }) => ({ ...pin, terminal: at })),
      undrawnPins,
    };
  }
  return (
    callSymbol(
      row,
      order,
      call.nodes.map((node) => node.pinName),
      undrawnPins,
    ) ?? row
  );
}

/**
 * The library symbol a call symbol of the file draws, rebuilt from its name
 * and kept only when its artwork and positional pins are exactly the ones
 * the export writes: the name alone is a hint, not evidence. Null for any
 * other symbol, or an edited one.
 */
export function callSymbolFromDefinition(
  symbol: RnlSymbolRef,
): RnlSymbol | null {
  if (
    symbol.package !== null ||
    symbol.level === null ||
    !symbol.name.startsWith(CALL_SYMBOL_PREFIX) ||
    !symbol.definition
  )
    return null;
  for (const row of RNL_SYMBOLS) {
    if (row.definition || !row.ac || row.importOnly || row.baseRotation)
      continue;
    const head = callSymbolHead(row);
    if (!symbol.name.startsWith(head)) continue;
    const order = symbol.name.slice(head.length).split("_").map(Number);
    if (order.some((terminal) => !Number.isInteger(terminal))) continue;
    const candidate = callSymbol(row, order, [], []);
    if (candidate && matchesInlineRnlSymbol(candidate, symbol.definition))
      return candidate;
  }
  return null;
}
