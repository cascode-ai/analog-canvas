import type { SchematicEdit } from "@icm/edit-engine";
import {
  SUPPLY_PINS_VARIANT_ID,
  transformPoint,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
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

/**
 * A transformer's secondary drawn looping away from its primary instead of
 * the same way (#2170): its "mirrored" variant, so pins, dots and netlist
 * never change. The same way, as the reference draws it, is the default.
 */
const MIRRORABLE_WINDINGS = new Set(["xfmr"]);
const MIRRORED_WINDINGS_VARIANT = "mirrored";

export function componentWindingsMirrored(
  instance: Pick<Instance, "symbolId" | "symbolVariantId">,
): boolean | undefined {
  if (!MIRRORABLE_WINDINGS.has(instance.symbolId)) return undefined;
  return instance.symbolVariantId === MIRRORED_WINDINGS_VARIANT;
}

/** Turns a transformer's secondary over, or back; none where already so. */
export function windingsMirroredEdit(
  instance: Pick<Instance, "id" | "symbolId" | "symbolVariantId">,
  mirrored: boolean,
): SchematicEdit | undefined {
  const current = componentWindingsMirrored(instance);
  if (current === undefined || current === mirrored) return undefined;
  return {
    kind: "set_instance_symbol",
    instanceId: instance.id,
    symbolId: instance.symbolId,
    symbolVariantId: mirrored ? MIRRORED_WINDINGS_VARIANT : null,
  };
}

/**
 * A chopper drawn wide (#2170): its box 80 tall with a pin at each corner,
 * to sit between a differential pair's two branches. Its "wide" variant, so
 * pin names, wiring and the netlist never change; the narrow box on an
 * op-amp's input rows is the default.
 */
const WIDENABLE_CHOPPERS = new Set(["chopper"]);
export const WIDE_CHOPPER_VARIANT = "wide";

export function componentChopperWide(
  instance: Pick<Instance, "symbolId" | "symbolVariantId">,
): boolean | undefined {
  if (!WIDENABLE_CHOPPERS.has(instance.symbolId)) return undefined;
  return instance.symbolVariantId === WIDE_CHOPPER_VARIANT;
}

/** Draws a chopper wide, or back to narrow; none where already so. */
export function chopperWideEdit(
  instance: Pick<Instance, "id" | "symbolId" | "symbolVariantId">,
  wide: boolean,
): SchematicEdit | undefined {
  const current = componentChopperWide(instance);
  if (current === undefined || current === wide) return undefined;
  return {
    kind: "set_instance_symbol",
    instanceId: instance.id,
    symbolId: instance.symbolId,
    symbolVariantId: wide ? WIDE_CHOPPER_VARIANT : null,
  };
}

/** Half the chopper's box height, narrow and wide, in its own frame. */
const CHOPPER_HALF_HEIGHT = { narrow: 30, wide: 40 } as const;
/**
 * How far from its centre, along the box, a chopper's label row stands: a
 * new chopper's under its narrow box, and a grid square further from the
 * wide one, whose corner leads and the wires leaving them run along its end.
 */
const CHOPPER_LABEL_ROW = { narrow: 45, wide: 65 } as const;

/**
 * The labels above or below a chopper, moved to their row as its box grows
 * or shrinks (#2170) and centred on it, clear of the wires at its corners.
 * Its clock label names no part, so arranging labels would leave it where
 * the narrow box ended, drawn over by the wide one. A label moved further
 * out keeps its extra distance; a label beside the box stays.
 */
export function chopperWideLabelEdits(
  document: Pick<SchematicDocument, "annotations">,
  instance: Pick<Instance, "id" | "symbolId" | "symbolVariantId" | "placement">,
  wide: boolean,
): SchematicEdit[] {
  const current = componentChopperWide(instance);
  const placement = instance.placement;
  if (current === undefined || current === wide || !placement) return [];
  const from = current ? "wide" : "narrow";
  const to = wide ? "wide" : "narrow";
  const half = CHOPPER_HALF_HEIGHT[from];
  // The box's own downward direction on the sheet.
  const down = transformPoint({ x: 0, y: 1 }, { x: 0, y: 0 }, placement);
  return document.annotations.flatMap((annotation): SchematicEdit[] => {
    const anchor = annotation.anchor;
    if (
      annotation.kind !== "instance-label" ||
      anchor.kind !== "object" ||
      anchor.objectId !== instance.id
    )
      return [];
    const along = anchor.localOffset.x * down.x + anchor.localOffset.y * down.y;
    const side = along > half ? 1 : along < -half ? -1 : 0;
    if (!side) return [];
    const distance = Math.max(
      CHOPPER_LABEL_ROW[to],
      side * along + CHOPPER_LABEL_ROW[to] - CHOPPER_LABEL_ROW[from],
    );
    const localOffset = {
      x: down.x * side * distance + 0,
      y: down.y * side * distance + 0,
    };
    return [
      {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotation,
          anchor: {
            ...anchor,
            localOffset,
            fallbackPosition: {
              x:
                anchor.fallbackPosition.x +
                localOffset.x -
                anchor.localOffset.x,
              y:
                anchor.fallbackPosition.y +
                localOffset.y -
                anchor.localOffset.y,
            },
          },
        },
      },
    ];
  });
}

export function componentSourceShape(
  instance: Pick<Instance, "symbolId" | "symbolVariantId">,
): SourceShape | undefined {
  if (!SHAPED_SOURCES.has(instance.symbolId)) return undefined;
  return instance.symbolVariantId === DIAMOND_SOURCE_VARIANT
    ? "diamond"
    : "circle";
}
