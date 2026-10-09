// Cells and their callers: creating, renaming, deleting and placing Cells,
// external subcircuit definitions, and a Cell's block symbol.
import type {
  Annotation,
  CellSymbolPresentation,
  CellSymbolSide,
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import { foldNetName, routeEnd } from "@icm/model";
import {
  resolveReviewedExternalBinding,
  resolveReviewedLibraryInterface,
} from "@icm/devices";
import {
  cellSymbolPinSlots,
  externalSubcircuitSymbolId,
  freeHierarchicalBlockOffsets,
  hierarchicalSymbolId,
  placedCellDocumentIds,
  projectCellSymbolTerminals,
  unplacedCellSymbol,
} from "@icm/symbols";
import type { ProjectStructureEdit } from "./project-transaction.js";
import { requireDocument, transactDocument } from "./cell-document-edits.js";

export interface SubcircuitInterfaceProposal {
  readonly source: {
    readonly structureRevision: number;
    readonly documentRevisions: Readonly<Record<string, number>>;
  };
  readonly target: {
    readonly kind: "internal" | "external";
    readonly id: string;
  };
  readonly callers: readonly {
    documentId: string;
    instanceId: string;
  }[];
  readonly diagnostics: readonly string[];
  readonly edits: readonly ProjectStructureEdit[];
}

function interfaceProposal(
  project: CircuitProject,
  target: SubcircuitInterfaceProposal["target"],
  edits: readonly ProjectStructureEdit[],
  diagnostics: readonly string[] = [],
): SubcircuitInterfaceProposal {
  const callers = project.documents.flatMap((document) =>
    document.instances.flatMap((instance) => {
      const binding = instance.netlist?.binding;
      const matches =
        (target.kind === "internal" &&
          binding?.kind === "subcircuit" &&
          binding.childDocumentId === target.id) ||
        (target.kind === "external" &&
          binding?.kind === "external-subcircuit" &&
          binding.definitionId === target.id);
      return matches
        ? [{ documentId: document.id, instanceId: instance.id }]
        : [];
    }),
  );
  return {
    source: {
      structureRevision: project.structureRevision,
      documentRevisions: Object.fromEntries(
        project.documents.map((document) => [document.id, document.revision]),
      ),
    },
    target,
    callers,
    diagnostics,
    edits,
  };
}

/** Build the one canonical subcircuit Instance projection of a child Cell. */
export function createHierarchyInstance(
  id: string,
  child: Pick<SchematicDocument, "id" | "netlist">,
  placement: NonNullable<SchematicDocument["instances"][number]["placement"]>,
  reference = id,
): SchematicDocument["instances"][number] {
  if (!child.netlist) {
    throw new Error(`Cell has no formal interface: ${child.id}`);
  }
  return {
    id,
    symbolId: hierarchicalSymbolId(child.netlist.name),
    reference: reference,
    placement,
    netlist: {
      parameters: {},
      binding: {
        kind: "subcircuit",
        childDocumentId: child.id,
      },
    },
  };
}

/** Build an `X` call to a project-local external interface, without a fake Cell body. */
export function createExternalSubcircuitInstance(
  id: string,
  definition: ExternalSubcircuitDefinition,
  placement: NonNullable<SchematicDocument["instances"][number]["placement"]>,
  reference = id,
): SchematicDocument["instances"][number] {
  const reviewed =
    definition.presentation || definition.implementation
      ? undefined
      : resolveReviewedExternalBinding(
          definition.name,
          definition.terminals.map((terminal) => terminal.name),
        );
  return {
    id,
    symbolId:
      definition.symbolId ??
      reviewed?.symbolId ??
      externalSubcircuitSymbolId(definition.id),
    reference: reference,
    placement,
    netlist: {
      parameters: {},
      binding: { kind: "external-subcircuit", definitionId: definition.id },
    },
  };
}

export function planCreateCell(
  document: SchematicDocument,
): ProjectStructureEdit[] {
  return [{ kind: "add_document", document }];
}

export function planRenameCell(
  project: CircuitProject,
  documentId: string,
  name: string,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (document.name === name) return [];
  return [{ kind: "rename_document", documentId, name }];
}

export function planDeleteCell(
  project: CircuitProject,
  documentId: string,
): ProjectStructureEdit[] {
  requireDocument(project, documentId);
  const caller = project.documents
    .flatMap((parent) =>
      parent.instances.map((instance) => ({ parent, instance })),
    )
    .find(({ instance }) => {
      const binding = instance.netlist?.binding;
      return (
        binding?.kind === "subcircuit" && binding.childDocumentId === documentId
      );
    });
  if (caller) {
    throw new Error(
      `Cell ${documentId} is still referenced by ${caller.parent.id}.${caller.instance.id}`,
    );
  }
  return [{ kind: "remove_document", documentId }];
}

export function planPlaceCellInstance(
  project: CircuitProject,
  parentDocumentId: string,
  instance: SchematicDocument["instances"][number],
  annotations: readonly Annotation[] = [],
): ProjectStructureEdit[] {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "subcircuit") {
    throw new Error(`Instance is not bound to a Cell: ${instance.id}`);
  }
  const child = requireDocument(project, binding.childDocumentId);
  return [
    ...firstPlacementSymbol(project, child),
    transactDocument(project, parentDocumentId, [
      { kind: "add_instance", instance },
      ...annotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    ]),
  ];
}

