// Changes to a Cell's formal interface (Pin renames, label formats and
// removals) and how every caller's symbol, Nets and wires follow them.
import type { Annotation, CircuitProject, SchematicDocument } from "@icm/model";
import {
  canonicalPortTextDocument,
  deriveStableId,
  removeCircuitComponentTerminals,
  isAutomaticPinLabelLook,
  projectCellInterface,
  renamedLabelFormat,
  richTextPresentsIdentifier,
  roleLabelFormat,
  routeEnd,
} from "@icm/model";
import type { PortLabelFormatOptions } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
} from "@icm/symbols";
import { resolveEndpointConnection } from "@icm/derived";
import type { ProjectStructureEdit } from "./project-transaction.js";
import {
  planInstanceDeletion,
  planTerminalDeletion,
} from "./instance-lifecycle.js";
import {
  requireDocument,
  transactDocument,
  type DocumentEdits,
} from "./cell-document-edits.js";

export function instanceReferencesPin(
  document: SchematicDocument,
  instanceId: string,
  pinName: string,
): boolean {
  return (
    document.nets.some((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    ) ||
    document.routes.some((route) =>
      [route.start, routeEnd(route)].some(
        (endpoint) =>
          endpoint.kind === "terminal" &&
          endpoint.instanceId === instanceId &&
          endpoint.pinName === pinName,
      ),
    ) ||
    document.noConnects.some(
      (noConnect) =>
        noConnect.endpoint.instanceId === instanceId &&
        noConnect.endpoint.pinName === pinName,
    ) ||
    (
      document.instances.find((instance) => instance.id === instanceId)
        ?.importProvenance?.terminalMapping ?? []
    ).some((terminal) => terminal.pinName === pinName)
  );
}

interface CallerPinRename {
  readonly source: string;
  readonly target: string;
}

function gapDetachedCallerJunctions(
  document: SchematicDocument,
  resolver: ReturnType<typeof createProjectSymbolResolver>,
  edits: DocumentEdits,
): DocumentEdits {
  const terminalByJunctionId = new Map<
    string,
    { instanceId: string; pinName: string }
  >();
  for (const edit of edits) {
    if (edit.kind !== "set_route_path") continue;
    const original = document.routes.find(
      (route) => route.id === edit.route.id,
    );
    if (!original) continue;
    for (const [before, after] of [
      [original.start, edit.route.start],
      [routeEnd(original), routeEnd(edit.route)],
    ] as const) {
      if (before.kind !== "terminal" || after.kind !== "junction") continue;
      terminalByJunctionId.set(after.junctionId, {
        instanceId: before.instanceId,
        pinName: before.pinName,
      });
    }
  }
  if (terminalByJunctionId.size === 0) return edits;

  return edits.map((edit) => {
    if (edit.kind !== "add_junction") return edit;
    const terminal = terminalByJunctionId.get(edit.junctionId);
    if (!terminal) return edit;
    const connection = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      ...terminal,
    });
    if (!connection?.outward) return edit;
    const grid = document.presentation.grid;
    return {
      ...edit,
      position: {
        x: connection.gridLanding.x + connection.outward.x * grid,
        y: connection.gridLanding.y + connection.outward.y * grid,
      },
    };
  });
}

/**
 * Keeps caller drawings valid when the read-only formal interface projection
 * changes. Removed formal pins are detached to Junctions; canonical spelling
 * changes are one-to-one unless the caller explicitly requests electrical
 * aliasing. Explicit aliasing merges owner Nets before symbol reconciliation.
 */
