import { resolveDraftingObjectGeometry } from "@icm/derived";
import { snapGridPoint } from "@icm/model";
import type {
  DraftingObject,
  GridPoint,
  Point,
  Rect,
  SchematicDocument,
  VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

function scalePoint(
  point: Point,
  pivot: Point,
  factor: number,
  grid: number,
): GridPoint {
  return snapGridPoint(
    {
      x: pivot.x + (point.x - pivot.x) * factor,
      y: pivot.y + (point.y - pivot.y) * factor,
    },
    grid,
  );
}

function scaleFreeAnchor(
  anchor: VisualAnchor,
  pivot: Point,
  factor: number,
  grid: number,
): Extract<VisualAnchor, { kind: "free" }> | null {
  return anchor.kind === "free"
    ? { ...anchor, position: scalePoint(anchor.position, pivot, factor, grid) }
    : null;
}

/**
 * Uniformly scales the free drafting primitives used by a waveform snapshot.
 * Attached annotations deliberately reject scaling because changing their
 * fallback geometry would not change the owning electrical attachment.
 */
export function scaleDraftingObject(
  object: DraftingObject,
  pivot: Point,
  factor: number,
  grid: number,
): DraftingObject | null {
  if (object.locked || !Number.isFinite(factor) || factor <= 0) return null;
  const anchor = scaleFreeAnchor(object.anchor, pivot, factor, grid);
  if (!anchor) return null;
  if (object.kind === "text") {
    return {
      ...object,
      anchor,
      styleOverride: {
        ...(object.styleOverride ?? {}),
        sizeScale: (object.styleOverride?.sizeScale ?? 1) * factor,
      },
    };
  }
  if (object.kind === "construction-line") {
    return {
      ...object,
      anchor,
      points: object.points.map((point) =>
        scalePoint(point, pivot, factor, grid),
      ),
      curveControls: object.curveControls?.map((point) =>
        point ? scalePoint(point, pivot, factor, grid) : null,
      ),
    };
  }
  if (object.kind === "arrow") {
    const from = scaleFreeAnchor(object.from, pivot, factor, grid);
    const to = scaleFreeAnchor(object.to, pivot, factor, grid);
    if (!from || !to) return null;
    return {
      ...object,
      anchor,
      from,
      to,
      waypoints: object.waypoints?.map((point) =>
        scalePoint(point, pivot, factor, grid),
      ),
      curveControls: object.curveControls?.map((point) =>
        point ? scalePoint(point, pivot, factor, grid) : null,
      ),
    };
  }
  if (object.kind === "rectangle") {
    const center = scalePoint(object.center, pivot, factor, grid);
    return {
      ...object,
      anchor: { kind: "free", position: center },
      center,
      width: Math.max(grid, Math.round((object.width * factor) / grid) * grid),
      height: Math.max(
        grid,
        Math.round((object.height * factor) / grid) * grid,
      ),
    };
  }
  if (object.kind === "circle") {
    const center = scalePoint(object.center, pivot, factor, grid);
    return {
      ...object,
      anchor: { kind: "free", position: center },
      center,
      radius: Math.max(
        grid,
        Math.round((object.radius * factor) / grid) * grid,
      ),
    };
  }
  return null;
}

export function draftingGroupBounds(
  document: SchematicDocument,
  resolver: SymbolResolver,
  objectIds: readonly string[],
): Rect | null {
  const ids = new Set(objectIds);
  const bounds = (document.drafting?.objects ?? [])
    .filter((object) => ids.has(object.id))
    .map(
      (object) =>
        resolveDraftingObjectGeometry(document, resolver, object).bounds,
    );
  if (bounds.length === 0) return null;
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function scaleDraftingGroup(
  document: SchematicDocument,
  objectIds: readonly string[],
  pivot: Point,
  factor: number,
): DraftingObject[] | null {
  const ids = new Set(objectIds);
  const source = (document.drafting?.objects ?? []).filter((object) =>
    ids.has(object.id),
  );
  if (source.length !== ids.size) return null;
  const scaled = source.map((object) =>
    scaleDraftingObject(object, pivot, factor, document.presentation.grid),
  );
  return scaled.every((object): object is DraftingObject => object !== null)
    ? scaled
    : null;
}
