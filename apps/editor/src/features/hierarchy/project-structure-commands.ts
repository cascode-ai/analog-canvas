import {
  planEditCellTerminalAnnotation,
  planCreateCell,
  planDeleteCell,
  planFormatCellTerminalAnnotations,
  planInstanceDeletion,
  planRemoveCellTerminals,
  planRenameCell,
  planRenameCellTerminal,
  planReorderCellPort,
  planReorderCellTerminal,
  planSetCellSymbolPresentation,
  planUpdateCellTerminalDirection,
  planUpdateCellPortDirection,
  planRenameCellParameter,
  planSetCellParameterDefault,
  planRemoveCellParameter,
  proposeUpsertExternalSubcircuitDefinition,
} from "@icm/edit-engine";
import type { ProjectStructureEdit, SchematicEdit } from "@icm/edit-engine";
import {
  createEmptyDocument,
  createId,
  CircuitProjectSchema,
  semanticTextDocument,
  foldNetName,
  projectCellInterface,
} from "@icm/model";
import type {
  Annotation,
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { BlockSymbolLayoutTarget } from "./block-symbol-layout-target";

type CellDirection = "input" | "output" | "inout" | "passive";
type CellPinSide = "north" | "east" | "south" | "west" | "auto";
export type CellParameterChange =
  | { kind: "rename"; value: string }
  | { kind: "default"; value: string }
  | { kind: "remove" };

export interface ExternalDefinitionResult {
  ok: boolean;
  message: string;
}

export interface ProjectStructureCommandDependencies {
  requestConfirmation?: (request: CellInterfaceConfirmation) => void;
  project: CircuitProject;
  activeDocument: SchematicDocument;
  resolver: SymbolResolver;
  commitStructure: (
    transactionId: string,
    edits: ProjectStructureEdit[],
    activeDocumentId?: string,
  ) => boolean;
  setStatus: (status: string) => void;
  onCellCreated: () => void;
  nextSequence: () => number;
  createDocumentId?: () => string;
}

export interface CellInterfaceConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
  apply(): boolean;
}

/** Confirmation authorizes precisely the immutable Project the user reviewed. */
export function applyConfirmedCellInterfaceEdit(
  request: CellInterfaceConfirmation,
  snapshot: CircuitProject,
  current: CircuitProject,
): boolean {
  if (current !== snapshot)
    throw new Error(
      "Project changed. Repeat the operation to review its current impact.",
    );
  return request.apply();
}

/**
 * Owns behavior-neutral UI commands for formal Project structure. Planners and
 * the Edit Engine remain the semantic authority; this facade normalizes user
 * input, selects transaction names, and projects successful outcomes to UI
 * status without taking ownership of navigation or pointer interaction.
 */
