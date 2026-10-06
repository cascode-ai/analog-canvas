import { deviceDescriptor } from "@icm/devices";
import { transformPoint } from "@icm/model";
import type {
  Annotation,
  Point,
  Rect,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";
import type { ResolvedSymbol } from "@icm/symbols";
import { getRazaviCatalogEntry, withInputSigns } from "@icm/symbols";

import {
  objectStyleProfile,
  resolveDocumentStyleProfile,
  type SchematicStyleProfile,
} from "./style-profile.js";
import { visibleSymbolInkBounds } from "./visual.js";
import { magneticDisplayParameters } from "./instance-value.js";
import {
  fractionGeometry,
  fractionPartScale,
  measureRichTextDocument,
  richTextMetrics,
} from "./rich-text-layout.js";
import { LABEL_CAP_HEIGHT_EM, uprightTextInkBounds } from "./text-ink.js";

export interface InstanceLabelPlacement {
  readonly position: Point;
  readonly alignment: "start" | "middle" | "end";
}

export type InstanceLabelSide = "left" | "right" | "top" | "bottom";

/** A part's sides in the order labels try them. */
export const INSTANCE_LABEL_SIDES: readonly InstanceLabelSide[] = [
  "right",
  "left",
  "bottom",
  "top",
];

/**
 * The upright rows of a part's name and value on one side of it, the name
 * read first and its value under it (#1384): the Reference's slot, which a
 * name or a value shown alone takes; the value's, under the Reference; and
 * the Reference's over a shown value, a value row further out above the
 * part and the Reference's slot elsewhere.
 */
export type InstanceLabelSlot = "reference" | "value" | "reference-over-value";

/**
 * Vertical distance between the reference row and the value row: the
 * smallest whole grid multiple of at least 1.2 em, so a value stays next to
 * its part (#1105) and snapping cannot pull the two rows into each other.
 */
export function instanceLabelRowOffset(
  profile: SchematicStyleProfile,
  grid: number,
): number {
  return Math.ceil((profile.typography.instanceFontSize * 1.2) / grid) * grid;
}

/**
 * The row distance until 2026-10-04, 1.35 em rounded up to the grid (a whole
 * extra grid step at the default size). Labels still there count as
 * untouched, so they keep following their part.
 */
export function previousInstanceLabelRowOffset(
  profile: SchematicStyleProfile,
  grid: number,
): number {
  return Math.ceil((profile.typography.instanceFontSize * 1.35) / grid) * grid;
}

/** Whether a part's value is drawn as a stacked W/L fraction, as a MOS's is. */
function valueIsStackedFraction(symbolId: string): boolean {
  return (deviceDescriptor(symbolId)?.parameters ?? []).some(
    (parameter) =>
      parameter.displayRole === "width" || parameter.displayRole === "length",
  );
}

/**
 * Row distance between a part's reference and its value. A stacked W/L
 * fraction reaches a numerator above its baseline and a denominator below
 * it, so at one text row its numerator ran into the reference's subscript
 * (M₂ over 10u, #1299). Its row keeps the label gap on both sides: under a
 * reference, between the numerator's capitals and the subscript; over one,
 * between the denominator and the reference's capitals. Every other value
 * keeps one text row (instanceLabelRowOffset).
 */
export function instanceValueRowOffset(
  symbolId: string,
  profile: SchematicStyleProfile,
  grid: number,
): number {
  const row = instanceLabelRowOffset(profile, grid);
  if (!valueIsStackedFraction(symbolId)) return row;
  const { gap, capHeight, subscriptDrop } = instanceLabelMetrics(profile);
  const part =
    profile.typography.instanceFontSize *
    fractionPartScale(profile.typography.subscriptScale);
  const numeratorTop =
    part *
    (fractionGeometry.numeratorBaselineRiseEm + fractionGeometry.capHeightEm);
  const denominatorBottom = part * fractionGeometry.denominatorBaselineDropEm;
  const needed = Math.max(
    numeratorTop + subscriptDrop + gap,
    denominatorBottom + capHeight + gap,
  );
  return Math.max(row, Math.ceil(needed / grid) * grid);
}

type InstanceLabelRowRule = (
  profile: SchematicStyleProfile,
  grid: number,
  symbolId: string,
) => number;

const SIDE_LABEL_SYMBOLS = new Set([
  "resistor",
  "variable-resistor",
  "capacitor",
  "variable-capacitor",
  "inductor",
  "inductor-compact",
  "variable-inductor",
  "battery",
  "voltage-source",
  "current-source",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
  "ac-voltage-source",
  "pulse-voltage-source",
]);

const TOP_LABEL_SYMBOLS = new Set(["tcoil"]);

export function isMosSymbol(resolved: ResolvedSymbol): boolean {
  const roles = new Set(resolved.definition.pins.map((pin) => pin.role));
  return roles.has("gate") && roles.has("drain") && roles.has("source");
}

export function isBjtSymbol(resolved: ResolvedSymbol): boolean {
  const roles = new Set(resolved.definition.pins.map((pin) => pin.role));
  return roles.has("base") && roles.has("collector") && roles.has("emitter");
}

/**
 * True when the Symbol draws a polarity-marked differential input pair, so a
 * caller can offer "swap + / −" as a named action. The swap itself is the
 * ordinary top/bottom reflection: the marks are artwork, and the terminals
 * move with them, so the electrical fact and the drawing stay in agreement.
 */
export function hasDifferentialInputs(resolved: ResolvedSymbol): boolean {
  const roles = new Set(resolved.definition.pins.map((pin) => pin.role));
  return roles.has("non-inverting-input") && roles.has("inverting-input");
}

function transformedBounds(
  localBounds: Rect,
  instance: SchematicDocument["instances"][number],
): Rect | null {
  if (!instance.placement) return null;
  const corners = [
    { x: localBounds.x, y: localBounds.y },
    { x: localBounds.x + localBounds.width, y: localBounds.y },
    {
      x: localBounds.x + localBounds.width,
      y: localBounds.y + localBounds.height,
    },
    { x: localBounds.x, y: localBounds.y + localBounds.height },
  ].map((point) =>
    transformPoint(point, instance.placement!.position, instance.placement!),
  );
  const left = Math.min(...corners.map((point) => point.x));
  const right = Math.max(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const bottom = Math.max(...corners.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Canonical upright Net-name label for the reviewed VDD Port artwork. The
 * label stays on the world-right side after rotation or mirror, so the glyph
 * never follows the symbol into its bar or stem.
 */
export function defaultVddPowerLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  grid: number,
): InstanceLabelPlacement | null {
  if (instance.symbolId !== "vdd-port" || !instance.placement) return null;
  const bounds = transformedBounds(
    visibleSymbolInkBounds(resolved, instance.signalFlowParameters),
    instance,
  );
  if (!bounds) return null;
  // Project coordinates are grid-aligned. Reviewed Symbol artwork may use
  // fractional geometry, so quantize the derived optical centre only at this
  // persistence boundary instead of leaking off-grid annotation anchors.
  const projectCoordinate = (value: number) => Math.round(value / grid) * grid;
  return {
    position: {
      x: projectCoordinate(bounds.x + bounds.width + grid / 2),
      y: projectCoordinate(bounds.y + bounds.height / 2),
    },
    alignment: "start",
  };
}

export function inferInstanceLabelSide(
  localAnchor: Point,
  localBounds: Rect,
): InstanceLabelSide | null {
  // A renderer-owned label is normally just outside exactly one edge.  That
  // exterior relationship is authoritative: a baseline/optical y offset must
  // not turn a right-side label into a bottom-side label when the instance is
  // rotated.  Only labels entirely inside the bounds need centre-based
  // fallback (for legacy/manual placements).
  const exteriorSides = [
    ...(localAnchor.x < localBounds.x
      ? ([
          {
            side: "left" as const,
            clearance: localBounds.x - localAnchor.x,
          },
        ] as const)
      : []),
    ...(localAnchor.x > localBounds.x + localBounds.width
      ? ([
          {
            side: "right" as const,
            clearance: localAnchor.x - (localBounds.x + localBounds.width),
          },
        ] as const)
      : []),
    ...(localAnchor.y < localBounds.y
      ? ([
          {
            side: "top" as const,
            clearance: localBounds.y - localAnchor.y,
          },
        ] as const)
      : []),
    ...(localAnchor.y > localBounds.y + localBounds.height
      ? ([
          {
            side: "bottom" as const,
            clearance: localAnchor.y - (localBounds.y + localBounds.height),
          },
        ] as const)
      : []),
  ];
  if (exteriorSides.length === 1) return exteriorSides[0]!.side;
  if (exteriorSides.length > 1) {
    return exteriorSides.sort(
      (left, right) => left.clearance - right.clearance,
    )[0]!.side;
  }
  const center = {
    x: localBounds.x + localBounds.width / 2,
    y: localBounds.y + localBounds.height / 2,
  };
  const displacement = {
    x: (localAnchor.x - center.x) / Math.max(localBounds.width / 2, 1),
    y: (localAnchor.y - center.y) / Math.max(localBounds.height / 2, 1),
  };
  if (displacement.x === 0 && displacement.y === 0) return null;
  if (Math.abs(displacement.x) >= Math.abs(displacement.y)) {
    return displacement.x > 0 ? "right" : "left";
  }
  return displacement.y > 0 ? "bottom" : "top";
}

/**
 * Side opposite the Symbol's own connection point, so a label constrained to
 * a horizontal side never lands on top of the wire leaving the Port.
 */
function horizontalSideAwayFromPin(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
): InstanceLabelSide {
  const pin = resolved.definition.pins[0];
  if (!pin || !instance.placement) return "left";
  const localBounds = visibleSymbolInkBounds(
    resolved,
    instance.signalFlowParameters,
  );
  const localCenter = {
    x: localBounds.x + localBounds.width / 2,
    y: localBounds.y + localBounds.height / 2,
  };
  const pinWorld = transformPoint(
    pin.at,
    instance.placement.position,
    instance.placement,
  );
  const centerWorld = transformPoint(
    localCenter,
    instance.placement.position,
    instance.placement,
  );
  return pinWorld.x > centerWorld.x ? "left" : "right";
}

function transformedSide(
  side: InstanceLabelSide,
  instance: SchematicDocument["instances"][number],
): InstanceLabelSide | null {
  if (!instance.placement) return null;
  const vector =
    side === "left"
      ? { x: -1, y: 0 }
      : side === "right"
        ? { x: 1, y: 0 }
        : side === "top"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  const world = transformPoint(vector, { x: 0, y: 0 }, instance.placement);
  if (world.x > 0) return "right";
  if (world.x < 0) return "left";
  return world.y > 0 ? "bottom" : "top";
}

/** Unbounded absolute M/L/C paths (the coil) otherwise use the padded viewBox.
 * Their control-point hull gives a conservative artwork envelope for label
 * spacing without changing symbol geometry, pin coordinates or hit testing. */
function compactLabelInkBounds(resolved: ResolvedSymbol): Rect {
  const primitives = resolved.definition.primitives.map((primitive) => {
    if (primitive.kind !== "path" || primitive.bounds) return primitive;
    const commands = primitive.data.match(/[a-z]/gi) ?? [];
    if (
      !commands.length ||
      commands.some((command) => !["M", "L", "C"].includes(command))
    )
      return primitive;
    const coordinates = (
      primitive.data.match(/[-+]?(?:\d*\.\d+|\d+)/g) ?? []
    ).map(Number);
    if (!coordinates.length || coordinates.length % 2) return primitive;
    const xs = coordinates.filter((_, index) => index % 2 === 0);
    const ys = coordinates.filter((_, index) => index % 2 === 1);
    const x = Math.min(...xs),
      y = Math.min(...ys);
    return {
      ...primitive,
      bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
    };
  });
  return visibleSymbolInkBounds({
    ...resolved,
    definition: { ...resolved.definition, primitives },
  });
}

/**
 * The drawn extent a label keeps its distance from. A path without declared
 * bounds contributes the hull of its absolute M/L/C points (Z closes it
 * without adding any) instead of the Symbol's padded viewBox, which left a
 * delay cell's label 15 units from its box.
 */
export function instanceLabelInkBounds(
  resolved: ResolvedSymbol,
  signalFlowParameters?: Parameters<typeof visibleSymbolInkBounds>[1],
): Rect {
  const withBounds = (
    primitives: ResolvedSymbol["definition"]["primitives"],
  ): ResolvedSymbol["definition"]["primitives"] =>
    primitives.map((primitive) => {
      if (primitive.kind !== "path" || primitive.bounds) return primitive;
      const commands = primitive.data.match(/[a-z]/gi) ?? [];
      if (
        !commands.length ||
        commands.some((command) => !["M", "L", "C", "Z", "z"].includes(command))
      )
        return primitive;
      const coordinates = (
        primitive.data.match(/[-+]?(?:\d*\.\d+|\d+)/g) ?? []
      ).map(Number);
      if (!coordinates.length || coordinates.length % 2) return primitive;
      const xs = coordinates.filter((_, index) => index % 2 === 0);
      const ys = coordinates.filter((_, index) => index % 2 === 1);
      const x = Math.min(...xs),
        y = Math.min(...ys);
      return {
        ...primitive,
        bounds: {
          x,
          y,
          width: Math.max(...xs) - x,
          height: Math.max(...ys) - y,
        },
      };
    });
  return visibleSymbolInkBounds(
    {
      ...resolved,
      definition: {
        ...resolved.definition,
        primitives: withBounds(resolved.definition.primitives),
      },
      ...(resolved.variant
        ? {
            variant: {
              ...resolved.variant,
              ...(resolved.variant.additionalPrimitives
                ? {
                    additionalPrimitives: withBounds(
                      resolved.variant.additionalPrimitives,
                    ),
                  }
                : {}),
            },
          }
        : {}),
    },
    signalFlowParameters,
  );
}

/** Clearance between a label's ink and its Symbol's drawn ink, in drawing units. */
export const INSTANCE_LABEL_GAP = 4;
export { LABEL_CAP_HEIGHT_EM };

/**
 * The distances the placement rule works with, in drawing units: the gap,
 * the height of the label's capitals, and how far a subscript's figures reach
 * below its baseline.
 */
export function instanceLabelMetrics(
  profile: SchematicStyleProfile,
  sizeScale = 1,
): { gap: number; capHeight: number; subscriptDrop: number } {
  const fontSize = profile.typography.instanceFontSize * sizeScale;
  return {
    gap: INSTANCE_LABEL_GAP,
    capHeight: fontSize * LABEL_CAP_HEIGHT_EM,
    subscriptDrop:
      fontSize *
      profile.typography.subscriptScale *
      profile.typography.subscriptBaselineShiftEm,
  };
}

/**
 * Places horizontal SVG text around the active symbol variant, the same way
 * for every family: the label's ink keeps INSTANCE_LABEL_GAP from the drawn
 * artwork on whichever side it sits. Beside the Symbol its capitals are
 * centred on the body; below, the capitals start one gap under it; above,
 * the subscript's descent is cleared first, so M₂ or R₂ over a part never
 * touches it. The position is not snapped to the connection grid: rounding
 * the gap to a grid step is what left gates, registers and blocks 10 to 26
 * units away while devices sat at 5.
 *
 * A name reads before its value on every side (#1384). Beside or below the
 * part the value's row is under the name's. Above it the group stands on
 * its last row, the one nearest the part: the value, or a label shown
 * alone, stands there, a W/L fraction far enough out to clear the part, and
 * a name over its value stands a value row further out.
 */
export function placeUprightInstanceLabel(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  localAnchor: Point,
  localSide: InstanceLabelSide,
  grid: number,
  sizeScale = 1,
  slot: InstanceLabelSlot = "reference",
): InstanceLabelPlacement | null {
  return nameFirstPlacer(
    instance,
    resolved,
    profile,
    localAnchor,
    localSide,
    grid,
    sizeScale,
    slot,
    instanceValueRowOffset(instance.symbolId, profile, grid),
  );
}

/**
 * The upright placer until 2026-10-06: above the part a value row stood a
 * row further out than its name (#1384). Labels still where it put them,
 * by default or by an arrangement, count as untouched.
 */
export function outwardPlaceUprightInstanceLabel(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  localAnchor: Point,
  localSide: InstanceLabelSide,
  grid: number,
  sizeScale = 1,
  slot: InstanceLabelSlot = "reference",
): InstanceLabelPlacement | null {
  return outwardPlacer(
    instance,
    resolved,
    profile,
    localAnchor,
    localSide,
    grid,
    sizeScale,
    slot,
    instanceValueRowOffset(instance.symbolId, profile, grid),
  );
}

/** Places one label of a part's group, its value `valueRow` under its name. */
type UprightPlacer = (
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  localAnchor: Point,
  localSide: InstanceLabelSide,
  grid: number,
  sizeScale: number,
  slot: InstanceLabelSlot,
  valueRow: number,
) => InstanceLabelPlacement | null;

const nameFirstPlacer: UprightPlacer = (
  instance,
  resolved,
  profile,
  _localAnchor,
  localSide,
  _grid,
  sizeScale,
  slot,
  valueRow,
) => {
  const lift =
    slot === "reference"
      ? 0
      : stackedValueLift(instance.symbolId, profile, sizeScale);
  return placeUpright(
    instance,
    resolved,
    profile,
    localSide,
    sizeScale,
    (side) =>
      side === "top"
        ? (slot === "reference-over-value" ? valueRow : 0) + lift
        : slot === "value"
          ? valueRow
          : 0,
  );
};

const outwardPlacer: UprightPlacer = (
  instance,
  resolved,
  profile,
  _localAnchor,
  localSide,
  _grid,
  sizeScale,
  slot,
  valueRow,
) =>
  placeUpright(instance, resolved, profile, localSide, sizeScale, () =>
    slot === "value" ? valueRow : 0,
  );

const legacyPlacer: UprightPlacer = (
  instance,
  resolved,
  profile,
  localAnchor,
  localSide,
  grid,
  sizeScale,
  slot,
  valueRow,
) =>
  legacyPlaceUprightInstanceLabel(
    instance,
    resolved,
    profile,
    localAnchor,
    localSide,
    grid,
    sizeScale,
    slot === "value" ? valueRow : 0,
  );

/**
 * Upright text on one side of a part's drawn ink, `rowsOn` that side units
 * lower beside or below it and higher above it.
 */
function placeUpright(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  localSide: InstanceLabelSide,
  sizeScale: number,
  rowsOn: (worldSide: InstanceLabelSide) => number,
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  const worldBounds = transformedBounds(
    instanceLabelInkBounds(
      withInputSigns(resolved, instance),
      instance.signalFlowParameters,
    ),
    instance,
  );
  const worldSide = transformedSide(localSide, instance);
  if (!worldBounds || !worldSide) return null;
  return placeBesideBounds(
    worldBounds,
    worldSide,
    instanceLabelMetrics(profile, sizeScale),
    rowsOn(worldSide),
  );
}

/** Any stacked W/L fraction, for measuring the ink a MOS value draws. */
const STACKED_VALUE: RichTextDocument = {
  runs: [
    {
      kind: "fraction",
      numerator: { runs: [{ kind: "text", value: "W" }] },
      denominator: { runs: [{ kind: "text", value: "L" }] },
    },
  ],
};

/**
 * How much further out than a name a part's value stands in the row nearest
 * the part above it. A label there clears a subscript's descent; a stacked
 * W/L fraction is one tall line whose ink, as labels are measured, reaches
 * lower, so its row stands out by the difference.
 */
function stackedValueLift(
  symbolId: string,
  profile: SchematicStyleProfile,
  sizeScale: number,
): number {
  if (!valueIsStackedFraction(symbolId)) return 0;
  const { subscriptDrop } = instanceLabelMetrics(profile, sizeScale);
  const fontSize = profile.typography.instanceFontSize * sizeScale;
  const layout = measureRichTextDocument(STACKED_VALUE, {
    ...richTextMetrics(profile, "label", sizeScale),
    fontSize,
  });
  const ink = uprightTextInkBounds({
    left: 0,
    width: 0,
    baseline: 0,
    fontSize,
    fractionAscent: 0,
    descentEm: subscriptDrop / fontSize,
    layoutHeight: layout.height,
  });
  return Math.max(0, ink.y + ink.height - subscriptDrop);
}

/**
 * Upright text beside drawn ink, on one world side of it, `rowOffset` units
 * lower beside or below the ink and higher above it.
 */
function placeBesideBounds(
  worldBounds: Rect,
  worldSide: InstanceLabelSide,
  { gap, capHeight, subscriptDrop }: ReturnType<typeof instanceLabelMetrics>,
  rowOffset = 0,
): InstanceLabelPlacement {
  const centreX = worldBounds.x + worldBounds.width / 2;
  const centreBaseline =
    worldBounds.y + worldBounds.height / 2 + capHeight / 2 + rowOffset;
  switch (worldSide) {
    case "right":
      return {
        position: {
          x: Math.round(worldBounds.x + worldBounds.width + gap),
          y: Math.round(centreBaseline),
        },
        alignment: "start",
      };
    case "left":
      return {
        position: {
          x: Math.round(worldBounds.x - gap),
          y: Math.round(centreBaseline),
        },
        alignment: "end",
      };
    case "bottom":
      return {
        position: {
          x: Math.round(centreX),
          y: Math.round(
            worldBounds.y + worldBounds.height + gap + capHeight + rowOffset,
          ),
        },
        alignment: "middle",
      };
    case "top":
      return {
        position: {
          x: Math.round(centreX),
          y: Math.round(worldBounds.y - gap - subscriptDrop - rowOffset),
        },
        alignment: "middle",
      };
  }
}

/**
 * The placement rule used until 2026-09-25: a five-unit gap for devices and
 * Analog Blocks that ignored a subscript above the part, and grid-snapped
 * spacing for everything else. Labels still exactly there count as
 * untouched, so they keep following their Symbol.
 */
function legacyPlaceUprightInstanceLabel(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  localAnchor: Point,
  localSide: InstanceLabelSide,
  grid: number,
  sizeScale = 1,
  rowOffset = 0,
  /**
   * Keep the label beside the symbol through every quarter turn. Upright text
   * above or below a rotated Port reads as the label having flipped over, so
   * such a Symbol swaps between left and right instead.
   */
  horizontalSidesOnly = false,
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  const compactDevice =
    isMosSymbol(resolved) ||
    isBjtSymbol(resolved) ||
    SIDE_LABEL_SYMBOLS.has(instance.symbolId);
  const compact =
    compactDevice ||
    getRazaviCatalogEntry(instance.symbolId)?.category === "analog-block";
  const localBounds = compactDevice
    ? compactLabelInkBounds(resolved)
    : visibleSymbolInkBounds(resolved, instance.signalFlowParameters);
  const worldBounds = transformedBounds(localBounds, instance);
  const rotatedSide = transformedSide(localSide, instance);
  const worldSide =
    horizontalSidesOnly && (rotatedSide === "top" || rotatedSide === "bottom")
      ? horizontalSideAwayFromPin(instance, resolved)
      : rotatedSide;
  if (!worldBounds || !worldSide) return null;
  const semanticPosition = transformPoint(
    localAnchor,
    instance.placement.position,
    instance.placement,
  );
  // `localAnchor` carries the preferred cross-axis position and semantic
  // side. Its previous distance from the edge is not a visual constraint:
  // retaining a reconstructed, snapped distance was the source of one-grid
  // outward drift on each repeated quarter turn.
  // Device text belongs to the artwork, not to the electrical connection grid.
  // Rounding a five-unit gap to a ten-unit grid makes different families appear
  // inconsistently spaced and pushes their visual centre below the body.
  const clearance = compact ? 5 : grid;
  const fontSize = profile.typography.instanceFontSize * sizeScale;
  const snap = compact
    ? Math.round
    : (value: number) => Math.round(value / grid) * grid;
  const centerX = compact
    ? worldBounds.x + worldBounds.width / 2
    : semanticPosition.x;
  const centerBaseline = compact
    ? worldBounds.y + worldBounds.height / 2 + fontSize * 0.35
    : semanticPosition.y;
  switch (worldSide) {
    case "right":
      return {
        position: {
          x: snap(worldBounds.x + worldBounds.width + clearance),
          y: snap(centerBaseline + rowOffset),
        },
        alignment: "start",
      };
    case "left":
      return {
        position: {
          x: snap(worldBounds.x - clearance),
          y: snap(centerBaseline + rowOffset),
        },
        alignment: "end",
      };
    case "bottom":
      return {
        position: {
          x: snap(centerX),
          y: snap(
            worldBounds.y +
              worldBounds.height +
              clearance +
              fontSize * (compact ? 0.7 : 1.05) +
              rowOffset,
          ),
        },
        alignment: "middle",
      };
    case "top":
      return {
        position: {
          x: snap(centerX),
          y: snap(
            worldBounds.y -
              clearance -
              (compact ? 0 : fontSize * 0.3) +
              rowOffset,
          ),
        },
        alignment: "middle",
      };
  }
}

/**
 * A Cell Pin's name sits squarely beside its artwork on the side away from its
 * wire: left, right, above or below, centred across that side. Capitals are
 * centred on the Pin, so a subscript hangs below the way it does on a device.
 * The text is not snapped to the connection grid, which used to pull it up
 * to half a grid off centre, and a vertical Pin's name is no longer pushed to
 * one side at the height of its rotated anchor.
 */
function portLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  rowOffset: number,
  /**
   * Above or below, half a grid step: a whole step read as the name having
   * drifted off the Pin's tip, and the descent kept under a name above
   * already clears its subscript.
   */
  verticalGap = grid / 2,
): InstanceLabelPlacement | null {
  return (
    portLabelSides(
      instance,
      resolved,
      profile,
      grid,
      rowOffset,
      verticalGap,
    )?.[0] ?? null
  );
}

/**
 * Where a Cell Pin's name may go, best first: the side away from its wire,
 * then the two sides across the Pin. A name that would collide on the first
 * side takes the next one (#1105); the side toward the wire is never offered.
 */
export function portLabelCandidates(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
): InstanceLabelPlacement[] {
  return portLabelSides(instance, resolved, profile, grid, 0, grid / 2) ?? [];
}

function portLabelSides(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  rowOffset: number,
  verticalGap: number,
): InstanceLabelPlacement[] | null {
  const pin = resolved.definition.pins[0];
  const bounds = transformedBounds(
    visibleSymbolInkBounds(resolved, instance.signalFlowParameters),
    instance,
  );
  if (!pin || !bounds || !instance.placement) return null;
  const pinWorld = transformPoint(
    pin.at,
    instance.placement.position,
    instance.placement,
  );
  const centreX = bounds.x + bounds.width / 2;
  const centreY = bounds.y + bounds.height / 2;
  const towardWireX = pinWorld.x - centreX;
  const towardWireY = pinWorld.y - centreY;
  const fontSize = profile.typography.instanceFontSize;
  const gap = grid;
  const baseline = Math.round(centreY + fontSize * 0.35 + rowOffset);
  const left: InstanceLabelPlacement = {
    position: { x: Math.round(bounds.x - gap), y: baseline },
    alignment: "end",
  };
  const right: InstanceLabelPlacement = {
    position: { x: Math.round(bounds.x + bounds.width + gap), y: baseline },
    alignment: "start",
  };
  const x = Math.round(centreX);
  // Above: leave room for a subscript's descent under the baseline.
  const above: InstanceLabelPlacement = {
    position: {
      x,
      y: Math.round(bounds.y - verticalGap - fontSize * 0.3 + rowOffset),
    },
    alignment: "middle",
  };
  const below: InstanceLabelPlacement = {
    position: {
      x,
      y: Math.round(
        bounds.y + bounds.height + verticalGap + fontSize * 0.7 + rowOffset,
      ),
    },
    alignment: "middle",
  };
  if (Math.abs(towardWireX) >= Math.abs(towardWireY))
    return towardWireX > 0 ? [left, above, below] : [right, above, below];
  return towardWireY > 0 ? [above, right, left] : [below, right, left];
}

/**
 * Where a vertical Cell Pin's name was placed from 2026-09-24 to 2026-09-29:
 * a whole grid step above or below its artwork. Labels still sitting there
 * count as untouched, so they keep following their Pin.
 */
export function previousPortLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
): InstanceLabelPlacement | null {
  if (instance.symbolId !== "port" && instance.symbolId !== "port-filled")
    return null;
  return portLabelPlacement(instance, resolved, profile, grid, 0, grid);
}

/**
 * Where a Cell Pin's name was placed before 2026-09-24: always beside the
 * Pin, snapped to the grid, at the height of its rotated anchor. Labels still
 * sitting there count as untouched, so they keep following their Pin.
 */
export function legacyPortLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  const localBounds = visibleSymbolInkBounds(
    resolved,
    instance.signalFlowParameters,
  );
  return legacyPlaceUprightInstanceLabel(
    instance,
    resolved,
    profile,
    {
      x: localBounds.x - grid,
      y:
        localBounds.y +
        localBounds.height / 2 +
        profile.typography.instanceFontSize * 0.35,
    },
    "left",
    grid,
    1,
    0,
    true,
  );
}

