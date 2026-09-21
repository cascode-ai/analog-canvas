import { transformPoint } from "@icm/model";
import type { Point, Rect, SchematicDocument } from "@icm/model";
import type { ResolvedSymbol } from "@icm/symbols";
import { getRazaviCatalogEntry } from "@icm/symbols";

import type { SchematicStyleProfile } from "./style-profile.js";
import { visibleSymbolInkBounds } from "./visual.js";
import { magneticDisplayParameters } from "./instance-value.js";

export interface InstanceLabelPlacement {
  readonly position: Point;
  readonly alignment: "start" | "middle" | "end";
}

export type InstanceLabelSide = "left" | "right" | "top" | "bottom";

/** The two upright text slots that share an instance's label side. */
export type InstanceLabelSlot = "reference" | "value";

/**
 * Vertical distance between the reference row and the value row, quantized to
 * whole grid multiples so snapping cannot pull the two rows into each other.
 */
export function instanceLabelRowOffset(
  profile: SchematicStyleProfile,
  grid: number,
): number {
  return Math.ceil((profile.typography.instanceFontSize * 1.35) / grid) * grid;
}

const SIDE_LABEL_SYMBOLS = new Set([
  "resistor",
  "variable-resistor",
  "capacitor",
  "variable-capacitor",
  "inductor",
  "inductor-compact",
  "variable-inductor",
  "voltage-source",
  "current-source",
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
 * Places horizontal SVG text around the active symbol variant. Compact device
 * and Analog Block labels use a five-unit gap and a centered glyph row at
 * integer precision; other labels retain their grid-aligned spacing. Distances use the
 * drawn artwork, excluding the padded interaction envelope.
 */
export function placeUprightInstanceLabel(
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

/** Supplies canonical placement for renderer-owned instance labels. */
export function defaultInstanceLabelPlacement(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  grid: number,
  slot: InstanceLabelSlot = "reference",
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  const localBounds = visibleSymbolInkBounds(
    resolved,
    instance.signalFlowParameters,
  );
  const middleY = localBounds.y + localBounds.height / 2;
  const middleX = localBounds.x + localBounds.width / 2;
  // A label gap is a grid-space visual rule, measured from drawn ink rather
  // than the padded hit envelope.
  const compactSideGap = grid;
  const baselineOffset = profile.typography.instanceFontSize * 0.35;
  // The value slot is the second upright row under the reference on the same
  // side; see instanceLabelRowOffset.
  const rowOffset =
    slot === "value" ? instanceLabelRowOffset(profile, grid) : 0;

  if (instance.symbolId === "port" || instance.symbolId === "port-filled") {
    const localPosition = {
      x: localBounds.x - compactSideGap,
      y: middleY + baselineOffset,
    };
    return placeUprightInstanceLabel(
      instance,
      resolved,
      profile,
      localPosition,
      "left",
      grid,
      1,
      rowOffset,
      true,
    );
  }

  if (
    isMosSymbol(resolved) ||
    isBjtSymbol(resolved) ||
    SIDE_LABEL_SYMBOLS.has(instance.symbolId)
  ) {
    return placeUprightInstanceLabel(
      instance,
      resolved,
      profile,
      { x: middleX, y: middleY },
      "right",
      grid,
      1,
      rowOffset,
    );
  }

  if (TOP_LABEL_SYMBOLS.has(instance.symbolId)) {
    return placeUprightInstanceLabel(
      instance,
      resolved,
      profile,
      { x: middleX, y: localBounds.y - compactSideGap },
      "top",
      grid,
      1,
      rowOffset,
    );
  }

  return placeUprightInstanceLabel(
    instance,
    resolved,
    profile,
    { x: middleX, y: localBounds.y + localBounds.height + compactSideGap },
    "bottom",
    grid,
    1,
    rowOffset,
  );
}

/** Independent magnetic values stack outside the world-space symbol ink. */
export function defaultInstanceParameterLabelPlacement(
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
        index * instanceLabelRowOffset(profile, grid),
    },
    alignment: "start",
  };
}