export function planCallerInterfaceChanges(
  project: CircuitProject,
  childDocumentId: string,
  disappearingPinNames: readonly string[],
  pinRenames: readonly CallerPinRename[],
  mergeAliases = false,
  external = false,
  expectedPinNames?: readonly string[],
  callerSymbolIds?: ReadonlyMap<string, string>,
): {
  readonly beforeChild: readonly ProjectStructureEdit[];
  readonly afterChild: readonly ProjectStructureEdit[];
  readonly symbolMigrations: ReadonlyMap<string, string>;
} {
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const uniqueDisappearingPinNames = [...new Set(disappearingPinNames)];
  const uniquePinRenames = [
    ...new Map(
      pinRenames
        .filter((rename) => rename.source !== rename.target)
        .map((rename) => [rename.source, rename]),
    ).values(),
  ];
  const beforeChild: ProjectStructureEdit[] = [];
  const afterChild: ProjectStructureEdit[] = [];
  const capturedIds = new Set<string>();
  const symbolMigrations = new Map<string, string>();

  for (const parent of project.documents) {
    const callers = parent.instances.filter((instance) => {
      const binding = instance.netlist?.binding;
      return external
        ? binding?.kind === "external-subcircuit" &&
            binding.definitionId === childDocumentId
        : binding?.kind === "subcircuit" &&
            binding.childDocumentId === childDocumentId;
    });
    if (callers.length === 0) continue;

    const detachTargets: { instanceId: string; pinName: string }[] = [];
    const mergeEdits: DocumentEdits = [];
    const netAliases = new Map<string, string>();
    const currentNetId = (id: string): string => {
      while (netAliases.has(id)) id = netAliases.get(id)!;
      return id;
    };
    const reconcileEdits: DocumentEdits = [];
    for (const instance of callers) {
      let symbolId = instance.symbolId;
      const captured = project.componentDefinitions?.find(
        (component) => component.symbol.id === instance.symbolId,
      );
      const chosenSymbolId = callerSymbolIds?.get(
        JSON.stringify([parent.id, instance.id]),
      );
      const derivedId = external
        ? externalSubcircuitSymbolId(childDocumentId)
        : hierarchicalSymbolId(
            project.documents.find((d) => d.id === childDocumentId)!.netlist!
              .name,
          );
      const original = resolver.resolve(symbolId)?.definition;
      if (
        symbolId !== derivedId &&
        original &&
        expectedPinNames &&
        !chosenSymbolId
      ) {
        const mappedNames = original.pins
          .filter((pin) => !uniqueDisappearingPinNames.includes(pin.name))
          .map(
            (pin) =>
              uniquePinRenames.find((r) => r.source === pin.name)?.target ??
              pin.name,
          );
        const missing = expectedPinNames.filter(
          (name) => !mappedNames.includes(name),
        );
        if (missing.length)
          throw new Error(
            `Custom caller ${instance.reference ?? instance.id} artwork lacks ports ${missing.join(", ")}. Use a symbol containing all new ports or switch the caller to its generated Cell symbol before Apply`,
          );
      }
      if (
        symbolId !== derivedId &&
        original &&
        !captured?.circuitBinding &&
        (uniquePinRenames.length > 0 || uniqueDisappearingPinNames.length > 0)
      ) {
        const rename = (name: string) =>
          uniquePinRenames.find((r) => r.source === name)?.target ?? name;
        const removed = (name: string) =>
          uniqueDisappearingPinNames.includes(name);
        const migratedId = deriveStableId(
          "caller-interface-symbol",
          childDocumentId,
          symbolId,
          JSON.stringify(uniquePinRenames),
          JSON.stringify(uniqueDisappearingPinNames),
        );
        const symbol = {
          ...structuredClone(original),
          id: migratedId,
          pins: original.pins
            .filter((p) => !removed(p.name))
            .map((p) => ({ ...p, name: rename(p.name) })),
          variants: original.variants.map((v) => ({
            ...v,
            hiddenPinNames: v.hiddenPinNames
              .filter((name) => !removed(name))
              .map(rename),
            ...(v.auxiliaryPins
              ? {
                  auxiliaryPins: v.auxiliaryPins
                    .filter((p) => !removed(p.name))
                    .map((p) => ({ ...p, name: rename(p.name) })),
                }
              : {}),
          })),
          ...(original.pins.every((p) => removed(p.name))
            ? { hierarchicalBlock: true as const }
            : {}),
        };
        if (!capturedIds.has(migratedId)) {
          // This snapshot owns artwork only. The caller binding and native
          // source continue to own its electrical implementation.
          afterChild.push({
            kind: "capture_component_definition",
            definition: { symbol },
          });
          capturedIds.add(migratedId);
        }
        symbolId = migratedId;
      }
      if (
        captured?.circuitBinding &&
        !chosenSymbolId &&
        uniqueDisappearingPinNames.length
      ) {
        const owner = project.externalSubcircuitDefinitions.find(
          (definition) => definition.id === childDocumentId,
        )!;
        const migrated = removeCircuitComponentTerminals(
          captured,
          owner.terminals
            .filter((terminal) =>
              uniqueDisappearingPinNames.includes(terminal.name),
            )
            .map((terminal) => terminal.id),
        );
        if (!capturedIds.has(migrated.symbol.id)) {
          afterChild.push({
            kind: "capture_component_definition",
            definition: migrated,
          });
          capturedIds.add(migrated.symbol.id);
        }
        symbolMigrations.set(instance.symbolId, migrated.symbol.id);
        symbolId = migrated.symbol.id;
      }
      symbolId = chosenSymbolId ?? symbolId;
      const referencedDisappearingPins = uniqueDisappearingPinNames.filter(
        (pinName) => instanceReferencesPin(parent, instance.id, pinName),
      );
      detachTargets.push(
        ...referencedDisappearingPins.map((pinName) => ({
          instanceId: instance.id,
          pinName,
        })),
      );
      const pinMap = Object.fromEntries(
        uniquePinRenames
          .filter((rename) =>
            instanceReferencesPin(parent, instance.id, rename.source),
          )
          .map((rename) => [rename.source, rename.target]),
      );
      if (mergeAliases) {
        for (const target of new Set(Object.values(pinMap))) {
          const mapsToTarget = (name: string) =>
            (pinMap[name] ?? name) === target;
          const nets = parent.nets.filter((net) =>
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === instance.id &&
                mapsToTarget(terminal.pinName),
            ),
          );
          const netIds = [...new Set(nets.map((net) => currentNetId(net.id)))];
          const targetNetId = netIds[0];
          if (targetNetId) {
            for (const sourceNetId of netIds.slice(1)) {
              mergeEdits.push({ kind: "merge_nets", targetNetId, sourceNetId });
              netAliases.set(sourceNetId, targetNetId);
            }
          }
          const noConnects = parent.noConnects.filter(
            (item) =>
              item.endpoint.instanceId === instance.id &&
              mapsToTarget(item.endpoint.pinName),
          );
          for (const item of noConnects.slice(targetNetId ? 0 : 1)) {
            mergeEdits.push({
              kind: "remove_no_connect",
              noConnectId: item.id,
            });
            const pinName = item.endpoint.pinName;
            // A discarded NoConnect may have been the only reference to this
            // source pin. Do not leave an invalid source in the symbol map.
            const withoutNoConnect = {
              ...parent,
              noConnects: parent.noConnects.filter(
                (candidate) => candidate.id !== item.id,
              ),
            };
            if (!instanceReferencesPin(withoutNoConnect, instance.id, pinName))
              delete pinMap[pinName];
          }
        }
      }
      if (
        referencedDisappearingPins.length === 0 &&
        Object.keys(pinMap).length === 0 &&
        symbolId === instance.symbolId
      ) {
        continue;
      }
      reconcileEdits.push({
        kind: "set_instance_symbol",
        instanceId: instance.id,
        symbolId,
        ...(instance.symbolVariantId &&
        (!chosenSymbolId ||
          resolver.resolve(chosenSymbolId, instance.symbolVariantId))
          ? { symbolVariantId: instance.symbolVariantId }
          : {}),
        ...(Object.keys(pinMap).length > 0 ? { pinMap } : {}),
      });
    }
    if (reconcileEdits.length === 0) continue;

    const detachEdits = gapDetachedCallerJunctions(
      parent,
      resolver,
      planTerminalDeletion(
        parent,
        resolver,
        detachTargets,
        project.structureRevision + 2,
      ),
    );
    if (detachEdits.length > 0) {
      beforeChild.push({
        kind: "transact_document",
        documentId: parent.id,
        expectedRevision: parent.revision,
        edits: detachEdits,
      });
    }
    afterChild.push({
      kind: "transact_document",
      documentId: parent.id,
      expectedRevision: parent.revision + (detachEdits.length > 0 ? 1 : 0),
      edits: [...mergeEdits, ...reconcileEdits],
    });
  }

  return { beforeChild, afterChild, symbolMigrations };
}

