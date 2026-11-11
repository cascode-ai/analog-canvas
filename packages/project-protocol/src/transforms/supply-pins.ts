import type { CircuitProject } from "@icm/model";
import { symbolSignature } from "./symbol-signature.js";

/** A supply pin's x and y, and where its lead meets the body. */
type Supply = readonly [x: number, y: number, contactY: number];

/**
 * Exact built-in snapshots drawn before their supplies could be shown, by
 * content signature, with where the current symbol draws VDD and VSS.
 *
 * - Repair v1 (#1833): the eight single-ended op-amp forms from op-amp
 *   converter v6, from 412b36ccf06e3c2b2e754dc58b6616da20452b83's
 *   definitions (`opamp-supply-v6`).
 * - Repair v2 (#1941): every other block that takes VDD and VSS, from
 *   a7a3ac1c9a49cf5c787ce9a44fcb7685e1403ef8's definitions, and the AND and
 *   NAND gates as drawn before their bodies were closed (#1043)
 *   (`block-supply-v1`).
 *
 * They are historical facts, not recomputed from whichever library a later
 * website happens to ship. Each form gains its VDD and VSS pins and their
 * leads, after its own, hidden by the default variant, so a drawing looks as
 * it did and an Instance may show them. Its interface already takes both
 * supplies; Document content stays untouched. Grouped by where the forms
 * draw VDD and VSS.
 */
const LEGACY_GROUPS: readonly (readonly [
  vdd: Supply,
  vss: Supply,
  forms: Readonly<Record<string, string | readonly string[]>>,
])[] = [
  [
    [0, -30, -12.679492],
    [0, 30, 12.679492],
    {
      opamp: "opamp-supply-v6-c077cc0237b74b5e",
      "opamp-lettered": "opamp-supply-v6-a488feb6a21aee07",
      "opamp-wide": "opamp-supply-v6-e0e7909d27276368",
      "opamp-wide-lettered": "opamp-supply-v6-aba400b57f3f573c",
      "opamp-inputs-swapped": "opamp-supply-v6-5d50bf8ec42579e9",
      "opamp-lettered-inputs-swapped": "opamp-supply-v6-7391b3899484804e",
      "opamp-wide-inputs-swapped": "opamp-supply-v6-6e0fdc8ed22218e0",
      "opamp-wide-lettered-inputs-swapped": "opamp-supply-v6-86d00a7b853f0654",
      comparator: "block-supply-v1-7d827cebd21e73a1",
      "comparator-inputs-swapped": "block-supply-v1-8535f5240c057c8a",
      "comparator-unmarked": "block-supply-v1-0efa0d858e7e83e1",
      "comparator-unmarked-inputs-swapped": "block-supply-v1-c96779cd0554033d",
      "voltage-amplifier": "block-supply-v1-f3a330d2a7e591b2",
      "voltage-amplifier-lettered": "block-supply-v1-e12e805f22b3df1c",
    },
  ],
  [
    [0, -30, -20],
    [0, 30, 20],
    {
      adc: "block-supply-v1-08468eeae15a5df6",
      dac: "block-supply-v1-6585295f527c20bd",
    },
  ],
  [
    [0, -20, -12],
    [10, 20, 6.633241],
    {
      adder: "block-supply-v1-8dba1ba49c6c6a89",
      multiplier: "block-supply-v1-8f702643c13bd046",
    },
  ],
  [
    [-10, -20, -15.077165],
    [-10, 20, 14.921964],
    {
      "and-gate": [
        "block-supply-v1-606ddcf635053cfc",
        "block-supply-v1-04afed17a797c9eb",
      ],
      "and-gate-3": "block-supply-v1-c3ebecdd052b6d4a",
      "and-gate-4": "block-supply-v1-ba84f010db41f6cf",
    },
  ],
  [
    [-10, -20, -7.960516],
    [-10, 20, 8.683668],
    {
      buffer: "block-supply-v1-139865415d25eab7",
    },
  ],
  [
    [-10, -30, -18.452995],
    [-10, 30, 18.452995],
    {
      "comparator-differential": "block-supply-v1-347ca68ea19e4c32",
      "comparator-differential-inputs-swapped":
        "block-supply-v1-0bd56b489f8029a2",
      "comparator-differential-unmarked": "block-supply-v1-dcd456cae39bca76",
      "comparator-differential-unmarked-inputs-swapped":
        "block-supply-v1-4db74d3230031362",
      "opamp-differential": "block-supply-v1-ea083bdd0d7476ab",
      "opamp-differential-crossed": "block-supply-v1-1af18b72681784ee",
      "opamp-differential-crossed-inputs-swapped":
        "block-supply-v1-b2cbc89479b80381",
      "opamp-differential-crossed-lettered": "block-supply-v1-e9b48094a9400e7b",
      "opamp-differential-crossed-lettered-inputs-swapped":
        "block-supply-v1-e7c82a764f823dc2",
      "opamp-differential-inputs-swapped": "block-supply-v1-037467cfeb55f6d3",
      "opamp-differential-lettered": "block-supply-v1-a01b1a68ef332041",
      "opamp-differential-lettered-inputs-swapped":
        "block-supply-v1-573b3b99509a3845",
    },
  ],
  [
    [0, -40, -25],
    [0, 40, 25],
    {
      "d-flip-flop": "block-supply-v1-5a029f94af30f3df",
      "d-flip-flop-q": "block-supply-v1-36aa9e31d168d0fd",
    },
  ],
  [
    [0, -40, -25],
    [-20, 50, 35],
    {
      "d-flip-flop-reset": "block-supply-v1-68826c6bdef0fefd",
    },
  ],
  [
    [0, -20, -12],
    [0, 20, 12],
    {
      "delay-cell": "block-supply-v1-2bcee60aef795f21",
    },
  ],
  [
    [0, -40, -26.25],
    [0, 40, 26.25],
    {
      "differential-transconductance": "block-supply-v1-eecc74d0257c73d5",
      "differential-transconductance-inputs-swapped":
        "block-supply-v1-b64d108ee2db4aed",
      transconductance: "block-supply-v1-6b5c30063d1ce8f7",
    },
  ],
  [
    [-10, -20, -8.684724],
    [-10, 20, 7.959819],
    {
      inverter: "block-supply-v1-772d840f1286757a",
    },
  ],
  [
    [-10, -20, -14.921092],
    [-10, 20, 15.07978],
    {
      "nand-gate": [
        "block-supply-v1-9c1185e28fe44891",
        "block-supply-v1-5e5c63881477cb93",
      ],
      "nand-gate-3": "block-supply-v1-fe6077e2e8b591f9",
      "nand-gate-4": "block-supply-v1-29a5f4e6f423e459",
    },
  ],
  [
    [-10, -20, -15.504847],
    [-10, 20, 15.587068],
    {
      "nor-gate": "block-supply-v1-7223e604bf3de1e4",
      "nor-gate-3": "block-supply-v1-d3a7dcbea91ef03a",
      "nor-gate-4": "block-supply-v1-0012c49b1323bfb0",
      "or-gate": "block-supply-v1-b926187d36af6a80",
      "or-gate-3": "block-supply-v1-fac13bfb2dc7ef2f",
      "or-gate-4": "block-supply-v1-48cf2ce27dfe5ee5",
    },
  ],
  [
    [-20, -30, -24.226497],
    [-20, 30, 24.226497],
    {
      "opamp-differential-wide": "block-supply-v1-e918488c272226a5",
      "opamp-differential-wide-crossed": "block-supply-v1-f0fb372eb1a6cfd0",
      "opamp-differential-wide-crossed-inputs-swapped":
        "block-supply-v1-195dff4ef8bdbfd3",
      "opamp-differential-wide-crossed-lettered":
        "block-supply-v1-c405bf36181dcf39",
      "opamp-differential-wide-crossed-lettered-inputs-swapped":
        "block-supply-v1-eb18830f7fc413bc",
      "opamp-differential-wide-inputs-swapped":
        "block-supply-v1-a4459ff4a4146142",
      "opamp-differential-wide-lettered": "block-supply-v1-47a409b05b7e6e2a",
      "opamp-differential-wide-lettered-inputs-swapped":
        "block-supply-v1-ef5067d21ad8dd47",
    },
  ],
  [
    [0, -20, -14.494679],
    [0, 20, 14.554466],
    {
      "xnor-gate": "block-supply-v1-9a7690cb6a062b3d",
      "xnor-gate-3": "block-supply-v1-269c7ff7af9a9d23",
      "xnor-gate-4": "block-supply-v1-e9defe9c7b5b0c91",
      "xor-gate": "block-supply-v1-d98b470c02b5bc26",
      "xor-gate-3": "block-supply-v1-126572020d049a42",
      "xor-gate-4": "block-supply-v1-23b1003ad46937d6",
    },
  ],
];
const LEGACY_SYMBOLS = new Map<
  string,
  { signatures: readonly string[]; vdd: Supply; vss: Supply }
