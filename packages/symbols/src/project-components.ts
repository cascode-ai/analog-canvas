import { type CircuitProject, type ComponentDefinition } from "@icm/model";
import { deviceDescriptor, subcircuitDescriptor } from "@icm/devices";
import { projectSymbolSources } from "./hierarchical-block.js";
import { builtInSymbols } from "./builtins.js";
import { createProjectSymbolResolver } from "./resolver.js";
import type { SymbolDefinition } from "./schema.js";

export function referencedProjectSymbolIds(
  project: Pick<CircuitProject, "documents">,
): string[] {
  return [
    ...new Set(
      project.documents.flatMap((document) => [
        ...document.instances.map((instance) => instance.symbolId),
        ...(document.drafting?.objects ?? []).flatMap((object) =>
          object.kind === "floating-symbol" ? [object.symbolId] : [],
        ),
      ]),
    ),
  ].sort();
}

/** Snapshot actual dependencies once, sharing one definition across instances.
 * Unused snapshots are excluded; editor history retains its own definitions
 * so undo can restore a deleted custom component. */
export function withProjectComponentDefinitions(
  project: CircuitProject,
  baseDefinitions: readonly SymbolDefinition[] = builtInSymbols,
): CircuitProject {
  const resolver = createProjectSymbolResolver(project, baseDefinitions);
  const existing = new Map(
    (project.componentDefinitions ?? []).map((definition) => [
      definition.symbol.id,
      definition,
    ]),
  );
  const sources = projectSymbolSources(project);
  const definitions = referencedProjectSymbolIds(project).map((id) => {
    const resolved = resolver.resolve(id);
    if (!resolved)
      throw new Error(`Cannot save missing component definition: ${id}`);
    const previous = existing.get(id);
    if (
      previous &&
      (!previous.generatedFrom ||
        JSON.stringify(previous.generatedFrom) ===
          JSON.stringify(sources.get(id)))
    )
      return previous;
    if (previous)
      return {
        ...previous,
        symbol: resolved.definition,
        ...(sources.has(id) ? { generatedFrom: sources.get(id)! } : {}),
      };
    const electrical = deviceDescriptor(id);
    const subcircuit = subcircuitDescriptor(id);
    return structuredClone({
      symbol: resolved.definition,
      ...(sources.has(id) ? { generatedFrom: sources.get(id)! } : {}),
      ...(electrical ? { electrical } : {}),
      ...(subcircuit ? { subcircuit } : {}),
    }) as ComponentDefinition;
  });
  if (
    definitions.length > 0 &&
    definitions.length === (project.componentDefinitions?.length ?? 0) &&
    definitions.every(
      (definition, index) =>
        definition === project.componentDefinitions?.[index],
    )
  )
    return project;
  const { componentDefinitions: _previous, ...content } = project;
  return definitions.length
    ? { ...content, componentDefinitions: definitions }
    : content;
}