/**
 * Supplies canonical placement for renderer-owned instance labels, for a
 * label of the given size (a label a person made smaller sits closer), in
 * one of its group's slots on the part's default side.
 */
export function defaultInstanceLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot = "reference",
  sizeScale = 1,
): InstanceLabelPlacement | null {
  return defaultPlacementWith(
    nameFirstPlacer,
    (rowProfile, rowGrid, symbolId) =>
      instanceValueRowOffset(symbolId, rowProfile, rowGrid),
    instance,
    resolved,
    profile,
    grid,
    slot,
    sizeScale,
  );
}

/**
 * Where the rule until 2026-10-06 put an untouched value above its part: a
 * row further out than its name, so it read before the name (#1384). Beside
 * and below a part it is the current rule. Such a value still counts as
 * untouched, so an orientation edit or an arrangement puts it under its name.
 */
export function outwardDefaultInstanceLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot = "reference",
  sizeScale = 1,
): InstanceLabelPlacement | null {
  return defaultPlacementWith(
    outwardPlacer,
    (rowProfile, rowGrid, symbolId) =>
      instanceValueRowOffset(symbolId, rowProfile, rowGrid),
    instance,
    resolved,
    profile,
    grid,
    slot,
    sizeScale,
  );
}

/**
 * Where the rule until 2026-10-05 put an untouched value: the current sides
 * and one text row under the reference for every part, a stacked W/L
 * fraction included (#1299); above a part, a row further out than its name.
 * Such a value still counts as untouched, so an orientation edit moves it to
 * the current row.
 */
export function uniformRowDefaultInstanceLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot = "reference",
  sizeScale = 1,
): InstanceLabelPlacement | null {
  return defaultPlacementWith(
    outwardPlacer,
    instanceLabelRowOffset,
    instance,
    resolved,
    profile,
    grid,
    slot,
    sizeScale,
  );
}

/**
 * Where the rule from 2026-09-25 to 2026-10-04 put an untouched label: the
 * current sides, with the wider row distance under the reference.
 */
export function previousDefaultInstanceLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot = "reference",
  sizeScale = 1,
): InstanceLabelPlacement | null {
  return defaultPlacementWith(
    outwardPlacer,
    previousInstanceLabelRowOffset,
    instance,
    resolved,
    profile,
    grid,
    slot,
    sizeScale,
  );
}

/**
 * Where the placement rule before 2026-09-25 put an untouched label, so an
 * orientation edit still recognizes it as machine-placed and moves it with
 * the current rule.
 */
export function legacyDefaultInstanceLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot = "reference",
  sizeScale = 1,
): InstanceLabelPlacement | null {
  return defaultPlacementWith(
    legacyPlacer,
    previousInstanceLabelRowOffset,
    instance,
    resolved,
    profile,
    grid,
    slot,
    sizeScale,
  );
}

function defaultPlacementWith(
  place: UprightPlacer,
  rows: InstanceLabelRowRule,
  instance: SchematicDocument["instances"][number],
  symbol: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot,
  sizeScale: number,
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  // An adder's sign marks are its ink as much as its circle is.
  const resolved = withInputSigns(symbol, instance);
  const localBounds = visibleSymbolInkBounds(
    resolved,
    instance.signalFlowParameters,
  );
  const middleY = localBounds.y + localBounds.height / 2;
  const middleX = localBounds.x + localBounds.width / 2;
  // A label gap is a grid-space visual rule, measured from drawn ink rather
  // than the padded hit envelope.
  const compactSideGap = grid;
  // The value slot is the second upright row under the reference on the same
  // side; see instanceLabelRowOffset.
  const valueRow = rows(profile, grid, instance.symbolId);

  if (instance.symbolId === "port" || instance.symbolId === "port-filled") {
    return portLabelPlacement(
      instance,
      resolved,
      profile,
      grid,
      slot === "value" ? valueRow : 0,
    );
  }

  const [anchor, side]: [Point, InstanceLabelSide] =
    isMosSymbol(resolved) ||
    isBjtSymbol(resolved) ||
    SIDE_LABEL_SYMBOLS.has(instance.symbolId)
      ? [{ x: middleX, y: middleY }, "right"]
      : TOP_LABEL_SYMBOLS.has(instance.symbolId)
        ? [{ x: middleX, y: localBounds.y - compactSideGap }, "top"]
        : [
            {
              x: middleX,
              y: localBounds.y + localBounds.height + compactSideGap,
            },
            "bottom",
          ];
  return place(
    instance,
    resolved,
    profile,
    anchor,
    side,
    grid,
    sizeScale,
    slot,
    valueRow,
  );
}

