import type {
  CircuitProject,
  SymbolDefinition,
  SymbolPrimitive,
} from "@icm/model";
import { symbolSignature } from "./symbol-signature.js";

/**
 * Exact built-in snapshots of the fully differential op-amps drawn before
 * VOCM could be shown (#2443), by content signature: d25933b32's definitions,
 * with their body fill and as drawn before it (#2313). Each form gains its
 * VOCM pin and lead, hidden by each supply-pin variant, a twin of each that
 * draws it, and its optional VOCM port, so a drawing looks and exports as it
 * did and an Instance may show VOCM. They are historical facts, not
 * recomputed from whichever library a later website ships.
 */
// prettier-ignore
const LEGACY_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
  "opamp-differential-crossed-inputs-swapped": [
    "vocm-pin-v1-1a5c233b437f1b4c",
    "vocm-pin-v1-874ca9a00dbd8dbf",
  ],
  "opamp-differential-crossed-lettered-inputs-swapped": [
    "vocm-pin-v1-0891d906552e5543",
    "vocm-pin-v1-df9b14f86df02973",
  ],
  "opamp-differential-crossed-lettered": [
    "vocm-pin-v1-9cbd0e9eb58c6f98",
    "vocm-pin-v1-8b58c38b5679b9bb",
  ],
  "opamp-differential-crossed": [
    "vocm-pin-v1-34f09434c987c500",
    "vocm-pin-v1-07b62fd6e654cf1b",
  ],
  "opamp-differential-inputs-swapped": [
    "vocm-pin-v1-f6aa5d15ee48d339",
    "vocm-pin-v1-20e8521c1c05876e",
  ],
  "opamp-differential-lettered-inputs-swapped": [
    "vocm-pin-v1-382709535f551a08",
    "vocm-pin-v1-27127ced519ad6e7",
  ],
  "opamp-differential-lettered": [
    "vocm-pin-v1-262cae2bd7090c05",
    "vocm-pin-v1-8ec472444ba762b2",
  ],
  "opamp-differential-wide-crossed-inputs-swapped": [
    "vocm-pin-v1-11f757a62323752a",
    "vocm-pin-v1-940ee16e436c0f81",
  ],
  "opamp-differential-wide-crossed-lettered-inputs-swapped": [
    "vocm-pin-v1-ebfc2b163fb272a6",
    "vocm-pin-v1-2346987aa4abbe14",
  ],
  "opamp-differential-wide-crossed-lettered": [
    "vocm-pin-v1-9c7f854f0e81d85a",
    "vocm-pin-v1-382ea24a590cb9f1",
  ],
  "opamp-differential-wide-crossed": [
    "vocm-pin-v1-7349512bd729029c",
    "vocm-pin-v1-9ca4227ee182c963",
  ],
  "opamp-differential-wide-inputs-swapped": [
    "vocm-pin-v1-ad8672e338b5670c",
    "vocm-pin-v1-e28a41ec82dabd9f",
  ],
  "opamp-differential-wide-lettered-inputs-swapped": [
    "vocm-pin-v1-5bd739e282e7ffde",
    "vocm-pin-v1-7ef0105c62dfe8ad",
  ],
  "opamp-differential-wide-lettered": [
    "vocm-pin-v1-0f836e7478b7b4a2",
    "vocm-pin-v1-976a443f4fd87429",
  ],
  "opamp-differential-wide": [
    "vocm-pin-v1-65215548660c45fb",
    "vocm-pin-v1-2608f4af037e7f29",
  ],
  "opamp-differential": [
    "vocm-pin-v1-9743cb7f3cf19f3b",
    "vocm-pin-v1-279a9e77e8bba910",
  ],
};

const VOCM = "VOCM";
const VOCM_LEAD = "vocm-lead";
const VOCM_VARIANTS: Readonly<Record<string, string>> = {
  "signal-pins": "vocm-pin",
  "supply-pins": "supply-vocm-pins",
};

/**
 * Where a form draws VOCM, and where its lead meets the body: below a
 * compact body, beside VSS; at a Wide body's apex, between its outputs.
 */
function vocmPlacement(id: string) {
  return id.startsWith("opamp-differential-wide")
    ? {
        at: { x: 30, y: 0 },
        contact: { x: 21.961524, y: 0 },
        direction: "east" as const,
      }
    : {
        at: { x: 0, y: 30 },
        contact: { x: 0, y: 12.679492 },
        direction: "south" as const,
      };
}

/** `symbol` as drawn before it had VOCM: no such pin, lead or variants. */
export function withoutVocmPin(symbol: SymbolDefinition): SymbolDefinition {
  if (!symbol.pins.some((pin) => pin.name === VOCM)) return symbol;
  const twins = new Set(Object.values(VOCM_VARIANTS));
  return {
    ...symbol,
    pins: symbol.pins.filter((pin) => pin.name !== VOCM),
    primitives: symbol.primitives.filter(
      (primitive) => primitive.part !== VOCM_LEAD,
    ),
    variants: symbol.variants
      .filter((variant) => !twins.has(variant.id))
      .map((variant) => ({
        ...variant,
        hiddenPinNames: variant.hiddenPinNames.filter((name) => name !== VOCM),
        ...(variant.hiddenPrimitiveParts
          ? {
              hiddenPrimitiveParts: variant.hiddenPrimitiveParts.filter(
                (part) => part !== VOCM_LEAD,
              ),
            }
          : {}),
      })),
  };
}

function withVocmPin(symbol: SymbolDefinition): SymbolDefinition {
  const { at, contact, direction } = vocmPlacement(symbol.id);
  const lead: SymbolPrimitive = {
    kind: "line",
    from: contact,
    to: at,
    style: { strokeRole: "normal", lineCap: "butt", lineJoin: "miter" },
    part: VOCM_LEAD,
  };
  return {
    ...symbol,
    pins: [
      ...symbol.pins,
      {
        name: VOCM,
        role: "common-mode-input",
        at,
        direction,
        presentation: { visibility: "visible", leadLength: 10 },
      },
    ],
    primitives: [...symbol.primitives, lead],
    variants: [
      ...symbol.variants.map((variant) => ({
        ...variant,
        hiddenPinNames: [...variant.hiddenPinNames, VOCM],
        hiddenPrimitiveParts: [
          ...(variant.hiddenPrimitiveParts ?? []),
          VOCM_LEAD,
        ],
      })),
      ...symbol.variants.map((variant) => ({
        ...variant,
        id: VOCM_VARIANTS[variant.id]!,
      })),
    ],
  };
}

export function repairVocmPinSnapshots(
  project: CircuitProject,
): CircuitProject {
  let repaired = false;
  const definitions = project.componentDefinitions?.map((definition) => {
    const signatures = Object.hasOwn(LEGACY_SYMBOLS, definition.symbol.id)
      ? LEGACY_SYMBOLS[definition.symbol.id]!
      : [];
    const subcircuit = definition.subcircuit;
    if (
      definition.generatedFrom ||
      !subcircuit ||
      subcircuit.ports.some((port) => port.name === VOCM) ||
      !signatures.includes(symbolSignature("vocm-pin-v1", definition.symbol))
    )
      return definition;
    repaired = true;
    return {
      ...definition,
      symbol: withVocmPin(definition.symbol),
      subcircuit: {
        ...subcircuit,
        ports: [
          ...subcircuit.ports,
          {
            name: VOCM,
            direction: "input" as const,
            pinName: VOCM,
            optional: true as const,
          },
        ],
      },
    };
  });
  return repaired
    ? { ...project, componentDefinitions: definitions! }
    : project;
}
