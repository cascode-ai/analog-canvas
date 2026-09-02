import type { Point, Rect, SchematicDocument } from "@icm/model";

import type { ResolvedDocumentRoutingGeometry } from "./resolved-route-geometry.js";

export interface SpatialEntry<T> {
  readonly bounds: Rect;
  readonly value: T;
}

export interface BoundsSpatialIndex<T> {
  readonly size: number;
  queryBounds(bounds: Rect): readonly T[];
  queryPoint(point: Point): readonly T[];
}

export interface IndexedRouteSegment {
  readonly routeId: string;
  readonly netId: string;
  readonly segmentIndex: number;
  readonly from: Point;
  readonly to: Point;
  readonly bounds: Rect;
  readonly orientation: "horizontal" | "vertical" | "other";
}

export interface DocumentSpatialIndex {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly routeSegments: BoundsSpatialIndex<IndexedRouteSegment>;
}

function normalizedBounds(bounds: Rect): Rect {
  const x = Math.min(bounds.x, bounds.x + bounds.width);
  const y = Math.min(bounds.y, bounds.y + bounds.height);
  return {
    x,
    y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}

function closedBoundsOverlap(left: Rect, right: Rect): boolean {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function bucketCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function bucketKey(x: number, y: number): string {
  return `${x}\0${y}`;
}

/**
 * Small deterministic broad-phase index. It only removes impossible pairs;
 * callers retain their existing exact geometry predicates. Results preserve
 * input order so diagnostic identity and ordering never depend on buckets.
 */
export function buildBoundsSpatialIndex<T>(
  entries: readonly SpatialEntry<T>[],
  cellSize: number,
): BoundsSpatialIndex<T> {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("Spatial index cell size must be a positive number");
  }
  const records = entries.map((entry) => ({
    bounds: normalizedBounds(entry.bounds),
    value: entry.value,
  }));
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < records.length; index += 1) {
    const bounds = records[index]!.bounds;
    const minX = bucketCoordinate(bounds.x, cellSize);
    const maxX = bucketCoordinate(bounds.x + bounds.width, cellSize);
    const minY = bucketCoordinate(bounds.y, cellSize);
    const maxY = bucketCoordinate(bounds.y + bounds.height, cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = bucketKey(x, y);
        const members = buckets.get(key) ?? [];
        members.push(index);
        buckets.set(key, members);
      }
    }
  }

  const queryBounds = (input: Rect): readonly T[] => {
    const bounds = normalizedBounds(input);
    const minX = bucketCoordinate(bounds.x, cellSize);
    const maxX = bucketCoordinate(bounds.x + bounds.width, cellSize);
    const minY = bucketCoordinate(bounds.y, cellSize);
    const maxY = bucketCoordinate(bounds.y + bounds.height, cellSize);
    const candidateIndexes = new Set<number>();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const index of buckets.get(bucketKey(x, y)) ?? []) {
          candidateIndexes.add(index);
        }
      }
    }
    return [...candidateIndexes]
      .sort((left, right) => left - right)
      .flatMap((index) => {
        const record = records[index]!;
        return closedBoundsOverlap(record.bounds, bounds) ? [record.value] : [];
      });
  };

  return {
    size: records.length,
    queryBounds,
    queryPoint(point) {
      return queryBounds({ x: point.x, y: point.y, width: 0, height: 0 });
    },
  };
}

function segmentBounds(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function buildDocumentSpatialIndex(
  document: SchematicDocument,
  routingGeometry: ResolvedDocumentRoutingGeometry,
): DocumentSpatialIndex {
  if (
    routingGeometry.documentId !== document.id ||
    routingGeometry.documentRevision !== document.revision
  ) {
    throw new Error("Spatial index received stale routing geometry");
  }
  const segments = document.routes.flatMap((route) => {
    const geometry = routingGeometry.routes.get(route.id);
    return (geometry?.segments ?? []).map((segment) => {
      const orientation =
        segment.from.y === segment.to.y
          ? ("horizontal" as const)
          : segment.from.x === segment.to.x
            ? ("vertical" as const)
            : ("other" as const);
      return {
        routeId: route.id,
        netId: route.netId,
        segmentIndex: segment.address.segmentIndex,
        from: segment.from,
        to: segment.to,
        bounds: segmentBounds(segment.from, segment.to),
        orientation,
      };
    });
  });
  return {
    documentId: document.id,
    documentRevision: document.revision,
    routeSegments: buildBoundsSpatialIndex(
      segments.map((segment) => ({ bounds: segment.bounds, value: segment })),
      Math.max(80, document.presentation.grid * 8),
    ),
  };
}