/** Positions closer than this stand in the same place. */
const SAME_PLACE = 0.01;

/**
 * How far a label stands from `placement`, or null when it stands
 * elsewhere: it keeps the placement's alignment and stands on it, or, with
 * `slides`, anywhere along the side of the part the placement is on.
 */
export function offsetFromPlacement(
  label: InstanceLabelPlacement,
  placement: InstanceLabelPlacement | null,
  slides = false,
): Point | null {
  if (!placement || placement.alignment !== label.alignment) return null;
  const offset = {
    x: label.position.x - placement.position.x,
    y: label.position.y - placement.position.y,
  };
  const off = slides
    ? Math.abs(placement.alignment === "middle" ? offset.y : offset.x)
    : Math.hypot(offset.x, offset.y);
  return off < SAME_PLACE ? offset : null;
}

const INSTANCE_LABEL_SLOTS: readonly InstanceLabelSlot[] = [
  "reference",
  "value",
  "reference-over-value",
];

/**
 * The side of its part and the slot of its group a label of this size
 * stands in, as the upright placer puts it, or null.
 */
export function instanceLabelSlotAt(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  label: InstanceLabelPlacement,
  sizeScale = 1,
): { side: InstanceLabelSide; slot: InstanceLabelSlot } | null {
  for (const side of INSTANCE_LABEL_SIDES)
    for (const slot of INSTANCE_LABEL_SLOTS)
      if (
        offsetFromPlacement(
          label,
          placeUprightInstanceLabel(
            instance,
            resolved,
            profile,
            { x: 0, y: 0 },
            side,
            grid,
            sizeScale,
            slot,
          ),
        )
      )
        return { side, slot };
  return null;
}

