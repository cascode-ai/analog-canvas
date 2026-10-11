import { SymbolDefinitionSchema } from "./schema.js";
import type { SymbolDefinition, SymbolVariant } from "./schema.js";
import {
  freezeSnapshot,
  isFrozenSnapshot,
  projectCircuitSymbol,
  type CircuitProject,
} from "@icm/model";
import { builtInSymbols } from "./builtins.js";
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

const validatedSymbols = new WeakMap<SymbolDefinition, SymbolDefinition>();

export class InMemorySymbolResolver implements SymbolResolver {
  readonly #symbols = new Map<string, SymbolDefinition>();
  readonly #variants = new Map<string, ReadonlyMap<string, SymbolVariant>>();
  readonly #base: InMemorySymbolResolver | undefined;

  constructor(
    definitions: readonly SymbolDefinition[],
    base?: InMemorySymbolResolver,
  ) {
    this.#base = base;
    for (const input of definitions) {
      const reusable = isFrozenSnapshot(input)
        ? validatedSymbols.get(input)
        : undefined;
      const definition =
        reusable ?? freezeSnapshot(SymbolDefinitionSchema.parse(input));
      if (isFrozenSnapshot(input)) validatedSymbols.set(input, definition);
      validatedSymbols.set(definition, definition);
      if (this.#symbols.has(definition.id)) {
        throw new Error(`Duplicate symbol: ${definition.id}`);
      }
      this.#symbols.set(definition.id, definition);
      this.#variants.set(
        definition.id,
        new Map(definition.variants.map((variant) => [variant.id, variant])),
      );
    }
  }

  resolve(symbolId: string, variantId?: string): ResolvedSymbol | undefined {
    const definition = this.#symbols.get(symbolId);
    if (!definition) {
      return this.#base?.resolve(symbolId, variantId);
    }
    const effectiveVariantId = variantId ?? definition.defaultVariantId;
    if (effectiveVariantId === undefined) return { definition };
    const variant = this.#variants.get(symbolId)?.get(effectiveVariantId);
    return variant ? { definition, variant } : undefined;
  }
}

let builtInCatalog: InMemorySymbolResolver | undefined;

/** Validate a library at ingestion; the resulting catalog owns its records. */
export function createSymbolCatalog(
  definitions: readonly SymbolDefinition[] | InMemorySymbolResolver,
): InMemorySymbolResolver {
  if (definitions instanceof InMemorySymbolResolver) return definitions;
  // This library is owned and frozen by builtins.ts. Caller-owned arrays still
  // take a fresh validated snapshot, so editing an input cannot poison a cache.
  if (definitions === builtInSymbols)
    return (builtInCatalog ??= new InMemorySymbolResolver(definitions));
  return new InMemorySymbolResolver(definitions);
}

export function createProjectSymbolResolver(
  project: Pick<CircuitProject, "documents" | "topDocumentId"> &
    Partial<
      Pick<
        CircuitProject,
        "externalSubcircuitDefinitions" | "componentDefinitions"
      >
    >,
  baseDefinitions: readonly SymbolDefinition[] | InMemorySymbolResolver,
): InMemorySymbolResolver {
  // Legacy callers merge available and captured definitions in one list.
  // Preserve their last-definition precedence before loading the catalog.
  const base = createSymbolCatalog(
    baseDefinitions === builtInSymbols ||
      baseDefinitions instanceof InMemorySymbolResolver
      ? baseDefinitions
      : [
          ...new Map(
            baseDefinitions.map((definition) => [definition.id, definition]),
          ).values(),
        ],
  );
  const definitions = new Map<string, SymbolDefinition>();
  for (const definition of project.componentDefinitions ?? []) {
    const owner = definition.circuitBinding
      ? project.externalSubcircuitDefinitions?.find(
          (d) => d.id === definition.circuitBinding!.definitionId,
        )
      : undefined;
    definitions.set(
      definition.symbol.id,
      owner ? projectCircuitSymbol(definition, owner) : definition.symbol,
    );
  }
  const sources = projectSymbolSources(project);
  const captured = new Map(
    (project.componentDefinitions ?? []).map((definition) => [
      definition.symbol.id,
      definition,
    ]),
  );
  const overlay = new InMemorySymbolResolver([...definitions.values()], base);
  const hierarchical = createProjectHierarchicalSymbols(project, overlay);
  const generatedOverrides: SymbolDefinition[] = [];
  for (const definition of hierarchical) {
    const existing = overlay.resolve(definition.id)?.definition;
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
      generatedOverrides.push(definition);
  }
  return new InMemorySymbolResolver(generatedOverrides, overlay);
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
