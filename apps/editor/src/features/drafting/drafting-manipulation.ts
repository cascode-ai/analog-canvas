import type { ResolvedDraftingGeometry } from "@icm/derived";
import { snapGridPoint } from "@icm/model";
import { translateDraftingObject } from "@icm/edit-engine";

export { translateDraftingObject };
import type {
  DerivedPoint,
  DraftingObject,
  GridPoint,
  VisualAnchor,
} from "@icm/model";

import {
  centerOfBounds,
  closestPointOnSegment,
  normalizedBearing,
  rotatePointByDegrees,
} from "../../canvas/canvas-geometry";

export type DraftingHandle =
  | { kind: "from" | "to" }
  | {
      kind:
        "waypoint" | "vertex" | "curve" | "rectangle-corner" | "circle-radius";
      index: number;
    };

export type DraftingStylePatch = Partial<{
  lineStyle: "solid" | "dashed" | "dotted";
  /** Free multiplier over the profile annotation stroke, 0.25–4. */
  strokeScale: number;
  /** Explicit stroke color; an explicit undefined restores the profile
   * foreground (the patch application deletes the key). */
  color: string | undefined;
  arrowHead: "none" | "filled" | "open";
  arrowHeadScale: 0.75 | 1 | 1.25 | 1.5;
}>;

export type DraftingGeometryPatch = Partial<{
  radius: number;
  width: number;
  height: number;
}>;

/**
 * Precise geometry from the Properties dock: a circle takes a radius, a
 * rectangle takes width/height. Values are rounded to integers and floored
 * at 1 to stay inside the persisted schema; other kinds return null.
 */
export function applyDraftingGeometryPatch(
  object: DraftingObject,
  patch: DraftingGeometryPatch,
): DraftingObject | null {
  if (object.locked) return null;
  const size = (value: number): number => Math.max(1, Math.round(value));
  if (object.kind === "circle" && patch.radius !== undefined) {
    if (!Number.isFinite(patch.radius)) return null;
    return { ...object, radius: size(patch.radius) };
  }
  if (
    object.kind === "rectangle" &&
    (patch.width !== undefined || patch.height !== undefined)
  ) {
    const width = patch.width ?? object.width;
    const height = patch.height ?? object.height;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { ...object, width: size(width), height: size(height) };
  }
  return null;
}

export function draftingDragOrigin(object: DraftingObject): GridPoint | null {
  if (object.kind === "construction-line") return object.points[0] ?? null;
  if (object.kind === "rectangle") return object.center;
  if (object.kind === "circle") return object.center;
  if (object.kind === "arrow") {
    return object.from.kind === "free" && object.to.kind === "free"
      ? object.from.position
      : null;
  }
  return object.anchor.kind === "free" ? object.anchor.position : null;
}

function controlForQuadraticMidpoint(
  from: DerivedPoint,
  midpoint: GridPoint,
  to: DerivedPoint,
  grid: number,
): GridPoint {
  return snapGridPoint(
    {
      x: 2 * midpoint.x - (from.x + to.x) / 2,
      y: 2 * midpoint.y - (from.y + to.y) / 2,
    },
    grid,
  );
}

