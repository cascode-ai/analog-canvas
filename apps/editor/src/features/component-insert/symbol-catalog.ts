import {
  expandedDeviceCatalogEntry,
  expandedDeviceSymbols,
  EXTENDED_DEVICE_CATEGORY,
  normalizeSignalFlowFormula,
  razaviProductSymbols,
} from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";

import {
  ANNOTATION_CATEGORY,
  annotationPreviewSymbols,
  isAnnotationPaletteSymbol,
} from "./annotation-preview-symbols";
import { vddRailPreviewSymbol } from "./vdd-rail-preview-symbol";
import { TIMING_UI_ENABLED } from "../simulation/timing-ui";

/**
 * Reach order rather than taxonomy order: the devices placed most often in a
 * Razavi-style schematic come first, and the composite blocks and logic gates
 * that are reached for least often sit at the end.
 */
interface CatalogSection {
  readonly category: string;
}

const CATALOG_SECTIONS: readonly CatalogSection[] = [
  { category: "Transistors" },
  { category: "Passives" },
  { category: "Power and Ports" },
  { category: "Sources" },
  { category: "Switches" },
  { category: "Analog Blocks" },
  { category: "Logic Gates" },
  { category: "Signal Flow" },
  { category: ANNOTATION_CATEGORY },
  { category: EXTENDED_DEVICE_CATEGORY },
];

export interface ComponentCatalogGroup {
  category: string;
  symbols: SymbolDefinition[];
}

export function symbolCategory(symbolId: string): string {
  if (isAnnotationPaletteSymbol(symbolId)) return ANNOTATION_CATEGORY;
  // Keep diode and adjustable-passive tiles in Extended Devices,
  // leaving the everyday transistor and passive groups compact.
  if (
    [
      "variable-resistor",
      "variable-capacitor",
      "variable-inductor",
      "diode",
      "zener-diode",
    ].includes(symbolId)
  ) {
    return EXTENDED_DEVICE_CATEGORY;
  }
  const expanded = expandedDeviceCatalogEntry(symbolId);
  if (expanded) return expanded.category;
  if (["nmos", "pmos", "npn", "pnp"].includes(symbolId)) {
    return "Transistors";
  }
  if (
    ["resistor", "capacitor", "inductor-compact", "inductor"].includes(symbolId)
  ) {
    return "Passives";
  }
  if (
    [
      "opamp",
      "opamp-lettered",
      "voltage-amplifier-lettered",
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
      "d-flip-flop-q",
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
  if (
    [
      "adder",
      "multiplier",
      "transconductance",
      "integrator",
      "unit-delay",
      "discrete-time-integrator",
      "quantizer",
    ].includes(symbolId)
  ) {
    return "Signal Flow";
  }
  if (
    ["voltage-source", "pulse-voltage-source", "current-source"].includes(
      symbolId,
    )
  ) {
    return "Sources";
  }
  if (
    ["ideal-switch", "closed-switch", "voltage-controlled-switch"].includes(
      symbolId,
    )
  ) {
    return "Switches";
  }
  return "Power and Ports";
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
  "zener-diode": "Zener",
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

export function paletteSymbols(
  _styleProfileId: string,
  timingUiEnabled = TIMING_UI_ENABLED,
): SymbolDefinition[] {
  const symbols = [
    vddRailPreviewSymbol,
    ...razaviProductSymbols,
    ...annotationPreviewSymbols,
    ...expandedDeviceSymbols,
  ];
  return timingUiEnabled
    ? symbols
    : symbols.filter((symbol) => symbol.id !== "pulse-voltage-source");
}

/**
 * Reach order inside a category. Alphabetical order separated devices that are
 * used together — NMOS from PMOS, the supply Port from its Rail — so the
 * frequently placed pair leads and the rest keep alphabetical order after it.
 */
const SYMBOL_ORDER: readonly string[] = [
  "nmos",
  "pmos",
  "npn",
  "pnp",
  // Passives in the order they are taught and reached for, not alphabetical.
  "resistor",
  "capacitor",
  "inductor-compact",
  "inductor",
  // Logic gates likewise: the two single-input gates, then the combinational
  // family, then the sequential blocks that are reached for least often.
  "inverter",
  "buffer",
  "and-gate",
  "or-gate",
  "nand-gate",
  "nor-gate",
  "xor-gate",
  "xnor-gate",
  "d-flip-flop",
  "d-flip-flop-q",
  "delay-cell",
  "variable-resistor",
  "variable-capacitor",
  "variable-inductor",
  "diode",
  "zener-diode",
  "ndmos",
  "pdmos",
  "vdd-port",
  "vdd",
  "ground",
  // Signal-flow blocks in signal-chain order, not alphabetical.
  "adder",
  "multiplier",
  "transconductance",
  "integrator",
  "unit-delay",
  "discrete-time-integrator",
  "quantizer",
  // Annotations: drawing tools first (toolbar order), then the polarity
  // label, standalone signs, and fixed decorative marks last.
  "annotation-arrow",
  "annotation-line",
  "annotation-rectangle",
  "annotation-circle",
  "annotation-polarity-both",
  "annotation-text-plus",
  "annotation-text-minus",
  "annotation-ellipsis",
];

function symbolRank(symbolId: string): number {
  const index = SYMBOL_ORDER.indexOf(symbolId);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

function searchableText(symbol: SymbolDefinition): string {
  const formula = symbol.formulaPresentation?.defaultFormula ?? "";
  return normalizeSignalFlowFormula(
    `${symbol.name} ${symbol.id} ${formula}`,
  ).toLowerCase();
}

export function componentCatalog(
  styleProfileId: string,
  query: string,
  recentSymbolIds: readonly string[] = [],
  timingUiEnabled = TIMING_UI_ENABLED,
): ComponentCatalogGroup[] {
  const normalizedQuery = normalizeSignalFlowFormula(
    query.trim(),
  ).toLowerCase();
  const recentRank = new Map(
    recentSymbolIds.map((symbolId, index) => [symbolId, index]),
  );
  const symbols = paletteSymbols(styleProfileId, timingUiEnabled)
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

  return CATALOG_SECTIONS.map(({ category }) => ({
    category,
    symbols: symbols.filter((symbol) => symbolCategory(symbol.id) === category),
  })).filter((group) => group.symbols.length > 0);
}

export function findPaletteSymbol(
  styleProfileId: string,
  symbolId: string,
  timingUiEnabled = TIMING_UI_ENABLED,
): SymbolDefinition | undefined {
  return paletteSymbols(styleProfileId, timingUiEnabled).find(
    (symbol) => symbol.id === symbolId,
  );
}

export function flattenComponentCatalog(
  groups: readonly ComponentCatalogGroup[],
): SymbolDefinition[] {
  return groups.flatMap((group) => group.symbols);
}
