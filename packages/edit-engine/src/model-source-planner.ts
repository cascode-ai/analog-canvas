import {
  deriveStableId,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
} from "@icm/model";
import { inspectProjectModelSource } from "@icm/netlist";
import {
  instanceReferencesPin,
  planCallerInterfaceChanges,
} from "./hierarchy-planner.js";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { executeTransaction } from "./transaction.js";
import type { ProjectStructureEdit } from "./project-transaction.js";
import { resolveReviewedLibraryInterface } from "@icm/devices";

/** Native source Apply plans ordinary edits; all callers share the atomic boundary. */
export function planModelSourceApply(
  project: CircuitProject,
  edit: Extract<ProjectStructureEdit, { kind: "apply_model_source" }>,
): ProjectStructureEdit[] {
  const source = structuredClone(edit.source);
  const inspected = inspectProjectModelSource(source);
  const failure = inspected.diagnostics.find((d) => d.severity === "error");
  if (failure)
    throw Error(
      `${failure.path ?? source.entry}${failure.sourceRef ? ":" + failure.sourceRef.start.line : ""}: ${failure.message}`,
    );
  const previous = project.modelSources?.find((s) => s.id === source.id);
  if (previous && previous.revision !== source.revision)
    throw Error("Model source revision is stale");
  const targets = new Map(edit.definitions.map((d) => [d.definitionId, d]));
  if (targets.size !== edit.definitions.length)
    throw Error("A definition can only be selected once per Apply");
  for (const definition of project.externalSubcircuitDefinitions) {
    if (
      definition.implementation?.kind === "source" &&
      definition.implementation.sourceId === source.id &&
      !targets.has(definition.id)
    )
      targets.set(definition.id, {
        definitionId: definition.id,
        entry: definition.implementation.entry,
      });
  }
  const working = structuredClone(project);
  const planned: ProjectStructureEdit[] = [];
  const preview = (edits: readonly ProjectStructureEdit[]) => {
    for (const edit of edits) {
      if (edit.kind === "capture_component_definition") {
        working.componentDefinitions ??= [];
        if (
          !working.componentDefinitions.some(
            (d) => d.symbol.id === edit.definition.symbol.id,
          )
        )
          working.componentDefinitions.push(edit.definition);
        continue;
      }
      if (edit.kind !== "transact_document") continue;
      const document = working.documents.find((d) => d.id === edit.documentId)!;
      const result = executeTransaction(
        document,
        {
          transactionId: "model-migration-preview",
          documentId: edit.documentId,
          expectedRevision: edit.expectedRevision,
          edits: edit.edits,
          actor: { kind: "human", id: "model-planner" },
        },
        {
          symbolResolver: createProjectSymbolResolver(working, builtInSymbols),
        },
      );
      if (!result.ok) throw Error(result.error.message);
      working.documents[
        working.documents.findIndex((d) => d.id === document.id)
      ] = result.document;
    }
  };
  for (const [id, target] of targets) {
    const entry = inspected.entries.find(
      (e) => e.name.toLowerCase() === target.entry.toLowerCase(),
    );
    if (!entry) throw Error(`Missing model entry ${target.entry}`);
    const old = working.externalSubcircuitDefinitions.find((d) => d.id === id);
    if (
      old &&
      !old.implementation &&
      resolveReviewedLibraryInterface(
        old.name,
        old.terminals.map((t) => t.name),
      )
    )
      throw Error(
        "Reviewed library implementations are fixed. Create an explicit model fork with a new definition instead",
      );
    const map = target.portMap ?? {};
    for (const [name, destination] of Object.entries(map)) {
      if (!old?.terminals.some((t) => t.name === name))
        throw Error(`Unknown old model port ${name}`);
      if (destination !== null && !entry.ports.includes(destination))
        throw Error(`Unknown new model port ${destination}`);
    }
    const destinations =
      old?.terminals.flatMap((t) => {
        const name = Object.hasOwn(map, t.name) ? map[t.name] : t.name;
        return name && entry.ports.includes(name) ? [name] : [];
      }) ?? [];
    if (new Set(destinations).size !== destinations.length)
      throw Error(
        "Model port migration must be one-to-one; repair aliased connections explicitly",
      );
    const deleted =
      old?.terminals.filter(
        (t) =>
          !entry.ports.includes(map[t.name] ?? t.name) || map[t.name] === null,
      ) ?? [];
    for (const terminal of deleted) {
      const referenced = project.documents.some((d) =>
        d.instances.some(
          (i) =>
            i.netlist?.binding?.kind === "external-subcircuit" &&
            i.netlist.binding.definitionId === id &&
            instanceReferencesPin(d, i.id, terminal.name),
        ),
      );
      if (referenced && !Object.hasOwn(map, terminal.name))
        throw Error(
          `Connected model port ${terminal.name} requires an explicit remap or disconnect`,
        );
    }
    const renames = Object.entries(map).flatMap(([source, destination]) =>
      destination !== null && source !== destination
        ? [{ source, target: destination }]
        : [],
    );
    const changes = planCallerInterfaceChanges(
      working,
      id,
      deleted.map((t) => t.name),
      renames,
      false,
      true,
      entry.ports,
    );
    preview(changes.beforeChild);
    const definition: ExternalSubcircuitDefinition = {
      ...old,
      id,
      name: entry.name,
      terminals: entry.ports.map((name) => {
        const previousTerminal = old?.terminals.find(
          (t) => (Object.hasOwn(map, t.name) ? map[t.name] : t.name) === name,
        );
        return previousTerminal
          ? { ...previousTerminal, name }
          : {
              id: deriveStableId("model-terminal", id, name),
              name,
              direction: "passive",
            };
      }),
      formalParameters: entry.parameters.map((p) => ({
        name: p.name,
        defaultValue: p.rawText,
      })),
      interfaceStatus: "declared",
      implementation: {
        kind: "source",
        sourceId: source.id,
        entry: entry.name,
      },
    };
    if (definition.presentation?.pinPlacements)
      definition.presentation.pinPlacements =
        definition.presentation.pinPlacements.filter((s) =>
          definition.terminals.some((t) => t.id === s.terminalId),
        );
    const index = working.externalSubcircuitDefinitions.findIndex(
      (d) => d.id === id,
    );
    if (index < 0) working.externalSubcircuitDefinitions.push(definition);
    else working.externalSubcircuitDefinitions[index] = definition;
    preview(changes.afterChild);
    planned.push(
      ...changes.beforeChild,
      { kind: "upsert_external_subcircuit_definition", definition },
      ...changes.afterChild,
    );
  }
  source.revision = (previous?.revision ?? 0) + 1;
  delete source.draft;
  return [{ kind: "upsert_model_source", source }, ...planned];
}