export function createProjectStructureCommands({
  project,
  activeDocument,
  resolver,
  commitStructure,
  setStatus,
  onCellCreated,
  nextSequence,
  createDocumentId = () => createId("document"),
  requestConfirmation,
}: ProjectStructureCommandDependencies) {
  const confirm = (request: CellInterfaceConfirmation): boolean => {
    if (!requestConfirmation) {
      setStatus(request.message);
      return false;
    }
    requestConfirmation(request);
    return true;
  };
  const isMerge = (
    document: SchematicDocument,
    terminalId: string,
    name: string,
  ) => {
    const terminal = document.netlist?.terminals.find(
      (item) => item.id === terminalId,
    );
    return (
      terminal &&
      foldNetName(terminal.name) !== foldNetName(name) &&
      document.netlist!.terminals.some(
        (item) =>
          item.id !== terminalId &&
          foldNetName(item.name) === foldNetName(name),
      )
    );
  };
  const confirmMerge = (name: string, apply: () => boolean) =>
    confirm({
      title: "Merge Cell Ports?",
      confirmLabel: "Merge Ports",
      message: `Merge into ${name}. This electrically joins the Ports and their connected parent networks. Undo restores the change.`,
      apply,
    });
  const commitRemoval = (
    terminalIds: readonly string[],
    apply: () => boolean,
  ) => {
    const removed = new Set(terminalIds);
    const disappearing = projectCellInterface(
      activeDocument.netlist,
    ).ports.filter((port) => port.terminalIds.every((id) => removed.has(id)));
    const names = new Set(disappearing.map((port) => port.name));
    const callers = project.documents.flatMap((parent) =>
      parent.instances
        .filter((instance) => {
          const binding = instance.netlist?.binding;
          return (
            binding?.kind === "subcircuit" &&
            binding.childDocumentId === activeDocument.id &&
            parent.nets.some((net) =>
              net.terminals.some(
                (terminal) =>
                  terminal.instanceId === instance.id &&
                  names.has(terminal.pinName),
              ),
            )
          );
        })
        .map(
          (instance) => `${parent.name}/${instance.reference ?? instance.id}`,
        ),
    );
    return callers.length
      ? confirm({
          title: "Delete connected Cell Ports?",
          confirmLabel: "Delete Ports",
          message: `Delete ${disappearing.map((port) => port.name).join(", ")}. Wires remain disconnected in: ${callers.join(", ")}.`,
          apply,
        })
      : apply();
  };
  const createCell = (inputName: string): void => {
    const name = inputName.trim();
    if (!name) return;
    const child = createEmptyDocument(createDocumentId(), name);
    child.netlist!.name = name;
    child.presentation = structuredClone(activeDocument.presentation);
    if (commitStructure("create-cell", planCreateCell(child), child.id)) {
      onCellCreated();
      setStatus(`Created Cell ${name}`);
    }
  };

  const setTopCell = (documentId: string): boolean => {
    if (documentId === project.topDocumentId) return true;
    const target = project.documents.find(
      (document) => document.id === documentId,
    );
    if (!target) return false;
    const committed = commitStructure("set-top-cell", [
      { kind: "set_top_document", documentId },
    ]);
    if (committed) setStatus(`Default Top: ${target.name}`);
    return committed;
  };

  const renameCell = (documentId: string, inputName: string): void => {
    const target = project.documents.find(
      (candidate) => candidate.id === documentId,
    );
    const name = inputName.trim();
    if (!target || !name || name === target.name) return;
    if (
      commitStructure("rename-cell", planRenameCell(project, documentId, name))
    ) {
      setStatus(`Renamed Cell to ${name}`);
    }
  };

  const deleteCell = (documentId: string): boolean => {
    const target = project.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!target) return false;
    const committed = commitStructure(
      "delete-cell",
      planDeleteCell(project, documentId),
      project.topDocumentId,
    );
    if (committed) setStatus(`Deleted Cell ${target.name}`);
    return committed;
  };

  const updateCellPinDirection = (
    terminalId: string,
    direction: CellDirection,
    targetDocumentId = activeDocument.id,
  ): void => {
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === targetDocumentId,
    );
    if (!targetDocument?.netlist) return;
    if (
      commitStructure(
        "update-cell-pin-direction",
        planUpdateCellTerminalDirection(
          project,
          targetDocumentId,
          terminalId,
          direction,
        ),
      )
    ) {
      setStatus("Updated Cell port direction");
    }
  };

  const updateCellPortDirection = (
    portId: string,
    direction: CellDirection,
    targetDocumentId = activeDocument.id,
  ): void => {
    if (
      commitStructure(
        "update-cell-port-direction",
        planUpdateCellPortDirection(
          project,
          targetDocumentId,
          portId,
          direction,
        ),
      )
    ) {
      setStatus("Updated Cell port direction");
    }
  };

  const renameCellTerminal = (
    terminalId: string,
    inputName: string,
    targetDocumentId = activeDocument.id,
    transactionId = "rename-cell-interface-terminal",
  ): void => {
    const nextName = inputName.trim();
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === targetDocumentId,
    );
    const terminal = targetDocument?.netlist?.terminals.find(
      (candidate) => candidate.id === terminalId,
    );
    if (!terminal || !nextName || terminal.name === nextName) return;
    if (isMerge(targetDocument!, terminalId, nextName)) {
      confirmMerge(nextName, () =>
        commitStructure(
          transactionId,
          planRenameCellTerminal(
            project,
            targetDocumentId,
            terminalId,
            nextName,
            { mergeExistingPort: true },
          ),
        ),
      );
      return;
    }
    try {
      if (
        commitStructure(
          transactionId,
          planRenameCellTerminal(
            project,
            targetDocumentId,
            terminalId,
            nextName,
          ),
        )
      ) {
        setStatus(`Renamed Cell Pin to ${nextName}`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not rename port",
      );
    }
  };

  const editCellTerminalAnnotation = (
    annotation: Annotation,
    inputName: string,
  ): boolean => {
    const interfaceInstanceId =
      annotation.anchor.kind === "object"
        ? annotation.anchor.objectId
        : undefined;
    const terminal = activeDocument.netlist?.terminals.find(
      (candidate) =>
        (annotation.binding?.kind === "cell-terminal-name" &&
          annotation.binding.terminalId === candidate.id) ||
        (interfaceInstanceId !== undefined &&
          candidate.interfaceInstanceIds.includes(interfaceInstanceId)),
    );
    if (!terminal) return false;
    try {
      const {
        content,
        formatOverride,
        binding: _binding,
        ...annotationPresentation
      } = annotation;
      const editedContent = formatOverride ?? content;
      const semanticContent = semanticTextDocument(inputName, "formal-port");
      const normalizedAnnotation: Annotation = {
        ...annotationPresentation,
        binding: {
          kind: "cell-terminal-name",
          terminalId: terminal.id,
        },
        ...(editedContent &&
        JSON.stringify(editedContent) !== JSON.stringify(semanticContent)
          ? { formatOverride: editedContent }
          : {}),
      };
      const renamed = terminal.name !== inputName;
      if (isMerge(activeDocument, terminal.id, inputName)) {
        return confirmMerge(inputName, () =>
          commitStructure(
            "merge-cell-pin-label",
            planEditCellTerminalAnnotation(
              project,
              activeDocument.id,
              terminal.id,
              normalizedAnnotation,
              inputName,
              { mergeExistingPort: true },
            ),
          ),
        );
      }
      const edits = planEditCellTerminalAnnotation(
        project,
        activeDocument.id,
        terminal.id,
        normalizedAnnotation,
        inputName,
      );
      if (edits.length === 0) {
        setStatus(`Cell Pin ${terminal.name} is already current`);
        return true;
      }
      const committed = commitStructure("edit-cell-pin-label", edits);
      if (committed) {
        setStatus(
          renamed
            ? `Renamed Cell Pin to ${inputName}`
            : `Formatted Cell Pin ${inputName}`,
        );
      }
      return committed;
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not rename port",
      );
      return false;
    }
  };

  const formatCellTerminalAnnotations = (
    targetDocumentId = activeDocument.id,
  ): void => {
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === targetDocumentId,
    );
    if (!targetDocument) return;
    const hasPortLabels = targetDocument.annotations.some(
      (annotation) => annotation.binding?.kind === "cell-terminal-name",
    );
    if (!hasPortLabels) {
      setStatus("This Cell has no Port labels");
      return;
    }
    const edits = planFormatCellTerminalAnnotations(project, targetDocumentId);
    if (edits.length === 0) {
      setStatus("All Port labels already use the standard format");
      return;
    }
    if (commitStructure("format-cell-port-labels", edits)) {
      setStatus("Formatted all Port labels");
    }
  };

  const removeCellTerminalSelection = (
    terminalIds: readonly string[],
    documentEdits: readonly SchematicEdit[],
  ): boolean =>
    commitRemoval(terminalIds, () =>
      commitStructure(
        "delete-cell-pin-selection",
        planRemoveCellTerminals(project, activeDocument.id, terminalIds, [
          ...documentEdits,
        ]),
      ),
    );

  const deleteCellTerminal = (
    terminalId: string,
    interfaceInstanceId: string,
  ): boolean => {
    const terminal = activeDocument.netlist?.terminals.find(
      (candidate) => candidate.id === terminalId,
    );
    if (!terminal) return false;
    try {
      const edits = planRemoveCellTerminals(
        project,
        activeDocument.id,
        [terminalId],
        planInstanceDeletion(
          activeDocument,
          resolver,
          [interfaceInstanceId],
          nextSequence(),
        ),
      );
      const committed = commitRemoval([terminalId], () =>
        commitStructure("delete-cell-pin", edits),
      );
      if (committed) setStatus(`Deleted Cell Pin ${terminal.name}`);
      return committed;
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not delete port",
      );
      return false;
    }
  };

  const moveCellTerminal = (
    terminalId: string,
    delta: -1 | 1,
    targetDocumentId = activeDocument.id,
  ): void => {
    const edits = planReorderCellTerminal(
      project,
      targetDocumentId,
      terminalId,
      delta,
    );
    if (edits.length === 0) return;
    if (commitStructure("reorder-cell-interface-terminal", edits)) {
      setStatus("Reordered formal terminal interface");
    }
  };

  const moveCellPort = (
    portId: string,
    delta: -1 | 1,
    targetDocumentId = activeDocument.id,
  ): void => {
    const edits = planReorderCellPort(project, targetDocumentId, portId, delta);
    if (edits.length === 0) return;
    if (commitStructure("reorder-cell-interface-port", edits)) {
      setStatus("Reordered formal port interface");
    }
  };

  const editCellParameter = (
    name: string,
    change: CellParameterChange,
    targetDocumentId = activeDocument.id,
  ): ExternalDefinitionResult => {
    try {
      const edits =
        change.kind === "rename"
          ? planRenameCellParameter(
              project,
              targetDocumentId,
              name,
              change.value.trim(),
            )
          : change.kind === "default"
            ? planSetCellParameterDefault(
                project,
                targetDocumentId,
                name,
                change.value.trim(),
              )
            : planRemoveCellParameter(project, targetDocumentId, name);
      const ok =
        edits.length === 0 ||
        commitStructure(`cell-parameter-${change.kind}`, edits);
      const message = ok
        ? "Updated Cell parameter"
        : "Could not update Cell parameter";
      setStatus(message);
      return { ok, message };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not update Cell parameter";
      setStatus(message);
      return { ok: false, message };
    }
  };

  const setExternalSubcircuitDefinition = (
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult => {
    const fail = (message: string): ExternalDefinitionResult => {
      setStatus(message);
      return { ok: false, message };
    };
    try {
      const collision = project.documents.some(
        (document) =>
          document.netlist?.name.toLowerCase() ===
          definition.name.toLowerCase(),
      );
      if (collision)
        return fail("An existing Cell already uses this target name.");
      const candidate = CircuitProjectSchema.safeParse({
        ...project,
        externalSubcircuitDefinitions: [
          ...project.externalSubcircuitDefinitions.filter(
            (item) => item.id !== definition.id,
          ),
          definition,
        ],
      });
      if (!candidate.success) {
        return fail(
          candidate.error.issues.map((issue) => issue.message).join("; "),
        );
      }
      const proposal = proposeUpsertExternalSubcircuitDefinition(
        project,
        definition,
      );
      if (proposal.diagnostics.length > 0) {
        return fail(
          `Cannot update external interface: ${proposal.diagnostics[0]}`,
        );
      }
      if (
        commitStructure("upsert-external-subcircuit-interface", [
          ...proposal.edits,
        ])
      ) {
        const message = `Updated external subcircuit ${definition.name}`;
        setStatus(message);
        return { ok: true, message };
      }
      return fail(
        "Could not save the external interface. The Project was not changed.",
      );
    } catch (error) {
      return fail(
        error instanceof Error
          ? error.message
          : "Could not update external subcircuit interface",
      );
    }
  };

  const removeExternalSubcircuitDefinition = (
    definitionId: string,
  ): ExternalDefinitionResult => {
    const definition = project.externalSubcircuitDefinitions.find(
      (item) => item.id === definitionId,
    );
    const caller = project.documents.flatMap((document) =>
      document.instances
        .filter(
          (instance) =>
            instance.netlist?.binding?.kind === "external-subcircuit" &&
            instance.netlist.binding.definitionId === definitionId,
        )
        .map(
          (instance) => `${document.name}.${instance.reference ?? instance.id}`,
        ),
    )[0];
    const message = !definition
      ? "External definition no longer exists."
      : caller
        ? `Still used by ${caller}. Remove its instances first.`
        : undefined;
    if (message) {
      setStatus(message);
      return { ok: false, message };
    }
    const ok = commitStructure("remove-external-subcircuit-definition", [
      { kind: "remove_external_subcircuit_definition", definitionId },
    ]);
    const result = {
      ok,
      message: ok
        ? `Deleted external circuit ${definition!.name}`
        : "Could not delete external definition. The Project was not changed.",
    };
    setStatus(result.message);
    return result;
  };

  const saveBlockSymbolPresentation = (
    target: BlockSymbolLayoutTarget,
    presentation: NonNullable<BlockSymbolLayoutTarget["presentation"]>,
  ): ProjectStructureEdit[] => {
    if (target.kind === "cell") {
      return planSetCellSymbolPresentation(
        project,
        target.ownerId,
        presentation,
      );
    }
    const definition = project.externalSubcircuitDefinitions.find(
      (item) => item.id === target.ownerId,
    );
    if (!definition) throw new Error("External definition no longer exists");
    return [
      {
        kind: "upsert_external_subcircuit_definition",
        definition: { ...definition, presentation },
      },
    ];
  };

  const setCellSymbolBodySize = (
    child: BlockSymbolLayoutTarget,
    width: number,
    height: number,
  ): void => {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width % 10 !== 0 ||
      height % 10 !== 0
    ) {
      setStatus("Cell symbol size must use positive 10-unit grid values");
      return;
    }
    const current = child.presentation;
    if (
      commitStructure(
        "resize-cell-symbol",
        saveBlockSymbolPresentation(child, {
          ...(current?.pinPlacements
            ? { pinPlacements: current.pinPlacements }
            : {}),
          minimumBodySize: { width, height },
        }),
      )
    ) {
      setStatus(`Resized ${child.name} symbol for every parent instance`);
    }
  };

  const setCellSymbolPortPlacement = (
    child: BlockSymbolLayoutTarget,
    terminalId: string,
    side: CellPinSide,
    offset: number,
  ): void => {
    try {
      if (!Number.isInteger(offset) || offset % 10 !== 0) {
        throw new Error("Cell Pin position must be a multiple of 10");
      }
      const pinPlacements = (child.presentation?.pinPlacements ?? []).filter(
        (pin) => pin.terminalId !== terminalId,
      );
      if (side !== "auto") pinPlacements.push({ terminalId, side, offset });
      if (
        commitStructure(
          "move-cell-symbol-pin",
          saveBlockSymbolPresentation(child, {
            ...child.presentation,
            pinPlacements,
          }),
        )
      ) {
        setStatus("Moved Cell symbol pin in every parent instance");
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not move Cell symbol pin",
      );
    }
  };

  const renameProject = (inputName: string | null): void => {
    const name = (inputName ?? "").trim();
    if (!name || name === project.name) return;
    if (commitStructure("rename-project", [{ kind: "rename_project", name }])) {
      setStatus(`Renamed circuit to ${name}`);
    }
  };

  return {
    setTopCell,
    createCell,
    renameCell,
    deleteCell,
    updateCellPinDirection,
    updateCellPortDirection,
    renameCellTerminal,
    editCellTerminalAnnotation,
    formatCellTerminalAnnotations,
    removeCellTerminalSelection,
    deleteCellTerminal,
    moveCellTerminal,
    moveCellPort,
    editCellParameter,
    setExternalSubcircuitDefinition,
    removeExternalSubcircuitDefinition,
    setCellSymbolBodySize,
    setCellSymbolPortPlacement,
    renameProject,
  };
}
