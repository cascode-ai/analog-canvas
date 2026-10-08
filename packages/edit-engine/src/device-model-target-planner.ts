// Switching a device between its ordinary binding and one reviewed external
// model target, without renaming the Instance.
import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  SchematicDocument,
} from "@icm/model";
import { deriveStableId } from "@icm/model";
import {
  builtInModelDefaults,
  deviceDescriptor,
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
    if (!targetBinding && normalizedName) {
      throw new Error(
        `${normalizedName} is not a reviewed standard cell for ${sourceSymbolId}; use ${gateTargets.join(", ")}`,
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
