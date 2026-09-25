import {
  deriveStableId,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
  type Instance,
} from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";
import type { ProjectStructureEdit } from "./project-transaction.js";

export type CopyDependencySource = Pick<
  CircuitProject,
  "id" | "symbolLibrary" | "source" | "externalSubcircuitDefinitions"
>;

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
  };
}

/** Same-name reuse must preserve both the electrical interface and pin geometry. */
export function compatibleExternalDefinition(
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
  const edits: ProjectStructureEdit[] = [];
  const occupied = new Set(
    [
      ...destination.externalSubcircuitDefinitions,
      ...destination.source.files,
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
    if (existing && !compatibleExternalDefinition(existing, definition))
      throw new Error(
        `External subcircuit ${definition.name} has an incompatible interface, parameters or presentation in the destination`,
      );
    const id = existing?.id ?? fresh(definition.id);
    externalIds.set(definition.id, id);
    if (!existing) {
      const clone = structuredClone(definition);
      clone.id = id;
      const terminals = new Map(
        clone.terminals.map((t) => [
          t.id,
          deriveStableId("copy-terminal", id, t.id),
        ]),
      );
      for (const terminal of clone.terminals)
        terminal.id = terminals.get(terminal.id)!;
      for (const pin of clone.presentation?.pinPlacements ?? [])
        pin.terminalId = terminals.get(pin.terminalId)!;
      edits.push({
        kind: "upsert_external_subcircuit_definition",
        definition: clone,
      });
    }
  }
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
  return { externalIds, fileIds, edits };
}
