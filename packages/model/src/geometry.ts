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
    default: {
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

export function manhattanDistance(
  left: GridPoint | DerivedPoint,
  right: GridPoint | DerivedPoint,
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}