/**
 * A Cell no parent has placed shows the symbol its first placement keeps:
 * Pins on the side their Ports are drawn on (#1319), and room for top and
 * bottom Pin names (#1327). The first placement stores it, so the block does
 * not change once placed and later Pins never move under wires.
 */
function firstPlacementSymbol(
  project: CircuitProject,
  child: SchematicDocument,
): ProjectStructureEdit[] {
  if (placedCellDocumentIds(project).has(child.id)) return [];
  const next = unplacedCellSymbol(child);
  const current = child.presentation.cellSymbol;
  if (!next || JSON.stringify(next) === JSON.stringify(current)) return [];
  return [
    transactDocument(project, child.id, [
      { kind: "set_cell_symbol_presentation", presentation: next },
    ]),
  ];
}

export function planPlaceExternalSubcircuitInstance(
  project: CircuitProject,
  parentDocumentId: string,
  instance: SchematicDocument["instances"][number],
  annotations: readonly Annotation[] = [],
): ProjectStructureEdit[] {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "external-subcircuit") {
    throw new Error(
      `Instance is not bound to an external subcircuit: ${instance.id}`,
    );
  }
  if (
    !project.externalSubcircuitDefinitions.some(
      (definition) => definition.id === binding.definitionId,
    )
  ) {
    throw new Error(
      `External subcircuit does not exist: ${binding.definitionId}`,
    );
  }
  return [
    transactDocument(project, parentDocumentId, [
      { kind: "add_instance", instance },
      ...annotations.map((annotation) => ({
        kind: "upsert_schematic_annotation" as const,
        annotation,
      })),
    ]),
  ];
}

/** Reviewed library semantics stay fixed through every Project write entrance. */
export function reviewedExternalDefinitionEditIssue(
  previous: ExternalSubcircuitDefinition | undefined,
  definition: ExternalSubcircuitDefinition,
): string | undefined {
  if (
    previous &&
    !previous.implementation &&
    resolveReviewedLibraryInterface(
      previous.name,
      previous.terminals.map((t) => t.name),
    ) &&
    (definition.implementation ||
      definition.name !== previous.name ||
      JSON.stringify(definition.terminals) !==
        JSON.stringify(previous.terminals) ||
      JSON.stringify(definition.formalParameters) !==
        JSON.stringify(previous.formalParameters))
  )
    return "Reviewed PDK interfaces and implementations are fixed. Create a new definition for an explicit model fork.";
  return undefined;
}

