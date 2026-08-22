import { razaviProductSymbols } from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";

import { cellPinPreviewSymbol } from "./cell-pin-preview-symbol";
import { vddRailPreviewSymbol } from "./vdd-rail-preview-symbol";

/**
 * Reach order rather than taxonomy order: the devices placed most often in a
 * Razavi-style schematic come first, and the composite blocks and logic gates
 * that are reached for least often sit at the end.
 */
const CATEGORY_ORDER = [
  "Transistors",
  "Passives",
  "Power and Ports",
  "Sources",
  "Switches",
  "Analog Blocks",
  "Logic Gates",
] as const;

export interface ComponentCatalogGroup {
  category: string;
  symbols: SymbolDefinition[];
}

export function symbolCategory(symbolId: string): string {
  if (["nmos", "pmos", "npn", "pnp"].includes(symbolId)) {
    return "Transistors";
  }
  if (
    [
      "resistor",
      "variable-resistor",
      "capacitor",
      "variable-capacitor",
      "inductor-compact",
      "inductor",
      "variable-inductor",
      "diode",
    ].includes(symbolId)
  ) {
    return "Passives";
  }
  if (
    [
      "opamp",
      "opamp-differential",
      "opamp-differential-crossed",
      "voltage-amplifier",
      "comparator",
    ].includes(symbolId)
  ) {
    return "Analog Blocks";
  }
  if (
    [
      "inverter",
      "and-gate",
      "or-gate",
      "nand-gate",
      "nor-gate",
      "xor-gate",
      "xnor-gate",
    ].includes(symbolId)
  ) {
    return "Logic Gates";
  }
  if (["voltage-source", "current-source"].includes(symbolId)) {
    return "Sources";
  }
  if (["ideal-switch", "closed-switch"].includes(symbolId)) {
    return "Switches";
  }
  return "Power and Ports";
}

export function paletteSymbols(_styleProfileId: string): SymbolDefinition[] {
  return [vddRailPreviewSymbol, cellPinPreviewSymbol, ...razaviProductSymbols];
}

function searchableText(symbol: SymbolDefinition): string {
  return `${symbol.name} ${symbol.id}`.toLowerCase();
}

export function componentCatalog(
  styleProfileId: string,
  query: string,
  recentSymbolIds: readonly string[] = [],
): ComponentCatalogGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  const recentRank = new Map(
    recentSymbolIds.map((symbolId, index) => [symbolId, index]),
  );
  const symbols = paletteSymbols(styleProfileId)
    .filter(
      (symbol) =>
        normalizedQuery.length === 0 ||
        searchableText(symbol).includes(normalizedQuery),
    )
    .sort((left, right) => {
      const leftRank = recentRank.get(left.id) ?? Number.POSITIVE_INFINITY;
      const rightRank = recentRank.get(right.id) ?? Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name);
    });

  return CATEGORY_ORDER.map((category) => ({
    category,
    symbols: symbols.filter((symbol) => symbolCategory(symbol.id) === category),
  })).filter((group) => group.symbols.length > 0);
}

export function findPaletteSymbol(
  styleProfileId: string,
  symbolId: string,
): SymbolDefinition | undefined {
  return paletteSymbols(styleProfileId).find(
    (symbol) => symbol.id === symbolId,
  );
}

export function flattenComponentCatalog(
  groups: readonly ComponentCatalogGroup[],
): SymbolDefinition[] {
  return groups.flatMap((group) => group.symbols);
}