/**
 * Plans one atomic formal-port rename and updates every connected caller
 * through the existing set_instance_symbol pin-reconciliation edit.
 */
export function planRenameCellTerminal(
  project: CircuitProject,
  childDocumentId: string,
  terminalId: string,
  newName: string,
  options: { mergeExistingPort?: boolean } = {},
): ProjectStructureEdit[] {
  const child = project.documents.find(
    (document) => document.id === childDocumentId,
  );
  const terminal = child?.netlist?.terminals.find(
    (candidate) => candidate.id === terminalId,
  );
  if (!child?.netlist || !terminal) {
    throw new Error(
      `Cell terminal does not exist: ${childDocumentId}.${terminalId}`,
    );
  }
  const terminalRename = terminal.name !== newName;
  const annotationEdits = child.annotations
    .filter(
      (annotation) =>
        annotation.kind === "instance-label" &&
        annotation.anchor.kind === "object" &&
        terminal.interfaceInstanceIds.includes(annotation.anchor.objectId),
    )
    .flatMap((annotation) => {
      if (annotation.binding?.kind === "cell-terminal-name") {
        if (!terminalRename) return [];
        const { formatOverride: _formatOverride, ...rest } = annotation;
        // A label with no look of its own, or the automatic one, takes the
        // look a Pin placed with the new name gets: rfp renamed vrfp is
        // drawn V_rfp (#1419), unless it is locked and has none. A standard
        // look follows the new name, and an author's keeps its styling.
        const format = isAutomaticPinLabelLook(
          annotation.formatOverride,
          terminal.name,
        )
          ? roleLabelFormat("voltage-node", newName)
          : renamedLabelFormat(
              annotation,
              terminal.name,
              newName,
              child.presentation,
            );
        if (!annotation.formatOverride && (!format || annotation.locked))
          return [];
        return [
          {
            kind: "upsert_schematic_annotation" as const,
            annotation: {
              ...rest,
              ...(format ? { formatOverride: format } : {}),
            },
          },
        ];
      }
      // A written label that reads the Pin's name is an older name label
      // and follows the Pin as a binding. One that reads anything else is
      // the Pin's display alias, and a rename keeps it, as for a part.
      if (
        !annotation.binding &&
        !richTextPresentsIdentifier(
          annotation.content ?? { runs: [] },
          terminal.name,
        )
      )
        return [];
      const {
        content: _content,
        formatOverride: _formatOverride,
        ...rest
      } = annotation;
      return [
        {
          kind: "upsert_schematic_annotation" as const,
          annotation: {
            ...rest,
            binding: { kind: "cell-terminal-name" as const, terminalId },
          },
        },
      ];
    });
  if (!terminalRename && annotationEdits.length === 0) return [];

  const childEdit: ProjectStructureEdit = {
    kind: "transact_document",
    documentId: child.id,
    expectedRevision: child.revision,
    edits: [
      ...(terminalRename
        ? [
            {
              kind: "update_cell_terminal" as const,
              terminalId,
              name: newName,
            },
          ]
        : []),
      ...annotationEdits,
    ],
  };
  if (!terminalRename) return [childEdit];

  const beforeProjection = projectCellInterface(child.netlist);
  const afterProjection = projectCellInterface({
    ...child.netlist,
    terminals: child.netlist.terminals.map((candidate) =>
      candidate.id === terminalId ? { ...candidate, name: newName } : candidate,
    ),
  });
  const beforeByKey = new Map(
    beforeProjection.ports.map((port) => [port.key, port]),
  );
  const afterByKey = new Map(
    afterProjection.ports.map((port) => [port.key, port]),
  );
  const selectedBeforePort = beforeProjection.ports.find((port) =>
    port.terminalIds.includes(terminalId),
  )!;
  const selectedAfterPort = afterProjection.ports.find((port) =>
    port.terminalIds.includes(terminalId),
  )!;
  const disappearingPinNames: string[] = [];
  const pinRenames: CallerPinRename[] = [];

  for (const beforePort of beforeProjection.ports) {
    const afterPort = afterByKey.get(beforePort.key);
    if (afterPort) {
      if (beforePort.name !== afterPort.name) {
        pinRenames.push({ source: beforePort.name, target: afterPort.name });
      }
      continue;
    }

    // Joining an existing interface detaches callers unless the operation has
    // explicitly requested electrical merging. The UI must confirm that intent.
    if (
      beforePort.key === selectedBeforePort.key &&
      (!beforeByKey.has(selectedAfterPort.key) || options.mergeExistingPort)
    ) {
      pinRenames.push({
        source: beforePort.name,
        target: selectedAfterPort.name,
      });
    } else {
      disappearingPinNames.push(beforePort.name);
    }
  }

  const callerChanges = planCallerInterfaceChanges(
    project,
    child.id,
    disappearingPinNames,
    pinRenames,
    options.mergeExistingPort,
  );
  return [...callerChanges.beforeChild, childEdit, ...callerChanges.afterChild];
}

