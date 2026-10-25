import type { DesignNetlistInstance, DesignNetlistNode } from "@icm/netlist";
import { builtInSymbols } from "@icm/symbols";

import { matchesInlineRnlSymbol } from "./inline-symbols.js";
import { toRnlPoint } from "./place.js";
import type { RnlSymbolRef } from "./rnl-import.js";
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
 * none. `names` are the call's terminals as the netlist prints them, and
 * `undrawnAt` the position of a terminal the artwork does not draw.
 */
function callSymbol(
  row: RnlSymbol,
  order: readonly number[],
  names: readonly string[],
  undrawnAt: (acPin: string) => number,
): RnlSymbol | null {
  const artwork = builtInSymbols.find((symbol) => symbol.id === row.ac);
  if (!artwork) return null;
  const at = (terminal: number) => order.indexOf(terminal) + 1;
  const pins = row.pins.map((pin) => {
    const own = artwork.pins.find((item) => item.name === pin.acPin);
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
    undrawnPins: row.undrawnPins.flatMap((pin) => {
      const position = undrawnAt(pin.acPin);
      return position ? [{ ...pin, terminal: position }] : [];
    }),
    acNetlistOrder: null,
  };
}

/**
 * The symbol that draws `row`'s artwork on this call. RNL binds a pin to the
 * terminal at that position of the instance line (language standard 9.2.4),
 * so a library symbol fits a call only when each pin's Analog Canvas pin is
 * printed at the pin's terminal number. A call that prints them elsewhere,
 * such as a gate Cell whose ports start with its supplies, gets the same
 * artwork defined in the file with each pin on the position it is printed
 * at. The name records, for each position of the call, the library terminal
 * there (0 for none), so the same order gives the same symbol.
 */
export function symbolForCall(
  row: RnlSymbol,
  call: DesignNetlistInstance,
  /** The Analog Canvas pin a printed terminal stands for. */
  pinOf: (node: DesignNetlistNode) => string | undefined = (node) =>
    node.canvasPinName ?? node.pinName,
): RnlSymbol {
  if (row.inline || row.definition || !row.ac) return row;
  const position = (acPin: string) =>
    call.nodes.findIndex((node) => pinOf(node) === acPin) + 1;
  const placed = row.pins.map((pin) => ({ pin, at: position(pin.acPin) }));
  // A pin the call does not print stays as the library draws it.
  if (placed.some(({ at }) => at === 0)) return row;
  if (placed.every(({ pin, at }) => pin.terminal === at)) return row;
  const order = call.nodes.map(
    (_, index) => placed.find(({ at }) => at === index + 1)?.pin.terminal ?? 0,
  );
  return (
    callSymbol(
      row,
      order,
      call.nodes.map((node) => node.pinName),
      position,
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
    if (row.inline || row.definition || !row.ac || row.importOnly) continue;
    const head = callSymbolHead(row);
    if (!symbol.name.startsWith(head)) continue;
    const order = symbol.name.slice(head.length).split("_").map(Number);
    if (order.some((terminal) => !Number.isInteger(terminal))) continue;
    const candidate = callSymbol(row, order, [], () => 0);
    if (candidate && matchesInlineRnlSymbol(candidate, symbol.definition))
      return candidate;
  }
  return null;
}
