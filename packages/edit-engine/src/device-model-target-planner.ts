// Switching a device between its ordinary binding and one reviewed external
// model target, without renaming the Instance.
import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import { deriveStableId, projectCellInterface } from "@icm/model";
import {
  builtInModelDefaults,
  deviceDescriptor,
  matchGateCellPins,
  resolveReviewedExternalBinding,
  reviewedExternalBindingForMaster,
  reviewedExternalBindingSupportsSymbol,
  reviewedExternalModelSuggestions,
  standardCellBindingForMaster,
  subcircuitDescriptor,
} from "@icm/devices";
import type { ProjectStructureEdit } from "./project-transaction.js";
import {
  requireDocument,
  transactDocument,
  type DocumentEdits,
} from "./cell-document-edits.js";

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
  if (!definition || definition.presentation || definition.implementation)
    return undefined;
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

/** Whether a Cell calls `targetId`, itself or through the Cells it places. */
function cellReaches(
  project: CircuitProject,
  cellId: string,
  targetId: string,
): boolean {
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return (
      project.documents.find((document) => document.id === id)?.instances ?? []
    ).some((instance) => {
      const binding = instance.netlist?.binding;
      return binding?.kind === "subcircuit" && visit(binding.childDocumentId);
    });
  };
  return visit(cellId);
}

/** A Document with a formal interface: a Cell a part can call. */
type Cell = SchematicDocument & {
  netlist: NonNullable<SchematicDocument["netlist"]>;
};
const isCell = (document: SchematicDocument): document is Cell =>
  Boolean(document.netlist);

function cellPinMatch(cell: Cell, symbolId: string) {
  return matchGateCellPins(symbolId, {
    name: cell.netlist.name,
    portNames: projectCellInterface(cell.netlist).ports.map(
      (port) => port.name,
    ),
  });
}

/**
 * The Cells of the Project a Library gate drawn in this Document may call
 * (#1450): those whose Pins fit the gate, and none that would call the
 * Document itself.
 */
export function gateCellTargets(
  project: CircuitProject,
  documentId: string,
  symbolId: string,
): Cell[] {
  return project.documents
    .filter(isCell)
    .filter(
      (cell) =>
        cellPinMatch(cell, symbolId)?.ok &&
        !cellReaches(project, cell.id, documentId),
    );
}

/** A Cell of the Project by its name, as SPICE compares names, or its ID. */
function projectCellNamed(
  project: CircuitProject,
  name: string,
): Cell | undefined {
  const folded = name.toLowerCase();
  const cells = project.documents.filter(isCell);
  return (
    cells.find((cell) => cell.netlist.name.toLowerCase() === folded) ??
    cells.find((cell) => cell.name.toLowerCase() === folded) ??
    cells.find((cell) => cell.id === name)
  );
}

/**
 * Binds a Library gate to a transistor-level Cell of its Project (#1450).
 * The gate keeps its symbol and pins; its call goes to the Cell, Pin by
 * name. Its own parameters give way to the Cell's, and a VDD or VSS Net it
 * was given is cleared where the Cell takes that supply globally.
 */
