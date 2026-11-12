/**
 * The marker Symbols that name a supply Net by its own name: VDD Power
 * (`vdd-port`) and Named Ground (`named-ground`, the ground glyph with its
 * Net's name under it, as VSS, AGND or DGND are drawn). Each is a supply
 * label: it claims its Net by name, can be renamed, and can be a Cell Pin.
 * Ground (`ground`) is not one of them; it is always node 0.
 */
const SUPPLY_PORT_SYMBOL_IDS: ReadonlySet<string> = new Set([
  "vdd-port",
  "named-ground",
]);

export function isSupplyPortSymbol(symbolId: string): boolean {
  return SUPPLY_PORT_SYMBOL_IDS.has(symbolId);
}

/** A power marker: Ground, or a supply port that names its Net. */
export function isPowerMarkerSymbol(symbolId: string): boolean {
  return symbolId === "ground" || isSupplyPortSymbol(symbolId);
}
