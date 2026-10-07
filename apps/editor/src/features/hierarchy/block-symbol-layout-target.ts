import { type CircuitProject, type SchematicDocument } from "@icm/model";
import { resolveReviewedLibraryInterface } from "@icm/devices";
import {
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
  projectCellSymbolTerminals,
  type BlockSymbolLayout,
} from "@icm/symbols";

/** Read-only layout projection; persistence remains with the actual definition. */
export interface BlockSymbolLayoutTarget extends BlockSymbolLayout {
  kind: "cell" | "external";
  ownerId: string;
  revision: number;
}

export function localBlockSymbolTarget(
  cell: SchematicDocument,
): BlockSymbolLayoutTarget {
  return {
    kind: "cell",
    ownerId: cell.id,
    revision: cell.revision,
    id: hierarchicalSymbolId(cell.netlist!.name),
    name: cell.name,
    terminals: projectCellSymbolTerminals(cell),
    presentation: cell.presentation.cellSymbol,
  };
}

export function selectedBlockSymbolTarget(
  project: CircuitProject,
  instance: SchematicDocument["instances"][number] | undefined,
): BlockSymbolLayoutTarget | undefined {
  const binding = instance?.netlist?.binding;
  if (binding?.kind === "subcircuit") {
    const cell = project.documents.find(
      (item) => item.id === binding.childDocumentId,
    );
    return cell?.netlist ? localBlockSymbolTarget(cell) : undefined;
  }
  if (binding?.kind !== "external-subcircuit") return undefined;
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.id === binding.definitionId,
  );
  if (!definition) return undefined;
  // Native PDK artwork is not a generic, resizable block, and a standard
  // cell's library interface is not either: a layout would give the
  // definition a presentation, which turns every gate bound to it into a
  // block (#1450).
  if (
    !definition.presentation &&
    !definition.implementation &&
    resolveReviewedLibraryInterface(
      definition.name,
      definition.terminals.map((pin) => pin.name),
    )
  )
    return undefined;
  return {
    kind: "external",
    ownerId: definition.id,
    revision: project.structureRevision,
    id: externalSubcircuitSymbolId(definition.id),
    name: definition.name,
    terminals: definition.terminals,
    presentation: definition.presentation,
  };
}