/** A part's name or value as drawn, read as one of its group. */
export interface InstanceGroupLabel extends InstanceLabelPlacement {
  readonly profile: SchematicStyleProfile;
  readonly sizeScale: number;
  readonly shows: boolean;
}

/**
 * A part's name or value annotation read as one of its group, its part
 * placed at `partPosition`, or null for one not attached to its part.
 */
export function instanceGroupLabel(
  document: SchematicDocument,
  annotation: Annotation,
  partPosition: Point,
): InstanceGroupLabel | null {
  if (annotation.anchor.kind !== "object") return null;
  return {
    position: {
      x: partPosition.x + annotation.anchor.localOffset.x,
      y: partPosition.y + annotation.anchor.localOffset.y,
    },
    alignment: annotation.alignment,
    profile: objectStyleProfile(
      resolveDocumentStyleProfile(document.presentation),
      annotation,
    ),
    sizeScale: annotation.sizeScale ?? 1,
    shows: annotation.visible !== false,
  };
}

/**
 * Where a part's name and value stand together: the side of the part, as
 * drawn, and how far they are slid along it.
 */
export interface InstanceLabelGroupSeat {
  readonly side: InstanceLabelSide;
  readonly shift: Point;
}

/**
 * The slots a name and its value take together, name first: both shown,
 * one of them alone in the name's slot with the other where it stands when
 * shown, and both alone.
 */
