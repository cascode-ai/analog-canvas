import {
  deriveStableId,
  type CircuitProject,
  type ComponentDefinition,
  type Instance,
} from "@icm/model";
import { namespaceModelSource, inspectProjectModelSource } from "@icm/netlist";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "./project-transaction.js";
import { buildCircuitComponentPackage } from "./circuit-component-package.js";
import { instanceReferencesPin } from "./cell-interface-change-planner.js";

type SourceApply = Extract<
  ProjectStructureEdit,
  { kind: "apply_model_source" }
>;

/** Artwork edits use the same captured class through GUI and Agent transactions. */
export function componentDefaultNetlist(
  definition: ComponentDefinition,
): Instance["netlist"] {
  const electrical = definition.electrical;
  if (!electrical && !definition.subcircuit) return undefined;
  return {
    ...(definition.subcircuit
      ? {
          binding: {
            kind: "unresolved-subcircuit" as const,
            name: definition.subcircuit.target,
          },
        }
      : electrical?.targetPolicy === "builtin"
        ? {
            binding: {
              kind: "primitive" as const,
              deviceClass: electrical.deviceClass,
            },
          }
        : {}),
    parameters: Object.fromEntries(
      (electrical?.parameters ?? []).flatMap((p) =>
        p.defaultValue === undefined ? [] : [[p.name, p.defaultValue]],
      ),
    ),
  };
}

export function planComponentArtworkApply(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  definition: ComponentDefinition,
  scope: "instance" | "definition" = "definition",
): ProjectStructureEdit[] {
  const selected = project.documents
    .find((d) => d.id === documentId)
    ?.instances.find((i) => i.id === instanceId);
  if (!selected) throw Error("Select an existing component instance");
  if (
    selected.netlist?.binding?.kind === "external-subcircuit" ||
    selected.netlist?.binding?.kind === "subcircuit"
  )
    throw Error("Edit the circuit source and its bound artwork together");
  const previous = project.componentDefinitions?.find(
    (d) => d.symbol.id === selected.symbolId,
  );
  const next = structuredClone(definition);
  if (previous?.libraryOrigin) next.libraryOrigin = previous.libraryOrigin;
  const compatible =
    previous?.electrical?.deviceClass === next.electrical?.deviceClass &&
    previous?.subcircuit?.target === next.subcircuit?.target;
  const edits: ProjectStructureEdit[] = [
    { kind: "capture_component_definition", definition: next },
  ];
  for (const document of project.documents) {
    const callers = document.instances.filter((i) =>
      scope === "definition"
        ? i.symbolId === selected.symbolId
        : document.id === documentId && i.id === instanceId,
    );
    if (!callers.length) continue;
    for (const caller of callers) {
      for (const pin of previous?.symbol.pins ?? []) {
        if (
          !next.symbol.pins.some((p) => p.name === pin.name) &&
          instanceReferencesPin(document, caller.id, pin.name)
        )
          throw Error(
            `Disconnect ${caller.reference}.${pin.name} before removing its Pin`,
          );
      }
    }
    edits.push({
      kind: "transact_document",
      documentId: document.id,
      expectedRevision: document.revision,
      edits: callers.flatMap((i) => [
        ...(!compatible
          ? [
              {
                kind: "set_instance_netlist" as const,
                instanceId: i.id,
                netlist: componentDefaultNetlist(next) ?? { parameters: {} },
              },
            ]
          : []),
        {
          kind: "set_instance_symbol" as const,
          instanceId: i.id,
          symbolId: next.symbol.id,
          ...(i.symbolVariantId &&
          next.symbol.variants.some((v) => v.id === i.symbolVariantId)
            ? { symbolVariantId: i.symbolVariantId }
            : {}),
        },
      ]),
    });
  }
  return edits;
}

/** Definition editing follows the native owner, never a name or a single artwork capture. */
export function planComponentDefinitionApply(
  project: CircuitProject,
  edit: SourceApply,
): SourceApply {
  const previous = project.modelSources?.find((s) => s.id === edit.source.id);
  const selected = new Set(
    edit.authoringDefinitionIds ?? edit.definitions.map((d) => d.definitionId),
  );
  const otherOwners = project.externalSubcircuitDefinitions.filter(
    (d) =>
      d.implementation?.kind === "source" &&
      d.implementation.sourceId === edit.source.id &&
      !selected.has(d.id),
  );
  if (
    previous &&
    otherOwners.length &&
    JSON.stringify([
      previous.language,
      previous.entry,
      previous.files,
      previous.dependencies,
    ]) !==
      JSON.stringify([
        edit.source.language,
        edit.source.entry,
        edit.source.files,
        edit.source.dependencies,
      ])
  )
    throw Error(
      `This source also defines ${otherOwners.map((d) => d.name).join(", ")}. Create a variant, or edit the shared source in Cell Manager.`,
    );
  return {
    ...edit,
    definitions: edit.definitions.map((target) => ({
      ...target,
      callers: project.documents.flatMap((document) =>
        document.instances
          .filter(
            (instance) =>
              instance.netlist?.binding?.kind === "external-subcircuit" &&
              instance.netlist.binding.definitionId === target.definitionId,
          )
          .map((instance) => ({
            documentId: document.id,
            instanceId: instance.id,
            expectedSymbolId: instance.symbolId,
          })),
      ),
    })),
  };
}