export function applyDraftingHandle(
  object: DraftingObject,
  handle: DraftingHandle,
  point: GridPoint,
  originalGeometry: ResolvedDraftingGeometry,
  grid: number,
): DraftingObject {
  if (object.kind === "arrow") {
    if (handle.kind === "waypoint") {
      if (handle.index < 0 || handle.index >= (object.waypoints?.length ?? 0)) {
        return object;
      }
      const waypoints = [...(object.waypoints ?? [])];
      waypoints[handle.index] = point;
      return { ...object, waypoints };
    }
    if (handle.kind === "curve" && originalGeometry.kind === "arrow") {
      const from = originalGeometry.points[handle.index];
      const to = originalGeometry.points[handle.index + 1];
      if (!from || !to) return object;
      const controls = Array.from(
        { length: originalGeometry.points.length - 1 },
        (_, index) => object.curveControls?.[index] ?? null,
      );
      controls[handle.index] = controlForQuadraticMidpoint(
        from,
        point,
        to,
        grid,
      );
      return { ...object, curveControls: controls };
    }
    if (
      handle.kind === "vertex" ||
      handle.kind === "rectangle-corner" ||
      handle.kind === "circle-radius"
    ) {
      return object;
    }
    const anchor = handle.kind === "from" ? object.from : object.to;
    if (anchor.kind !== "free") return object;
    const nextAnchor = { ...anchor, position: point };
    return handle.kind === "from"
      ? { ...object, from: nextAnchor }
      : { ...object, to: nextAnchor };
  }
  if (object.kind === "construction-line" && handle.kind === "vertex") {
    if (handle.index < 0 || handle.index >= object.points.length) return object;
    const points = object.points.slice();
    points[handle.index] = point;
    return { ...object, points };
  }
  if (
    object.kind === "construction-line" &&
    handle.kind === "curve" &&
    originalGeometry.kind === "construction-line"
  ) {
    const from = originalGeometry.points[handle.index];
    const to = originalGeometry.points[handle.index + 1];
    if (!from || !to) return object;
    const controls = Array.from(
      { length: originalGeometry.points.length - 1 },
      (_, index) => object.curveControls?.[index] ?? null,
    );
    controls[handle.index] = controlForQuadraticMidpoint(from, point, to, grid);
    return { ...object, curveControls: controls };
  }
  if (
    object.kind === "rectangle" &&
    handle.kind === "rectangle-corner" &&
    originalGeometry.kind === "rectangle"
  ) {
    const opposite = originalGeometry.corners[(handle.index + 2) % 4];
    if (!opposite) return object;
    const radians = (object.rotation * Math.PI) / 180;
    const ux = { x: Math.cos(radians), y: Math.sin(radians) };
    const uy = { x: -Math.sin(radians), y: Math.cos(radians) };
    const delta = { x: point.x - opposite.x, y: point.y - opposite.y };
    const localWidth = delta.x * ux.x + delta.y * ux.y;
    const localHeight = delta.x * uy.x + delta.y * uy.y;
    const center = snapGridPoint(
      {
        x: opposite.x + (localWidth * ux.x + localHeight * uy.x) / 2,
        y: opposite.y + (localWidth * ux.y + localHeight * uy.y) / 2,
      },
      grid,
    );
    return {
      ...object,
      center,
      anchor: { kind: "free", position: center },
      width: Math.max(grid, Math.round(Math.abs(localWidth) / grid) * grid),
      height: Math.max(grid, Math.round(Math.abs(localHeight) / grid) * grid),
    };
  }
  if (
    object.kind === "circle" &&
    handle.kind === "circle-radius" &&
    originalGeometry.kind === "circle"
  ) {
    const radius = Math.max(
      grid,
      Math.round(
        Math.hypot(point.x - object.center.x, point.y - object.center.y) / grid,
      ) * grid,
    );
    return { ...object, radius };
  }
  return object;
}

