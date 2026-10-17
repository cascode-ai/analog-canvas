import { resolveDocumentLogicalNets } from "@icm/derived";
import type { CircuitProject, Instance, StableId } from "@icm/model";
import type { DesignNetlistIR, NetlistFormat } from "@icm/netlist";
import type { SymbolDefinition, SymbolResolver } from "@icm/symbols";

import { toRnlPoint, type RnlPoint } from "./place.js";
import { rnlName } from "./rnl-name.js";
import { symbolShapes, type RnlShape } from "./shapes.js";
import { RNL_SYMBOLS, rnlSymbolFor } from "./symbol-map.js";
import { plainLines, rnlTextLines, type RnlRun } from "./text.js";

/** A pin of a symbol an edit transaction defines (language standard 9.2.4). */
export interface RnlSymbolPin {
  /** Its terminal: a port's name, or a number where the port has none. */
  terminals: (number | string)[];
  at: RnlPoint;
  direction?: "right" | "up" | "left" | "down";
  /** The pin's name as shown, for display only. */
  label?: { lines: RnlRun[][] };
}

/** A symbol an edit transaction defines, in its own frame (9.2). */
export interface RnlSymbolDefinition {
  /** `%name` in a Cell's own level, `$name` in the file level. */
  name: string;
  box: [number, number, number, number];
  pins: RnlSymbolPin[];
  prims: RnlShape[];
}

const DIRECTION = {
  west: "left",
  east: "right",
  north: "up",
  south: "down",
} as const;

/**
 * For a block with no RNL symbol of its own — a drawn Cell or an external
 * subcircuit — the terminal each pin connects: its port's position in the
 * printed `.subckt`, whose ports RNL reads from the netlist.
 */
export function blockTerminals(
  instance: Instance,
  project: CircuitProject,
  ir: DesignNetlistIR,
): ((pin: string) => number | undefined) | undefined {
  const binding = instance.netlist?.binding;
  if (binding?.kind === "subcircuit") {
    const child = project.documents.find(
      (document) => document.id === binding.childDocumentId,
    );
    const printed = ir.cells.find(
      (cell) => cell.id === binding.childDocumentId,
    );
    if (!child || !printed) return undefined;
    // A printed port is keyed by its logical Net; the block's pin by its Cell Pin.
    const logical = resolveDocumentLogicalNets(child);
    return (pin) => {
      const terminal = child.netlist?.terminals.find(
        (item) => item.name === pin,
      );
      const net = terminal && logical.byBaseNetId.get(terminal.netId)?.id;
      const index = printed.ports.findIndex(
        (port) => port.id === net || (!net && port.name === pin),
      );
      return index < 0 ? undefined : index + 1;
    };
  }
  if (binding?.kind === "external-subcircuit") {
    const master = ir.externalMasters?.find(
      (item) => item.id === binding.definitionId,
    );
    if (!master) return undefined;
    return (pin) => {
      const index = master.terminals.findIndex((item) => item.name === pin);
      return index < 0 ? undefined : index + 1;
    };
  }
  return undefined;
}

/**
 * A block's Analog Canvas symbol as RNL defines it: its outline and leads,
 * and a pin for each port, labelled with the port's name as the block shows
 * it. Null when its artwork has a shape RNL cannot take yet.
 */
function definedSymbol(
  name: string,
  definition: SymbolDefinition,
  terminal: (pin: string) => number | string | undefined,
): RnlSymbolDefinition | null {
  const prims = symbolShapes(definition.primitives);
  if (!prims) return null;
  const taken = new Set<number | string>();
  const pins = definition.pins.flatMap((pin): RnlSymbolPin[] => {
    const key = terminal(pin.name);
    // A port has one pin (9.2.4); a pin no port prints draws nothing.
    if (key === undefined || taken.has(key)) return [];
    taken.add(key);
    const shown =
      pin.presentation.showName !== false &&
      pin.presentation.visibility === "visible";
    const label = pin.presentation.nameContent
      ? rnlTextLines(pin.presentation.nameContent).lines
      : plainLines(pin.presentation.displayName ?? pin.name);
    return [
      {
        terminals: [key],
        at: toRnlPoint(pin.at),
        direction: DIRECTION[pin.direction],
        ...(shown ? { label: { lines: label } } : {}),
      },
    ];
  });
  const { x, y, width, height } = definition.viewBox;
  const [left, top] = toRnlPoint({ x, y });
  const [right, bottom] = toRnlPoint({ x: x + width, y: y + height });
  return { name, box: [left, bottom, right, top], pins, prims };
}

/**
 * The symbols of the blocks the printed Cells place. A drawn Cell's goes in
 * its own level, where `# @SET-SYMBOL` makes it how every call is drawn
 * (9.2.6); its pins name the printed ports. An external subcircuit has no
 * level in the file, so its symbol goes in the file level, where every Cell
 * sees it (6.8), and each call sets it; its pins number the ports. A name
 * the standard or Analog Canvas package already has takes a number.
 */
export function blockSymbols(
  project: CircuitProject,
  ir: DesignNetlistIR,
  resolver: SymbolResolver,
  format: NetlistFormat = "spice",
): {
  cells: Map<StableId, RnlSymbolDefinition>;
  externals: Map<StableId, RnlSymbolDefinition>;
} {
  const cells = new Map<StableId, RnlSymbolDefinition>();
  const externals = new Map<StableId, RnlSymbolDefinition>();
  const names = new Set(RNL_SYMBOLS.map((symbol) => symbol.symbol));
  const unique = (name: string) => {
    let candidate = name;
    for (let count = 2; names.has(rnlName("$", candidate)); count++)
      candidate = `${name}_${count}`;
    names.add(rnlName("$", candidate));
    return rnlName("$", candidate);
  };
  for (const cell of ir.cells) {
    const document = project.documents.find((item) => item.id === cell.id);
    for (const instance of document?.instances ?? []) {
      // A call drawn with a mapped symbol, such as a PDK MOS, is no block.
      if (rnlSymbolFor(instance.symbolId, instance.symbolVariantId)) continue;
      const binding = instance.netlist?.binding;
      const definition = resolver.resolve(instance.symbolId)?.definition;
      const terminalOf = blockTerminals(instance, project, ir);
      if (!definition || !terminalOf) continue;
      if (
        binding?.kind === "subcircuit" &&
        !cells.has(binding.childDocumentId)
      ) {
        const printed = ir.cells.find(
          (item) => item.id === binding.childDocumentId,
        )!;
        const symbol = definedSymbol(
          rnlName("%", `${printed.name}_SYMBOL`),
          definition,
          (pin) => {
            const index = terminalOf(pin);
            if (index === undefined) return undefined;
            // A Spectre netlist escapes a port's other characters (`Vin\+`);
            // the pin shows the name it means.
            const name = printed.ports[index - 1]!.name;
            return format === "spectre" ? name.replace(/\\(.)/gu, "$1") : name;
          },
        );
        if (symbol) cells.set(binding.childDocumentId, symbol);
      }
      if (
        binding?.kind === "external-subcircuit" &&
        !externals.has(binding.definitionId)
      ) {
        const master = ir.externalMasters!.find(
          (item) => item.id === binding.definitionId,
        )!;
        const symbol = definedSymbol(
          unique(`${master.name}_SYMBOL`),
          definition,
          terminalOf,
        );
        if (symbol) externals.set(binding.definitionId, symbol);
      }
    }
  }
  return { cells, externals };
}
