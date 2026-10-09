import {
  deriveStableId,
  resolveCircuitArtworkDraft,
  ComponentDefinitionSchema,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
  type Instance,
  type ProjectModelSource,
} from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import { inspectProjectModelSource } from "@icm/netlist";
import type { ProjectStructureEdit } from "./project-transaction.js";

export type CopyDependencySource = Pick<
  CircuitProject,
  | "id"
  | "symbolLibrary"
  | "source"
  | "externalSubcircuitDefinitions"
  | "modelSources"
> &
  Partial<Pick<CircuitProject, "componentDefinitions">>;

function modelSourceShape(source: ProjectModelSource): string {
  return JSON.stringify({
    language: source.language,
    entry: source.entry,
    files: [...source.files].sort((a, b) => a.path.localeCompare(b.path)),
    dependencies: [...source.dependencies].sort((a, b) =>
      a.mountPath.localeCompare(b.mountPath),
    ),
    draft: source.draft
      ? {
          language: source.draft.language ?? source.language,
          entry: source.draft.entry,
          files: [...source.draft.files].sort((a, b) =>
            a.path.localeCompare(b.path),
          ),
          dependencies: [
            ...(source.draft.dependencies ?? source.dependencies),
          ].sort((a, b) => a.mountPath.localeCompare(b.mountPath)),
        }
      : undefined,
  });
}

function definitionShape(definition: ExternalSubcircuitDefinition): unknown {
  const names = new Map(definition.terminals.map((t) => [t.id, t.name]));
  return {
    name: definition.name.toLowerCase(),
    terminals: definition.terminals.map(({ name, direction }) => ({
      name,
      direction,
    })),
    formalParameters: definition.formalParameters,
    interfaceStatus: definition.interfaceStatus,
    presentation: definition.presentation
      ? {
          ...definition.presentation,
          pinPlacements: definition.presentation.pinPlacements?.map(
            ({ terminalId, ...placement }) => ({
              ...placement,
              terminalName: names.get(terminalId),
            }),
          ),
        }
      : undefined,
    implementation:
      definition.implementation?.kind === "source"
        ? { kind: "source", entry: definition.implementation.entry }
        : definition.implementation
          ? {
              kind: "placeholder",
              hasDraftOwner: Boolean(definition.implementation.sourceId),
            }
          : undefined,
  };
}

/** Same-name reuse must preserve both the electrical interface and pin geometry. */
function compatibleExternalDefinition(
  a: ExternalSubcircuitDefinition,
  b: ExternalSubcircuitDefinition,
): boolean {
  return (
    JSON.stringify(definitionShape(a)) === JSON.stringify(definitionShape(b))
  );
}

export function referencedSourceFiles(
  value: unknown,
  output = new Set<string>(),
): Set<string> {
  if (Array.isArray(value))
    for (const item of value) referencedSourceFiles(item, output);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (key === "parameters" || key === "properties") continue;
      if (key === "fileId" && typeof item === "string") output.add(item);
      referencedSourceFiles(item, output);
    }
  return output;
}

/** Only reference fields are rewritten; parameter strings and arbitrary text are never substituted. */
export function remapCopySourceFiles<T>(
  value: T,
  ids: ReadonlyMap<string, string>,
): T {
  if (Array.isArray(value))
    return value.map((item) => remapCopySourceFiles(item, ids)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "parameters" || key === "properties"
        ? item
        : key === "fileId" && typeof item === "string"
          ? (ids.get(item) ?? item)
          : remapCopySourceFiles(item, ids),
    ]),
  ) as T;
}

export function remapExternalCopyInstance(
  instance: Instance,
  ids: ReadonlyMap<string, string>,
): Instance {
  const clone = structuredClone(instance);
  const binding = clone.netlist?.binding;
  if (binding?.kind !== "external-subcircuit") return clone;
  const id = ids.get(binding.definitionId);
  if (!id)
    throw new Error(
      `Missing copied external definition: ${binding.definitionId}`,
    );
  if (clone.symbolId === externalSubcircuitSymbolId(binding.definitionId))
    clone.symbolId = externalSubcircuitSymbolId(id);
  binding.definitionId = id;
  return clone;
}

