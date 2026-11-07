import type { CircuitProject } from "@icm/model";
import { builtInSymbols } from "@icm/symbols";

import type { ProjectComponentInsertCandidate } from "./insert-component-dialog";

const BUILT_IN_SYMBOL_IDS = new Set(builtInSymbols.map((symbol) => symbol.id));

/**
 * The Project's own components, for Insert to offer under their own names.
 * A Project keeps a copy of each built-in definition it uses, and the
 * Library's own tile already places that copy (a Project's definition comes
 * first), so a used Resistor is not offered twice. An external subcircuit's
 * symbol is offered as that subcircuit.
 */
export function projectComponentInsertCandidates(
  project: Pick<
    CircuitProject,
    "componentDefinitions" | "externalSubcircuitDefinitions"
  >,
): ProjectComponentInsertCandidate[] {
  return (project.componentDefinitions ?? [])
    .filter(
      (definition) =>
        !BUILT_IN_SYMBOL_IDS.has(definition.symbol.id) &&
        !project.externalSubcircuitDefinitions.some(
          (external) => external.symbolId === definition.symbol.id,
        ),
    )
    .map((definition) => ({ symbol: definition.symbol, definition }));
}
