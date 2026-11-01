import type { CircuitProject } from "@icm/model";
import { symbolSignature } from "./symbol-signature.js";

/**
 * Repair v1: exact built-in snapshots from op-amp converter v6 (#1833).
 * Signatures cover the complete Symbol of each single-ended op-amp form, from
 * 412b36ccf06e3c2b2e754dc58b6616da20452b83's definitions. They are historical
 * facts, not recomputed from whichever library a later website happens to
 * ship. Each form gains its VDD and VSS pins and their leads, hidden by the
 * default variant, so a drawing looks as it did and an Instance may show
 * them. Its interface already takes both supplies; Document content stays
 * untouched.
 */
const LEGACY_SYMBOLS = new Map([
  ["opamp", "opamp-supply-v6-c077cc0237b74b5e"],
  ["opamp-lettered", "opamp-supply-v6-a488feb6a21aee07"],
  ["opamp-wide", "opamp-supply-v6-e0e7909d27276368"],
  ["opamp-wide-lettered", "opamp-supply-v6-aba400b57f3f573c"],
  ["opamp-inputs-swapped", "opamp-supply-v6-5d50bf8ec42579e9"],
  ["opamp-lettered-inputs-swapped", "opamp-supply-v6-7391b3899484804e"],
  ["opamp-wide-inputs-swapped", "opamp-supply-v6-6e0fdc8ed22218e0"],
  ["opamp-wide-lettered-inputs-swapped", "opamp-supply-v6-86d00a7b853f0654"],
]);

/** Where the slanted edges cross x 0: 30 - 10√3, as converter v7 draws it. */
const SUPPLY_CONTACT_Y = 12.679492;
const supply = (name: "VDD" | "VSS", side: -1 | 1) => ({
  pin: {
    name,
    role: side < 0 ? "positive-supply" : "negative-supply",
    at: { x: 0, y: side * 30 },
    direction: side < 0 ? ("north" as const) : ("south" as const),
    presentation: { visibility: "visible" as const, leadLength: 10 },
  },
  lead: {
    kind: "line" as const,
    from: { x: 0, y: side * SUPPLY_CONTACT_Y },
    to: { x: 0, y: side * 30 },
    style: {
      strokeRole: "normal" as const,
      lineCap: "butt" as const,
      lineJoin: "miter" as const,
    },
    part: `${name.toLowerCase()}-lead`,
  },
});
const SUPPLIES = [supply("VDD", -1), supply("VSS", 1)];

export function repairOpampSupplyPinSnapshots(
  project: CircuitProject,
): CircuitProject {
  let repaired = false;
  const definitions = project.componentDefinitions?.map((definition) => {
    const expected = LEGACY_SYMBOLS.get(definition.symbol.id);
    const ports = definition.subcircuit?.ports ?? [];
    if (
      !expected ||
      definition.generatedFrom ||
      // The pins draw these supplies; an interface without both keeps its
      // art, as a Circuit Component does, whose native source maps its own.
      !(["VDD", "VSS"] as const).every((name) =>
        ports.some((port) => "supply" in port && port.supply === name),
      ) ||
      symbolSignature("opamp-supply-v6", definition.symbol) !== expected
    )
      return definition;
    repaired = true;
    return {
      ...definition,
      symbol: {
        ...definition.symbol,
        pins: [...definition.symbol.pins, ...SUPPLIES.map(({ pin }) => pin)],
        primitives: [
          ...definition.symbol.primitives,
          ...SUPPLIES.map(({ lead }) => lead),
        ],
        variants: [
          {
            id: "signal-pins",
            hiddenPinNames: ["VDD", "VSS"],
            hiddenPrimitiveParts: ["vdd-lead", "vss-lead"],
            additionalPrimitives: [],
          },
          {
            id: "supply-pins",
            hiddenPinNames: [],
            hiddenPrimitiveParts: [],
            additionalPrimitives: [],
          },
        ],
        defaultVariantId: "signal-pins",
      },
    };
  });
  return repaired
    ? { ...project, componentDefinitions: definitions! }
    : project;
}
