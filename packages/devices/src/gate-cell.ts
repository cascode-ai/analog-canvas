// A Library part with a generated body (logic gate, D flip-flop, Delay Cell,
// op-amp, comparator, signal or analog block, crystal) implemented by a Cell
// or an external definition of its Project: the part keeps its symbol, and
// its call goes to that subcircuit, Pin by name.
import {
  foldNetName,
  projectCellInterface,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
  type SchematicDocument,
} from "@icm/model";

import { DIFFERENTIAL_COMPARATOR_TARGET } from "./ideal-comparator.js";
import { OPAMP_TARGET } from "./ideal-opamp.js";
import type { ParameterOwner } from "./instance-parameters.js";
import { subcircuitDescriptor } from "./registry.js";
import {
  isLibraryLogicGate,
  resolveReviewedExternalBinding,
} from "./reviewed-external.js";

/** The Library D flip-flops, which a Cell implements as it does a gate. */
const CELL_FLIP_FLOPS: ReadonlySet<string> = new Set([
  "d-flip-flop",
  "d-flip-flop-q",
  "d-flip-flop-reset",
]);

/**
 * The Library op-amps and comparators, by the target their symbols name,
 * which a Cell implements as it does a gate (#1878).
 */
const CELL_AMPLIFIERS: ReadonlyMap<string, string> = new Map([
  [OPAMP_TARGET, "op-amp"],
  ["opamp_differential", "op-amp"],
  ["comparator", "comparator"],
  [DIFFERENTIAL_COMPARATOR_TARGET, "comparator"],
]);

const amplifierKind = (symbolId: string) =>
  CELL_AMPLIFIERS.get(subcircuitDescriptor(symbolId)?.target ?? "");

/**
 * Whether a Library symbol keeps its look while a Cell of its Project
 * implements it: every Library part whose call goes to a generated body
 * (#1928).
 */
export function bindsProjectCell(symbolId: string): boolean {
  return subcircuitDescriptor(symbolId) !== undefined;
}

/** What a refusal calls a part a Cell may implement: gate, op-amp, … */
function partKind(symbolId: string): string {
  return CELL_FLIP_FLOPS.has(symbolId)
    ? "flip-flop"
    : symbolId === "delay-cell"
      ? "Delay Cell"
      : isLibraryLogicGate(symbolId)
        ? "gate"
        : (amplifierKind(symbolId) ?? "part");
}

/** One Pin of the Cell a gate calls, and the gate terminal on it. */
export interface GateCellPin {
  /** The Cell's Pin, as its `.subckt` line spells it. */
  readonly portName: string;
  /** The part's pin (A, Y; D, CK, Q; IN+, OUT), or its VDD or VSS terminal. */
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

/** A Library part's pins, then its VDD and VSS terminals. */
export function libraryGateTerminals(
  symbolId: string,
): readonly { readonly pinName: string; readonly supply?: "VDD" | "VSS" }[] {
  if (!bindsProjectCell(symbolId)) return [];
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

/** A Library part's own signal pins as a refusal spells them: IN+, IN- and OUT. */
export function spokenGatePins(symbolId: string): string {
  return spokenList(
    libraryGateTerminals(symbolId)
      .filter((terminal) => !terminal.supply)
      .map((terminal) => terminal.pinName),
  );
}

/**
 * How a Library gate meets the Pins of a Cell that implements it: each of its
 * pins the Pin of that name, and its VDD and VSS terminals the Pins of theirs
 * where the Cell has them, since a Cell may take its supplies globally
 * instead. Names compare as SPICE compares them, without case. Undefined for
 * a symbol no Cell may implement.
 */
export function matchGateCellPins(
  symbolId: string,
  cell: { readonly name: string; readonly portNames: readonly string[] },
): GateCellPinMatch | undefined {
  return matchPartPins(symbolId, cell, { title: "Cell", noun: "Cell" });
}

/**
 * How a Library part meets the ports of an external definition that
 * implements it (#1928), as it meets a Cell's Pins. A definition that names
 * its ports only by position fits no part.
 */
export function matchGateExternalPins(
  symbolId: string,
  definition: Pick<
    ExternalSubcircuitDefinition,
    "name" | "terminals" | "interfaceStatus"
  >,
): GateCellPinMatch | undefined {
  const portNames = definition.terminals.map((terminal) => terminal.name);
  if (definition.interfaceStatus === "declared")
    return matchPartPins(
      symbolId,
      { name: definition.name, portNames },
      { title: "External subcircuit", noun: "subcircuit" },
    );
  if (!libraryGateTerminals(symbolId).length) return undefined;
  return {
    ok: false,
    pins: [],
    missing: libraryGateTerminals(symbolId)
      .filter((terminal) => !terminal.supply)
      .map((terminal) => terminal.pinName),
    extra: portNames,
    message: `External subcircuit ${definition.name} names its ports only by position; name them ${spokenGatePins(symbolId)} to bind the ${symbolId} to it`,
  };
}

function matchPartPins(
  symbolId: string,
  cell: { readonly name: string; readonly portNames: readonly string[] },
  { title, noun }: { readonly title: string; readonly noun: string },
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
          )} of the ${partKind(symbolId)}'s`,
        ]
      : []),
  ];
  return {
    ok: false,
    pins,
    missing,
    extra,
    message: `${title} ${cell.name} does not fit the ${symbolId}: ${problems.join(", and ")}. Its Pins must be ${spokenList(
      signals.map((terminal) => terminal.pinName),
    )}, in any letter case, and VDD and VSS unless the ${noun} takes its supplies globally`,
  };
}

/**
 * The Cell a Library gate or op-amp is bound to, and how it meets its Pins.
 * Undefined for any other Instance, or a Cell that is gone.
 */
export function gateCellBinding(
  project: Pick<CircuitProject, "documents">,
  instance: ParameterOwner,
): { cell: SchematicDocument; match: GateCellPinMatch } | undefined {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "subcircuit" || !bindsProjectCell(instance.symbolId))
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

/**
 * The external definition a Library part is bound to (#1928), and how it
 * meets the definition's ports. Undefined for a reviewed standard cell or PDK
 * device, which its reviewed terminal order maps, for a definition that is
 * gone, and for any other Instance.
 */
export function gateExternalBinding(
  project: Pick<CircuitProject, "externalSubcircuitDefinitions">,
  instance: ParameterOwner,
):
  | { definition: ExternalSubcircuitDefinition; match: GateCellPinMatch }
  | undefined {
  const binding = instance.netlist?.binding;
  if (
    binding?.kind !== "external-subcircuit" ||
    !bindsProjectCell(instance.symbolId)
  )
    return undefined;
  const definition = project.externalSubcircuitDefinitions.find(
    (candidate) => candidate.id === binding.definitionId,
  );
  if (!definition) return undefined;
  if (
    !definition.implementation &&
    resolveReviewedExternalBinding(
      definition.name,
      definition.terminals.map((terminal) => terminal.name),
      instance.symbolId,
    )
  )
    return undefined;
  const match = matchGateExternalPins(instance.symbolId, definition);
  return match && { definition, match };
}

/**
 * The Cell or external definition a Library part is bound to, by its name,
 * and how it meets its Pins (#1450, #1928).
 */
export function libraryPartBinding(
  project: Pick<CircuitProject, "documents" | "externalSubcircuitDefinitions">,
  instance: ParameterOwner,
): { name: string; match: GateCellPinMatch } | undefined {
  const cell = gateCellBinding(project, instance);
  if (cell) return { name: cell.cell.netlist!.name, match: cell.match };
  const external = gateExternalBinding(project, instance);
  return external && { name: external.definition.name, match: external.match };
}
