import {
  resolveElectricalContactTargets,
  type ResolvedRouteGeometry,
  type RoutedComponent,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { Point, RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { endpointSnapAnchor } from "../../snap/candidates";
import {
  resolvePointSnap,
  SNAP_PROFILES,
  snapCoordinate,
  type SnapGuideLine,
} from "../../snap/engine";
import { routeTapPoint } from "./route-interaction-geometry";

interface IndexedEndpointTarget {
  source: WireSource;
  anchor: ReturnType<typeof endpointSnapAnchor>;
}

interface IndexedRouteSegment {
  routeId: string;
  netId: string;
  segmentIndex: number;
  from: Point;
  to: Point;
}

export interface WireCanvasSnapIndex {
  readonly cellSize: number;
  readonly endpointTargets: readonly IndexedEndpointTarget[];
  readonly routeSegments: readonly IndexedRouteSegment[];
  readonly endpointBuckets: ReadonlyMap<string, readonly number[]>;
  readonly routeBuckets: ReadonlyMap<string, readonly number[]>;
}

function bucketKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function addToBucket(
  buckets: Map<string, number[]>,
  key: string,
  index: number,
): void {
  const bucket = buckets.get(key);
  if (bucket) bucket.push(index);
  else buckets.set(key, [index]);
}

function cellsForBounds(from: Point, to: Point, cellSize: number): string[] {
  const minX = Math.floor(Math.min(from.x, to.x) / cellSize);
  const maxX = Math.floor(Math.max(from.x, to.x) / cellSize);
  const minY = Math.floor(Math.min(from.y, to.y) / cellSize);
  const maxY = Math.floor(Math.max(from.y, to.y) / cellSize);
  const cells: string[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) cells.push(bucketKey(x, y));
  }
  return cells;
}

/** Stable endpoint and segment lookup, rebuilt only with derived geometry. */
export function buildWireCanvasSnapIndex(
  wiringEndpoints: readonly WireSource[],
  routeGeometryRecords: WireCanvasSnapContext["routeGeometryRecords"],
  cellSize = 100,
): WireCanvasSnapIndex {
  const endpointTargets = wiringEndpoints.map((source) => ({
    source,
    anchor: endpointSnapAnchor(source),
  }));
  const routeSegments = routeGeometryRecords.flatMap(({ route, geometry }) =>
    geometry.centerline.slice(0, -1).map((from, segmentIndex) => ({
      routeId: route.id,
      netId: route.netId,
      segmentIndex,
      from,
      to: geometry.centerline[segmentIndex + 1]!,
    })),
  );
  const endpointBuckets = new Map<string, number[]>();
  endpointTargets.forEach((target, index) => {
    addToBucket(
      endpointBuckets,
      bucketKey(
        Math.floor(target.anchor.point.x / cellSize),
        Math.floor(target.anchor.point.y / cellSize),
      ),
      index,
    );
  });
  const routeBuckets = new Map<string, number[]>();
  routeSegments.forEach((segment, index) => {
    for (const cell of cellsForBounds(segment.from, segment.to, cellSize)) {
      addToBucket(routeBuckets, cell, index);
    }
  });
  return {
    cellSize,
    endpointTargets,
    routeSegments,
    endpointBuckets,
    routeBuckets,
  };
}

function nearbyIndices(
  buckets: ReadonlyMap<string, readonly number[]>,
  point: Point,
  tolerance: number,
  cellSize: number,
): number[] {
  const cells = cellsForBounds(
    { x: point.x - tolerance, y: point.y - tolerance },
    { x: point.x + tolerance, y: point.y + tolerance },
    cellSize,
  );
  return [
    ...new Set(cells.flatMap((cell) => [...(buckets.get(cell) ?? [])])),
  ].sort((left, right) => left - right);
}

export interface WireCanvasSnapContext {
  document: SchematicDocument;
  resolver: SymbolResolver;
  wiringEndpoints: readonly WireSource[];
  routeGeometryRecords: readonly {
    route: RouteBranch;
    geometry: ResolvedRouteGeometry;
  }[];
  contactComponents: readonly RoutedComponent[];
  wireSource: WireSource | null;
  wireWaypoints: readonly Point[];
  captureTolerance: number;
  snapIndex?: WireCanvasSnapIndex;
}

export interface WireCanvasSnapResult {
  point: Point;
  endpoint?: WireSource;
  route?: { routeId: string; segmentIndex: number; point: Point };
  ambiguous?: boolean;
  guides: SnapGuideLine[];
}

/** Resolve one wire-canvas pointer to a grid, endpoint, or routed conductor. */
export function resolveWireCanvasSnap(
  {
    document,
    resolver,
    wiringEndpoints,
    routeGeometryRecords,
    contactComponents,
    wireSource,
    wireWaypoints,
    captureTolerance,
    snapIndex,
  }: WireCanvasSnapContext,
  point: Point,
  suppressSnap: boolean,
): WireCanvasSnapResult {
  if (suppressSnap) {
    return {
      point: {
        x: snapCoordinate(point.x, document.presentation.grid),
        y: snapCoordinate(point.y, document.presentation.grid),
      },
      guides: [],
    };
  }
  const arrival = wireSource
    ? (wireWaypoints.at(-1) ?? wireSource.connection.contactPoint)
    : null;
  const index =
    snapIndex ??
    buildWireCanvasSnapIndex(wiringEndpoints, routeGeometryRecords);
  const routeTargets = nearbyIndices(
    index.routeBuckets,
    point,
    captureTolerance,
    index.cellSize,
  ).flatMap((routeSegmentIndex) => {
    const segment = index.routeSegments[routeSegmentIndex]!;
    const tapPoint = routeTapPoint(
      point,
      segment.from,
      segment.to,
      document.presentation.grid,
      arrival,
    );
    return Math.hypot(tapPoint.x - point.x, tapPoint.y - point.y) <=
      captureTolerance
      ? [
          {
            anchor: {
              id: `wire-route:${segment.routeId}:${segment.segmentIndex}`,
              point: tapPoint,
              kind: "route" as const,
            },
            routeId: segment.routeId,
            netId: segment.netId,
            segmentIndex: segment.segmentIndex,
          },
        ]
      : [];
  });
  const endpointTargets = nearbyIndices(
    index.endpointBuckets,
    point,
    captureTolerance,
    index.cellSize,
  )
    .map((endpointIndex) => index.endpointTargets[endpointIndex]!)
    .filter(
      (target) =>
        Math.hypot(
          target.anchor.point.x - point.x,
          target.anchor.point.y - point.y,
        ) <= captureTolerance,
    );
  const activeSourceAnchorId = wireSource
    ? endpointSnapAnchor(wireSource).id
    : null;
  const resolved = resolvePointSnap(
    point,
    [
      ...endpointTargets.map((candidate) => candidate.anchor),
      ...routeTargets.map((candidate) => candidate.anchor),
    ],
    {
      grid: document.presentation.grid,
      tolerance: captureTolerance,
      profile: SNAP_PROFILES.wire,
      ...(activeSourceAnchorId
        ? { excludedTargetIds: new Set([activeSourceAnchorId]) }
        : {}),
    },
  );
  const snappedPoint = {
    x: point.x + resolved.delta.x,
    y: point.y + resolved.delta.y,
  };
  const atPoint = (candidate: { anchor: { id: string; point: Point } }) =>
    candidate.anchor.id !== activeSourceAnchorId &&
    Math.abs(candidate.anchor.point.x - snappedPoint.x) < 1e-6 &&
    Math.abs(candidate.anchor.point.y - snappedPoint.y) < 1e-6;
  const contactTargets = resolveElectricalContactTargets(
    document,
    resolver,
    [
      ...endpointTargets.filter(atPoint).map((candidate) => ({
        kind: "endpoint" as const,
        id: candidate.anchor.id,
        point: candidate.anchor.point,
        netId: candidate.source.netId,
        endpoint: candidate.source.endpoint,
      })),
      ...routeTargets.filter(atPoint).map((candidate) => ({
        kind: "route" as const,
        id: candidate.anchor.id,
        point: candidate.anchor.point,
        netId: candidate.netId,
        routeId: candidate.routeId,
        segmentIndex: candidate.segmentIndex,
      })),
    ],
    contactComponents,
  );
  const ambiguous = contactTargets.length > 1;
  const contact = ambiguous ? undefined : contactTargets[0];
  const endpoint = contact?.endpoint
    ? endpointTargets.find(
        (candidate) => candidate.anchor.id === contact.endpoint!.id,
      )?.source
    : undefined;
  const route =
    !endpoint && contact?.route
      ? routeTargets.find(
          (candidate) => candidate.anchor.id === contact.route!.id,
        )
      : undefined;
  return {
    point: snappedPoint,
    ...(ambiguous ? { ambiguous: true } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(route
      ? {
          route: {
            routeId: route.routeId,
            segmentIndex: route.segmentIndex,
            point: snappedPoint,
          },
        }
      : {}),
    guides: resolved.guides,
  };
}
