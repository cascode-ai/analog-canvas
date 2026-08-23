import {
  razaviCatalogSymbols,
  razaviSemanticPrimitives,
  razaviSymbolCatalogEntries,
  razaviSymbolCatalogIdentity,
} from "./razavi-catalog.generated.js";
import type { SymbolDefinition } from "./schema.js";

export interface RazaviSymbolCatalogEntry {
  symbolId: string;
  name: string;
  category: string;
  reviewStatus: "reviewed" | "provisional";
  visualAuthority: {
    kind: "razavi-reference-v1";
    referenceManifestPath: string;
    referencePaths: string[];
    calibrationPath?: string;
  };
  pinOrder: string[];
  palette: boolean;
  automaticMappings: string[];
  manualOnlyReason?: string;
  assetPath: string;
  assetHash: string;
  generation?:
    | {
        kind: "razavi-raster-reference" | "razavi-pdf-vector-reference";
        referenceManifestPath: string;
        referencePath: string;
        converterPath: string;
        converterVersion: number;
        /**
         * Uniform factor applied to the reference geometry so this Symbol
         * shares the pin span of its sibling family. Absent means
         * evidence-exact.
         */
        pinSpanScale?: number;
      }
    | {
        /**
         * Derived from another reviewed Symbol rather than from the reference
         * itself, so its visual authority is that Symbol's. The converter
         * states the one transformation it applies and its `:check` gate
         * keeps the pair from drifting apart.
         */
        kind: "derived-input-swap";
        sourceSymbolId: string;
        converterPath: string;
        converterVersion: number;
      };
}

export interface RazaviSemanticPrimitiveEntry {
  id: string;
  disposition: "semantic-primitive";
  geometry: {
    kind: "circle";
    sourceDiameterIU: number;
    fill: "foreground";
    stroke: "none";
  };
  runtimeOwner: string;
}

const symbolsById = new Map(
  razaviCatalogSymbols.map((symbol) => [symbol.id, symbol]),
);
const entriesById = new Map(
  razaviSymbolCatalogEntries.map((entry) => [entry.symbolId, entry]),
);

/**
 * Resolvable: a reviewed, Reference-calibrated Symbol the runtime may draw.
 *
 * `palette` is browsability, not existence. A Symbol reached by an action
 * rather than by picking it — the crossed-output and swapped-input siblings —
 * has to resolve everywhere the Project can name it while staying out of a
 * Library where it would read as a near-duplicate of its source.
 */
export function isRazaviLibraryCatalogEntry(
  entry: RazaviSymbolCatalogEntry,
): boolean {
  return (
    entry.reviewStatus === "reviewed" &&
    entry.visualAuthority.kind === "razavi-reference-v1"
  );
}

/** Browsable: the subset a person picks from. */
export function isRazaviProductCatalogEntry(
  entry: RazaviSymbolCatalogEntry,
): boolean {
  return entry.palette && isRazaviLibraryCatalogEntry(entry);
}

const symbolsFor = (
  predicate: (entry: RazaviSymbolCatalogEntry) => boolean,
): readonly SymbolDefinition[] =>
  razaviSymbolCatalogEntries
    .filter(predicate)
    .map((entry) => symbolsById.get(entry.symbolId)!)
    .filter((symbol): symbol is SymbolDefinition => symbol !== undefined);

export const razaviLibrarySymbols = symbolsFor(isRazaviLibraryCatalogEntry);
export const razaviProductSymbols = symbolsFor(isRazaviProductCatalogEntry);

export {
  razaviCatalogSymbols,
  razaviSemanticPrimitives,
  razaviSymbolCatalogEntries,
  razaviSymbolCatalogIdentity,
};

export function getRazaviCatalogSymbol(
  symbolId: string,
): SymbolDefinition | undefined {
  return symbolsById.get(symbolId);
}

export function requireRazaviCatalogSymbol(symbolId: string): SymbolDefinition {
  const symbol = getRazaviCatalogSymbol(symbolId);
  if (!symbol) throw new Error(`Unknown Razavi catalog symbol: ${symbolId}`);
  return symbol;
}

export function getRazaviCatalogEntry(
  symbolId: string,
): RazaviSymbolCatalogEntry | undefined {
  return entriesById.get(symbolId);
}

export function isRazaviProductSymbolId(symbolId: string): boolean {
  const entry = entriesById.get(symbolId);
  return entry !== undefined && isRazaviProductCatalogEntry(entry);
}
