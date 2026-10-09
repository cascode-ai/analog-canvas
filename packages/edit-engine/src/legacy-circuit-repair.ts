import {
  ComponentDefinitionSchema,
  circuitComponentIssues,
  deriveStableId,
  type CircuitProject,
  type ComponentDefinition,
  type ExternalSubcircuitDefinition,
} from "@icm/model";
import { instanceReferencesPin } from "./cell-interface-change-planner.js";
import { planTerminalDeletion } from "./instance-lifecycle.js";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
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
export interface LegacyCircuitRepairOptions {
  /** Captured concurrency precondition, independent of the editable candidate. */
  baseline?: ComponentDefinition;
  selected?: { documentId: string; instanceId: string };
  implementation?: Extract<
    ProjectStructureEdit,
    { kind: "apply_model_source" }
  >;
  disconnectPorts?: string[];
}

/** Persist a repair candidate without capturing artwork or changing legacy instances. */
export function prepareLegacyCircuitDraft(
  project: CircuitProject,
  baseline: ComponentDefinition,
  identity: string,
  input: ProjectStructureEdit[],
  definitionId: string,
  selected?: LegacyCircuitRepairOptions["selected"],
  disconnectPorts: string[] = [],
) {
  const edits = structuredClone(input).map((edit): ProjectStructureEdit => {
    if (edit.kind === "upsert_external_subcircuit_definition") {
      const { symbolId: _symbolId, ...definition } = edit.definition;
      return { ...edit, definition };
    }
    if (edit.kind !== "save_model_source_draft") return edit;
    const source = project.modelSources?.find(
      (source) => source.id === edit.sourceId,
    );
    const useAppliedSource =
      !!source &&
      source.language === (edit.language ?? source.language) &&
      source.entry === edit.entry &&
      JSON.stringify(source.files) === JSON.stringify(edit.files) &&
      JSON.stringify(source.dependencies) === JSON.stringify(edit.dependencies);
    const authoring = (edit.authoring ?? []).map((candidate) =>
      candidate.definitionId !== definitionId
        ? candidate
        : {
            ...candidate,
            legacyRepair: {
              identity,
              baseline,
              ...(selected ? { selected } : {}),
              ...(disconnectPorts.length ? { disconnectPorts } : {}),
              ...(useAppliedSource ? { useAppliedSource: true } : {}),
            },
          },
    );
    return {
      ...edit,
      ...(useAppliedSource && source?.draft
        ? {
            language: source.draft.language ?? source.language,
            entry: source.draft.entry,
            files: source.draft.files,
            dependencies: source.draft.dependencies ?? source.dependencies,
          }
        : {}),
      authoring,
    };
  });
  const saved = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "repair-draft-" + identity,
    actor: { kind: "human", id: "repair-draft" },
    edits,
  });
  if (!saved.ok)
    throw Error(saved.diagnostics[0]?.message ?? saved.error.message);
  return {
    edits,
    savedProject: saved.project,
    repair: prepareLegacyCircuitRepair(
      saved.project,
      baseline,
      identity,
      selected ? { selected } : {},
    ),
  };
}

/** Preview an explicit repair of this captured class; no implementation is inferred. */
export function prepareLegacyCircuitRepair(
  project: CircuitProject,
  legacy: ComponentDefinition,
  identity: string,
  options: LegacyCircuitRepairOptions = {},
): LegacyCircuitRepair {
  legacy = ComponentDefinitionSchema.parse(legacy);
  if (!legacy.subcircuit || legacy.circuitBinding || legacy.electrical)
    throw Error("Select an interface-only circuit component to repair.");
  const definitionId = deriveStableId("repaired-model", identity);
  const symbolId = deriveStableId("repaired-artwork", identity);
  const savedOwner = project.externalSubcircuitDefinitions.find(
    (owner) => owner.id === definitionId,
  );
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
    implementation: {
      kind: "placeholder",
      ...(savedOwner?.implementation?.sourceId
        ? { sourceId: savedOwner.implementation.sourceId }
        : {}),
    },
    symbolId,
  };
  if (options.implementation)
    return prepareLegacyCircuitApplication(
      project,
      options.baseline ?? legacy,
      identity,
      options.implementation,
      options.selected,
      definition,
      options.disconnectPorts,
    );
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
  return finishRepair(
    project,
    options.baseline ?? legacy,
    identity,
    definitionId,
    symbolId,
    edits,
    {},
    options.selected,
  );
}

