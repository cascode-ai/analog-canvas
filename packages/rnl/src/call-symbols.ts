import type { DesignNetlistInstance, DesignNetlistNode } from "@icm/netlist";
import { builtInSymbols } from "@icm/symbols";

import { toRnlPoint } from "./place.js";
import type { RnlSymbol } from "./symbol-map.js";

const DIRECTION = { east: 0, north: 90, west: 180, south: 270 } as const;

/** The local symbols drawing a call in its own terminal order start so. */
export const CALL_SYMBOL_PREFIX = "$CANVAS_CALL_";

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
  const artwork = builtInSymbols.find((symbol) => symbol.id === row.ac);
  if (!artwork) return row;
  const position = (acPin: string) =>
    call.nodes.findIndex((node) => pinOf(node) === acPin) + 1;
  const placed = row.pins.map((pin) => ({ pin, at: position(pin.acPin) }));
  // A pin the call does not print stays as the library draws it.
  if (placed.some(({ at }) => at === 0)) return row;
  if (placed.every(({ pin, at }) => pin.terminal === at)) return row;
  const order = call.nodes.map(
    (_, index) => placed.find(({ at }) => at === index + 1)?.pin.terminal ?? 0,
  );
  const variant = row.variant ? `_${row.variant}` : "";
  return {
    ...row,
    symbol: `${CALL_SYMBOL_PREFIX}${`${row.ac}${variant}`.toUpperCase().replaceAll("-", "_")}__${order.join("_")}`,
    inline: true,
    package: "",
    orient: "R0",
    offset: [0, 0],
    terminals: call.nodes.map((node, index) => ({
      n: index + 1,
      name: node.pinName,
      drawn: order[index] !== 0,
    })),
    pins: placed.map(({ pin, at }) => {
      const own = artwork.pins.find((item) => item.name === pin.acPin)!;
      return {
        ...pin,
        terminal: at,
        at: toRnlPoint(own.at),
        dir: DIRECTION[own.direction],
      };
    }),
    undrawnPins: row.undrawnPins.flatMap((pin) => {
      const at = position(pin.acPin);
      return at ? [{ ...pin, terminal: at }] : [];
    }),
    acNetlistOrder: null,
  };
}