/** A private candidate plus the atomic edits that install it; opening/canceling writes nothing. */
export function prepareComponentVariant(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  identity: string,
) {
  const document = project.documents.find((d) => d.id === documentId);
  const instance = document?.instances.find((i) => i.id === instanceId);
  if (!document || !instance)
    throw Error("Select an existing instance to create a variant");
  const symbolId = deriveStableId("variant-symbol", identity);
  const definitionId = deriveStableId("variant-definition", identity);
  const sourceId = deriveStableId("variant-source", identity);
  if (
    project.componentDefinitions?.some((d) => d.symbol.id === symbolId) ||
    project.externalSubcircuitDefinitions.some((d) => d.id === definitionId) ||
    project.modelSources?.some((s) => s.id === sourceId)
  )
    throw Error("This variant identity already exists");
  const binding = instance.netlist?.binding;
  let definition: ComponentDefinition;
  const edits: ProjectStructureEdit[] = [];
  if (binding?.kind === "external-subcircuit") {
    const packaged = buildCircuitComponentPackage(
      project,
      binding.definitionId,
      instance.symbolId,
    );
    const owner = structuredClone(packaged.circuit.externalDefinition);
    const ids = new Map(
      owner.terminals.map((t) => [
        t.id,
        deriveStableId("variant-terminal", identity, t.id),
      ]),
    );
    const renamed = namespaceModelSource(
      packaged.circuit.source,
      identity.replace(/[^a-zA-Z0-9_]/g, "_"),
    );
    const occupied = new Set(
      (project.modelSources ?? []).flatMap((source) => {
        const parsed = inspectProjectModelSource(source);
        return [...parsed.entries, ...parsed.globalModels].map((d) =>
          d.name.toLowerCase(),
        );
      }),
    );
    if (
      [...renamed.names.values()].some((name) =>
        occupied.has(name.toLowerCase()),
      )
    )
      throw Error(
        "Variant declarations already exist. Choose a new variant identity.",
      );
    owner.id = definitionId;
    owner.name = renamed.names.get(owner.name)!;
    owner.symbolId = symbolId;
    owner.implementation = { kind: "source", sourceId, entry: owner.name };
    delete owner.libraryOrigin;
    owner.terminals = owner.terminals.map((t) => ({
      ...t,
      id: ids.get(t.id)!,
    }));
    if (owner.presentation?.pinPlacements)
      owner.presentation.pinPlacements = owner.presentation.pinPlacements.map(
        (p) => ({ ...p, terminalId: ids.get(p.terminalId)! }),
      );
    definition = structuredClone(packaged.definition);
    definition.symbol.id = symbolId;
    definition.circuitBinding = {
      definitionId,
      terminals: definition.circuitBinding!.terminals.map((t) => ({
        ...t,
        terminalId: ids.get(t.terminalId)!,
      })),
    };
    delete definition.libraryOrigin;
    edits.push(
      {
        kind: "upsert_model_source",
        source: { ...renamed.source, id: sourceId, revision: 1 },
      },
      { kind: "upsert_external_subcircuit_definition", definition: owner },
    );
  } else {
    const captured = project.componentDefinitions?.find(
      (d) => d.symbol.id === instance.symbolId,
    );
    if (!captured || captured.circuitBinding || captured.generatedFrom)
      throw Error("Select a captured component or a source-backed circuit");
    definition = structuredClone(captured);
    definition.symbol.id = symbolId;
    delete definition.libraryOrigin;
    if (definition.electrical)
      definition.electrical = {
        ...definition.electrical,
        id: symbolId + "-electrical",
        symbolId,
      };
    if (definition.subcircuit)
      definition.subcircuit = {
        ...definition.subcircuit,
        id: symbolId + "-interface",
        symbolId,
      };
  }
  edits.push({ kind: "capture_component_definition", definition });
  edits.push({
    kind: "transact_document",
    documentId,
    expectedRevision: document.revision,
    edits: [
      ...(binding?.kind === "external-subcircuit"
        ? [
            {
              kind: "set_instance_binding" as const,
              instanceId,
              binding: { kind: "external-subcircuit" as const, definitionId },
            },
          ]
        : []),
      {
        kind: "set_instance_symbol",
        instanceId,
        symbolId,
        ...(instance.symbolVariantId
          ? { symbolVariantId: instance.symbolVariantId }
          : {}),
      },
    ],
  });
  const outcome = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "variant-" + identity,
    actor: { kind: "human", id: "variant-preview" },
    edits,
  });
  if (!outcome.ok)
    throw Error(outcome.diagnostics[0]?.message ?? outcome.error.message);
  return {
    identity,
    edits,
    project: outcome.project,
    definition,
    definitionId:
      binding?.kind === "external-subcircuit" ? definitionId : undefined,
    symbolId,
    originalSymbolId: instance.symbolId,
  };
}