/** Shared by whole-Cell import and canvas copying; never mutates either Project. */
export function planExternalCopyDependencies(
  destination: CircuitProject,
  source: CopyDependencySource,
  instances: readonly Instance[],
  referencedContent: unknown,
  allocateId: (id: string) => string = (id) =>
    deriveStableId("copy-dependency", destination.id, source.id, id),
) {
  const externalIds = new Map<string, string>();
  const fileIds = new Map<string, string>();
  const modelIds = new Map<string, string>();
  const terminalIds = new Map<string, Map<string, string>>();
  const symbolIds = new Map<string, string>();
  const edits: ProjectStructureEdit[] = [];
  const occupied = new Set(
    [
      ...destination.externalSubcircuitDefinitions,
      ...destination.source.files,
      ...(destination.modelSources ?? []),
    ].map((item) => item.id),
  );
  const fresh = (id: string): string => {
    const base = allocateId(id);
    let next = base;
    let sequence = 1;
    while (occupied.has(next)) next = `${base}-${sequence++}`;
    occupied.add(next);
    return next;
  };
  for (const instance of instances) {
    const binding = instance.netlist?.binding;
    if (
      binding?.kind !== "external-subcircuit" ||
      externalIds.has(binding.definitionId)
    )
      continue;
    const definition = source.externalSubcircuitDefinitions.find(
      (d) => d.id === binding.definitionId,
    );
    if (!definition)
      throw new Error(
        `Source references missing external subcircuit ${binding.definitionId}`,
      );
    const existing = destination.externalSubcircuitDefinitions.find(
      (d) => d.name.toLowerCase() === definition.name.toLowerCase(),
    );
    const implementation = definition.implementation;
    let copiedSourceId: string | undefined;
    if (implementation?.sourceId) {
      const model = source.modelSources?.find(
        (s) => s.id === implementation.sourceId,
      );
      if (!model)
        throw new Error(
          `Source is missing model implementation ${definition.name}`,
        );
      const existingImplementation = existing?.implementation;
      const existingModel = existingImplementation?.sourceId
        ? destination.modelSources?.find(
            (s) => s.id === existingImplementation.sourceId,
          )
        : undefined;
      if (
        existing &&
        (!existingModel ||
          modelSourceShape(existingModel) !== modelSourceShape(model))
      )
        throw new Error(
          `External subcircuit ${definition.name} has an incompatible implementation or model dependencies in the destination`,
        );
      copiedSourceId = modelIds.get(model.id);
      if (!copiedSourceId) {
        const reusable = destination.modelSources?.find(
          (s) => modelSourceShape(s) === modelSourceShape(model),
        );
        copiedSourceId = reusable?.id ?? fresh(model.id);
        modelIds.set(model.id, copiedSourceId);
        if (!reusable)
          edits.push({
            kind: "upsert_model_source",
            source: { ...structuredClone(model), id: copiedSourceId },
          });
      }
    }
    if (existing && !compatibleExternalDefinition(existing, definition))
      throw new Error(
        `External subcircuit ${definition.name} has an incompatible interface, parameters or presentation in the destination`,
      );
    const id = existing?.id ?? fresh(definition.id);
    externalIds.set(definition.id, id);
    const copiedTerminals = new Map(
      definition.terminals.map((terminal) => [
        terminal.id,
        existing?.terminals.find((t) => t.name === terminal.name)!.id ??
          deriveStableId("copy-terminal", id, terminal.id),
      ]),
    );
    terminalIds.set(definition.id, copiedTerminals);
    if (!existing) {
      const clone = structuredClone(definition);
      clone.id = id;
      if (clone.implementation?.sourceId)
        clone.implementation.sourceId = copiedSourceId!;
      for (const terminal of clone.terminals)
        terminal.id = copiedTerminals.get(terminal.id)!;
      for (const pin of clone.presentation?.pinPlacements ?? [])
        pin.terminalId = copiedTerminals.get(pin.terminalId)!;
      edits.push({
        kind: "upsert_external_subcircuit_definition",
        definition: clone,
      });
    }
  }
  // Only copied owners' authoring candidates travel with newly captured sources.
  // Reusing a source never overwrites its destination-private drafts.
  for (const edit of edits) {
    if (edit.kind !== "upsert_model_source" || !edit.source.draft?.authoring)
      continue;
    const model = edit.source;
    const draft = model.draft!;
    const inspection = inspectProjectModelSource({
      ...model,
      ...draft,
      language: draft.language ?? model.language,
      dependencies: draft.dependencies ?? model.dependencies,
      revision: model.revision,
    });
    draft.authoring = draft.authoring!.flatMap((candidate) => {
      const definitionId = externalIds.get(candidate.definitionId);
      const oldOwner = source.externalSubcircuitDefinitions.find(
        (definition) => definition.id === candidate.definitionId,
      );
      if (!definitionId || !oldOwner) return [];
      const ids = new Map(terminalIds.get(candidate.definitionId));
      for (const name of inspection.entries.find(
        (entry) => entry.name === candidate.entry,
      )?.ports ?? [])
        if (!oldOwner.terminals.some((terminal) => terminal.name === name))
          ids.set(
            deriveStableId("model-terminal", candidate.definitionId, name),
            deriveStableId("model-terminal", definitionId, name),
          );
      const remap = (id: string) => ids.get(id) ?? id;
      let rawOwner: string | undefined;
      try {
        const parsed = ComponentDefinitionSchema.safeParse(
          JSON.parse(candidate.artworkText),
        );
        if (parsed.success) rawOwner = parsed.data.circuitBinding?.definitionId;
      } catch {
        // Unfinished raw JSON retains its earlier copy provenance verbatim.
      }
      const previousOrigin =
        rawOwner === candidate.definitionId
          ? undefined
          : candidate.artworkOrigin;
      const origin = previousOrigin
        ? {
            definitionId: previousOrigin.definitionId,
            terminalIds: Object.fromEntries(
              Object.entries(previousOrigin.terminalIds).map(([from, to]) => [
                from,
                remap(to),
              ]),
            ),
          }
        : {
            definitionId: candidate.definitionId,
            terminalIds: Object.fromEntries(ids),
          };
      const owner = {
        ...oldOwner,
        id: definitionId,
        terminals: oldOwner.terminals.map((terminal) => ({
          ...terminal,
          id: remap(terminal.id),
        })),
      };
      const { legacyRepair: _legacyRepair, ...copied } = candidate;
      return [
        {
          ...copied,
          definitionId,
          artworkOrigin: origin,
          ...(candidate.lastValidArtwork
            ? {
                lastValidArtwork: resolveCircuitArtworkDraft(
                  candidate.lastValidArtwork,
                  owner,
                  {
                    definitionId: candidate.definitionId,
                    terminalIds: Object.fromEntries(ids),
                  },
                ),
              }
            : {}),
          ...(candidate.terminalDirections
            ? {
                terminalDirections: Object.fromEntries(
                  Object.entries(candidate.terminalDirections).map(
                    ([id, direction]) => [remap(id), direction],
                  ),
                ),
              }
            : {}),
          ...(candidate.presentation
            ? {
                presentation: {
                  ...candidate.presentation,
                  pinPlacements: candidate.presentation.pinPlacements?.map(
                    (placement) => ({
                      ...placement,
                      terminalId: remap(placement.terminalId),
                    }),
                  ),
                },
              }
            : {}),
          portMaps: Object.fromEntries(
            Object.entries(candidate.portMaps).flatMap(([id, map]) =>
              externalIds.has(id) ? [[externalIds.get(id)!, map]] : [],
            ),
          ),
        },
      ];
    });
  }
  // Capture artwork and its terminal correspondence together with its owner.
  // GUI clipboard, Cell import and Agent copies all consume these same edits.
  const captured = [...(destination.componentDefinitions ?? [])];
  const usedSymbols = new Set(instances.map((instance) => instance.symbolId));
  for (const definition of source.externalSubcircuitDefinitions)
    if (externalIds.has(definition.id) && definition.symbolId)
      usedSymbols.add(definition.symbolId);
  for (const component of source.componentDefinitions ?? []) {
    const binding = component.circuitBinding;
    if (
      !binding ||
      !usedSymbols.has(component.symbol.id) ||
      !externalIds.has(binding.definitionId)
    )
      continue;
    const copy = structuredClone(component);
    copy.circuitBinding!.definitionId = externalIds.get(binding.definitionId)!;
    for (const terminal of copy.circuitBinding!.terminals)
      terminal.terminalId = terminalIds
        .get(binding.definitionId)!
        .get(terminal.terminalId)!;
    const baseId = copy.symbol.id;
    let ordinal = 1;
    while (
      captured.some(
        (previous) =>
          previous.symbol.id === copy.symbol.id &&
          JSON.stringify(previous) !== JSON.stringify(copy),
      )
    )
      copy.symbol.id = `${baseId}-copy-${ordinal++}`;
    symbolIds.set(component.symbol.id, copy.symbol.id);
    if (!captured.some((previous) => previous.symbol.id === copy.symbol.id)) {
      captured.push(copy);
      edits.unshift({ kind: "capture_component_definition", definition: copy });
    }
  }
  for (const edit of edits)
    if (
      edit.kind === "upsert_external_subcircuit_definition" &&
      edit.definition.symbolId
    )
      edit.definition.symbolId =
        symbolIds.get(edit.definition.symbolId) ?? edit.definition.symbolId;
  for (const id of referencedSourceFiles(referencedContent)) {
    const file = source.source.files.find((f) => f.id === id);
    if (!file) throw new Error(`Source metadata is missing file ${id}`);
    const existing = destination.source.files.find(
      (f) =>
        f.path === file.path &&
        f.hash === file.hash &&
        JSON.stringify(f.content) === JSON.stringify(file.content) &&
        JSON.stringify(f.originalContent) ===
          JSON.stringify(file.originalContent),
    );
    const targetId = existing?.id ?? fresh(id);
    fileIds.set(id, targetId);
    if (!existing)
      edits.push({
        kind: "add_source_file",
        sourceFile: { ...file, id: targetId },
      });
  }
  return { externalIds, fileIds, symbolIds, terminalIds, edits };
}
