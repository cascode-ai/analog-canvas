import type { SchematicEdit } from "@icm/edit-engine";
import { SUPPLY_PINS_VARIANT_ID, type Instance } from "@icm/model";
import { drawnPinNames, type SymbolResolver } from "@icm/symbols";
import { differentialInputSibling } from "../editor-shell/differential-input-swap";
import { differentialOutputSibling } from "../editor-shell/differential-output-swap";

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
  if (plain.startsWith("opamp")) {
    const wide = {
      plain: plain.replace(/^opamp(?:-differential)?/u, "$&-wide"),
      lettered: lettered.replace(/^opamp(?:-differential)?/u, "$&-wide"),
    };
    bodyMarkVariants.set(wide.plain, wide);
    bodyMarkVariants.set(wide.lettered, wide);
  }
}

const POLARITY_PAIRS = [
  ["comparator", "comparator-unmarked"],
  ["comparator-inputs-swapped", "comparator-unmarked-inputs-swapped"],
  ["comparator-differential", "comparator-differential-unmarked"],
  [
    "comparator-differential-inputs-swapped",
    "comparator-differential-unmarked-inputs-swapped",
  ],
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

/** Undefined means this component has no interchangeable differential inputs. */
export function componentInputsSwapped(symbolId: string): boolean | undefined {
  return differentialInputSibling(symbolId)
    ? symbolId.endsWith("-inputs-swapped")
    : undefined;
}

export function componentOutputsSwapped(symbolId: string): boolean | undefined {
  return differentialOutputSibling(symbolId)
    ? symbolId.includes("-crossed")
    : undefined;
}

export function symbolForInputsSwapped(
  symbolId: string,
  swapped: boolean,
): string | undefined {
  return componentInputsSwapped(symbolId) === swapped
    ? symbolId
    : differentialInputSibling(symbolId);
}

export function symbolForOutputsSwapped(
  symbolId: string,
  swapped: boolean,
): string | undefined {
  return componentOutputsSwapped(symbolId) === swapped
    ? symbolId
    : differentialOutputSibling(symbolId);
}

/**
 * The controlled sources a reader may draw as a diamond: the same
 * part in its "diamond" variant, so its netlist, pins and wiring never
 * change. A circle is the default.
 */
const SHAPED_SOURCES = new Set(["vccs", "cccs", "vcvs", "ccvs"]);
export const DIAMOND_SOURCE_VARIANT = "diamond";
export type SourceShape = "circle" | "diamond";

/**
 * Whether a part shows its supply pins; undefined where it has none to show,
 * as a project's own older drawing of an op-amp, or a Circuit Component whose
 * artwork leaves them unmapped.
 */
export function componentSupplyPins(
  instance: Pick<Instance, "symbolId" | "symbolVariantId">,
  resolver: SymbolResolver | undefined,
): boolean | undefined {
  const shown = resolver?.resolve(instance.symbolId, SUPPLY_PINS_VARIANT_ID);
  const placed = resolver?.resolve(instance.symbolId);
  if (
    !shown ||
    !placed ||
    drawnPinNames(shown).length <= drawnPinNames(placed).length
  )
    return undefined;
  return instance.symbolVariantId === SUPPLY_PINS_VARIANT_ID;
}

/**
 * Draws a part's VDD and VSS as pins to wire, or hides them so each takes its
 * Net in Properties (#1833): its variant alone, as a source's shape. The
 * netlist meets the same supplies either way. None where already as asked.
 */
export function supplyPinsEdit(
  instance: Pick<Instance, "id" | "symbolId" | "symbolVariantId">,
  shown: boolean,
): SchematicEdit | undefined {
  if (shown === (instance.symbolVariantId === SUPPLY_PINS_VARIANT_ID))
    return undefined;
  return {
    kind: "set_instance_symbol",
    instanceId: instance.id,
    symbolId: instance.symbolId,
    symbolVariantId: shown ? SUPPLY_PINS_VARIANT_ID : null,
  };
}

export function componentSourceShape(
  instance: Pick<Instance, "symbolId" | "symbolVariantId">,
): SourceShape | undefined {
  if (!SHAPED_SOURCES.has(instance.symbolId)) return undefined;
  return instance.symbolVariantId === DIAMOND_SOURCE_VARIANT
    ? "diamond"
    : "circle";
}
