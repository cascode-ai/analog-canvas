import type {
  Annotation,
  CellSymbolPresentation,
  CellSymbolSide,
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import {
  canonicalPortTextDocument,
  deriveStableId,
  foldNetName,
  projectCellInterface,
  rewriteRichTextPlainText,
  routeEnd,
  semanticTextDocument,
} from "@icm/model";
import type { PortLabelFormatOptions } from "@icm/model";
import {
  deviceDescriptor,
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
  hierarchicalSymbolId,
} from "@icm/symbols";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";

import type { ProjectStructureEdit } from "./project-transaction.js";
import {
  planInstanceDeletion,
  planTerminalDeletion,
} from "./instance-lifecycle.js";

type DocumentEdits = Extract<
  ProjectStructureEdit,
  { kind: "transact_document" }
>["edits"];

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

function requireDocument(project: CircuitProject, documentId: string) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error(`Document does not exist: ${documentId}`);
  return document;
}

function transactDocument(
  project: CircuitProject,
  documentId: string,
  edits: DocumentEdits,
): ProjectStructureEdit {
  const document = requireDocument(project, documentId);
  return {
    kind: "transact_document",
    documentId,
    expectedRevision: document.revision,
    edits,
  };
}

function instanceReferencesPin(
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
function planCallerInterfaceChanges(
  project: CircuitProject,
  childDocumentId: string,
  disappearingPinNames: readonly string[],
  pinRenames: readonly CallerPinRename[],
  mergeAliases = false,
): {
  readonly beforeChild: readonly ProjectStructureEdit[];
  readonly afterChild: readonly ProjectStructureEdit[];
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

  for (const parent of project.documents) {
    const callers = parent.instances.filter((instance) => {
      const binding = instance.netlist?.binding;
      return (
        binding?.kind === "subcircuit" &&
        binding.childDocumentId === childDocumentId
      );
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
        Object.keys(pinMap).length === 0
      ) {
        continue;
      }
      reconcileEdits.push({
        kind: "set_instance_symbol",
        instanceId: instance.id,
        symbolId: instance.symbolId,
        ...(instance.symbolVariantId
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

  return { beforeChild, afterChild };
}

function externalDefinitionId(masterName: string): string {
  return deriveStableId("external-subcircuit", masterName.toLowerCase());
}

function externalTerminalId(masterName: string, index: number): string {
  return deriveStableId(
    "external-subcircuit-terminal",
    masterName.toLowerCase(),
    String(index),
  );
}

function matchingReviewedExternalDefinition(
  project: CircuitProject,
  definitionId: string,
) {
  const definition = project.externalSubcircuitDefinitions.find(
    (candidate) => candidate.id === definitionId,
  );
  if (!definition || definition.presentation) return undefined;
  const binding = resolveReviewedExternalBinding(
    definition.name,
    definition.terminals.map((terminal) => terminal.name),
  );
  if (!binding) return undefined;
  return { definition, binding };
}

function removedPropertyTerminalEdits(
  document: SchematicDocument,
  instanceId: string,
  currentBinding: ReturnType<typeof matchingReviewedExternalDefinition>,
  nextBinding?: ReturnType<typeof reviewedExternalBindingForMaster>,
): DocumentEdits {
  if (!currentBinding) return [];
  const retainedPins = new Set(
    nextBinding?.terminals
      .filter((terminal) => terminal.interaction === "property")
      .map((terminal) => terminal.pinName.toLowerCase()) ?? [],
  );
  return currentBinding.binding.terminals.flatMap((terminal) =>
    terminal.interaction === "property" &&
    !retainedPins.has(terminal.pinName.toLowerCase()) &&
    document.nets.some((net) =>
      net.terminals.some(
        (member) =>
          member.instanceId === instanceId &&
          member.pinName.toLowerCase() === terminal.pinName.toLowerCase(),
      ),
    )
      ? [
          {
            kind: "set_property_terminal_net" as const,
            instanceId,
            pinName: terminal.pinName,
            netId: null,
          },
        ]
      : [],
  );
}

/**
 * Switches a native device between its ordinary binding and one exact reviewed
 * external target without renaming the schematic Instance. Invocation prefixes
 * belong to the derived SPICE netlist, not to process/model authoring.
 */
export function planSetDeviceModelTarget(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  modelName: string,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const instance = document.instances.find(
    (candidate) => candidate.id === instanceId,
  );
  if (!instance?.netlist) {
    throw new Error(`Netlisted Instance does not exist: ${instanceId}`);
  }
  const normalizedName = modelName.trim();
  const targetBinding = normalizedName
    ? reviewedExternalBindingForMaster(normalizedName)
    : undefined;
  const currentExternal =
    instance.netlist.binding?.kind === "external-subcircuit"
      ? matchingReviewedExternalDefinition(
          project,
          instance.netlist.binding.definitionId,
        )
      : undefined;
  const sourceSymbolId = currentExternal?.binding.symbolId ?? instance.symbolId;
  const sourceDescriptor = deviceDescriptor(sourceSymbolId);
  if (
    !sourceDescriptor ||
    (!targetBinding &&
      !currentExternal &&
      sourceDescriptor.targetPolicy !== "required-model")
  ) {
    throw new Error(
      "The selected device does not accept an explicit model target",
    );
  }

  if (targetBinding) {
    if (targetBinding.symbolId !== sourceSymbolId) {
      throw new Error(
        `${normalizedName} is not compatible with the selected ${sourceSymbolId}`,
      );
    }
    const sameNameDefinition = project.externalSubcircuitDefinitions.find(
      (definition) =>
        definition.name.toLowerCase() === normalizedName.toLowerCase(),
    );
    const definition =
      sameNameDefinition ??
      ({
        id: externalDefinitionId(normalizedName),
        name: normalizedName,
        terminals: targetBinding.terminals.map((terminal, index) => ({
          id: externalTerminalId(normalizedName, index),
          name: terminal.targetName,
          direction: "passive" as const,
        })),
        formalParameters: targetBinding.parameters.map((parameter) => ({
          name: parameter.name,
          ...(parameter.targetDefaultValue === undefined
            ? {}
            : { defaultValue: parameter.targetDefaultValue }),
        })),
        interfaceStatus: "declared" as const,
      } satisfies ExternalSubcircuitDefinition);
    const verified = definition.presentation
      ? undefined
      : resolveReviewedExternalBinding(
          definition.name,
          definition.terminals.map((terminal) => terminal.name),
        );
    if (!verified || verified.symbolId !== sourceSymbolId) {
      throw new Error(
        `Existing external definition ${definition.name} does not match its reviewed public terminal order`,
      );
    }
    const symbolId = verified.symbolId;
    const documentEdits: DocumentEdits = removedPropertyTerminalEdits(
      document,
      instanceId,
      currentExternal,
      verified,
    );
    if (instance.symbolId !== symbolId) {
      documentEdits.push({
        kind: "set_instance_symbol",
        instanceId,
        symbolId,
      });
    }
    const binding = {
      kind: "external-subcircuit" as const,
      definitionId: definition.id,
    };
    const parameterNames = new Set(
      verified.parameters.map((parameter) => parameter.name.toLowerCase()),
    );
    const set = Object.fromEntries(
      verified.parameters.flatMap((parameter) =>
        instance.netlist!.parameters[parameter.name] === undefined &&
        parameter.defaultValue !== undefined
          ? [[parameter.name, parameter.defaultValue]]
          : [],
      ),
    );
    const unset = Object.keys(instance.netlist.parameters).filter(
      (name) => !parameterNames.has(name.toLowerCase()),
    );
    if (
      JSON.stringify(instance.netlist.binding ?? null) !==
        JSON.stringify(binding) ||
      Object.keys(set).length > 0 ||
      unset.length > 0
    ) {
      documentEdits.push({
        kind: "bulk_patch_instance_netlist",
        assignments: [
          {
            instanceId,
            binding,
            ...(Object.keys(set).length ? { set } : {}),
            ...(unset.length ? { unset } : {}),
          },
        ],
      });
    }
    if (documentEdits.length === 0) return [];
    return [
      ...(sameNameDefinition
        ? []
        : [
            {
              kind: "upsert_external_subcircuit_definition" as const,
              definition,
            },
          ]),
      transactDocument(project, documentId, documentEdits),
    ];
  }

  const symbolId = sourceSymbolId;
  if (normalizedName && sourceDescriptor.targetPolicy !== "required-model") {
    throw new Error(
      `${symbolId} supports only the reviewed model suggestion in this release`,
    );
  }
  const binding =
    sourceDescriptor.targetPolicy === "required-model"
      ? normalizedName
        ? ({
            kind: "model",
            deviceClass: sourceDescriptor.deviceClass,
            name: normalizedName,
          } as const)
        : undefined
      : ({
          kind: "primitive",
          deviceClass: sourceDescriptor.deviceClass,
        } as const);
  const ordinaryParameterNames = new Set(
    sourceDescriptor.parameters.map((parameter) =>
      parameter.name.toLowerCase(),
    ),
  );
  const unset = Object.keys(instance.netlist.parameters).filter(
    (name) => !ordinaryParameterNames.has(name.toLowerCase()),
  );
  const documentEdits: DocumentEdits = removedPropertyTerminalEdits(
    document,
    instanceId,
    currentExternal,
  );
  if (instance.symbolId !== symbolId) {
    documentEdits.push({ kind: "set_instance_symbol", instanceId, symbolId });
  }
  if (
    JSON.stringify(instance.netlist.binding ?? null) !==
      JSON.stringify(binding ?? null) ||
    unset.length > 0
  ) {
    documentEdits.push({
      kind: "bulk_patch_instance_netlist",
      assignments: [
        {
          instanceId,
          binding: binding ?? null,
          ...(unset.length ? { unset } : {}),
        },
      ],
    });
  }
  return documentEdits.length > 0
    ? [transactDocument(project, documentId, documentEdits)]
    : [];
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
  const reviewed = definition.presentation
    ? undefined
    : resolveReviewedExternalBinding(
        definition.name,
        definition.terminals.map((terminal) => terminal.name),
      );
  return {
    id,
    symbolId: reviewed?.symbolId ?? externalSubcircuitSymbolId(definition.id),
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
  requireDocument(project, binding.childDocumentId);
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

export function planCreateCellPin(
  project: CircuitProject,
  documentId: string,
  input: {
    instance: SchematicDocument["instances"][number];
    connectionEdits: DocumentEdits;
    terminal: NonNullable<SchematicDocument["netlist"]>["terminals"][number];
    annotation?: Annotation;
  },
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (!document.netlist)
    throw new Error(`Cell has no interface: ${documentId}`);
  if (
    input.terminal.interfaceInstanceIds.length !== 1 ||
    input.terminal.interfaceInstanceIds[0] !== input.instance.id
  ) {
    throw new Error(
      "A Cell terminal must own exactly its placed Port Instance",
    );
  }
  if (
    input.instance.symbolId !== "port" &&
    input.instance.symbolId !== "port-filled" &&
    input.instance.symbolId !== "vdd-port"
  ) {
    throw new Error(
      `Cell interface marker must be a Port or VDD Power: ${input.instance.symbolId}`,
    );
  }
  return [
    transactDocument(project, documentId, [
      { kind: "add_instance", instance: input.instance },
      ...input.connectionEdits,
      { kind: "add_cell_terminal", terminal: input.terminal },
      ...(input.annotation
        ? [
            {
              kind: "upsert_schematic_annotation" as const,
              annotation: input.annotation,
            },
          ]
        : []),
    ]),
  ];
}

export type VddConnectionMode = "cell-pin" | "global";

/**
 * Switch the electrical role of the VDD artwork without touching its Base-Net
 * membership or geometry. Cell-Pin mode is represented by the existing formal
 * interface object; Global mode is represented by the existing marker-owned
 * name claim. Markers sharing one physical Base Net move together so the same
 * conductor can never be both interface styles at once.
 */
export function planSetVddConnectionMode(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  mode: VddConnectionMode,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  if (!document.netlist) {
    throw new Error(`Cell has no interface: ${documentId}`);
  }
  const selected = document.instances.find(
    (instance) => instance.id === instanceId,
  );
  if (selected?.symbolId !== "vdd-port") {
    throw new Error(`Instance is not VDD Power: ${instanceId}`);
  }
  const net = document.nets.find((candidate) =>
    candidate.terminals.some(
      (terminal) =>
        terminal.instanceId === instanceId && terminal.pinName === "P",
    ),
  );
  if (!net) throw new Error(`VDD Power has no Net: ${instanceId}`);

  const markerIds = new Set(
    net.terminals.flatMap((terminal) => {
      const instance = document.instances.find(
        (candidate) => candidate.id === terminal.instanceId,
      );
      return terminal.pinName === "P" && instance?.symbolId === "vdd-port"
        ? [instance.id]
        : [];
    }),
  );
  const terminalByMarkerId = new Map(
    document.netlist.terminals.flatMap((terminal) =>
      terminal.netId === net.id &&
      markerIds.has(terminal.interfaceInstanceIds[0]!)
        ? [[terminal.interfaceInstanceIds[0]!, terminal] as const]
        : [],
    ),
  );
  const selectedTerminal = terminalByMarkerId.get(instanceId);
  const ownedClaims = document.connectivityEvidence.filter(
    (
      evidence,
    ): evidence is Extract<
      SchematicDocument["connectivityEvidence"][number],
      { kind: "name-claim" }
    > =>
      evidence.kind === "name-claim" &&
      evidence.owner.kind === "power-marker" &&
      markerIds.has(evidence.owner.objectId) &&
      evidence.netId === net.id,
  );
  const logicalName = resolveDocumentLogicalNets(document).byBaseNetId.get(
    net.id,
  )?.name;

  if (mode === "global") {
    if (!selectedTerminal) return [];
    const terminals = [...terminalByMarkerId.values()];
    const names = new Map<string, string>();
    for (const terminal of terminals) {
      const folded = foldNetName(terminal.name);
      if (!names.has(folded)) names.set(folded, terminal.name);
    }
    if (names.size !== 1) {
      throw new Error(
        "One physical VDD Net exposes several Cell Pin names; unify them before making it Global",
      );
    }
    const retainedFormalOnNet = document.netlist.terminals.find(
      (terminal) =>
        terminal.netId === net.id &&
        !terminalByMarkerId.has(terminal.interfaceInstanceIds[0]!),
    );
    if (retainedFormalOnNet) {
      throw new Error(
        `Net ${retainedFormalOnNet.name} still has a non-VDD formal Cell Pin; disconnect it before making VDD Global`,
      );
    }
    const name = [...names.values()][0] ?? logicalName ?? "VDD";
    const annotationEdits: DocumentEdits = [];
    for (const markerId of markerIds) {
      const priorClaim = ownedClaims.find(
        (claim) =>
          claim.owner.kind === "power-marker" &&
          claim.owner.objectId === markerId,
      );
      annotationEdits.push({
        kind: "upsert_connectivity_evidence",
        evidence: {
          id:
            priorClaim?.id ??
            deriveStableId(
              "connectivity-evidence",
              document.id,
              "power-marker",
              markerId,
              net.id,
            ),
          kind: "name-claim",
          netId: net.id,
          name,
          scope: "global",
          powerDomain: "vdd",
          owner: { kind: "power-marker", objectId: markerId },
        },
      });
      for (const annotation of document.annotations) {
        if (
          annotation.kind !== "power-label" ||
          annotation.anchor.kind !== "object" ||
          annotation.anchor.objectId !== markerId
        )
          continue;
        annotationEdits.push({
          kind: "upsert_schematic_annotation",
          annotation: {
            ...annotation,
            netId: net.id,
            binding: { kind: "net-name", netId: net.id },
          },
        });
      }
    }
    const removal = planRemoveCellTerminals(
      project,
      documentId,
      terminals.map((terminal) => terminal.id),
      [],
    );
    return removal.map((edit) =>
      edit.kind === "transact_document" && edit.documentId === documentId
        ? { ...edit, edits: [...edit.edits, ...annotationEdits] }
        : edit,
    );
  }

  if (selectedTerminal) return [];
  const blockingClaim = document.connectivityEvidence.find(
    (evidence) =>
      evidence.kind === "name-claim" &&
      evidence.netId === net.id &&
      evidence.scope === "global" &&
      !(
        evidence.owner.kind === "power-marker" &&
        markerIds.has(evidence.owner.objectId)
      ),
  );
  if (blockingClaim) {
    throw new Error(
      "This conductor still has another Global declaration; remove or change that owner before making VDD a Cell Pin",
    );
  }
  const claimNames = new Map<string, string>();
  for (const claim of ownedClaims) {
    const folded = foldNetName(claim.name);
    if (!claimNames.has(folded)) claimNames.set(folded, claim.name);
  }
  if (claimNames.size > 1) {
    throw new Error(
      "One physical VDD Net has several Global names; unify them before making it a Cell Pin",
    );
  }
  const name = [...claimNames.values()][0] ?? logicalName ?? "VDD";
  const occupiedIds = new Set([
    ...document.instances.map((item) => item.id),
    ...document.nets.map((item) => item.id),
    ...document.routes.map((item) => item.id),
    ...document.junctions.map((item) => item.id),
    ...document.annotations.map((item) => item.id),
    ...document.connectivityEvidence.map((item) => item.id),
    ...document.noConnects.map((item) => item.id),
    ...document.netlist.terminals.map((item) => item.id),
  ]);
  const edits: DocumentEdits = ownedClaims.map((claim) => ({
    kind: "remove_connectivity_evidence" as const,
    evidenceId: claim.id,
  }));
  for (const markerId of markerIds) {
    const existingTerminal = terminalByMarkerId.get(markerId);
    let terminalId =
      existingTerminal?.id ?? `terminal-${markerId.toLowerCase()}`;
    if (!existingTerminal) {
      let suffix = 2;
      while (occupiedIds.has(terminalId)) {
        terminalId = `terminal-${markerId.toLowerCase()}-${suffix}`;
        suffix += 1;
      }
      occupiedIds.add(terminalId);
      edits.push({
        kind: "add_cell_terminal",
        terminal: {
          id: terminalId,
          name,
          netId: net.id,
          direction: "inout",
          interfaceInstanceIds: [markerId],
        },
      });
    }
    for (const annotation of document.annotations) {
      if (
        annotation.kind !== "power-label" ||
        annotation.anchor.kind !== "object" ||
        annotation.anchor.objectId !== markerId
      )
        continue;
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          netId: net.id,
          binding: { kind: "cell-terminal-name", terminalId },
        },
      });
    }
  }
  return [transactDocument(project, documentId, edits)];
}

export function planUpdateCellTerminalDirection(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  direction: "input" | "output" | "inout" | "passive",
): ProjectStructureEdit[] {
  return [
    transactDocument(project, documentId, [
      { kind: "update_cell_terminal", terminalId, direction },
    ]),
  ];
}

/** Update every authored declaration represented by one projected formal Port. */
export function planUpdateCellPortDirection(
  project: CircuitProject,
  documentId: string,
  portId: string,
  direction: "input" | "output" | "inout" | "passive",
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const port = projectCellInterface(document.netlist).ports.find(
    (candidate) => candidate.id === portId,
  );
  if (!port)
    throw new Error(`Cell port does not exist: ${documentId}.${portId}`);
  const edits = port.terminalIds.flatMap((terminalId) => {
    const terminal = document.netlist?.terminals.find(
      (candidate) => candidate.id === terminalId,
    );
    return terminal?.direction === direction
      ? []
      : [
          {
            kind: "update_cell_terminal" as const,
            terminalId,
            direction,
          },
        ];
  });
  return edits.length > 0 ? [transactDocument(project, documentId, edits)] : [];
}

export function planReorderCellTerminal(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  delta: -1 | 1,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const terminals = document.netlist?.terminals ?? [];
  const index = terminals.findIndex((terminal) => terminal.id === terminalId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= terminals.length) return [];
  const terminalIds = terminals.map((terminal) => terminal.id);
  [terminalIds[index], terminalIds[next]] = [
    terminalIds[next]!,
    terminalIds[index]!,
  ];
  return [
    transactDocument(project, documentId, [
      { kind: "reorder_cell_terminals", terminalIds },
    ]),
  ];
}

/** Reorder projected formal Ports while keeping each Port's marker declarations together. */
export function planReorderCellPort(
  project: CircuitProject,
  documentId: string,
  portId: string,
  delta: -1 | 1,
): ProjectStructureEdit[] {
  const document = requireDocument(project, documentId);
  const ports = projectCellInterface(document.netlist).ports;
  const index = ports.findIndex((port) => port.id === portId);
  const next = index + delta;
  if (index < 0)
    throw new Error(`Cell port does not exist: ${documentId}.${portId}`);
  if (next < 0 || next >= ports.length) return [];
  const orderedGroups = ports.map((port) => [...port.terminalIds]);
  [orderedGroups[index], orderedGroups[next]] = [
    orderedGroups[next]!,
    orderedGroups[index]!,
  ];
  return [
    transactDocument(project, documentId, [
      {
        kind: "reorder_cell_terminals",
        terminalIds: orderedGroups.flat(),
      },
    ]),
  ];
}

export function proposeSetCellFormalParameters(
  project: CircuitProject,
  documentId: string,
  formalParameters: NonNullable<
    SchematicDocument["netlist"]
  >["formalParameters"],
): SubcircuitInterfaceProposal {
  const document = requireDocument(project, documentId);
  if (!document.netlist) {
    throw new Error(`Cell has no formal interface: ${documentId}`);
  }
  return interfaceProposal(project, { kind: "internal", id: documentId }, [
    transactDocument(project, documentId, [
      { kind: "set_cell_formal_parameters", formalParameters },
    ]),
  ]);
}

export function proposeUpsertExternalSubcircuitDefinition(
  project: CircuitProject,
  definition: ExternalSubcircuitDefinition,
): SubcircuitInterfaceProposal {
  const previous = project.externalSubcircuitDefinitions.find(
    (item) => item.id === definition.id,
  );
  const previousReviewed =
    previous &&
    resolveReviewedExternalBinding(
      previous.name,
      previous.terminals.map((item) => item.name),
    );
  if (
    previousReviewed &&
    (definition.name !== previous!.name ||
      JSON.stringify(definition.terminals) !==
        JSON.stringify(previous!.terminals) ||
      JSON.stringify(definition.formalParameters) !==
        JSON.stringify(previous!.formalParameters))
  ) {
    return interfaceProposal(
      project,
      { kind: "external", id: definition.id },
      [],
      [
        "Reviewed PDK interfaces are fixed. Edit device parameters on each instance.",
      ],
    );
  }
  const reviewed = resolveReviewedExternalBinding(
    definition.name,
    definition.terminals.map((terminal) => terminal.name),
  );
  const allowedPins = new Set(
    (reviewed
      ? reviewed.terminals.map((terminal) => terminal.pinName)
      : definition.terminals.map((terminal) => terminal.name)
    ).map((name) => name.toLowerCase()),
  );
  const diagnostics = project.documents.flatMap((document) =>
    document.instances.flatMap((instance) => {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "external-subcircuit" ||
        binding.definitionId !== definition.id
      ) {
        return [];
      }
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

export function planSetCellTerminalPlacement(
  project: CircuitProject,
  documentId: string,
  terminalId: string,
  side: CellSymbolSide | "auto",
  offset: number,
): ProjectStructureEdit[] {
  if (!Number.isInteger(offset) || offset % 10 !== 0) {
    throw new Error("Cell Pin position must be a multiple of 10");
  }
  const document = requireDocument(project, documentId);
  const current = document.presentation.cellSymbol;
  const pinPlacements = (current?.pinPlacements ?? []).filter(
    (placement) => placement.terminalId !== terminalId,
  );
  if (side !== "auto") pinPlacements.push({ terminalId, side, offset });
  return planSetCellSymbolPresentation(project, documentId, {
    ...(current?.minimumBodySize
      ? { minimumBodySize: current.minimumBodySize }
      : {}),
    ...(pinPlacements.length > 0 ? { pinPlacements } : {}),
  });
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
        if (!terminalRename || !annotation.formatOverride) return [];
        const { formatOverride: _formatOverride, ...rest } = annotation;
        const automaticFormat =
          JSON.stringify(annotation.formatOverride) ===
          JSON.stringify(semanticTextDocument(terminal.name, "formal-port"));
        return [
          {
            kind: "upsert_schematic_annotation" as const,
            annotation: {
              ...rest,
              ...(!automaticFormat
                ? {
                    formatOverride: rewriteRichTextPlainText(
                      annotation.formatOverride,
                      newName,
                    ),
                  }
                : {}),
            },
          },
        ];
      }
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
