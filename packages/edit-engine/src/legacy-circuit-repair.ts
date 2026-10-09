import {
  ComponentDefinitionSchema,
  circuitComponentIssues,
  deriveStableId,
  type CircuitProject,
  type ComponentDefinition,
  type ExternalSubcircuitDefinition,
} from "@icm/model";
import { instanceReferencesPin } from "./cell-interface-change-planner.js";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import type { SchematicEdit } from "./edit-schema.js";
import {
  buildCircuitComponentPackage,
  planCircuitComponentCapture,
} from "./circuit-component-package.js";

export interface LegacyCircuitRepair {
  expectedProject: CircuitProject;
  project: CircuitProject;
  definitionId: string;
  symbolId: string;
  edits: ProjectStructureEdit[];
}

/** Preview an explicit repair of this captured class; no implementation is inferred. */
export function prepareLegacyCircuitRepair(
  project: CircuitProject,
  legacy: ComponentDefinition,
  identity: string,
): LegacyCircuitRepair {
  legacy = ComponentDefinitionSchema.parse(legacy);
  if (!legacy.subcircuit || legacy.circuitBinding || legacy.electrical)
    throw Error("Select an interface-only circuit component to repair.");
  const definitionId = deriveStableId("repaired-model", identity);
  const symbolId = deriveStableId("repaired-artwork", identity);
  let name = legacy.subcircuit.target;
  let suffix = 0;
  while (
    project.externalSubcircuitDefinitions.some(
      (d) => d.name.toLowerCase() === name.toLowerCase(),
    )
  )
    name = `${legacy.subcircuit.target}_repair${++suffix}`;
  const definition: ExternalSubcircuitDefinition = {
    id: definitionId,
    name,
    terminals: legacy.subcircuit.ports.map((port) => ({
      id: deriveStableId("legacy-terminal", definitionId, port.name),
      name: port.name,
      direction: port.direction,
    })),
    formalParameters: [],
    interfaceStatus: "declared",
    implementation: { kind: "placeholder" },
    symbolId,
  };
  const component = ComponentDefinitionSchema.parse({
    symbol: { ...structuredClone(legacy.symbol), id: symbolId },
    circuitBinding: {
      definitionId,
      terminals: legacy.subcircuit.ports.map((port, index) => ({
        terminalId: definition.terminals[index]!.id,
        ...("pinName" in port
          ? { pinName: port.pinName }
          : { supply: port.supply }),
      })),
    },
  });
  const issue = circuitComponentIssues(component, definition)[0];
  if (issue) throw Error(`${issue.path.join(".")}: ${issue.message}`);
  const edits: ProjectStructureEdit[] = [
    { kind: "upsert_external_subcircuit_definition", definition },
    { kind: "capture_component_definition", definition: component },
  ];
  return finishRepair(project, legacy, identity, definitionId, symbolId, edits);
}

/** Attach only the explicitly selected applied model, retaining private destination drafts. */
export function prepareLegacyCircuitAttachment(
  project: CircuitProject,
  legacy: ComponentDefinition,
  models: CircuitProject,
  modelId: string,
  portMap: Record<string, string>,
  identity: string,
): LegacyCircuitRepair {
  legacy = ComponentDefinitionSchema.parse(legacy);
  if (!legacy.subcircuit || legacy.circuitBinding || legacy.electrical)
    throw Error("Select an interface-only circuit component to repair.");
  const applied = {
    ...models,
    modelSources: models.modelSources?.map(
      ({ draft: _draft, ...source }) => source,
    ),
  };
  const packaged = buildCircuitComponentPackage(applied, modelId);
  const owner = packaged.circuit.externalDefinition;
  if (
    Object.keys(portMap).some(
      (name) => !legacy.subcircuit!.ports.some((port) => port.name === name),
    )
  )
    throw Error("Unknown legacy port in the proposed mapping.");
  const component = ComponentDefinitionSchema.parse({
    symbol: {
      ...structuredClone(legacy.symbol),
      id: deriveStableId("repaired-artwork", identity),
    },
    circuitBinding: {
      definitionId: owner.id,
      terminals: legacy.subcircuit.ports.map((port) => {
        const terminal = owner.terminals.find(
          (t) => t.name === portMap[port.name],
        );
        if (!terminal)
          throw Error(`Choose a native terminal for legacy ${port.name}.`);
        return {
          terminalId: terminal.id,
          ...("pinName" in port
            ? { pinName: port.pinName }
            : { supply: port.supply }),
        };
      }),
    },
  });
  const issue = circuitComponentIssues(component, owner)[0];
  if (issue) throw Error(`${issue.path.join(".")}: ${issue.message}`);
  const captured = planCircuitComponentCapture(
    project,
    {
      definition: component,
      circuit: {
        ...packaged.circuit,
        externalDefinition: { ...owner, symbolId: component.symbol.id },
      },
    },
    identity,
  );
  return finishRepair(
    project,
    legacy,
    identity,
    captured.definitionId,
    captured.symbolId,
    captured.edits,
    portMap,
  );
}

function finishRepair(
  project: CircuitProject,
  legacy: ComponentDefinition,
  identity: string,
  definitionId: string,
  symbolId: string,
  edits: ProjectStructureEdit[],
  names: Record<string, string> = {},
): LegacyCircuitRepair {
  const captured = project.componentDefinitions?.find(
    (d) => d.symbol.id === legacy.symbol.id,
  );
  if (captured && JSON.stringify(captured) !== JSON.stringify(legacy))
    throw Error("The captured component changed. Reopen it before repairing.");
  for (const document of project.documents) {
    const changes: SchematicEdit[] = [];
    for (const instance of document.instances.filter(
      (i) => i.symbolId === legacy.symbol.id,
    )) {
      const binding = instance.netlist?.binding;
      if (
        binding &&
        (binding.kind !== "unresolved-subcircuit" ||
          binding.name !== legacy.subcircuit!.target)
      )
        throw Error(
          "This captured class is already bound. Reopen its native definition.",
        );
      const pinMap = Object.fromEntries(
        legacy.subcircuit!.ports.flatMap((port) => {
          const old = "pinName" in port ? port.pinName : port.supply;
          const name = names[port.name] ?? port.name;
          return old !== name &&
            instanceReferencesPin(document, instance.id, old)
            ? [[old, name]]
            : [];
        }),
      );
      changes.push(
        {
          kind: "set_instance_symbol",
          instanceId: instance.id,
          symbolId,
          ...(instance.symbolVariantId
            ? { symbolVariantId: instance.symbolVariantId }
            : {}),
          pinMap,
        },
        {
          kind: "set_instance_binding",
          instanceId: instance.id,
          binding: { kind: "external-subcircuit", definitionId },
        },
      );
    }
    if (changes.length)
      edits.push({
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: changes,
      });
  }
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: `repair-preview-${identity}`,
    actor: { kind: "human", id: "repair-preview" },
    edits,
  });
  if (!result.ok)
    throw Error(result.diagnostics[0]?.message ?? result.error.message);
  return {
    expectedProject: project,
    project: result.project,
    definitionId,
    symbolId,
    edits,
  };
}