/** Apply the current native candidate and migrate the original class in one transaction. */
function prepareLegacyCircuitApplication(
  project: CircuitProject,
  baseline: ComponentDefinition,
  identity: string,
  implementation: Extract<ProjectStructureEdit, { kind: "apply_model_source" }>,
  selected?: LegacyCircuitRepairOptions["selected"],
  placeholder?: ExternalSubcircuitDefinition,
  disconnectPorts: string[] = [],
): LegacyCircuitRepair {
  if (!baseline.subcircuit || baseline.circuitBinding || baseline.electrical)
    throw Error("Select an interface-only circuit component to repair.");
  const target = implementation.definitions[0];
  if (!target) throw Error("Repair one explicitly selected circuit owner.");
  const edits: ProjectStructureEdit[] = [];
  if (
    placeholder?.id === target.definitionId &&
    !project.externalSubcircuitDefinitions.some(
      (definition) => definition.id === placeholder.id,
    )
  ) {
    const { symbolId: _symbolId, ...definition } = placeholder;
    edits.push({ kind: "upsert_external_subcircuit_definition", definition });
  }
  edits.push(implementation);
  const preview = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "repair-candidate-" + identity,
    actor: { kind: "human", id: "repair-preview" },
    edits,
  });
  if (!preview.ok)
    throw Error(preview.diagnostics[0]?.message ?? preview.error.message);
  const packaged = buildCircuitComponentPackage(
    preview.project,
    target.definitionId,
  );
  const owner = packaged.circuit.externalDefinition;
  const component = packaged.definition;
  const names: Record<string, string | null> = {};
  if (
    disconnectPorts.some(
      (name) => !baseline.subcircuit!.ports.some((port) => port.name === name),
    )
  )
    throw Error("Choose an existing legacy port to disconnect.");
  for (const port of baseline.subcircuit.ports) {
    if (disconnectPorts.includes(port.name)) {
      names[port.name] = null;
      continue;
    }
    const matches = component.circuitBinding!.terminals.filter((mapping) =>
      "pinName" in port
        ? "pinName" in mapping && mapping.pinName === port.pinName
        : "supply" in mapping && mapping.supply === port.supply,
    );
    if (matches.length === 1)
      names[port.name] = owner.terminals.find(
        (terminal) => terminal.id === matches[0]!.terminalId,
      )!.name;
    else if (
      project.documents.some((document) =>
        document.instances.some(
          (instance) =>
            instance.symbolId === baseline.symbol.id &&
            (!selected ||
              (document.id === selected.documentId &&
                instance.id === selected.instanceId)) &&
            instanceReferencesPin(
              document,
              instance.id,
              "pinName" in port ? port.pinName : port.supply,
            ),
        ),
      )
    )
      throw Error(
        "Connected legacy port " +
          port.name +
          " requires an explicit mapping before Apply.",
      );
  }
  // Referencing an unchanged owner captures only the artwork, preserving its source revision and private draft.
  const previous = project.modelSources?.find(
    (source) => source.id === implementation.source.id,
  );
  const existingOwner = project.externalSubcircuitDefinitions.find(
    (definition) => definition.id === owner.id,
  );
  const unchangedSource =
    previous &&
    previous.revision === implementation.source.revision &&
    previous.language === implementation.source.language &&
    previous.entry === implementation.source.entry &&
    JSON.stringify(previous.files) ===
      JSON.stringify(implementation.source.files) &&
    JSON.stringify(previous.dependencies) ===
      JSON.stringify(implementation.source.dependencies);
  if (
    unchangedSource &&
    existingOwner &&
    JSON.stringify(existingOwner.terminals) ===
      JSON.stringify(owner.terminals) &&
    JSON.stringify(existingOwner.presentation) ===
      JSON.stringify(owner.presentation)
  ) {
    const appliedPackage = buildCircuitComponentPackage(
      {
        ...project,
        modelSources: project.modelSources!.map(
          ({ draft: _draft, ...source }) => source,
        ),
      },
      existingOwner.id,
    );
    const captured = planCircuitComponentCapture(
      project,
      {
        ...appliedPackage,
        definition: component,
        circuit: {
          ...appliedPackage.circuit,
          externalDefinition: {
            ...existingOwner,
            symbolId: component.symbol.id,
          },
        },
      },
      identity,
    );
    const draft = previous.draft;
    if (
      draft?.authoring?.some(
        (candidate) =>
          candidate.definitionId === owner.id && candidate.legacyRepair,
      )
    ) {
      const authoring = draft.authoring.filter(
        (candidate) =>
          !(candidate.definitionId === owner.id && candidate.legacyRepair),
      );
      if (
        !authoring.length &&
        (draft.language ?? previous.language) === previous.language &&
        draft.entry === previous.entry &&
        JSON.stringify(draft.files) === JSON.stringify(previous.files) &&
        JSON.stringify(draft.dependencies ?? previous.dependencies) ===
          JSON.stringify(previous.dependencies)
      )
        captured.edits.push({
          kind: "discard_model_source_draft",
          sourceId: previous.id,
          expectedRevision: previous.revision,
          expectedDraft: draft,
        });
      else
        captured.edits.push({
          kind: "save_model_source_draft",
          sourceId: previous.id,
          expectedRevision: previous.revision,
          language: draft.language ?? previous.language,
          entry: draft.entry,
          files: draft.files,
          dependencies: draft.dependencies ?? previous.dependencies,
          authoring,
        });
    }
    return finishRepair(
      project,
      baseline,
      identity,
      captured.definitionId,
      captured.symbolId,
      captured.edits,
      names,
      selected,
    );
  }
  return finishRepair(
    project,
    baseline,
    identity,
    owner.id,
    component.symbol.id,
    edits,
    names,
    selected,
  );
}