export function proposeUpsertExternalSubcircuitDefinition(
  project: CircuitProject,
  definition: ExternalSubcircuitDefinition,
): SubcircuitInterfaceProposal {
  const previous = project.externalSubcircuitDefinitions.find(
    (item) => item.id === definition.id,
  );
  const reviewedIssue = reviewedExternalDefinitionEditIssue(
    previous,
    definition,
  );
  if (reviewedIssue) {
    return interfaceProposal(
      project,
      { kind: "external", id: definition.id },
      [],
      [reviewedIssue],
    );
  }
  // A caller's pins are its reviewed device's, or its gate's behind a
  // standard cell (#1450), else the definition's terminals.
  const allowedPinsFor = (symbolId: string) => {
    const reviewed = definition.implementation
      ? undefined
      : resolveReviewedExternalBinding(
          definition.name,
          definition.terminals.map((terminal) => terminal.name),
          symbolId,
        );
    return new Set(
      (reviewed
        ? reviewed.terminals.map((terminal) => terminal.pinName)
        : definition.terminals.map((terminal) => terminal.name)
      ).map((name) => name.toLowerCase()),
    );
  };
  const diagnostics = project.documents.flatMap((document) =>
    document.instances.flatMap((instance) => {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "external-subcircuit" ||
        binding.definitionId !== definition.id
      ) {
        return [];
      }
      const allowedPins = allowedPinsFor(instance.symbolId);
      const pins = new Set<string>();
      for (const net of document.nets) {
        for (const terminal of net.terminals) {
          if (terminal.instanceId === instance.id) pins.add(terminal.pinName);
        }
      }
      for (const route of document.routes) {
        for (const endpoint of [route.start, routeEnd(route)]) {
          if (
            endpoint.kind === "terminal" &&
            endpoint.instanceId === instance.id
          ) {
            pins.add(endpoint.pinName);
          }
        }
      }
      return [...pins]
        .filter((pinName) => !allowedPins.has(pinName.toLowerCase()))
        .map(
          (pinName) =>
            `${document.id}.${instance.id} references removed external terminal ${pinName}`,
        );
    }),
  );
  return interfaceProposal(
    project,
    { kind: "external", id: definition.id },
    [
      {
        kind: "upsert_external_subcircuit_definition",
        definition,
      },
    ],
    diagnostics,
  );
}

/**
 * Plans one definition-level hierarchy block presentation change. The Project
 * wrapper is deliberate: the changed child Symbol is visible to every caller
 * at the same structural revision, while terminal identities stay unchanged.
 */
export function planSetCellSymbolPresentation(
  project: CircuitProject,
  documentId: string,
  presentation: CellSymbolPresentation | null,
): ProjectStructureEdit[] {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document?.netlist) {
    throw new Error(`Cell does not exist: ${documentId}`);
  }
  return [
    {
      kind: "transact_document",
      documentId,
      expectedRevision: document.revision,
      edits: [{ kind: "set_cell_symbol_presentation", presentation }],
    },
  ];
}

/** A Pin of a Cell's block, by name, and the side it is to stand on. */
export interface CellSymbolPinRequest {
  readonly name: string;
  readonly side: CellSymbolSide;
  /**
   * Along the side from its middle, a multiple of 10. Left out, the Pin
   * stays put on its own side, or takes the first free slot of a new one.
   */
  readonly offset?: number | undefined;
}

/**
 * Arrange a Cell's block Pins by name (#1320). A Pin not named keeps where
 * it stands: the whole current layout is stored (a placed Cell's stored and
 * automatic slots; an unplaced Cell's, the one its first placement would
 * store) and only the named Pins change. A named Pin with no offset stays
 * put when its side does not change; otherwise it takes the first free slot
 * on its side, in the order the block gives automatic slots. Planned through
 * planSetCellSymbolPresentation, so callers keep their Nets and the wiring
 * the change stretches is redrawn clear (#1316).
 */
