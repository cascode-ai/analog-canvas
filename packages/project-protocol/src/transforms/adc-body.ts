import type { CircuitProject } from "@icm/model";

import { symbolSignature } from "./symbol-signature.js";

// Exact converter snapshots before the fill role was declared. A customized
// drawing with the same ID keeps its own artwork.
const CAPTURED_ADC_BODIES = new Set([
  "adc-body-v1-4300eede0da4d7d5",
  "adc-body-v1-f214f52a91c4afe5",
  "adc-body-v1-717ad1ea7a692a4e",
]);

export function repairAdcBodySnapshots(
  project: CircuitProject,
): CircuitProject {
  let changed = false;
  const definitions = project.componentDefinitions?.map((definition) => {
    const { symbol } = definition;
    if (
      definition.generatedFrom ||
      definition.libraryOrigin ||
      !["adc", "adc-differential", "adc-differential-inputs-swapped"].includes(
        symbol.id,
      ) ||
      !CAPTURED_ADC_BODIES.has(symbolSignature("adc-body-v1", symbol))
    )
      return definition;
    changed = true;
    return {
      ...definition,
      symbol: {
        ...symbol,
        primitives: symbol.primitives.map((primitive) =>
          primitive.kind === "polygon"
            ? { ...primitive, fillableBody: true as const }
            : primitive,
        ),
      },
    };
  });
  return changed ? { ...project, componentDefinitions: definitions! } : project;
}