function finishRepair(
  project: CircuitProject,
  legacy: ComponentDefinition,
  identity: string,
  definitionId: string,
  symbolId: string,
  edits: ProjectStructureEdit[],
  names: Record<string, string | null> = {},
  selected?: { documentId: string; instanceId: string },
): LegacyCircuitRepair {
  const captured = project.componentDefinitions?.find(
    (d) => d.symbol.id === legacy.symbol.id,
  );
  if (captured && JSON.stringify(captured) !== JSON.stringify(legacy))
    throw Error("The captured component changed. Reopen it before repairing.");
  if (
    selected &&
    !project.documents.some(
      (document) =>
        document.id === selected.documentId &&
        document.instances.some(
          (instance) =>
            instance.id === selected.instanceId &&
            instance.symbolId === legacy.symbol.id,
        ),
    )
  )
    throw Error("The selected component changed. Reopen it before repairing.");
  for (const document of project.documents) {
    const changes: SchematicEdit[] = [];
    for (const instance of document.instances.filter(
      (i) =>
        i.symbolId === legacy.symbol.id &&
        (!selected ||
          (document.id === selected.documentId &&
            i.id === selected.instanceId)),
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
          if (names[port.name] === null) return [];
          const old = "pinName" in port ? port.pinName : port.supply;
          const name = names[port.name] ?? port.name;
          return old !== name &&
            instanceReferencesPin(document, instance.id, old)
            ? [[old, name]]
            : [];
        }),
      );
      const removed = legacy
        .subcircuit!.ports.filter((port) => names[port.name] === null)
        .map((port) => ({
          instanceId: instance.id,
          pinName: "pinName" in port ? port.pinName : port.supply,
        }));
      if (removed.length)
        changes.push(
          ...planTerminalDeletion(
            document,
            createProjectSymbolResolver(project, builtInSymbols),
            removed,
            changes.length,
          ),
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
