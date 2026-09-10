import type { SchematicEdit } from "@icm/edit-engine";

/**
 * The differential op amp ships as a pair of Symbols with identical pin names
 * and mirrored output geometry. Swapping outputs therefore exchanges the two
 * Symbols rather than repainting polarity marks: the terminals keep their
 * names, so every attached Net survives, and the drawing keeps telling the
 * truth about which output is which.
 */
const OUTPUT_SWAP_SIBLINGS: Readonly<Record<string, string>> = {
  "opamp-differential": "opamp-differential-crossed",
  "opamp-differential-crossed": "opamp-differential",
  "opamp-differential-inputs-swapped":
    "opamp-differential-crossed-inputs-swapped",
  "opamp-differential-crossed-inputs-swapped":
    "opamp-differential-inputs-swapped",
  "opamp-differential-lettered": "opamp-differential-crossed-lettered",
  "opamp-differential-crossed-lettered": "opamp-differential-lettered",
  "opamp-differential-lettered-inputs-swapped":
    "opamp-differential-crossed-lettered-inputs-swapped",
  "opamp-differential-crossed-lettered-inputs-swapped":
    "opamp-differential-lettered-inputs-swapped",
};

export function differentialOutputSibling(
  symbolId: string,
): string | undefined {
  return OUTPUT_SWAP_SIBLINGS[symbolId];
}

export function planDifferentialOutputSwap(
  instanceId: string,
  symbolId: string,
): SchematicEdit[] {
  const sibling = differentialOutputSibling(symbolId);
  return sibling
    ? [{ kind: "set_instance_symbol", instanceId, symbolId: sibling }]
    : [];
}
