import { deriveStableId, projectCellInterface } from "@icm/model";
import type {
  CellSymbolPresentation,
  CircuitProject,
  SchematicDocument,
} from "@icm/model";

import {
  createHierarchicalBlockGeometry,
  type HierarchicalBlockTerminal,
} from "./hierarchical-block-geometry.js";
import { resolvePdkSymbolMappingForTerminalOrder } from "./pdk-registry.js";
import { SymbolDefinitionSchema } from "./schema.js";
import type { SymbolDefinition } from "./schema.js";

export function hierarchicalSymbolId(cellName: string): string {
  return deriveStableId("hierarchical-symbol", cellName.toLowerCase());
}

/** External symbols are keyed by immutable definition identity, never master spelling. */
export function externalSubcircuitSymbolId(definitionId: string): string {
  return deriveStableId("external-subcircuit-symbol", definitionId);
}

/** Shared generic block artwork contract, independent of its definition owner. */
export interface BlockSymbolLayout {
  id: string;
  name: string;
  terminals: readonly HierarchicalBlockTerminal[];
  presentation?: CellSymbolPresentation | undefined;
}

export function createBlockSymbol(layout: BlockSymbolLayout): SymbolDefinition {
  const positional = createHierarchicalBlockGeometry(
    layout.terminals,
    layout.presentation,
  );
  return SymbolDefinitionSchema.parse({
    ...positional,
    id: layout.id,
    name: layout.name,
    hierarchicalBlock: true,
    variants: [],
  });
}

export function createHierarchicalBlockSymbol(
  document: Pick<SchematicDocument, "name" | "sourceBinding" | "netlist"> & {
    readonly presentation?: SchematicDocument["presentation"];
  },
): SymbolDefinition | null {
  // The current netlist name is the local Cell identity. sourceBinding keeps
  // import provenance and intentionally does not change when the local Cell is
  // renamed, so it must not select the runtime symbol identity.
  const cellName = document.netlist?.name;
  const terminals = projectCellInterface(document.netlist).ports;
  if (!cellName) return null;
  return createBlockSymbol({
    id: hierarchicalSymbolId(cellName),
    name: document.name,
    terminals,
    presentation: document.presentation?.cellSymbol,
  });
}

export function createProjectHierarchicalSymbols(
  project: Pick<CircuitProject, "documents" | "topDocumentId"> &
    Partial<Pick<CircuitProject, "externalSubcircuitDefinitions">>,
  baseDefinitions: readonly SymbolDefinition[] = [],
): SymbolDefinition[] {
  const internal = project.documents.flatMap((document) => {
    // Top is an entry point, not a restriction on Cell reuse. First placement
    // and definition preview must resolve before a caller exists.
    const definition = createHierarchicalBlockSymbol(document);
    return definition ? [definition] : [];
  });
  const external = (project.externalSubcircuitDefinitions ?? []).flatMap(
    (definition) => {
      const mapping = definition.presentation
        ? undefined
        : resolvePdkSymbolMappingForTerminalOrder(
            definition.name,
            definition.terminals.map((terminal) => terminal.name),
          );
      const mappedDefinition = mapping
        ? baseDefinitions.find((candidate) => candidate.id === mapping.symbolId)
        : undefined;
      if (mappedDefinition) {
        const { id: _baseId, name: _baseName, ...artwork } = mappedDefinition;
        return [
          SymbolDefinitionSchema.parse({
            ...artwork,
            id: externalSubcircuitSymbolId(definition.id),
            name: definition.name,
            hierarchicalBlock: true,
          }),
        ];
      }
      return [
        createBlockSymbol({
          id: externalSubcircuitSymbolId(definition.id),
          name: definition.name,
          terminals: definition.terminals,
          presentation: definition.presentation,
        }),
      ];
    },
  );
  return [...internal, ...external];
}
