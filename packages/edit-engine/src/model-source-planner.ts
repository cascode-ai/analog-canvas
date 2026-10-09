import {
  deriveStableId,
  circuitComponentIssues,
  initializeCircuitComponent,
  removeCircuitComponentTerminals,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
} from "@icm/model";
import {
  inspectProjectModelSource,
  transformProjectModelSource,
  type SimulationSourceDiagnostic,
} from "@icm/netlist";
import {
  instanceReferencesPin,
  planCallerInterfaceChanges,
} from "./hierarchy-planner.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { executeTransaction } from "./transaction.js";
import type { ProjectStructureEdit } from "./project-transaction.js";
import { resolveReviewedLibraryInterface } from "@icm/devices";

export class ModelSourceApplyError extends Error {
  constructor(readonly diagnostic: SimulationSourceDiagnostic) {
    super(
      `${diagnostic.path ?? diagnostic.sourceRef?.fileId ?? "model"}:${diagnostic.sourceRef?.start.line ?? 1}: ${diagnostic.message}`,
    );
  }
}

/** During atomic Apply, departing captures resolve against the original interface. */
export function modelSourceMigrationResolver(
  project: CircuitProject,
  previous: CircuitProject,
) {
  const original = createProjectSymbolResolver(previous, builtInSymbols);
  const originals = (previous.componentDefinitions ?? []).flatMap(
    (component) => {
      const resolved = original.resolve(component.symbol.id);
      return resolved ? [resolved.definition] : [];
    },
  );
  const componentDefinitions = (project.componentDefinitions ?? []).filter(
    (component) => {
      if (!component.circuitBinding) return true;
      const owner = project.externalSubcircuitDefinitions.find(
        (definition) =>
          definition.id === component.circuitBinding!.definitionId,
      );
      return owner && circuitComponentIssues(component, owner).length === 0;
    },
  );
  return createProjectSymbolResolver({ ...project, componentDefinitions }, [
    ...builtInSymbols,
    ...originals,
  ]);
}

/** Native source Apply plans ordinary edits; all callers share the atomic boundary. */
export function planModelSourceApply(
  project: CircuitProject,
  edit: Extract<ProjectStructureEdit, { kind: "apply_model_source" }>,
): ProjectStructureEdit[] {
  const transformed = transformProjectModelSource(
    edit.source,
    edit.transform ?? {},
  );
  if (!transformed.ok)
    throw new ModelSourceApplyError({
      ...transformed.diagnostic,
      modelSource: { sourceId: edit.source.id, revision: edit.source.revision },
    });
  const source = transformed.source;
  const inspected = inspectProjectModelSource(source);
  const failure = inspected.diagnostics.find((d) => d.severity === "error");
  if (failure)
    throw new ModelSourceApplyError({
      ...failure,
      modelSource: { sourceId: source.id, revision: source.revision },
    });
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
          symbolResolver: modelSourceMigrationResolver(working, project),
        },
      );
      if (!result.ok) throw Error(result.error.message);
      working.documents[
        working.documents.findIndex((d) => d.id === document.id)
      ] = result.document;
    }
  };
  for (const [id, target] of targets) {
    const entry = inspected.entries.find((e) =>
      source.language === "spectre"
        ? e.name === target.entry
        : e.name.toLowerCase() === target.entry.toLowerCase(),
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
      new Map(
        (target.callers ?? []).map((caller) => [
          JSON.stringify([caller.documentId, caller.instanceId]),
          target.symbol === null
            ? externalSubcircuitSymbolId(id)
            : (target.symbol?.symbol.id ??
              old?.symbolId ??
              externalSubcircuitSymbolId(id)),
        ]),
      ),
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
    if (
      definition.symbolId &&
      changes.symbolMigrations.has(definition.symbolId)
    )
      definition.symbolId = changes.symbolMigrations.get(definition.symbolId)!;
    else if (definition.symbolId && target.symbol === undefined) {
      const preferred = working.componentDefinitions?.find(
        (component) => component.symbol.id === definition.symbolId,
      );
      if (preferred?.circuitBinding) {
        const migrated = removeCircuitComponentTerminals(
          preferred,
          deleted.map((terminal) => terminal.id),
        );
        if (migrated !== preferred) {
          const captured = {
            kind: "capture_component_definition" as const,
            definition: migrated,
          };
          preview([captured]);
          planned.push(captured);
          definition.symbolId = migrated.symbol.id;
        }
      }
    }
    if (target.symbol) {
      const symbol = initializeCircuitComponent(target.symbol, definition);
      const issue = circuitComponentIssues(symbol, definition)[0];
      if (issue) throw Error(`${issue.path.join(".")}: ${issue.message}`);
      const captured = {
        kind: "capture_component_definition" as const,
        definition: symbol,
      };
      preview([captured]);
      planned.push(captured);
      definition.symbolId = symbol.symbol.id;
    } else if (target.symbol === null) delete definition.symbolId;
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
    const callerEdits = new Map<
      string,
      { instanceId: string; symbolId: string; symbolVariantId?: string }[]
    >();
    const symbolId = definition.symbolId ?? externalSubcircuitSymbolId(id);
    const callerResolver = target.callers?.length
      ? modelSourceMigrationResolver(working, project)
      : undefined;
    for (const caller of target.callers ?? []) {
      const original = project.documents
        .find((d) => d.id === caller.documentId)
        ?.instances.find((i) => i.id === caller.instanceId);
      if (
        !original ||
        original.symbolId !== caller.expectedSymbolId ||
        original.netlist?.binding?.kind !== "external-subcircuit" ||
        original.netlist.binding.definitionId !== id
      )
        throw Error(
          `Caller ${caller.instanceId} changed; reopen it before applying its artwork`,
        );
      const edits = callerEdits.get(caller.documentId) ?? [];
      if (edits.some((edit) => edit.instanceId === caller.instanceId))
        throw Error(`Caller ${caller.instanceId} is selected more than once`);
      edits.push({
        instanceId: caller.instanceId,
        symbolId,
        ...(original.symbolVariantId &&
        callerResolver?.resolve(symbolId, original.symbolVariantId)
          ? { symbolVariantId: original.symbolVariantId }
          : {}),
      });
      callerEdits.set(caller.documentId, edits);
    }
    for (const [documentId, callers] of callerEdits) {
      const document = working.documents.find((d) => d.id === documentId)!;
      const edit: ProjectStructureEdit = {
        kind: "transact_document",
        documentId,
        expectedRevision: document.revision,
        edits: callers.map((caller) => ({
          kind: "set_instance_symbol",
          ...caller,
        })),
      };
      preview([edit]);
      planned.push(edit);
    }
  }
  source.revision = (previous?.revision ?? 0) + 1;
  delete source.draft;
  return [{ kind: "upsert_model_source", source }, ...planned];
}
