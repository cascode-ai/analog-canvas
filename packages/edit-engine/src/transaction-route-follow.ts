import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import {
  polylineSatisfiesConstraint,
  resolveEndpointOutwardDirection,
  resolveEndpointPoint,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { normalizeRouteGeometry } from "./route-geometry-edit.js";
import { resolveRouteEditPath } from "./route-operations.js";
import { pointOnSegment } from "./transaction-routing.js";

export function splitRoute(
  document: SchematicDocument,
  route: RouteBranch,
  splitEndpoint: RouteEndpoint,
  position: Point,
  firstRouteId: string,
  secondRouteId: string,
  segmentIndex: number,
  resolver: SymbolResolver,
): { first: RouteBranch; second: RouteBranch } | string {
  const polyline = resolveRouteEditPath(document, resolver, route);
  if (!polyline) return `Route ${route.id} has an unresolved endpoint`;
  if (segmentIndex >= polyline.points.length - 1) {
    return `Route split segment is out of range: ${segmentIndex}`;
  }
  const vertexIndex = polyline.points.findIndex(
    (point, index) =>
      index > 0 &&
      index < polyline.points.length - 1 &&
      point.x === position.x &&
      point.y === position.y,
  );
  if (vertexIndex > 0) {
    // A manual orthogonal bend is already a geometric vertex, not a point in
    // the interior of either adjoining segment. Splitting it through the
    // ordinary path would introduce a zero-length segment and is rejected by
    // route validation. Partition the existing polyline at the vertex instead.
    const firstNormalized = normalizeRouteGeometry(
      polyline.points.slice(0, vertexIndex + 1),
      route.segmentModes.slice(0, vertexIndex),
    );
    const secondNormalized = normalizeRouteGeometry(
      polyline.points.slice(vertexIndex),
      route.segmentModes.slice(vertexIndex),
    );
    return {
      first: {
        id: firstRouteId,
        netId: route.netId,
        from: structuredClone(route.from),
        to: structuredClone(splitEndpoint),
        waypoints: firstNormalized.points.slice(1, -1),
        segmentModes: firstNormalized.segmentModes,
        ...(route.presentation ? { presentation: route.presentation } : {}),
      },
      second: {
        id: secondRouteId,
        netId: route.netId,
        from: structuredClone(splitEndpoint),
        to: structuredClone(route.to),
        waypoints: secondNormalized.points.slice(1, -1),
        segmentModes: secondNormalized.segmentModes,
        ...(route.presentation ? { presentation: route.presentation } : {}),
      },
    };
  }
  const segmentFrom = polyline.points[segmentIndex]!;
  const segmentTo = polyline.points[segmentIndex + 1]!;
  if (!pointOnSegment(position, segmentFrom, segmentTo)) {
    return `Junction position is not inside route segment ${segmentIndex}`;
  }
  const firstNormalized = normalizeRouteGeometry(
    [...polyline.points.slice(0, segmentIndex + 1), position],
    route.segmentModes.slice(0, segmentIndex + 1),
  );
  const secondNormalized = normalizeRouteGeometry(
    [position, ...polyline.points.slice(segmentIndex + 1)],
    [
      route.segmentModes[segmentIndex]!,
      ...route.segmentModes.slice(segmentIndex + 1),
    ],
  );
  return {
    first: {
      id: firstRouteId,
      netId: route.netId,
      from: structuredClone(route.from),
      to: structuredClone(splitEndpoint),
      waypoints: firstNormalized.points.slice(1, -1),
      segmentModes: firstNormalized.segmentModes,
      ...(route.presentation ? { presentation: route.presentation } : {}),
    },
    second: {
      id: secondRouteId,
      netId: route.netId,
      from: structuredClone(splitEndpoint),
      to: structuredClone(route.to),
      waypoints: secondNormalized.points.slice(1, -1),
      segmentModes: secondNormalized.segmentModes,
      ...(route.presentation ? { presentation: route.presentation } : {}),
    },
  };
}

export function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

export function endpointBelongsToInstance(
  endpoint: RouteEndpoint,
  instanceId: string,
): boolean {
  return endpoint.kind === "terminal" && endpoint.instanceId === instanceId;
}

/**
 * Move one resolved terminal endpoint while preserving the axis of its
 * adjacent persisted segment. This changes geometry only; it never changes
 * Route topology or connectivity.
 */
export function followRouteEndpoint(
  routeId: string,
  points: Point[],
  modes: RouteBranch["segmentModes"],
  side: "from" | "to",
  oldPoint: Point,
  newPoint: Point,
  outward: Point | null,
): void {
  if (samePoint(oldPoint, newPoint)) return;
  const mode = side === "from" ? modes[0] : modes.at(-1);
  if (mode === "locked" || mode === "trunk") {
    throw new Error(`Route ${routeId} has a protected adjacent segment`);
  }
  const endpointIndex = side === "from" ? 0 : points.length - 1;
  points[endpointIndex] = { ...newPoint };
  if (points.length === 2) return;

  const neighborIndex = side === "from" ? 1 : points.length - 2;
  const neighbor = points[neighborIndex]!;
  const oldNeighbor = { ...neighbor };
  if (mode === "escape" && outward) {
    const escapeLength =
      Math.abs(oldNeighbor.x - oldPoint.x) +
      Math.abs(oldNeighbor.y - oldPoint.y);
    neighbor.x = newPoint.x + outward.x * escapeLength;
    neighbor.y = newPoint.y + outward.y * escapeLength;

    const nextIndex = side === "from" ? neighborIndex + 1 : neighborIndex - 1;
    const next = points[nextIndex]!;
    if (neighbor.x !== next.x && neighbor.y !== next.y) {
      // Turn away from the rotated/mirrored escape before reconnecting to the
      // unchanged body. Choosing the perpendicular axis avoids a collinear
      // U-turn that normalization would collapse back toward the pin.
      const bridge =
        outward.x !== 0
          ? { x: neighbor.x, y: next.y }
          : { x: next.x, y: neighbor.y };
      const bridgeModeIndex = side === "from" ? 1 : modes.length - 2;
      const bridgeMode = modes[bridgeModeIndex] ?? "auto";
      points.splice(side === "from" ? nextIndex : neighborIndex, 0, bridge);
      modes.splice(bridgeModeIndex, 1, bridgeMode, bridgeMode);
    }
    return;
  }
  if (oldPoint.x === neighbor.x && oldPoint.y !== neighbor.y) {
    neighbor.x = newPoint.x;
  } else if (oldPoint.y === neighbor.y && oldPoint.x !== neighbor.x) {
    neighbor.y = newPoint.y;
  } else {
    throw new Error(`Route ${routeId} has invalid endpoint geometry`);
  }
}

/**
 * Apply topology-preserving Route geometry after any instance placement
 * transform. The caller supplies the pre-edit snapshot and the transformed
 * draft, making move/rotate/mirror share one behavior at the transaction
 * boundary.
 */
export function applyInstanceRouteFollow(
  draft: SchematicDocument,
  originalDocument: SchematicDocument,
  resolver: SymbolResolver,
  instanceId: string,
  explicitlyAuthoredRouteIds: ReadonlySet<string>,
): string[] {
  return applyInstancesRouteFollow(
    draft,
    originalDocument,
    resolver,
    resolver,
    new Set([instanceId]),
    explicitlyAuthoredRouteIds,
  );
}

/**
 * Generalized route following for a definition-level Symbol change. Original
 * and current resolvers may differ because a child Cell changed its derived
 * pin geometry while each parent Instance and its electrical endpoint stayed
 * the same.
 */
export function applyInstancesRouteFollow(
  draft: SchematicDocument,
  originalDocument: SchematicDocument,
  originalResolver: SymbolResolver,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
  explicitlyAuthoredRouteIds: ReadonlySet<string>,
): string[] {
  const changed: string[] = [];
  for (const originalRoute of originalDocument.routes) {
    if (explicitlyAuthoredRouteIds.has(originalRoute.id)) continue;
    const movesFrom =
      originalRoute.from.kind === "terminal" &&
      instanceIds.has(originalRoute.from.instanceId);
    const movesTo =
      originalRoute.to.kind === "terminal" &&
      instanceIds.has(originalRoute.to.instanceId);
    if (!movesFrom && !movesTo) continue;

    const route = draft.routes.find(
      (candidate) => candidate.id === originalRoute.id,
    );
    const original = resolveRouteEditPath(
      originalDocument,
      originalResolver,
      originalRoute,
    );
    const newFrom = route
      ? resolveEndpointPoint(draft, resolver, route.from)
      : null;
    const newTo = route
      ? resolveEndpointPoint(draft, resolver, route.to)
      : null;
    if (!route || !original || !newFrom || !newTo) continue;

    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    try {
      if (movesFrom) {
        followRouteEndpoint(
          route.id,
          points,
          modes,
          "from",
          original.points[0]!,
          newFrom,
          resolveEndpointOutwardDirection(draft, resolver, route.from),
        );
      }
      if (movesTo) {
        followRouteEndpoint(
          route.id,
          points,
          modes,
          "to",
          original.points.at(-1)!,
          newTo,
          resolveEndpointOutwardDirection(draft, resolver, route.to),
        );
      }
    } catch {
      // Protected or otherwise non-followable geometry remains unchanged;
      // final validation rejects the transaction and names the affected Route.
      // Routes explicitly authored anywhere in this transaction were skipped
      // above, so their edit is the sole geometry authority.
      continue;
    }

    if (points.length === 2 && newFrom.x !== newTo.x && newFrom.y !== newTo.y) {
      const originallyVertical =
        original.points[0]!.x === original.points[1]!.x;
      points.splice(
        1,
        0,
        originallyVertical
          ? { x: newFrom.x, y: newTo.y }
          : { x: newTo.x, y: newFrom.y },
      );
      const mode = modes[0] ?? "manual";
      modes.splice(0, 1, mode, mode);
    }

    const normalized = normalizeRouteGeometry(points, modes);
    // Any heading is legal geometry (ADR 0039), so a follow-stretch is skipped
    // only when it would leave a degenerate segment behind — previously a
    // free-angle Route simply stopped following its instance.
    if (!polylineSatisfiesConstraint(normalized.points, "any-angle")) continue;
    route.waypoints = normalized.points.slice(1, -1);
    route.segmentModes = normalized.segmentModes;
    changed.push(route.id);
  }
  return changed.sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * Converts shared route-follow output into the normal typed edit union. This
 * is intentionally a planner; Project transactions still validate and commit
 * every resulting `set_route_points` edit in the usual way.
 */
export function planInstanceSymbolGeometryRouteFollow(
  document: SchematicDocument,
  originalDocument: SchematicDocument,
  originalResolver: SymbolResolver,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
): Extract<SchematicEdit, { kind: "set_route_points" }>[] {
  const draft = structuredClone(document);
  const changedRouteIds = applyInstancesRouteFollow(
    draft,
    originalDocument,
    originalResolver,
    resolver,
    instanceIds,
    new Set(),
  );
  return changedRouteIds.map((routeId) => {
    const route = draft.routes.find((candidate) => candidate.id === routeId)!;
    return {
      kind: "set_route_points",
      routeId: route.id,
      netId: route.netId,
      from: structuredClone(route.from),
      to: structuredClone(route.to),
      waypoints: structuredClone(route.waypoints),
      segmentModes: [...route.segmentModes],
      ...(route.presentation ? { presentation: route.presentation } : {}),
    };
  });
}
