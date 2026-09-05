import { deriveStableId, projectCellInterface } from "@icm/model";
import type { CircuitProject, SchematicDocument } from "@icm/model";

import { createHierarchicalBlockGeometry } from "./hierarchical-block-geometry.js";
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

export function createHierarchicalBlockSymbol(
  document: Pick<SchematicDocument, "name" | "sourceBinding" | "netlist"> & {
    readonly presentation?: SchematicDocument["presentation"];
  },
): SymbolDefinition | null {
  const cellName = document.sourceBinding?.cellName ?? document.netlist?.name;
  const terminals = projectCellInterface(document.netlist).ports;
  if (!cellName) return null;
  const positional = createHierarchicalBlockGeometry(
    terminals,
    document.presentation?.cellSymbol,
  );
  return SymbolDefinitionSchema.parse({
    ...positional,
    id: hierarchicalSymbolId(cellName),
    name: document.name,
    hierarchicalBlock: true,
    pins: positional.pins,
    variants: [],
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
      const positional = createHierarchicalBlockGeometry(
        definition.terminals.map((terminal) => ({
          id: terminal.id,
          name: terminal.name,
          direction: terminal.direction,
        })),
        definition.presentation,
      );
      return [
        SymbolDefinitionSchema.parse({
          ...positional,
          id: externalSubcircuitSymbolId(definition.id),
          name: definition.name,
          hierarchicalBlock: true,
          pins: positional.pins,
          variants: [],
        }),
      ];
    },
  );
  return [...internal, ...external];
}