const NAME_FIRST_STACKS = [
  ["reference-over-value", "value"],
  ["reference", "value"],
  ["reference-over-value", "reference"],
  ["reference", "reference"],
] as const;

/**
 * The seat of a part's name and value when they stand as one group in the
 * slots the upright placer gives them on a side of the part, slid alike
 * along it with `slides`, or null when either stands anywhere else.
 * `stacks` reads a name first and its value under it, or a value standing
 * over its name above the part as the outward placer stacked them, or
 * either.
 */
export function instanceLabelGroupSeat(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  grid: number,
  name: InstanceGroupLabel,
  value: InstanceGroupLabel,
  {
    stacks = "any",
    slides = true,
  }: {
    stacks?: "any" | "value-over-name";
    slides?: boolean;
  } = {},
): InstanceLabelGroupSeat | null {
  for (const localSide of INSTANCE_LABEL_SIDES) {
    const side = transformedSide(localSide, instance);
    if (!side) continue;
    const at = (
      label: InstanceGroupLabel,
      slot: InstanceLabelSlot,
      placer: UprightPlacer = nameFirstPlacer,
    ) =>
      placer(
        instance,
        resolved,
        label.profile,
        { x: 0, y: 0 },
        localSide,
        grid,
        label.sizeScale,
        slot,
        instanceValueRowOffset(instance.symbolId, label.profile, grid),
      );
    const pairs = [
      ...(stacks === "any"
        ? NAME_FIRST_STACKS.map(
            ([nameSlot, valueSlot]) =>
              [at(name, nameSlot), at(value, valueSlot)] as const,
          )
        : []),
      ...(side === "top"
        ? [[at(name, "reference"), at(value, "value", outwardPlacer)] as const]
        : []),
    ];
    for (const [nameSlot, valueSlot] of pairs) {
      const shift = offsetFromPlacement(name, nameSlot, slides);
      const valueShift = offsetFromPlacement(value, valueSlot, slides);
      if (
        shift &&
        valueShift &&
        Math.hypot(shift.x - valueShift.x, shift.y - valueShift.y) < SAME_PLACE
      )
        return { side, shift };
    }
  }
  return null;
}

