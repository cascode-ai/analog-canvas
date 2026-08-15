import { transformPoint } from "@icm/model";
import type { Point, Rect, SchematicDocument } from "@icm/model";
import type { ResolvedSymbol } from "@icm/symbols";

import type { SchematicStyleProfile } from "./style-profile.js";
import { visibleSymbolLocalBounds } from "./visual.js";

export interface InstanceLabelPlacement {
  readonly position: Point;
  readonly alignment: "start" | "middle" | "end";
}

export type InstanceLabelSide = "left" | "right" | "top" | "bottom";

const SIDE_LABEL_SYMBOLS = new Set([
  "resistor",
  "capacitor",
  "inductor",
  "voltage-source",
  "current-source",
  "ac-voltage-source",
  "pulse-voltage-source",
]);

export function isMosSymbol(resolved: ResolvedSymbol): boolean {
  const roles = new Set(resolved.definition.pins.map((pin) => pin.role));
  return roles.has("gate") && roles.has("drain") && roles.has("source");
}

export function isBjtSymbol(resolved: ResolvedSymbol): boolean {
  const roles = new Set(resolved.definition.pins.map((pin) => pin.role));
  return roles.has("base") && roles.has("collector") && roles.has("emitter");
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

function sideClearance(
  localAnchor: Point,
  localBounds: Rect,
  side: InstanceLabelSide,
): number {
  switch (side) {
    case "left":
      return localBounds.x - localAnchor.x;
    case "right":
      return localAnchor.x - (localBounds.x + localBounds.width);
    case "top":
      return localBounds.y - localAnchor.y;
    case "bottom":
      return localAnchor.y - (localBounds.y + localBounds.height);
  }
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

/**
 * Places horizontal SVG text around the active symbol variant. Vertical sides
 * convert the internal clearance point to the upright glyph baseline before
 * returning it, so persisted object anchors have one visible position.
 */
export function placeUprightInstanceLabel(
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
  profile: SchematicStyleProfile,
  localAnchor: Point,
  localSide: InstanceLabelSide,
  grid: number,
  sizeScale = 1,
  minimumClearance = grid,
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  const localBounds = visibleSymbolLocalBounds(resolved);
  const worldBounds = transformedBounds(localBounds, instance);
  const worldSide = transformedSide(localSide, instance);
  if (!worldBounds || !worldSide) return null;
  const semanticPosition = transformPoint(
    localAnchor,
    instance.placement.position,
    instance.placement,
  );
  const clearance = Math.max(
    minimumClearance,
    sideClearance(localAnchor, localBounds, localSide),
  );
  const fontSize = profile.typography.instanceFontSize * sizeScale;
  const snap = (value: number) => Math.round(value / grid) * grid;
  const snapOutward = (value: number, direction: -1 | 1) =>
    (direction < 0 ? Math.floor(value / grid) : Math.ceil(value / grid)) * grid;
  switch (worldSide) {
    case "right":
      return {
        position: {
          x: snapOutward(worldBounds.x + worldBounds.width + clearance, 1),
          y: snap(semanticPosition.y),
        },
        alignment: "start",
      };
    case "left":
      return {
        position: {
          x: snapOutward(worldBounds.x - clearance, -1),
          y: snap(semanticPosition.y),
        },
        alignment: "end",
      };
    case "bottom":
      return {
        position: {
          x: snap(semanticPosition.x),
          y: snapOutward(
            worldBounds.y + worldBounds.height + clearance + fontSize * 1.05,
            1,
          ),
        },
        alignment: "middle",
      };
    case "top":
      return {
        position: {
          x: snap(semanticPosition.x),
          y: snapOutward(worldBounds.y - clearance - fontSize * 0.3, -1),
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
): InstanceLabelPlacement | null {
  if (!instance.placement) return null;
  const localBounds = visibleSymbolLocalBounds(resolved);
  const middleY = localBounds.y + localBounds.height / 2;
  const middleX = localBounds.x + localBounds.width / 2;
  // A label gap is a grid-space rule, not a raw-coordinate optical tweak.
  // The outward-only snap in placeUprightInstanceLabel preserves this full
  // grid unit even when a symbol edge is itself not grid-aligned.
  const compactSideGap = grid;
  const baselineOffset = profile.typography.instanceFontSize * 0.35;

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
    );
  }

  if (isMosSymbol(resolved) || isBjtSymbol(resolved)) {
    const localPosition = {
      x: localBounds.x + localBounds.width + compactSideGap,
      y: middleY + profile.typography.instanceFontSize * 0.55,
    };
    return placeUprightInstanceLabel(
      instance,
      resolved,
      profile,
      localPosition,
      "right",
      grid,
    );
  }

  if (SIDE_LABEL_SYMBOLS.has(instance.symbolId)) {
    const localPosition = {
      x: localBounds.x + localBounds.width + compactSideGap,
      y: middleY + baselineOffset,
    };
    return placeUprightInstanceLabel(
      instance,
      resolved,
      profile,
      localPosition,
      "right",
      grid,
    );
  }

  return placeUprightInstanceLabel(
    instance,
    resolved,
    profile,
    { x: middleX, y: localBounds.y + localBounds.height + compactSideGap },
    "bottom",
    grid,
  );
}
