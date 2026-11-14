import { inverseTransformPoint } from "@icm/model";
import type { Orientation, Point } from "@icm/model";

import type { SymbolPrimitive } from "./schema.js";

/**
 * Polarity marks are notation, not device geometry: they move with a source,
 * but a minus sign remains horizontal on the page. Pre-apply the inverse of
 * the instance orientation around each mark's centre; the parent SVG
 * transform then restores the centre while cancelling rotation and mirror.
 * The strokes of one mark share its part name and turn about the mark's
 * centre together, so a letter drawn in strokes (the ammeter's A) stays one
 * upright letter.
 */
function screenUprightPoints(
  points: readonly Point[],
  orientation: Pick<Orientation, "rotation" | "mirror">,
  center: Point,
): Point[] {
  const canonicalCoordinate = (value: number): number => {
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return points.map((point) => {
    const unrotated = inverseTransformPoint(
      { x: point.x - center.x, y: point.y - center.y },
      { x: 0, y: 0 },
      orientation,
    );
    return {
      x: canonicalCoordinate(center.x + unrotated.x),
      y: canonicalCoordinate(center.y + unrotated.y),
    };
  });
}

/** The middle of a mark's extent, which a single line's midpoint is. */
function extentCenter(points: readonly Point[]): Point {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function uprightStrokePoints(primitive: SymbolPrimitive): readonly Point[] {
  if (!primitive.part?.startsWith("upright-")) return [];
  if (primitive.kind === "line") return [primitive.from, primitive.to];
  if (primitive.kind === "polyline") return primitive.points;
  return [];
}

export function screenUprightPrimitive(
  primitive: SymbolPrimitive,
  orientation?: Pick<Orientation, "rotation" | "mirror">,
  pivot?: Point,
): SymbolPrimitive {
  const points = uprightStrokePoints(primitive);
  if (!points.length || orientation === undefined) return primitive;
  const [first, ...rest] = screenUprightPoints(
    points,
    orientation,
    pivot ?? extentCenter(points),
  );
  if (primitive.kind === "line")
    return { ...primitive, from: first!, to: rest[0]! };
  if (primitive.kind === "polyline")
    return { ...primitive, points: [first!, ...rest] };
  return primitive;
}

/** The centre each upright mark turns about: the middle of all its strokes. */
export function uprightMarkPivots(
  primitives: readonly SymbolPrimitive[],
): ReadonlyMap<string, Point> {
  const strokes = new Map<string, Point[]>();
  for (const primitive of primitives) {
    const points = uprightStrokePoints(primitive);
    if (points.length && primitive.part)
      strokes.set(primitive.part, [
        ...(strokes.get(primitive.part) ?? []),
        ...points,
      ]);
  }
  return new Map(
    [...strokes].map(([part, points]) => [part, extentCenter(points)]),
  );
}
