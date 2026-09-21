import type { DraftingObject, Point } from "@icm/model";
import { snapGridPoint } from "@icm/model";

type Arrow = Extract<DraftingObject, { kind: "arrow" }>;

// Leave room between vertex circles and the independent whole-path handles.
export const POLYLINE_RESIZE_PADDING = 15;
export const POLYLINE_CORNER_DIRECTIONS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

/** Paths use the existing ordered endpoints/waypoints, including a closing edge. */
export function freeArrowPoints(object: Arrow): Point[] | null {
  return object.from.kind === "free" && object.to.kind === "free"
    ? [object.from.position, ...(object.waypoints ?? []), object.to.position]
    : null;
}

export function isClosedPolyline(object: Arrow): boolean {
  const points = freeArrowPoints(object);
  return Boolean(
    points &&
    points.length >= 4 &&
    points[0]!.x === points.at(-1)!.x &&
    points[0]!.y === points.at(-1)!.y,
  );
}

export function replaceArrowPoints(object: Arrow, points: Point[]): Arrow {
  if (!freeArrowPoints(object))
    throw new Error("Move attached endpoints through their attachment");
  if (points.length < 2) throw new Error("A path needs at least two points");
  return {
    ...object,
    anchor: { kind: "free", position: points[0]! },
    from: { kind: "free", position: points[0]! },
    to: { kind: "free", position: points.at(-1)! },
    waypoints: points.slice(1, -1),
    ...(object.curveControls
      ? {
          curveControls: Array.from(
            { length: points.length - 1 },
            (_, i) => object.curveControls?.[i] ?? null,
          ),
        }
      : {}),
  };
}

export function setPolylineClosed(object: Arrow, closed: boolean): Arrow {
  if (closed === isClosedPolyline(object)) return object;
  if (object.outline)
    throw new Error("Outline arrows cannot be closed polygons");
  const points = freeArrowPoints(object);
  if (!points) throw new Error("Only a free path can be closed");
  if (closed) {
    if (new Set(points.map((p) => `${p.x},${p.y}`)).size < 3)
      throw new Error("A polygon needs at least three distinct vertices");
    return replaceArrowPoints(object, [...points, { ...points[0]! }]);
  }
  return replaceArrowPoints(object, points.slice(0, -1));
}

export function polylineCorners(object: Arrow): Point[] | null {
  const points = freeArrowPoints(object);
  if (!points || points.length < 3 || object.outline) return null;
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y));
  if (left === right || top === bottom) return null;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

/** Drag a bounding corner; the opposite corner stays fixed, including on flips. */
export function resizePolyline(
  object: Arrow,
  cornerIndex: number,
  point: Point,
  grid: number,
): Arrow {
  const corners = polylineCorners(object);
  const corner = corners?.[cornerIndex],
    fixed = corners?.[(cornerIndex + 2) % 4];
  if (!corner || !fixed) return object;
  const sx = (point.x - fixed.x) / (corner.x - fixed.x);
  const sy = (point.y - fixed.y) / (corner.y - fixed.y);
  if (sx === 1 && sy === 1) return object;
  const scale = (p: Point) => {
    const snapped = snapGridPoint(
      { x: fixed.x + (p.x - fixed.x) * sx, y: fixed.y + (p.y - fixed.y) * sy },
      grid,
    );
    // Exact visual captures may be off the annotation grid. Keep the fixed
    // edge and any unchanged axis where the author placed them.
    return {
      x: sx === 1 || p.x === fixed.x ? p.x : snapped.x,
      y: sy === 1 || p.y === fixed.y ? p.y : snapped.y,
    };
  };
  return {
    ...replaceArrowPoints(object, freeArrowPoints(object)!.map(scale)),
    ...(object.curveControls
      ? {
          curveControls: object.curveControls.map((p) => (p ? scale(p) : null)),
        }
      : {}),
  };
}