function planGateCellBinding(
  project: CircuitProject,
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  netlist: NonNullable<SchematicDocument["instances"][number]["netlist"]>,
  cell: Cell,
): ProjectStructureEdit[] {
  const name = cell.netlist.name;
  const gateName = instance.reference ?? instance.id;
  if (cellReaches(project, cell.id, document.id))
    throw new Error(
      cell.id === document.id
        ? `${gateName} is drawn in Cell ${name}, which cannot call itself`
        : `Cell ${name} contains Cell ${document.name}, where ${gateName} is drawn; a Cell cannot call itself`,
    );
  const match = cellPinMatch(cell, instance.symbolId);
  if (match && !match.ok) throw new Error(match.message);
  const supplies = new Set(match?.pins.map((pin) => pin.supply));
  const documentEdits: DocumentEdits = (["VDD", "VSS"] as const)
    .filter(
      (supply) =>
        !supplies.has(supply) &&
        document.nets.some((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id &&
              terminal.pinName === supply,
          ),
        ),
    )
    .map((supply) => ({
      kind: "set_property_terminal_net" as const,
      instanceId: instance.id,
      pinName: supply,
      netId: null,
    }));
  const binding = { kind: "subcircuit" as const, childDocumentId: cell.id };
  const formals = new Set(
    cell.netlist.formalParameters.map((parameter) =>
      parameter.name.toLowerCase(),
    ),
  );
  const unset = Object.keys(netlist.parameters).filter(
    (parameter) => !formals.has(parameter.toLowerCase()),
  );
  if (
    JSON.stringify(netlist.binding ?? null) !== JSON.stringify(binding) ||
    unset.length > 0
  )
    documentEdits.push({
      kind: "bulk_patch_instance_netlist",
      assignments: [
        {
          instanceId: instance.id,
          binding,
          ...(unset.length ? { unset } : {}),
        },
      ],
    });
  return documentEdits.length
    ? [transactDocument(project, document.id, documentEdits)]
    : [];
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
  const currentExternal =
    instance.netlist.binding?.kind === "external-subcircuit"
      ? matchingReviewedExternalDefinition(
          project,
          instance.netlist.binding.definitionId,
        )
      : undefined;
  // A part drawn with a block symbol returns to the symbol its reviewed
  // device is drawn with. A part drawn as a built-in device keeps its own:
  // clearing the model of a Var Cap bound to the varactor before #1298
  // leaves an ideal Var Cap, not a plain capacitor.
  const sourceSymbolId =
    currentExternal && !deviceDescriptor(instance.symbolId)
      ? currentExternal.binding.symbolId
      : instance.symbolId;
  const sourceDescriptor = deviceDescriptor(sourceSymbolId);
  // A Library logic gate has no device descriptor; its reviewed targets are
  // standard cells of its function, and clearing returns it to its ideal
  // body with that body's parameters (#1450).
  const gate = sourceDescriptor
    ? undefined
    : subcircuitDescriptor(sourceSymbolId, project);
  const gateTargets = gate
    ? reviewedExternalModelSuggestions(sourceSymbolId)
    : [];
  // A gate's target may be any standard cell, so that one of another
  // function is refused by name below.
  const targetBinding = normalizedName
    ? (reviewedExternalBindingForMaster(normalizedName) ??
      (gateTargets.length > 0
        ? standardCellBindingForMaster(normalizedName)
        : undefined))
    : undefined;
  if (gate && gateTargets.length > 0) {
    // A Cell of the Project comes first: the Project defines that name.
    const cell = normalizedName
      ? projectCellNamed(project, normalizedName)
      : undefined;
    if (cell)
      return planGateCellBinding(
        project,
        document,
        instance,
        instance.netlist,
        cell,
      );
    if (!targetBinding && normalizedName) {
      const cells = gateCellTargets(project, documentId, sourceSymbolId).map(
        (candidate) => candidate.netlist.name,
      );
      throw new Error(
        `${normalizedName} is neither a Cell of this Project nor a reviewed standard cell for ${sourceSymbolId}; use ${[...cells, ...gateTargets].join(", ")}`,
      );
    }
    if (!targetBinding) {
      // The gate's VDD/VSS Nets are its own supply choice and stay.
      const binding = {
        kind: "unresolved-subcircuit" as const,
        name: gate.target,
      };
      if (
        JSON.stringify(instance.netlist.binding ?? null) ===
        JSON.stringify(binding)
      )
        return [];
      const set = Object.fromEntries(
        Object.entries(builtInModelDefaults(gate.target)).filter(
          ([name]) => instance.netlist!.parameters[name] === undefined,
        ),
      );
      return [
        transactDocument(project, documentId, [
          {
            kind: "bulk_patch_instance_netlist",
            assignments: [
              {
                instanceId,
                binding,
                ...(Object.keys(set).length ? { set } : {}),
              },
            ],
          },
        ]),
      ];
    }
  } else if (
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
    if (!reviewedExternalBindingSupportsSymbol(targetBinding, sourceSymbolId)) {
      throw new Error(
        `${normalizedName} is not compatible with the selected ${sourceSymbolId}: it is a ${targetBinding.symbolId} model. Place a ${targetBinding.symbolId} to use it.`,
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
    const verified =
      definition.presentation || definition.implementation
        ? undefined
        : resolveReviewedExternalBinding(
            definition.name,
            definition.terminals.map((terminal) => terminal.name),
            sourceSymbolId,
          );
    if (
      !verified ||
      !reviewedExternalBindingSupportsSymbol(verified, sourceSymbolId)
    ) {
      throw new Error(
        `Existing external definition ${definition.name} does not match its reviewed public terminal order`,
      );
    }
    const symbolId = sourceSymbolId;
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
    const set: Record<string, string> = Object.fromEntries(
      verified.parameters.flatMap((parameter) =>
        instance.netlist!.parameters[parameter.name] === undefined &&
        parameter.defaultValue !== undefined
          ? [[parameter.name, parameter.defaultValue]]
          : [],
      ),
    );
    // A size the device has no model at (SKY130's 16 V pair) is fitted by the
    // transaction that applies this edit (#1483, #1485).
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

  // Only a device reaches here: a gate's target is bound or cleared above.
  if (!sourceDescriptor) {
    throw new Error(
      "The selected device does not accept an explicit model target",
    );
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
