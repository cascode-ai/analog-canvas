import {
  createRoutePath,
  routeEnd,
  type Point,
  type RouteBranch,
  type SegmentMode,
  type SchematicDocument,
} from "@icm/model";
import {
  isNonStandardWireAngle,
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";

export interface AngledWireRepairIssue {
  routeId: string;
  segmentIndexes: readonly number[];
  protected: boolean;
}

export interface AngledWireRepairPlan {
  edits: readonly SchematicEdit[];
  issues: readonly AngledWireRepairIssue[];
  angledSegmentCount: number;
  repairableSegmentCount: number;
  repairableRouteCount: number;
  protectedRouteCount: number;
}

type CardinalDirection = "left" | "right" | "up" | "down";

function cardinalDirection(from: Point, to: Point): CardinalDirection | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dy === 0 && dx !== 0) return dx > 0 ? "right" : "left";
  if (dx === 0 && dy !== 0) return dy > 0 ? "down" : "up";
  return null;
}

function directionFromVector(
  vector: Point | null | undefined,
): CardinalDirection | null {
  if (!vector) return null;
  return cardinalDirection({ x: 0, y: 0 }, vector);
}

function opposite(direction: CardinalDirection): CardinalDirection {
  switch (direction) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "up":
      return "down";
    case "down":
      return "up";
  }
}

function continuationScore(
  previous: CardinalDirection | null,
  next: CardinalDirection,
): number {
  if (!previous) return 0;
  if (previous === next) return 6;
  if (opposite(previous) === next) return -6;
  return 0;
}

function endpointScore(
  outward: CardinalDirection | null,
  routeAwayFromEndpoint: CardinalDirection,
): number {
  if (!outward) return 0;
  if (outward === routeAwayFromEndpoint) return 4;
  if (opposite(outward) === routeAwayFromEndpoint) return -4;
  return 0;
}

function elbowScore({
  points,
  segmentIndex,
  elbow,
  startOutward,
  endOutward,
}: {
  points: readonly Point[];
  segmentIndex: number;
  elbow: Point;
  startOutward: CardinalDirection | null;
  endOutward: CardinalDirection | null;
}): number {
  const from = points[segmentIndex]!;
  const to = points[segmentIndex + 1]!;
  const first = cardinalDirection(from, elbow)!;
  const second = cardinalDirection(elbow, to)!;
  let score = continuationScore(
    segmentIndex > 0
      ? cardinalDirection(points[segmentIndex - 1]!, from)
      : null,
    first,
  );
  score += continuationScore(
    second,
    segmentIndex + 2 < points.length
      ? (cardinalDirection(to, points[segmentIndex + 2]!) ?? second)
      : second,
  );
  if (segmentIndex === 0) score += endpointScore(startOutward, first);
  if (segmentIndex === points.length - 2) {
    score += endpointScore(endOutward, opposite(second));
  }
  return score;
}

/** Prefer the elbow that preserves adjacent and terminal directions. */
function preferredElbow(
  points: readonly Point[],
  segmentIndex: number,
  startOutward: CardinalDirection | null,
  endOutward: CardinalDirection | null,
): Point {
  const from = points[segmentIndex]!;
  const to = points[segmentIndex + 1]!;
  const horizontalFirst = { x: to.x, y: from.y };
  const verticalFirst = { x: from.x, y: to.y };
  return elbowScore({
    points,
    segmentIndex,
    elbow: verticalFirst,
    startOutward,
    endOutward,
  }) >
    elbowScore({
      points,
      segmentIndex,
      elbow: horizontalFirst,
      startOutward,
      endOutward,
    })
    ? verticalFirst
    : horizontalFirst;
}

function routeIsProtected(route: RouteBranch): boolean {
  return route.legs.some(
    (leg) => leg.mode === "locked" || leg.mode === "trunk",
  );
}

function repairedRoute(
  source: RouteBranch,
  points: readonly Point[],
  modes: readonly SegmentMode[],
  startOutward: CardinalDirection | null,
  endOutward: CardinalDirection | null,
): RouteBranch {
  const repairedPoints: Point[] = [{ ...points[0]! }];
  const repairedModes: SegmentMode[] = [];
  for (let segmentIndex = 0; segmentIndex < modes.length; segmentIndex += 1) {
    const from = points[segmentIndex]!;
    const to = points[segmentIndex + 1]!;
    const mode = modes[segmentIndex]!;
    if (isNonStandardWireAngle(from, to)) {
      repairedPoints.push(
        preferredElbow(points, segmentIndex, startOutward, endOutward),
      );
      repairedModes.push(mode);
    }
    repairedPoints.push({ ...to });
    repairedModes.push(mode);
  }
  return createRoutePath({
    id: source.id,
    netId: source.netId,
    start: structuredClone(source.start),
    end: structuredClone(routeEnd(source)),
    bends: repairedPoints.slice(1, -1),
    modes: repairedModes,
    ...(source.presentation ? { presentation: source.presentation } : {}),
    ...(source.styleOverride
      ? { styleOverride: structuredClone(source.styleOverride) }
      : {}),
  });
}

/**
 * Build one undoable set of local path repairs for the current Document.
 * Orthogonal and standard 45° segments stay untouched. Locked and trunk
 * Routes are reported for manual repair and never edited.
 */
export function planAngledWireRepairs(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ),
): AngledWireRepairPlan {
  const edits: SchematicEdit[] = [];
  const issues: AngledWireRepairIssue[] = [];
  let angledSegmentCount = 0;
  let repairableSegmentCount = 0;
  let protectedRouteCount = 0;

  for (const route of [...document.routes].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  )) {
    const resolved = routingGeometry.routes.get(route.id);
    if (!resolved) continue;
    const segmentIndexes = resolved.segments
      .filter((segment) => isNonStandardWireAngle(segment.from, segment.to))
      .map((segment) => segment.address.segmentIndex);
    if (segmentIndexes.length === 0) continue;
    angledSegmentCount += segmentIndexes.length;
    const protectedRoute = routeIsProtected(route);
    issues.push({
      routeId: route.id,
      segmentIndexes,
      protected: protectedRoute,
    });
    if (protectedRoute) {
      protectedRouteCount += 1;
      continue;
    }
    repairableSegmentCount += segmentIndexes.length;
    edits.push({
      kind: "set_route_path",
      route: repairedRoute(
        route,
        resolved.centerline,
        resolved.segments.map((segment) => segment.mode),
        directionFromVector(resolved.endpointConnections.from.outward),
        directionFromVector(resolved.endpointConnections.to.outward),
      ),
    });
  }

  return {
    edits,
    issues,
    angledSegmentCount,
    repairableSegmentCount,
    repairableRouteCount: edits.length,
    protectedRouteCount,
  };
}
