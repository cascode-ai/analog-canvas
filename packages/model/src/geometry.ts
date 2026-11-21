import type {
  DerivedPoint,
  GridPoint,
  Mirror,
  Orientation,
  Rotation,
  SymbolLocalPoint,
} from "./schema.js";
import { mirrorScale } from "./orientation-reflect.js";

function mirrorLocal(
  point: GridPoint | SymbolLocalPoint,
  mirror: Mirror,
): DerivedPoint {
  const scale = mirrorScale(mirror);
  return { x: point.x * scale.x, y: point.y * scale.y };
}

function rotateLocal(point: DerivedPoint, rotation: Rotation): DerivedPoint {
  switch (rotation) {
    case 0:
      return point;
    case 90:
      return { x: -point.y, y: point.x };
    case 180:
      return { x: -point.x, y: -point.y };
    case 270:
      return { x: point.y, y: -point.x };
    case 45:
    case 135:
    case 225:
    case 315: {
      const radians = (rotation * Math.PI) / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      return {
        x: point.x * cosine - point.y * sine,
        y: point.x * sine + point.y * cosine,
      };
    }
  }
}

function inverseRotateLocal(
  point: DerivedPoint,
  rotation: Rotation,
): DerivedPoint {
  return rotateLocal(point, ((360 - rotation) % 360) as Rotation);
}

export function transformPoint(
  localPoint: GridPoint | SymbolLocalPoint,
  origin: GridPoint,
  orientation: Orientation,
): DerivedPoint {
  const transformed = mirrorLocal(
    rotateLocal(localPoint, orientation.rotation),
    orientation.mirror,
  );
  return {
    x: origin.x + transformed.x,
    y: origin.y + transformed.y,
  };
}

export function inverseTransformPoint(
  worldPoint: DerivedPoint,
  origin: GridPoint,
  orientation: Orientation,
): DerivedPoint {
  const translated = {
    x: worldPoint.x - origin.x,
    y: worldPoint.y - origin.y,
  };
  const mirrored = mirrorLocal(translated, orientation.mirror);
  return inverseRotateLocal(mirrored, orientation.rotation);
}

/** The extent of any rectangle, grid or derived. */
interface RectExtent {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Boundary inclusive. */
export function pointInRect(point: DerivedPoint, rect: RectExtent): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Whether a segment lies in or crosses a rectangle, as a crossing marquee
 * takes a wire.
 */
export function segmentIntersectsRect(
  from: DerivedPoint,
  to: DerivedPoint,
  rect: RectExtent,
): boolean {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return true;

  const delta = { x: to.x - from.x, y: to.y - from.y };
  let entry = 0;
  let exit = 1;
  const boundaries: ReadonlyArray<readonly [number, number]> = [
    [-delta.x, from.x - rect.x],
    [delta.x, rect.x + rect.width - from.x],
    [-delta.y, from.y - rect.y],
    [delta.y, rect.y + rect.height - from.y],
  ];

  for (const [direction, distance] of boundaries) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return true;
}

/** Whether any segment of a polyline lies in or crosses a rectangle. */
export function polylineIntersectsRect(
  points: readonly DerivedPoint[],
  rect: RectExtent,
): boolean {
  return points
    .slice(0, -1)
    .some((from, index) =>
      segmentIntersectsRect(from, points[index + 1]!, rect),
    );
}
