import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  planRoutingDeletion,
  type RoutingDeletionSeed,
} from "./routing-deletion-planner.js";

/** GUI and Agent selection deletion share both graph closure and interface ownership. */
export function planCellSelectionDeletion(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingDeletionSeed,
  sequence: number,
) {
  const routing = planRoutingDeletion(document, resolver, seed, sequence);
  const terminalIds = (document.netlist?.terminals ?? [])
    .filter(
      (terminal) =>
        terminal.interfaceInstanceIds.some((id) =>
          seed.instanceIds.includes(id),
        ) ||
        (terminal.interfaceAnnotationId !== undefined &&
          routing.affected.electricalAnnotationIds.includes(
            terminal.interfaceAnnotationId,
          )),
    )
    .map((terminal) => terminal.id);
  return { routing, terminalIds };
}