>(
  LEGACY_GROUPS.flatMap(([vdd, vss, forms]) =>
    Object.entries(forms).map(([id, signatures]) => [
      id,
      { signatures: [signatures].flat(), vdd, vss },
    ]),
  ),
);

const supply = (name: "VDD" | "VSS", [x, y, contactY]: Supply) => ({
  pin: {
    name,
    role: name === "VDD" ? "positive-supply" : "negative-supply",
    at: { x, y },
    direction: name === "VDD" ? ("north" as const) : ("south" as const),
    presentation: { visibility: "visible" as const, leadLength: 10 },
  },
  lead: {
    kind: "line" as const,
    from: { x, y: contactY },
    to: { x, y },
    style: {
      strokeRole: "normal" as const,
      lineCap: "butt" as const,
      lineJoin: "miter" as const,
    },
    part: `${name.toLowerCase()}-lead`,
  },
});

/** The signature's own prefix: everything before its 16-digit hash. */
const matches = (signature: string, symbol: unknown) =>
  symbolSignature(signature.slice(0, -17), symbol) === signature;

export function repairSupplyPinSnapshots(
  project: CircuitProject,
): CircuitProject {
  let repaired = false;
  const definitions = project.componentDefinitions?.map((definition) => {
    const legacy = LEGACY_SYMBOLS.get(definition.symbol.id);
    const ports = definition.subcircuit?.ports ?? [];
    if (
      !legacy ||
      definition.generatedFrom ||
      // The pins draw these supplies; an interface without both keeps its
      // art, as a Circuit Component does, whose native source maps its own.
      !(["VDD", "VSS"] as const).every((name) =>
        ports.some((port) => "supply" in port && port.supply === name),
      ) ||
      !legacy.signatures.some((signature) =>
        matches(signature, definition.symbol),
      )
    )
      return definition;
    repaired = true;
    const supplies = [supply("VDD", legacy.vdd), supply("VSS", legacy.vss)];
    return {
      ...definition,
      symbol: {
        ...definition.symbol,
        pins: [...definition.symbol.pins, ...supplies.map(({ pin }) => pin)],
        primitives: [
          ...definition.symbol.primitives,
          ...supplies.map(({ lead }) => lead),
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
