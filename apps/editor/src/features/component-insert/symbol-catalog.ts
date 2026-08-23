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

/**
 * Library display names, where the catalog's own name does not say what the
 * entry is *for*.
 *
 * "Cell Pin" and "Port" are the same drawing with different meanings, and the
 * names did not say which was which — the difference is whether the terminal
 * appears on the cell's interface, so the names say that now. The model keeps
 * its terms (ADR 0034's Formal Cell Pin and Free Net Port); this is what the
 * Library calls them.
 */
const LIBRARY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "cell-pin": "Interface Pin",
  port: "Net Label",
  "port-filled": "Net Label (filled)",
};

/** One line saying what an entry does, where the name alone leaves a doubt. */
const LIBRARY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "cell-pin":
    "A terminal on this cell's interface — the parent circuit connects to it",
  port: "Names a net on this sheet; not part of the cell's interface",
  "port-filled":
    "Names a net on this sheet, drawn solid; not part of the cell's interface",
};

export function libraryDisplayName(symbolId: string, fallback: string): string {
  return LIBRARY_DISPLAY_NAMES[symbolId] ?? fallback;
}

export function libraryDescription(symbolId: string): string | undefined {
  return LIBRARY_DESCRIPTIONS[symbolId];
}

export function paletteSymbols(_styleProfileId: string): SymbolDefinition[] {
  return [vddRailPreviewSymbol, cellPinPreviewSymbol, ...razaviProductSymbols];
}

/**
 * Reach order inside a category. Alphabetical order separated devices that are
 * used together — NMOS from PMOS, the supply Port from its Rail — so the
 * frequently placed pair leads and the rest keep alphabetical order after it.
 */
const SYMBOL_ORDER: readonly string[] = [
  "nmos",
  "pmos",
  "vdd-port",
  "vdd",
  "ground",
];

function symbolRank(symbolId: string): number {
  const index = SYMBOL_ORDER.indexOf(symbolId);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
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
      const leftOrder = symbolRank(left.id);
      const rightOrder = symbolRank(right.id);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
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