/**
 * Canonicalize every visible formal-Port label in one Cell without changing
 * terminal names, connectivity, or annotation geometry. All changed labels
 * share one document transaction so the action also has one Undo step.
 */
export function planFormatCellTerminalAnnotations(
  project: CircuitProject,
  documentId: string,
  options?: PortLabelFormatOptions,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (!document.netlist) throw new Error(`Cell does not exist: ${documentId}`);
  const terminalById = new Map(
    document.netlist.terminals.map((terminal) => [terminal.id, terminal]),
  );
  const edits = document.annotations.flatMap((annotation) => {
    const binding = annotation.binding;
    if (binding?.kind !== "cell-terminal-name") return [];
    const terminal = terminalById.get(binding.terminalId);
    if (!terminal) return [];
    const formatOverride = canonicalPortTextDocument(terminal.name, options);
    if (
      annotation.formatOverride &&
      JSON.stringify(annotation.formatOverride) ===
        JSON.stringify(formatOverride)
    ) {
      return [];
    }
    return [
      {
        kind: "upsert_schematic_annotation" as const,
        annotation: { ...annotation, formatOverride },
      },
    ];
  });
  return edits.length > 0 ? [transactDocument(project, documentId, edits)] : [];
}

/**
 * Applies a canvas Cell-Pin text edit atomically: the semantic character
 * change uses the hierarchy rename planner, while the same-text RichText
 * formatting remains on the bound annotation.
 */