export function insertConstructionVertex(
  object: Extract<DraftingObject, { kind: "construction-line" }>,
  point: GridPoint,
): {
  object: Extract<DraftingObject, { kind: "construction-line" }>;
  index: number;
} | null {
  if (object.locked) return null;
  let bestIndex = object.points.length - 1;
  let bestDistance = Infinity;
  for (let index = 0; index < object.points.length - 1; index += 1) {
    const on = closestPointOnSegment(
      point,
      object.points[index]!,
      object.points[index + 1]!,
    );
    const distance = (on.x - point.x) ** 2 + (on.y - point.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }
  const points = object.points.slice();
  points.splice(bestIndex, 0, { ...point });
  const curveControls = object.curveControls
    ? [...object.curveControls]
    : undefined;
  if (curveControls) curveControls.splice(bestIndex - 1, 1, null, null);
  return { object: { ...object, points, curveControls }, index: bestIndex };
}

export function insertArrowWaypoint(
  object: Extract<DraftingObject, { kind: "arrow" }>,
  geometry: Extract<ResolvedDraftingGeometry, { kind: "arrow" }>,
  point: GridPoint,
): {
  object: Extract<DraftingObject, { kind: "arrow" }>;
  index: number;
} | null {
  if (object.locked) return null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < geometry.points.length - 1; index += 1) {
    const on = closestPointOnSegment(
      point,
      geometry.points[index]!,
      geometry.points[index + 1]!,
    );
    const distance = (on.x - point.x) ** 2 + (on.y - point.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  const waypoints = [...(object.waypoints ?? [])];
  waypoints.splice(bestIndex, 0, { ...point });
  const curveControls = object.curveControls
    ? [...object.curveControls]
    : undefined;
  if (curveControls) curveControls.splice(bestIndex, 1, null, null);
  return { object: { ...object, waypoints, curveControls }, index: bestIndex };
}

export type DeleteConstructionVertexResult =
  | {
      kind: "updated";
      object: Extract<DraftingObject, { kind: "construction-line" }>;
    }
  | { kind: "locked" }
  | { kind: "minimum" }
  | { kind: "invalid-index" };

export function deleteConstructionVertex(
  object: Extract<DraftingObject, { kind: "construction-line" }>,
  index: number,
): DeleteConstructionVertexResult {
  if (object.locked) return { kind: "locked" };
  if (object.points.length <= 2) return { kind: "minimum" };
  if (index < 0 || index >= object.points.length) {
    return { kind: "invalid-index" };
  }
  const points = object.points.filter(
    (_, vertexIndex) => vertexIndex !== index,
  );
  const { curveControls: _curveControls, ...straightObject } = object;
  return { kind: "updated", object: { ...straightObject, points } };
}

export function applyDraftingStylePatch(
  object: DraftingObject,
  patch: DraftingStylePatch,
): DraftingObject | null {
  if (
    object.locked ||
    (object.kind !== "arrow" &&
      object.kind !== "construction-line" &&
      object.kind !== "rectangle" &&
      object.kind !== "circle")
  ) {
    return null;
  }
  const nextOverride = { ...(object.styleOverride ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete (nextOverride as Record<string, unknown>)[key];
    } else {
      (nextOverride as Record<string, unknown>)[key] = value;
    }
  }
  return {
    ...object,
    styleOverride:
      Object.keys(nextOverride).length > 0 ? nextOverride : undefined,
  };
}

function rotateFreeAnchor(
  anchor: Extract<VisualAnchor, { kind: "free" }>,
  pivot: DerivedPoint,
  deltaDegrees: number,
  grid: number,
): Extract<VisualAnchor, { kind: "free" }> {
  return {
    ...anchor,
    position: snapGridPoint(
      rotatePointByDegrees(anchor.position, pivot, deltaDegrees),
      grid,
    ),
  };
}

export function rotateDraftingObject(
  object: DraftingObject,
  geometry: ResolvedDraftingGeometry,
  deltaDegrees: 90 | -90,
  grid: number,
): DraftingObject | null {
  if (object.locked) return null;
  if (object.kind === "arrow" && geometry.kind === "arrow") {
    const pivot = geometry.center;
    return {
      ...object,
      from:
        object.from.kind === "free"
          ? rotateFreeAnchor(object.from, pivot, deltaDegrees, grid)
          : object.from,
      to:
        object.to.kind === "free"
          ? rotateFreeAnchor(object.to, pivot, deltaDegrees, grid)
          : object.to,
      waypoints: object.waypoints?.map((point) =>
        snapGridPoint(rotatePointByDegrees(point, pivot, deltaDegrees), grid),
      ),
      curveControls: object.curveControls?.map((point) =>
        point
          ? snapGridPoint(
              rotatePointByDegrees(point, pivot, deltaDegrees),
              grid,
            )
          : null,
      ),
    };
  }
  if (
    object.kind === "construction-line" &&
    geometry.kind === "construction-line"
  ) {
    const pivot = centerOfBounds(geometry.bounds);
    return {
      ...object,
      points: object.points.map((point) =>
        snapGridPoint(rotatePointByDegrees(point, pivot, deltaDegrees), grid),
      ),
      curveControls: object.curveControls?.map((point) =>
        point
          ? snapGridPoint(
              rotatePointByDegrees(point, pivot, deltaDegrees),
              grid,
            )
          : null,
      ),
    };
  }
  if (object.kind === "rectangle") {
    return {
      ...object,
      rotation: (((object.rotation + deltaDegrees) % 360) + 360) % 360,
    };
  }
  return null;
}

function controlForTangentAngle(
  from: DerivedPoint,
  to: DerivedPoint,
  angleDegrees: number,
  existingControl: GridPoint | null,
  grid: number,
): GridPoint | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < 1e-6 || angleDegrees <= 0.01) return null;
  const boundedAngle = Math.min(170, Math.max(0.01, angleDegrees));
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const normal = { x: -dy / chordLength, y: dx / chordLength };
  const existingSide = existingControl
    ? Math.sign(
        (existingControl.x - midpoint.x) * normal.x +
          (existingControl.y - midpoint.y) * normal.y,
      )
    : 1;
  const offset = (chordLength / 2) * Math.tan((boundedAngle * Math.PI) / 360);
  return snapGridPoint(
    {
      x: midpoint.x + normal.x * offset * (existingSide || 1),
      y: midpoint.y + normal.y * offset * (existingSide || 1),
    },
    grid,
  );
}

