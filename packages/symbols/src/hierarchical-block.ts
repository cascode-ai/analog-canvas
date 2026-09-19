import {
  deriveStableId,
  projectCellInterface,
  semanticTextDocument,
} from "@icm/model";
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
    pins: positional.pins.map((pin) => ({
      ...pin,
      presentation: {
        ...pin.presentation,
        nameContent:
          layout.terminals.find((terminal) => terminal.name === pin.name)
            ?.nameContent ?? semanticTextDocument(pin.name, "formal-port"),
      },
    })),
    id: layout.id,
    name: layout.name,
    hierarchicalBlock: true,
    variants: [],
  });
}

type CellSymbolSource = Pick<SchematicDocument, "netlist"> &
  Partial<Pick<SchematicDocument, "annotations">>;

/** Same representative declaration as the effective interface, including its authored format. */
export function projectCellSymbolTerminals(
  document: CellSymbolSource,
): HierarchicalBlockTerminal[] {
  return projectCellInterface(document.netlist).ports.map((port) => {
    const terminal = document.netlist!.terminals.find(
      (item) => item.id === port.id,
    )!;
    const annotation = document.annotations?.find(
      (item) =>
        (item.binding?.kind === "cell-terminal-name" &&
          item.binding.terminalId === port.id) ||
        (!item.binding &&
          (item.id === terminal.interfaceAnnotationId ||
            (item.kind === "instance-label" &&
              item.anchor.kind === "object" &&
              terminal.interfaceInstanceIds.includes(item.anchor.objectId)))),
    );
    return {
      ...port,
      nameContent:
        annotation?.formatOverride ??
        (!annotation?.binding ? annotation?.content : undefined) ??
        semanticTextDocument(port.name, "formal-port"),
    };
  });
}

export function createHierarchicalBlockSymbol(
  document: Pick<SchematicDocument, "name" | "sourceBinding" | "netlist"> & {
    readonly presentation?: SchematicDocument["presentation"];
    readonly annotations?: SchematicDocument["annotations"];
  },
): SymbolDefinition | null {
  // The current netlist name is the local Cell identity. sourceBinding keeps
  // import provenance and intentionally does not change when the local Cell is
  // renamed, so it must not select the runtime symbol identity.
  const cellName = document.netlist?.name;
  const terminals = projectCellSymbolTerminals(document);
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
