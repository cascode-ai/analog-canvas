import { deriveStableId, type CircuitProject } from "@icm/model";

/**
 * Repair v1: exact built-in snapshots from op-amp converter v8 (#1392).
 * Signatures cover the complete Symbol, including pins and customized text,
 * from f65095ae12b9b5155260617be2ec621132edcb82. They are historical facts,
 * not recomputed from whichever library a later website happens to ship.
 * Component electrical contracts and all Document content stay untouched.
 */
const LEGACY_SYMBOLS = new Map([
  [
    "opamp-differential-crossed-inputs-swapped",
    "fd-polarity-v8-1eb6f6796be884c3",
  ],
  [
    "opamp-differential-crossed-lettered-inputs-swapped",
    "fd-polarity-v8-257da5739fa1e93b",
  ],
  ["opamp-differential-crossed-lettered", "fd-polarity-v8-3ffe80d12b87a555"],
  ["opamp-differential-crossed", "fd-polarity-v8-ad282a0abc973380"],
  ["opamp-differential-inputs-swapped", "fd-polarity-v8-6c5309ffa187fd81"],
  [
    "opamp-differential-lettered-inputs-swapped",
    "fd-polarity-v8-33e2e1f666fcb7db",
  ],
  ["opamp-differential-lettered", "fd-polarity-v8-0f2a009305915fef"],
  [
    "opamp-differential-wide-crossed-inputs-swapped",
    "fd-polarity-v8-1d3320931d00c7ed",
  ],
  [
    "opamp-differential-wide-crossed-lettered-inputs-swapped",
    "fd-polarity-v8-b36ca4b18d0a1f8a",
  ],
  [
    "opamp-differential-wide-crossed-lettered",
    "fd-polarity-v8-065c9a623e3078f4",
  ],
  ["opamp-differential-wide-crossed", "fd-polarity-v8-b352357d3336eaba"],
  ["opamp-differential-wide-inputs-swapped", "fd-polarity-v8-726662b4c686e269"],
  [
    "opamp-differential-wide-lettered-inputs-swapped",
    "fd-polarity-v8-2d397570cbf7103d",
  ],
  ["opamp-differential-wide-lettered", "fd-polarity-v8-89a6449f9e772e30"],
  ["opamp-differential-wide", "fd-polarity-v8-c60f68c04fac0157"],
  ["opamp-differential", "fd-polarity-v8-ad1d4de857de2585"],
]);

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
}

export function repairAmplifierPolaritySnapshots(
  project: CircuitProject,
): CircuitProject {
  let repaired = false;
  const definitions = project.componentDefinitions?.map((definition) => {
    const expected = LEGACY_SYMBOLS.get(definition.symbol.id);
    if (
      !expected ||
      definition.generatedFrom ||
      deriveStableId(
        "fd-polarity-v8",
        JSON.stringify(ordered(definition.symbol)),
      ) !== expected
    )
      return definition;
    repaired = true;
    return {
      ...definition,
      symbol: {
        ...definition.symbol,
        primitives: definition.symbol.primitives.map((primitive) =>
          primitive.kind === "line" &&
          (primitive.part === "input-polarity" ||
            primitive.part === "upright-input-polarity-negative")
            ? {
                ...primitive,
                from: { ...primitive.from, y: -primitive.from.y },
                to: { ...primitive.to, y: -primitive.to.y },
              }
            : primitive,
        ),
      },
    };
  });
  return repaired
    ? { ...project, componentDefinitions: definitions! }
    : project;
}
