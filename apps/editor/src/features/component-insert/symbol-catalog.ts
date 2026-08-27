import {
  expandedDeviceCatalogEntry,
  expandedDeviceSymbols,
  EXTENDED_DEVICE_CATEGORY,
  HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
  razaviProductSymbols,
} from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";

import { vddRailPreviewSymbol } from "./vdd-rail-preview-symbol";

/**
 * Reach order rather than taxonomy order: the devices placed most often in a
 * Razavi-style schematic come first, and the composite blocks and logic gates
 * that are reached for least often sit at the end.
 */
interface CatalogSection {
  readonly category: string;
  readonly subcategory?: string;
}

const CATALOG_SECTIONS: readonly CatalogSection[] = [
  { category: "Transistors" },
  { category: "Passives" },
  { category: "Power and Ports" },
  { category: "Sources" },
  { category: "Switches" },
  { category: "Analog Blocks" },
  { category: "Logic Gates" },
  {
    category: EXTENDED_DEVICE_CATEGORY,
    subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
  },
];

export interface ComponentCatalogGroup {
  category: string;
  subcategory?: string;
  symbols: SymbolDefinition[];
}

export function symbolCategory(symbolId: string): string {
  const expanded = expandedDeviceCatalogEntry(symbolId);
  if (expanded) return expanded.category;
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
      "comparator-unmarked",
    ].includes(symbolId)
  ) {
    return "Analog Blocks";
  }
  if (
    [
      "inverter",
      "buffer",
      "delay-cell",
      "d-flip-flop",
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

export function symbolSubcategory(symbolId: string): string | undefined {
  return expandedDeviceCatalogEntry(symbolId)?.subcategory;
}

/**
 * Library display names, where the catalog's own name does not say what the
 * entry is *for*.
 *
 * Port artwork has one meaning: an independently authored Cell Pin. Hollow
 * and filled entries are appearance variants, never shared interface objects.
 */
const LIBRARY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  port: "Cell Pin",
  "port-filled": "Cell Pin (filled)",
};

/** One line saying what an entry does, where the name alone leaves a doubt. */
const LIBRARY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  port: "A terminal on this Cell interface — the parent circuit connects to it",
  "port-filled": "An independent Cell Pin with a solid appearance",
};

export function libraryDisplayName(symbolId: string, fallback: string): string {
  return LIBRARY_DISPLAY_NAMES[symbolId] ?? fallback;
}

export function libraryDescription(symbolId: string): string | undefined {
  return LIBRARY_DESCRIPTIONS[symbolId];
}

export function paletteSymbols(_styleProfileId: string): SymbolDefinition[] {
  return [
    vddRailPreviewSymbol,
    ...razaviProductSymbols,
    ...expandedDeviceSymbols,
  ];
}

/**
 * Reach order inside a category. Alphabetical order separated devices that are
 * used together — NMOS from PMOS, the supply Port from its Rail — so the
 * frequently placed pair leads and the rest keep alphabetical order after it.
 */
const SYMBOL_ORDER: readonly string[] = [
  "nmos",
  "pmos",
  "ndmos",
  "pdmos",
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

  return CATALOG_SECTIONS.map(({ category, ...location }) => ({
    category,
    ...location,
    symbols: symbols.filter(
      (symbol) =>
        symbolCategory(symbol.id) === category &&
        symbolSubcategory(symbol.id) === location.subcategory,
    ),
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
