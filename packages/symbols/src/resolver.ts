import { SymbolDefinitionSchema } from "./schema.js";
import type { SymbolDefinition, SymbolVariant } from "./schema.js";
import type { CircuitProject } from "@icm/model";
import {
  createProjectHierarchicalSymbols,
  projectSymbolSources,
} from "./hierarchical-block.js";

export interface ResolvedSymbol {
  definition: SymbolDefinition;
  variant?: SymbolVariant;
}

export interface SymbolResolver {
  resolve(symbolId: string, variantId?: string): ResolvedSymbol | undefined;
}

export class InMemorySymbolResolver implements SymbolResolver {
  readonly #symbols = new Map<string, SymbolDefinition>();

  constructor(definitions: readonly SymbolDefinition[]) {
    for (const input of definitions) {
      const definition = SymbolDefinitionSchema.parse(input);
      if (this.#symbols.has(definition.id)) {
        throw new Error(`Duplicate symbol: ${definition.id}`);
      }
      this.#symbols.set(definition.id, definition);
    }
  }

  resolve(symbolId: string, variantId?: string): ResolvedSymbol | undefined {
    const definition = this.#symbols.get(symbolId);
    if (!definition) {
      return undefined;
    }
    const effectiveVariantId = variantId ?? definition.defaultVariantId;
    if (effectiveVariantId === undefined) return { definition };
    const variant = definition.variants.find(
      (candidate) => candidate.id === effectiveVariantId,
    );
    return variant ? { definition, variant } : undefined;
  }
}

export function createProjectSymbolResolver(
  project: Pick<CircuitProject, "documents" | "topDocumentId"> &
    Partial<
      Pick<
        CircuitProject,
        "externalSubcircuitDefinitions" | "componentDefinitions"
      >
    >,
  baseDefinitions: readonly SymbolDefinition[],
): InMemorySymbolResolver {
  const definitions = new Map(
    baseDefinitions.map((definition) => [definition.id, definition]),
  );
  for (const definition of project.componentDefinitions ?? [])
    definitions.set(definition.symbol.id, definition.symbol);
  const sources = projectSymbolSources(project);
  const captured = new Map(
    (project.componentDefinitions ?? []).map((definition) => [
      definition.symbol.id,
      definition,
    ]),
  );
  const hierarchical = createProjectHierarchicalSymbols(project, [
    ...definitions.values(),
  ]);
  for (const definition of hierarchical) {
    const existing = definitions.get(definition.id);
    // A changed Cell interface owns its pins. A stable interface keeps its
    // captured/customized artwork instead of following website releases.
    if (
      !existing?.hierarchicalBlock ||
      (captured.get(definition.id)?.generatedFrom &&
        JSON.stringify(captured.get(definition.id)!.generatedFrom) !==
          JSON.stringify(sources.get(definition.id))) ||
      JSON.stringify(existing.pins.map((pin) => pin.name)) !==
        JSON.stringify(definition.pins.map((pin) => pin.name))
    )
      definitions.set(definition.id, definition);
  }
  return new InMemorySymbolResolver([...definitions.values()]);
}

export function findUnsupportedProjectSymbolIds(
  project: Pick<CircuitProject, "documents" | "topDocumentId"> &
    Partial<
      Pick<
        CircuitProject,
        "externalSubcircuitDefinitions" | "componentDefinitions"
      >
    >,
  baseDefinitions: readonly SymbolDefinition[],
): string[] {
  const resolver = createProjectSymbolResolver(project, baseDefinitions);
  const unsupported = new Set<string>();
  for (const document of project.documents) {
    for (const instance of document.instances) {
      if (!resolver.resolve(instance.symbolId, instance.symbolVariantId)) {
        unsupported.add(instance.symbolId);
      }
    }
    for (const object of document.drafting?.objects ?? []) {
      if (
        object.kind === "floating-symbol" &&
        !resolver.resolve(object.symbolId)
      ) {
        unsupported.add(object.symbolId);
      }
    }
  }
  return [...unsupported].sort();
}