export function planEditCellTerminalAnnotation(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  annotation: Annotation,
  newName: string,
  options: { mergeExistingPort?: boolean } = {},
): ProjectStructureEdit[] {
  const renameEdits = planRenameCellTerminal(
    project,
    documentId,
    terminalId,
    newName,
    options,
  );
  const annotationEdit = {
    kind: "upsert_schematic_annotation" as const,
    annotation,
  };
  const childEditIndex = renameEdits.findIndex(
    (edit) =>
      edit.kind === "transact_document" && edit.documentId === documentId,
  );
  if (childEditIndex < 0) {
    return [transactDocument(project, documentId, [annotationEdit])];
  }
  return renameEdits.map((edit, index) =>
    index === childEditIndex && edit.kind === "transact_document"
      ? { ...edit, edits: [...edit.edits, annotationEdit] }
      : edit,
  );
}

export function planRemoveCellTerminal(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  instanceDeletionEdits?: DocumentEdits,
): ProjectStructureEdit[] {
  return planRemoveCellTerminals(
    project,
    documentId,
    [terminalId],
    instanceDeletionEdits,
  );
}

/**
 * Removes Cell Pins and detaches every child and caller wire to a Junction in
 * one Project transaction. Interface consistency is automatic; callers never
 * need to clear wires or NoConnect declarations by hand.
 */
