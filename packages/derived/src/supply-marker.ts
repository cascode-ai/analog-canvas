/**
 * The symbols that mean "this point is a supply", and the Net each one
 * authors when placed. A marker is an explicit placement, so reading one is
 * evidence, never inference: nothing here derives a supply from a Net's
 * spelling, from device polarity, or from where a wire happens to sit.
 *
 * This lives below the Edit Engine because two different readers need it —
 * the planner that authors the Net when a marker is placed, and the body
 * policy that asks which supply a MOS body follows.
 */
const SUPPLY_MARKER_BY_SYMBOL = {
  ground: {
    name: "0",
    pinName: "0",
    domain: "ground",
    scope: "global",
  },
  "vdd-port": {
    name: "VDD",
    pinName: "P",
    domain: "vdd",
    scope: "global",
  },
  // A ground net with a name of its own (VSS, AGND): a named supply rail,
  // the domain a negative rail drawn on VDD Power already has. Node 0 stays
  // the plain Ground's alone.
  "named-ground": {
    name: "VSS",
    pinName: "P",
    domain: "vdd",
    scope: "global",
  },
} as const;

export type SupplyMarker =
  (typeof SUPPLY_MARKER_BY_SYMBOL)[keyof typeof SUPPLY_MARKER_BY_SYMBOL];

export type SupplyDomain = SupplyMarker["domain"];

export function supplyMarkerForSymbol(
  symbolId: string,
): SupplyMarker | undefined {
  return SUPPLY_MARKER_BY_SYMBOL[
    symbolId as keyof typeof SUPPLY_MARKER_BY_SYMBOL
  ];
}
