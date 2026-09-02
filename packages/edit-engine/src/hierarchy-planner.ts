import type {
  Annotation,
  CellSymbolPresentation,
  CellSymbolSide,
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import { deriveStableId, projectCellInterface, routeEnd } from "@icm/model";
import {
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
} from "@icm/devices";
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
 * changes are strictly one-to-one. Neither path aliases or merges parent Nets.
 */
function planCallerInterfaceChanges(
  project: CircuitProject,
  childDocumentId: string,
  disappearingPinNames: readonly string[],
  pinRenames: readonly CallerPinRename[],
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
      edits: reconcileEdits,
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

/**
 * Switches a native device between its ordinary binding and one exact reviewed
 * external target without changing its authored reference or graphical pins.
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
  if (!["nmos", "pmos", "resistor", "capacitor"].includes(sourceSymbolId)) {
    throw new Error(
      "Only reviewed MOS, resistor, and capacitor targets use this Model field",
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
          ...(parameter.targetDefaultValue
            ? { defaultValue: parameter.targetDefaultValue }
            : {}),
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
    const reference = instance.reference!;
    const documentEdits: DocumentEdits = [];
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
      instance.reference !== reference ||
      Object.keys(set).length > 0 ||
      unset.length > 0
    ) {
      documentEdits.push({
        kind: "bulk_patch_instance_netlist",
        assignments: [
          {
            instanceId,
            reference,
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
  const reference = instance.reference!;
  if (normalizedName && symbolId !== "nmos" && symbolId !== "pmos") {
    throw new Error(
      `${symbolId} supports only the reviewed model suggestion in this release`,
    );
  }
  const binding =
    symbolId === "nmos" || symbolId === "pmos"
      ? normalizedName
        ? ({ kind: "model", deviceClass: "mos", name: normalizedName } as const)
        : undefined
      : ({
          kind: "primitive",
          deviceClass: symbolId === "resistor" ? "resistor" : "capacitor",
        } as const);
  const ordinaryParameterNames = new Set(
    (symbolId === "nmos" || symbolId === "pmos"
      ? ["w", "l", "nf", "m"]
      : ["value"]
    ).map((name) => name.toLowerCase()),
  );
  const unset = Object.keys(instance.netlist.parameters).filter(
    (name) => !ordinaryParameterNames.has(name.toLowerCase()),
  );
  const documentEdits: DocumentEdits = [];
  if (instance.symbolId !== symbolId) {
    documentEdits.push({ kind: "set_instance_symbol", instanceId, symbolId });
  }
  if (
    JSON.stringify(instance.netlist.binding ?? null) !==
      JSON.stringify(binding ?? null) ||
    instance.reference !== reference ||
    unset.length > 0
  ) {
    documentEdits.push({
      kind: "bulk_patch_instance_netlist",
      assignments: [
        {
          instanceId,
          reference,
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

/** Compatibility name for callers; behavior now covers all reviewed devices. */
export const planSetMosModelTarget = planSetDeviceModelTarget;

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

export function planCreateCellFromDraftingObject(
  project: CircuitProject,
  parentDocumentId: string,
  child: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  draftingObjectId: string,
): ProjectStructureEdit[] {
  const parent = requireDocument(project, parentDocumentId);
  if (project.documents.some((document) => document.id === child.id)) {
    throw new Error(`Document already exists: ${child.id}`);
  }
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "subcircuit" || binding.childDocumentId !== child.id) {
    throw new Error("Created hierarchy Instance must bind the new child Cell");
  }
  return [
    { kind: "add_document", document: child },
    {
      kind: "transact_document",
      documentId: parent.id,
      expectedRevision: parent.revision,
      edits: [
        { kind: "remove_drafting_object", objectId: draftingObjectId },
        { kind: "add_instance", instance },
      ],
    },
  ];
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
    input.instance.symbolId !== "port-filled"
  ) {
    throw new Error(
      `Cell interface marker must be a Port: ${input.instance.symbolId}`,
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

/**
 * Rename one external terminal while retaining its stable identity and every
 * connected caller projection. Reordering is separately safe because callers
 * connect by terminal identity/name while netlist extraction observes array order.
 */
export function planRenameExternalSubcircuitTerminal(
  project: CircuitProject,
  definitionId: string,
  terminalId: string,
  newName: string,
): ProjectStructureEdit[] {
  const definition = project.externalSubcircuitDefinitions.find(
    (candidate) => candidate.id === definitionId,
  );
  const terminal = definition?.terminals.find(
    (candidate) => candidate.id === terminalId,
  );
  if (!definition || !terminal) {
    throw new Error(
      `External terminal does not exist: ${definitionId}.${terminalId}`,
    );
  }
  if (
    definition.terminals.some(
      (candidate) =>
        candidate.id !== terminalId &&
        candidate.name.toLowerCase() === newName.toLowerCase(),
    )
  ) {
    throw new Error(`External terminal name already exists: ${newName}`);
  }
  if (terminal.name === newName) return [];
  const nextDefinition: ExternalSubcircuitDefinition = {
    ...definition,
    terminals: definition.terminals.map((candidate) =>
      candidate.id === terminalId ? { ...candidate, name: newName } : candidate,
    ),
  };
  const edits: ProjectStructureEdit[] = [
    {
      kind: "upsert_external_subcircuit_definition",
      definition: nextDefinition,
    },
  ];
  for (const document of project.documents) {
    const callerEdits: DocumentEdits = [];
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "external-subcircuit" ||
        binding.definitionId !== definitionId
      ) {
        continue;
      }
      const referenced =
        document.nets.some((net) =>
          net.terminals.some(
            (reference) =>
              reference.instanceId === instance.id &&
              reference.pinName === terminal.name,
          ),
        ) ||
        document.routes.some((route) =>
          [route.start, routeEnd(route)].some(
            (endpoint) =>
              endpoint.kind === "terminal" &&
              endpoint.instanceId === instance.id &&
              endpoint.pinName === terminal.name,
          ),
        ) ||
        document.noConnects.some(
          (noConnect) =>
            noConnect.endpoint.instanceId === instance.id &&
            noConnect.endpoint.pinName === terminal.name,
        ) ||
        (instance.importProvenance?.terminalMapping ?? []).some(
          (reference) => reference.pinName === terminal.name,
        );
      if (!referenced) continue;
      callerEdits.push({
        kind: "set_instance_symbol",
        instanceId: instance.id,
        symbolId: externalSubcircuitSymbolId(definitionId),
        pinMap: { [terminal.name]: newName },
      });
    }
    if (callerEdits.length > 0)
      edits.push(transactDocument(project, document.id, callerEdits));
  }
  return edits;
}

export function planReorderExternalSubcircuitTerminal(
  project: CircuitProject,
  definitionId: string,
  terminalId: string,
  delta: -1 | 1,
): ProjectStructureEdit[] {
  const definition = project.externalSubcircuitDefinitions.find(
    (candidate) => candidate.id === definitionId,
  );
  if (!definition)
    throw new Error(`External subcircuit does not exist: ${definitionId}`);
  const index = definition.terminals.findIndex(
    (terminal) => terminal.id === terminalId,
  );
  const nextIndex = index + delta;
  if (index < 0)
    throw new Error(
      `External terminal does not exist: ${definitionId}.${terminalId}`,
    );
  if (nextIndex < 0 || nextIndex >= definition.terminals.length) return [];
  const terminals = [...definition.terminals];
  [terminals[index], terminals[nextIndex]] = [
    terminals[nextIndex]!,
    terminals[index]!,
  ];
  return [
    {
      kind: "upsert_external_subcircuit_definition",
      definition: { ...definition, terminals },
    },
  ];
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
        return [
          {
            kind: "upsert_schematic_annotation" as const,
            annotation: rest,
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

    // A renamed Pin can either move a formal port one-to-one or make the old
    // formal port disappear by joining a group that already existed. Only the
    // former is a rename; the latter must detach the old caller endpoint.
    if (
      beforePort.key === selectedBeforePort.key &&
      !beforeByKey.has(selectedAfterPort.key)
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
  );
  return [...callerChanges.beforeChild, childEdit, ...callerChanges.afterChild];
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
): ProjectStructureEdit[] {
  const renameEdits = planRenameCellTerminal(
    project,
    documentId,
    terminalId,
    newName,
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

export function planExposePortInstance(
  project: CircuitProject,
  documentId: string,
  terminal: {
    id: string;
    name: string;
    netId: string;
    direction: "input" | "output" | "inout" | "passive";
    interfaceInstanceIds: string[];
  },
): ProjectStructureEdit[] {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error(`Document does not exist: ${documentId}`);
  return [
    {
      kind: "transact_document",
      documentId,
      expectedRevision: document.revision,
      edits: [{ kind: "add_cell_terminal", terminal }],
    },
  ];
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
    ...terminals.map((terminal) => ({
      kind: "remove_cell_terminal" as const,
      terminalId: terminal.id,
    })),
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
