import { resolveDraftingObjectGeometry } from "@icm/derived";
import type {
  DraftingObject,
  GridPoint,
  Point,
  Rect,
  SchematicDocument,
  VisualAnchor,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

const MIN_STROKE_SCALE = 0.25;
const MAX_STROKE_SCALE = 4;

function hasScalableStroke(object: DraftingObject): boolean {
  return (
    object.kind === "construction-line" ||
    object.kind === "arrow" ||
    object.kind === "rectangle" ||
    object.kind === "circle"
  );
}

function scaledStrokeOverride(
  object: DraftingObject,
  factor: number,
): DraftingObject["styleOverride"] | null {
  const strokeScale = (object.styleOverride?.strokeScale ?? 1) * factor;
  if (strokeScale < MIN_STROKE_SCALE || strokeScale > MAX_STROKE_SCALE) {
    return null;
  }
  return { ...(object.styleOverride ?? {}), strokeScale };
}

function scalePoint(point: Point, pivot: Point, factor: number): GridPoint {
  // Drafting geometry supports one-unit precision. Snapping every scaled point
  // to the electrical grid independently changes pulse widths and amplitudes.
  return {
    x: Math.round(pivot.x + (point.x - pivot.x) * factor),
    y: Math.round(pivot.y + (point.y - pivot.y) * factor),
  };
}

function scaleFreeAnchor(
  anchor: VisualAnchor,
  pivot: Point,
  factor: number,
): Extract<VisualAnchor, { kind: "free" }> | null {
  return anchor.kind === "free"
    ? { ...anchor, position: scalePoint(anchor.position, pivot, factor) }
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
): DraftingObject | null {
  if (object.locked || !Number.isFinite(factor) || factor <= 0) return null;
  const anchor = scaleFreeAnchor(object.anchor, pivot, factor);
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
    const styleOverride = scaledStrokeOverride(object, factor);
    if (!styleOverride) return null;
    return {
      ...object,
      anchor,
      styleOverride,
      points: object.points.map((point) => scalePoint(point, pivot, factor)),
      curveControls: object.curveControls?.map((point) =>
        point ? scalePoint(point, pivot, factor) : null,
      ),
    };
  }
  if (object.kind === "arrow") {
    const from = scaleFreeAnchor(object.from, pivot, factor);
    const to = scaleFreeAnchor(object.to, pivot, factor);
    const styleOverride = scaledStrokeOverride(object, factor);
    if (!from || !to || !styleOverride) return null;
    return {
      ...object,
      anchor,
      styleOverride,
      from,
      to,
      ...(object.outline
        ? { outline: { width: object.outline.width * factor } }
        : {}),
      waypoints: object.waypoints?.map((point) =>
        scalePoint(point, pivot, factor),
      ),
      curveControls: object.curveControls?.map((point) =>
        point ? scalePoint(point, pivot, factor) : null,
      ),
    };
  }
  if (object.kind === "rectangle") {
    const center = scalePoint(object.center, pivot, factor);
    const styleOverride = scaledStrokeOverride(object, factor);
    if (!styleOverride) return null;
    return {
      ...object,
      anchor: { kind: "free", position: center },
      styleOverride,
      center,
      width: Math.max(1, Math.round(object.width * factor)),
      height: Math.max(1, Math.round(object.height * factor)),
    };
  }
  if (object.kind === "circle") {
    const center = scalePoint(object.center, pivot, factor);
    const styleOverride = scaledStrokeOverride(object, factor);
    if (!styleOverride) return null;
    return {
      ...object,
      anchor: { kind: "free", position: center },
      styleOverride,
      center,
      radius: Math.max(1, Math.round(object.radius * factor)),
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

export function draftingGroupScaleRange(
  document: SchematicDocument,
  objectIds: readonly string[],
): { min: number; max: number } | null {
  const ids = new Set(objectIds);
  const source = (document.drafting?.objects ?? []).filter((object) =>
    ids.has(object.id),
  );
  if (source.length !== ids.size) return null;
  return source.reduce(
    (range, object) => {
      if (!hasScalableStroke(object)) return range;
      const strokeScale = object.styleOverride?.strokeScale ?? 1;
      return {
        min: Math.max(range.min, MIN_STROKE_SCALE / strokeScale),
        max: Math.min(range.max, MAX_STROKE_SCALE / strokeScale),
      };
    },
    { min: 0.25, max: 4 },
  );
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
    scaleDraftingObject(object, pivot, factor),
  );
  return scaled.every((object): object is DraftingObject => object !== null)
    ? scaled
    : null;
}