/**
 * Where a part's name and value stand on `seat`, name first and its value
 * under it: a label shown without the other takes the name's slot, and a
 * hidden one waits where it stands when shown. Null when no side of the
 * part faces the seat's side.
 */
export function seatedInstanceLabelGroup(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  grid: number,
  seat: InstanceLabelGroupSeat,
  name: InstanceGroupLabel,
  value: InstanceGroupLabel,
): { name: InstanceLabelPlacement; value: InstanceLabelPlacement } | null {
  const localSide = INSTANCE_LABEL_SIDES.find(
    (side) => transformedSide(side, instance) === seat.side,
  );
  if (!localSide) return null;
  const at = (label: InstanceGroupLabel, slot: InstanceLabelSlot) => {
    const placed = placeUprightInstanceLabel(
      instance,
      resolved,
      label.profile,
      { x: 0, y: 0 },
      localSide,
      grid,
      label.sizeScale,
      slot,
    );
    return placed
      ? {
          alignment: placed.alignment,
          position: {
            x: placed.position.x + seat.shift.x,
            y: placed.position.y + seat.shift.y,
          },
        }
      : null;
  };
  const placedName = at(
    name,
    value.shows ? "reference-over-value" : "reference",
  );
  const placedValue = at(value, name.shows ? "value" : "reference");
  return placedName && placedValue
    ? { name: placedName, value: placedValue }
    : null;
}

