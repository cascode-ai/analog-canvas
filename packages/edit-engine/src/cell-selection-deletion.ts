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
  // Any segment of a Power Rail deletes the whole rail and the label at its
  // far end, which the selection's own closure never reaches. A label that is
  // a Cell Pin takes its terminal along, so the plan's own removals count.
  const removedTerminalIds = new Set(
    routing.edits.flatMap((edit) =>
      edit.kind === "remove_cell_terminal" ? [edit.terminalId] : [],
    ),
  );
  // Only a Pin label the plan removes takes its terminal along. The movement
  // closure also counts labels that would merely follow: with the last part
  // tapped onto a Power Rail deleted, the whole rail looked internal, its
  // VDD label a follower, and the VDD Pin went while the rail stayed,
  // unnamed and refused (#1312).
  const removedAnnotationIds = new Set(
    routing.edits.flatMap((edit) =>
      edit.kind === "remove_schematic_annotation" ? [edit.annotationId] : [],
    ),
  );
  const terminalIds = (document.netlist?.terminals ?? [])
    .filter(
      (terminal) =>
        removedTerminalIds.has(terminal.id) ||
        terminal.interfaceInstanceIds.some((id) =>
          seed.instanceIds.includes(id),
        ) ||
        (terminal.interfaceAnnotationId !== undefined &&
          removedAnnotationIds.has(terminal.interfaceAnnotationId)),
    )
    .map((terminal) => terminal.id);
  return { routing, terminalIds };
}
