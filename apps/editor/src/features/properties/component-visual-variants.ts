import type { Instance } from "@icm/model";

export const NO_INTERNAL_MARK = "none";

const BODY_MARK_PAIRS = [
  ["opamp", "opamp-lettered"],
  ["opamp-inputs-swapped", "opamp-lettered-inputs-swapped"],
  ["opamp-differential", "opamp-differential-lettered"],
  [
    "opamp-differential-inputs-swapped",
    "opamp-differential-lettered-inputs-swapped",
  ],
  ["opamp-differential-crossed", "opamp-differential-crossed-lettered"],
  [
    "opamp-differential-crossed-inputs-swapped",
    "opamp-differential-crossed-lettered-inputs-swapped",
  ],
  ["voltage-amplifier", "voltage-amplifier-lettered"],
] as const;

const bodyMarkVariants = new Map<string, { plain: string; lettered: string }>();
for (const [plain, lettered] of BODY_MARK_PAIRS) {
  const pair = { plain, lettered };
  bodyMarkVariants.set(plain, pair);
  bodyMarkVariants.set(lettered, pair);
}

const POLARITY_PAIRS = [
  ["comparator", "comparator-unmarked"],
  ["comparator-inputs-swapped", "comparator-unmarked-inputs-swapped"],
] as const;

const polarityVariants = new Map<
  string,
  { marked: string; unmarked: string }
>();
for (const [marked, unmarked] of POLARITY_PAIRS) {
  const pair = { marked, unmarked };
  polarityVariants.set(marked, pair);
  polarityVariants.set(unmarked, pair);
}

/** Editor-facing body text; legacy Symbol IDs remain an internal detail. */
export function componentInternalMark(instance: Instance): string | undefined {
  const pair = bodyMarkVariants.get(instance.symbolId);
  if (!pair) return undefined;
  return instance.symbolId === pair.plain
    ? NO_INTERNAL_MARK
    : (instance.signalFlowParameters?.formula ?? "A");
}

export function symbolForInternalMark(
  symbolId: string,
  mark: string,
): string | undefined {
  const pair = bodyMarkVariants.get(symbolId);
  if (!pair) return undefined;
  return mark === NO_INTERNAL_MARK ? pair.plain : pair.lettered;
}

/** Editor-facing comparator polarity; marked/unmarked IDs stay internal. */
export function componentInputPolarity(symbolId: string): boolean | undefined {
  const pair = polarityVariants.get(symbolId);
  if (!pair) return undefined;
  return symbolId === pair.marked;
}

export function symbolForInputPolarity(
  symbolId: string,
  visible: boolean,
): string | undefined {
  const pair = polarityVariants.get(symbolId);
  if (!pair) return undefined;
  return visible ? pair.marked : pair.unmarked;
}
