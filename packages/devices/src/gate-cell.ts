// A Library logic gate implemented by a Cell of its Project (#1450): the gate
// keeps its symbol, and its call goes to the Cell's subcircuit.
import {
  foldNetName,
  projectCellInterface,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";

import type { ParameterOwner } from "./instance-parameters.js";
import { subcircuitDescriptor } from "./registry.js";
import { isLibraryLogicGate } from "./reviewed-external.js";

/** One Pin of the Cell a gate calls, and the gate terminal on it. */
export interface GateCellPin {
  /** The Cell's Pin, as its `.subckt` line spells it. */
  readonly portName: string;
  /** The gate's pin (A, B, Y), or its VDD or VSS terminal. */
  readonly pinName: string;
  readonly supply?: "VDD" | "VSS";
}

export type GateCellPinMatch = {
  /** The Cell's Pins that meet a gate terminal, in the Cell's order. */
  readonly pins: readonly GateCellPin[];
} & (
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The gate's pins the Cell has no Pin for. */
      readonly missing: readonly string[];
      /** The Cell's Pins that are no terminal of the gate. */
      readonly extra: readonly string[];
      readonly message: string;
    }
);

/** A Library gate's pins, then its VDD and VSS terminals. */
export function libraryGateTerminals(
  symbolId: string,
): readonly { readonly pinName: string; readonly supply?: "VDD" | "VSS" }[] {
  if (!isLibraryLogicGate(symbolId)) return [];
  return (subcircuitDescriptor(symbolId)?.ports ?? []).map((port) =>
    port.supply
      ? { pinName: port.supply, supply: port.supply }
      : { pinName: port.pinName },
  );
}

const spokenList = (names: readonly string[]) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * How a Library gate meets the Pins of a Cell that implements it: each of its
 * pins the Pin of that name, and its VDD and VSS terminals the Pins of theirs
 * where the Cell has them, since a Cell may take its supplies globally
 * instead. Names compare as SPICE compares them, without case. Undefined for
 * a symbol that is not a Library gate.
 */
export function matchGateCellPins(
  symbolId: string,
  cell: { readonly name: string; readonly portNames: readonly string[] },
): GateCellPinMatch | undefined {
  const terminals = libraryGateTerminals(symbolId);
  if (!terminals.length) return undefined;
  const byName = new Map(
    terminals.map((terminal) => [foldNetName(terminal.pinName), terminal]),
  );
  const pins: GateCellPin[] = [];
  const extra: string[] = [];
  for (const portName of cell.portNames) {
    const terminal = byName.get(foldNetName(portName));
    if (!terminal) extra.push(portName);
    else pins.push({ portName, ...terminal });
  }
  const signals = terminals.filter((terminal) => !terminal.supply);
  const missing = signals
    .filter((terminal) => !pins.some((pin) => pin.pinName === terminal.pinName))
    .map((terminal) => terminal.pinName);
  if (!missing.length && !extra.length) return { ok: true, pins };
  const plural = (names: readonly string[], one: string, many: string) =>
    names.length > 1 ? many : one;
  const problems = [
    ...(missing.length
      ? [`it has no ${plural(missing, "Pin", "Pins")} ${spokenList(missing)}`]
      : []),
    ...(extra.length
      ? [
          `its ${plural(extra, "Pin", "Pins")} ${spokenList(extra)} ${plural(
            extra,
            "is not one",
            "are not",
          )} of the gate's`,
        ]
      : []),
  ];
  return {
    ok: false,
    pins,
    missing,
    extra,
    message: `Cell ${cell.name} does not fit the ${symbolId}: ${problems.join(", and ")}. Its Pins must be ${spokenList(
      signals.map((terminal) => terminal.pinName),
    )}, in any letter case, and VDD and VSS unless the Cell takes its supplies globally`,
  };
}

/**
 * The Cell a Library gate is bound to, and how the gate meets its Pins.
 * Undefined for any other Instance, or a Cell that is gone.
 */
export function gateCellBinding(
  project: Pick<CircuitProject, "documents">,
  instance: ParameterOwner,
): { cell: SchematicDocument; match: GateCellPinMatch } | undefined {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "subcircuit" || !isLibraryLogicGate(instance.symbolId))
    return undefined;
  const cell = project.documents.find(
    (document) => document.id === binding.childDocumentId,
  );
  if (!cell?.netlist) return undefined;
  const match = matchGateCellPins(instance.symbolId, {
    name: cell.netlist.name,
    portNames: projectCellInterface(cell.netlist).ports.map(
      (port) => port.name,
    ),
  });
  return match && { cell, match };
}