export function planSetCellSymbolPins(
  project: CircuitProject,
  documentId: string,
  pins: readonly CellSymbolPinRequest[],
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (!document.netlist) throw new Error(`Cell does not exist: ${documentId}`);
  const terminals = projectCellSymbolTerminals(document);
  const now = new Map(
    cellSymbolPinSlots(project, document).map((slot) => [
      slot.terminalId,
      slot,
    ]),
  );
  const nameOf = (terminalId: string) =>
    terminals.find((terminal) => terminal.id === terminalId)?.name ??
    terminalId;
  const asked = new Map<string, CellSymbolPinRequest>();
  for (const pin of pins) {
    const terminal = terminals.find(
      (item) => foldNetName(item.name) === foldNetName(pin.name),
    );
    if (!terminal)
      throw new Error(
        `${document.netlist.name} has no Pin "${pin.name}"; its Pins: ${
          terminals.map((item) => item.name).join(", ") || "none"
        }. Nothing was changed.`,
      );
    if (asked.has(terminal.id))
      throw new Error(
        `Pin ${terminal.name} is named twice. Nothing was changed.`,
      );
    if (
      pin.offset !== undefined &&
      (!Number.isInteger(pin.offset) || pin.offset % 10 !== 0)
    )
      throw new Error(
        `${terminal.name}'s offset ${pin.offset} is not a multiple of 10. Nothing was changed.`,
      );
    asked.set(terminal.id, pin);
  }
  // Who stands where, side by side: the Pins not named first.
  const standing = new Map<string, Map<number, string>>();
  const along = (side: CellSymbolSide) => {
    let offsets = standing.get(side);
    if (!offsets) standing.set(side, (offsets = new Map()));
    return offsets;
  };
  for (const terminal of terminals) {
    const slot = now.get(terminal.id);
    if (!slot || asked.has(terminal.id)) continue;
    if (!along(slot.side).has(slot.offset))
      along(slot.side).set(slot.offset, terminal.id);
  }
  const placed = new Map<string, { side: CellSymbolSide; offset: number }>();
  const stand = (terminalId: string, side: CellSymbolSide, offset: number) => {
    const other = along(side).get(offset);
    if (other !== undefined)
      throw new Error(
        `${nameOf(terminalId)} and ${nameOf(other)} would stand on one slot, ${side} ${offset}. Free on ${side}, in the order a Pin with no offset takes them: ${freeHierarchicalBlockOffsets(
          along(side).keys(),
        )
          .slice(0, 4)
          .join(", ")}. Nothing was changed.`,
      );
    along(side).set(offset, terminalId);
    placed.set(terminalId, { side, offset });
  };
  // An offset given wins its slot; a Pin staying on its side keeps its
  // place; the rest take the first free slot, in the order named.
  for (const [terminalId, pin] of asked)
    if (pin.offset !== undefined) stand(terminalId, pin.side, pin.offset);
  for (const [terminalId, pin] of asked) {
    const slot = now.get(terminalId);
    if (
      pin.offset === undefined &&
      slot?.side === pin.side &&
      !along(pin.side).has(slot.offset)
    )
      stand(terminalId, pin.side, slot.offset);
  }
  for (const [terminalId, pin] of asked) {
    if (placed.has(terminalId)) continue;
    const offset = freeHierarchicalBlockOffsets(along(pin.side).keys())[0];
    if (offset === undefined)
      throw new Error(
        `No free slot on the ${pin.side} side for ${nameOf(terminalId)}. Nothing was changed.`,
      );
    stand(terminalId, pin.side, offset);
  }
  if (
    [...placed].every(([terminalId, slot]) => {
      const before = now.get(terminalId);
      return before?.side === slot.side && before.offset === slot.offset;
    })
  )
    return [];
  const stored = document.presentation.cellSymbol;
  return planSetCellSymbolPresentation(project, documentId, {
    ...(stored?.minimumBodySize
      ? { minimumBodySize: stored.minimumBodySize }
      : {}),
    pinPlacements: terminals.flatMap((terminal) => {
      const slot = placed.get(terminal.id) ?? now.get(terminal.id);
      return slot
        ? [{ terminalId: terminal.id, side: slot.side, offset: slot.offset }]
        : [];
    }),
  });
}