export function setDraftingTangentAngle(
  object: Extract<DraftingObject, { kind: "arrow" | "construction-line" }>,
  geometry: Extract<
    ResolvedDraftingGeometry,
    { kind: "arrow" | "construction-line" }
  >,
  index: number,
  angleDegrees: number,
  grid: number,
): DraftingObject | null {
  if (
    object.locked ||
    !Number.isFinite(angleDegrees) ||
    index < 0 ||
    index >= geometry.points.length - 1
  ) {
    return null;
  }
  const curveControls = [...geometry.curveControls];
  curveControls[index] = controlForTangentAngle(
    geometry.points[index]!,
    geometry.points[index + 1]!,
    angleDegrees,
    curveControls[index] ?? null,
    grid,
  );
  return { ...object, curveControls };
}

export type SetDraftingBearingResult =
  | { kind: "updated"; object: DraftingObject }
  | { kind: "attached-arrow" }
  | { kind: "unsupported" };

export function setDraftingBearing(
  object: DraftingObject,
  geometry: ResolvedDraftingGeometry,
  bearingDegrees: number,
  grid: number,
): SetDraftingBearingResult {
  if (object.locked || !Number.isFinite(bearingDegrees)) {
    return { kind: "unsupported" };
  }
  const targetBearing = ((bearingDegrees % 360) + 360) % 360;
  if (object.kind === "rectangle") {
    return { kind: "updated", object: { ...object, rotation: targetBearing } };
  }
  if (
    (geometry.kind !== "arrow" && geometry.kind !== "construction-line") ||
    geometry.points.length < 2 ||
    (object.kind !== "arrow" && object.kind !== "construction-line")
  ) {
    return { kind: "unsupported" };
  }
  const currentBearing = normalizedBearing(
    geometry.points[0]!,
    geometry.points[1]!,
  );
  const delta = ((targetBearing - currentBearing + 540) % 360) - 180;
  if (object.kind === "arrow") {
    if (
      geometry.kind !== "arrow" ||
      object.from.kind !== "free" ||
      object.to.kind !== "free"
    ) {
      return { kind: "attached-arrow" };
    }
    const pivot = geometry.center;
    return {
      kind: "updated",
      object: {
        ...object,
        from: {
          ...object.from,
          position: snapGridPoint(
            rotatePointByDegrees(object.from.position, pivot, delta),
            grid,
          ),
        },
        to: {
          ...object.to,
          position: snapGridPoint(
            rotatePointByDegrees(object.to.position, pivot, delta),
            grid,
          ),
        },
        waypoints: object.waypoints?.map((point) =>
          snapGridPoint(rotatePointByDegrees(point, pivot, delta), grid),
        ),
        curveControls: object.curveControls?.map((point) =>
          point
            ? snapGridPoint(rotatePointByDegrees(point, pivot, delta), grid)
            : null,
        ),
      },
    };
  }
  if (geometry.kind !== "construction-line") {
    return { kind: "unsupported" };
  }
  const pivot = centerOfBounds(geometry.bounds);
  return {
    kind: "updated",
    object: {
      ...object,
      points: object.points.map((point) =>
        snapGridPoint(rotatePointByDegrees(point, pivot, delta), grid),
      ),
      curveControls: object.curveControls?.map((point) =>
        point
          ? snapGridPoint(rotatePointByDegrees(point, pivot, delta), grid)
          : null,
      ),
    },
  };
}