export function planRemoveCellTerminals(
  project: CircuitProject,
  documentId: string,
  terminalIds: readonly string[],
  instanceDeletionEdits?: DocumentEdits,
): ProjectStructureEdit[] {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document?.netlist) throw new Error(`Cell does not exist: ${documentId}`);
  const requestedIds = new Set(terminalIds);
  if (requestedIds.size === 0) return [];
  const terminals = [...requestedIds].map((terminalId) => {
    const terminal = document.netlist!.terminals.find(
      (item) => item.id === terminalId,
    );
    if (!terminal) {
      throw new Error(
        `Cell terminal does not exist: ${documentId}.${terminalId}`,
      );
    }
    return terminal;
  });
  const retainedTerminals = document.netlist.terminals.filter(
    (terminal) => !requestedIds.has(terminal.id),
  );
  const beforeProjection = projectCellInterface(document.netlist);
  const afterProjection = projectCellInterface({
    ...document.netlist,
    terminals: retainedTerminals,
  });
  const afterByKey = new Map(
    afterProjection.ports.map((port) => [port.key, port]),
  );
  const disappearingCallerPinNames: string[] = [];
  const pinRenames: CallerPinRename[] = [];
  for (const beforePort of beforeProjection.ports) {
    const afterPort = afterByKey.get(beforePort.key);
    if (!afterPort) {
      disappearingCallerPinNames.push(beforePort.name);
    } else if (beforePort.name !== afterPort.name) {
      pinRenames.push({ source: beforePort.name, target: afterPort.name });
    }
  }
  const terminalInstanceIds = new Set(
    terminals.flatMap((terminal) => terminal.interfaceInstanceIds),
  );
  const terminalAnnotationIds = new Set(
    terminals.flatMap((terminal) =>
      terminal.interfaceAnnotationId ? [terminal.interfaceAnnotationId] : [],
    ),
  );
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const lifecycleEdits =
    instanceDeletionEdits ??
    planInstanceDeletion(
      document,
      resolver,
      [...terminalInstanceIds],
      project.structureRevision + 1,
    );
  const instanceRemovalEdits = lifecycleEdits.filter(
    (edit) => edit.kind === "remove_instance",
  );
  const edits: DocumentEdits = [
    ...lifecycleEdits.filter((edit) => edit.kind !== "remove_instance"),
    ...document.annotations
      .filter(
        (annotation) =>
          terminalAnnotationIds.has(annotation.id) &&
          !lifecycleEdits.some(
            (edit) =>
              edit.kind === "remove_schematic_annotation" &&
              edit.annotationId === annotation.id,
          ),
      )
      .map((annotation) => ({
        kind: "remove_schematic_annotation" as const,
        annotationId: annotation.id,
      })),
    ...terminals.flatMap((terminal) =>
      lifecycleEdits.some(
        (edit) =>
          edit.kind === "remove_cell_terminal" &&
          edit.terminalId === terminal.id,
      )
        ? []
        : [
            {
              kind: "remove_cell_terminal" as const,
              terminalId: terminal.id,
            },
          ],
    ),
    ...instanceRemovalEdits,
  ];
  const callerChanges = planCallerInterfaceChanges(
    project,
    documentId,
    disappearingCallerPinNames,
    pinRenames,
  );
  return [
    ...callerChanges.beforeChild,
    {
      kind: "transact_document",
      documentId,
      expectedRevision: document.revision,
      edits,
    },
    ...callerChanges.afterChild,
  ];
}