/** Independent magnetic values stack outside the world-space symbol ink. */
interface MagneticParameterAnchor {
  readonly parts: readonly string[];
  readonly side: InstanceLabelSide;
  /** Rows further out, past the Reference label on the same side. */
  readonly rows?: number;
}

const TCOIL_BRIDGE = [
  "bridge-capacitor-1",
  "bridge-capacitor-2",
  "bridge-capacitor-3",
  "bridge-capacitor-4",
];

/**
 * Beside which drawn parts a magnetic device shows each parameter, and on
 * which side of them in Symbol space: a winding's inductance by that
 * winding, the bridge capacitance by the bridge, the coupling between the
 * windings. One column beside the whole Symbol read as four labels for the
 * centre tap once the Symbol was turned. `upright` is a Symbol turned a
 * quarter, where a T-coil's bridge loop is too narrow for text: its coupling
 * moves out past the centre tap, between the two windings' values.
 */
function magneticParameterAnchor(
  symbolId: string,
  parameter: string,
  upright: boolean,
): MagneticParameterAnchor | undefined {
  if (symbolId === "tcoil")
    switch (parameter) {
      case "k":
        return upright
          ? {
              parts: ["winding-center-link", "terminal-3-lead"],
              side: "bottom",
            }
          : { parts: ["winding-center-link"], side: "top" };
      case "l1":
        return { parts: ["winding-1"], side: "bottom" };
      case "l2":
        return { parts: ["winding-2"], side: "bottom" };
      case "cb":
        // The Reference sits on this side of the Symbol; the value goes one
        // row past it.
        return { parts: TCOIL_BRIDGE, side: "top", rows: 1 };
    }
  if (symbolId === "xfmr")
    switch (parameter) {
      case "k":
        return {
          parts: ["primary-winding", "secondary-winding"],
          side: "right",
        };
      case "lp":
        return { parts: ["primary-winding"], side: "top" };
      case "ls":
        return { parts: ["secondary-winding"], side: "bottom" };
    }
  return undefined;
}

/** The drawn extent of some of a Symbol's named parts, in Symbol space. */
function partInkBounds(
  resolved: ResolvedSymbol,
  parts: readonly string[],
): Rect | null {
  const wanted = new Set(parts);
  const primitives = resolved.definition.primitives.filter(
    (primitive) => primitive.part !== undefined && wanted.has(primitive.part),
  );
  if (primitives.length === 0) return null;
  return compactLabelInkBounds({
    definition: { ...resolved.definition, primitives, pins: [] },
  } as ResolvedSymbol);
}

export function defaultInstanceParameterLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  parameter: string,
): InstanceLabelPlacement | null {
  return parameterPlacementWith(
    instanceLabelRowOffset,
    instance,
    resolved,
    profile,
    grid,
    parameter,
  );
}

/** Where the rule until 2026-10-04 put a parameter's value: the current
 * parts and sides, rows apart by the wider row distance. */
export function previousDefaultInstanceParameterLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  parameter: string,
): InstanceLabelPlacement | null {
  return parameterPlacementWith(
    previousInstanceLabelRowOffset,
    instance,
    resolved,
    profile,
    grid,
    parameter,
  );
}

function parameterPlacementWith(
  rows: InstanceLabelRowRule,
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  parameter: string,
): InstanceLabelPlacement | null {
  const index = magneticDisplayParameters(instance.symbolId).findIndex(
    (candidate) => candidate.name === parameter,
  );
  if (index < 0) return null;
  // A quarter turn keeps each part's side distinct. On a diagonal two sides
  // fold onto one and the values would crowd, so they keep one column.
  const rotation = instance.placement?.rotation ?? 0;
  const anchor =
    rotation % 90 === 0
      ? magneticParameterAnchor(
          instance.symbolId,
          parameter,
          rotation % 180 !== 0,
        )
      : undefined;
  const part = anchor ? partInkBounds(resolved, anchor.parts) : null;
  const partBounds = part ? transformedBounds(part, instance) : null;
  const partSide = anchor ? transformedSide(anchor.side, instance) : null;
  if (anchor && partBounds && partSide)
    return placeBesideBounds(
      partBounds,
      partSide,
      instanceLabelMetrics(profile),
      (anchor.rows ?? 0) * rows(profile, grid, instance.symbolId),
    );
  return legacyDefaultInstanceParameterLabelPlacement(
    instance,
    resolved,
    profile,
    grid,
    parameter,
  );
}

/**
 * The placement rule used until 2026-09-26, and still on a diagonal: every
 * value in one column beside the whole Symbol. Labels still exactly there
 * count as untouched, so they keep following their Symbol.
 */
export function legacyDefaultInstanceParameterLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  parameter: string,
): InstanceLabelPlacement | null {
  const index = magneticDisplayParameters(instance.symbolId).findIndex(
    (candidate) => candidate.name === parameter,
  );
  if (index < 0) return null;
  const bounds = transformedBounds(
    visibleSymbolInkBounds(resolved, instance.signalFlowParameters),
    instance,
  );
  if (!bounds) return null;
  const snap = (value: number) => Math.round(value / grid) * grid;
  return {
    position: {
      x: Math.ceil((bounds.x + bounds.width + grid) / grid) * grid,
      y:
        snap(bounds.y + bounds.height / 2) +
        index * previousInstanceLabelRowOffset(profile, grid),
    },
    alignment: "start",
  };
}
