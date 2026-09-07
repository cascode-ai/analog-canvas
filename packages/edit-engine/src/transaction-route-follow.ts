import { createRoutePath, routeEnd, routeModes } from "@icm/model";
import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SegmentMode,
  SchematicDocument,
} from "@icm/model";
import {
  polylineSatisfiesConstraint,
  resolveEndpointConnection,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import {
  normalizeRouteGeometry,
  usablePinAxis,
  type PinAxis,
} from "./route-geometry-edit.js";
import { rebuildRoutePath } from "./route-leg-mutation.js";
import { resolveRouteEditPath } from "./route-operations.js";
import { pointOnSegment } from "./transaction-routing.js";
import { stretchRouteEndpoint } from "./route-endpoint-stretch.js";

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
      routeModes(route).slice(0, vertexIndex),
    );
    const secondNormalized = normalizeRouteGeometry(
      polyline.points.slice(vertexIndex),
      routeModes(route).slice(vertexIndex),
    );
    const first = createRoutePath({
      id: firstRouteId,
      netId: route.netId,
      start: structuredClone(route.start),
      end: structuredClone(splitEndpoint),
      bends: firstNormalized.points.slice(1, -1),
      modes: firstNormalized.segmentModes,
      ...(route.presentation ? { presentation: route.presentation } : {}),
      ...(route.styleOverride
        ? { styleOverride: structuredClone(route.styleOverride) }
        : {}),
    });
    const second = createRoutePath({
      id: secondRouteId,
      netId: route.netId,
      start: structuredClone(splitEndpoint),
      end: structuredClone(routeEnd(route)),
      bends: secondNormalized.points.slice(1, -1),
      modes: secondNormalized.segmentModes,
      ...(route.presentation ? { presentation: route.presentation } : {}),
      ...(route.styleOverride
        ? { styleOverride: structuredClone(route.styleOverride) }
        : {}),
    });
    adoptSplitIdentities(first, route, 0);
    adoptSplitIdentities(second, route, vertexIndex);
    return {
      first,
      second,
    };
  }
  const segmentFrom = polyline.points[segmentIndex]!;
  const segmentTo = polyline.points[segmentIndex + 1]!;
  if (!pointOnSegment(position, segmentFrom, segmentTo)) {
    return `Junction position is not inside route segment ${segmentIndex}`;
  }
  const firstNormalized = normalizeRouteGeometry(
    [...polyline.points.slice(0, segmentIndex + 1), position],
    routeModes(route).slice(0, segmentIndex + 1),
  );
  const secondNormalized = normalizeRouteGeometry(
    [position, ...polyline.points.slice(segmentIndex + 1)],
    [
      routeModes(route)[segmentIndex]!,
      ...routeModes(route).slice(segmentIndex + 1),
    ],
  );
  const first = createRoutePath({
    id: firstRouteId,
    netId: route.netId,
    start: structuredClone(route.start),
    end: structuredClone(splitEndpoint),
    bends: firstNormalized.points.slice(1, -1),
    modes: firstNormalized.segmentModes,
    ...(route.presentation ? { presentation: route.presentation } : {}),
    ...(route.styleOverride
      ? { styleOverride: structuredClone(route.styleOverride) }
      : {}),
  });
  const second = createRoutePath({
    id: secondRouteId,
    netId: route.netId,
    start: structuredClone(splitEndpoint),
    end: structuredClone(routeEnd(route)),
    bends: secondNormalized.points.slice(1, -1),
    modes: secondNormalized.segmentModes,
    ...(route.presentation ? { presentation: route.presentation } : {}),
    ...(route.styleOverride
      ? { styleOverride: structuredClone(route.styleOverride) }
      : {}),
  });
  adoptSplitIdentities(first, route, 0);
  adoptSplitIdentities(second, route, segmentIndex + 1, true);
  return {
    first,
    second,
  };
}

function adoptSplitIdentities(
  target: RouteBranch,
  source: RouteBranch,
  sourceOffset: number,
  firstLegIsNew = false,
): void {
  for (const [index, leg] of target.legs.entries()) {
    const sourceIndex = sourceOffset + index - (firstLegIsNew ? 1 : 0);
    const sourceLeg = source.legs[sourceIndex];
    if (!sourceLeg || (firstLegIsNew && index === 0)) continue;
    leg.id = sourceLeg.id;
    if (leg.to.kind === "bend" && sourceLeg.to.kind === "bend") {
      leg.to.bendId = sourceLeg.to.bendId;
    }
  }
  if (firstLegIsNew) {
    const splitSource = source.legs[sourceOffset - 1];
    const firstTarget = target.legs[0]?.to;
    if (firstTarget?.kind === "bend" && splitSource?.to.kind === "bend") {
      firstTarget.bendId = splitSource.to.bendId;
    }
  }
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
  modes: SegmentMode[],
  side: "from" | "to",
  oldPoint: Point,
  newPoint: Point,
  outward: Point | null,
  leads?: { from: PinAxis; to: PinAxis; grid: number },
): void {
  stretchRouteEndpoint(
    routeId,
    points,
    modes,
    side,
    oldPoint,
    newPoint,
    leads,
    outward,
  );
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
    const originalEnd = routeEnd(originalRoute);
    if (explicitlyAuthoredRouteIds.has(originalRoute.id)) continue;
    const movesFrom =
      originalRoute.start.kind === "terminal" &&
      instanceIds.has(originalRoute.start.instanceId);
    const movesTo =
      originalEnd.kind === "terminal" &&
      instanceIds.has(originalEnd.instanceId);
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
      ? resolveEndpointConnection(draft, resolver, route.start)
      : null;
    const newTo = route
      ? resolveEndpointConnection(draft, resolver, routeEnd(route))
      : null;
    if (!route || !original || !newFrom || !newTo) continue;

    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    const leads = {
      from: usablePinAxis(
        newFrom.outward,
        newFrom.contactPoint,
        newTo.contactPoint,
      ),
      to: usablePinAxis(
        newTo.outward,
        newTo.contactPoint,
        newFrom.contactPoint,
      ),
      grid: draft.presentation.grid,
    };
    try {
      if (movesFrom) {
        followRouteEndpoint(
          route.id,
          points,
          modes,
          "from",
          original.points[0]!,
          newFrom.contactPoint,
          newFrom.outward,
          leads,
        );
      }
      if (movesTo) {
        followRouteEndpoint(
          route.id,
          points,
          modes,
          "to",
          original.points.at(-1)!,
          newTo.contactPoint,
          newTo.outward,
          leads,
        );
      }
    } catch {
      // Protected or otherwise non-followable geometry remains unchanged;
      // final validation rejects the transaction and names the affected Route.
      // Routes explicitly authored anywhere in this transaction were skipped
      // above, so their edit is the sole geometry authority.
      continue;
    }

    const normalized = normalizeRouteGeometry(points, modes);
    if (normalized.points.length < 2) {
      // A transformed endpoint can land exactly on the Route's other
      // endpoint. Persisting that direct contact as a zero-length Route would
      // violate the canonical one-mode-per-segment invariant. Remove only the
      // redundant geometry; the endpoints and their Net membership remain,
      // so a later transform can materialize an ordinary Route again through
      // the direct-contact lifecycle.
      if (samePoint(newFrom.contactPoint, newTo.contactPoint)) {
        const routeIndex = draft.routes.findIndex(
          (candidate) => candidate.id === route.id,
        );
        if (routeIndex >= 0) draft.routes.splice(routeIndex, 1);
        changed.push(route.id);
      }
      continue;
    }
    // Any heading is legal geometry (ADR 0039), so a follow-stretch is skipped
    // only when it would leave a degenerate segment behind — previously a
    // free-angle Route simply stopped following its instance.
    if (!polylineSatisfiesConstraint(normalized.points, "any-angle")) continue;
    const routeIndex = draft.routes.findIndex(
      (candidate) => candidate.id === route.id,
    );
    draft.routes[routeIndex] = rebuildRoutePath(
      route,
      route.start,
      routeEnd(route),
      normalized.points.slice(1, -1),
      normalized.segmentModes,
      `follow-${draft.revision}`,
    );
    changed.push(route.id);
  }
  return changed.sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * Converts shared route-follow output into the normal typed edit union. This
 * is intentionally a planner; Project transactions still validate and commit
 * every resulting `set_route_path` edit in the usual way.
 */
export function planInstanceSymbolGeometryRouteFollow(
  document: SchematicDocument,
  originalDocument: SchematicDocument,
  originalResolver: SymbolResolver,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
): SchematicEdit[] {
  const draft = structuredClone(document);
  const changedRouteIds = applyInstancesRouteFollow(
    draft,
    originalDocument,
    originalResolver,
    resolver,
    instanceIds,
    new Set(),
  );
  return changedRouteIds.map((routeId): SchematicEdit => {
    const route = draft.routes.find((candidate) => candidate.id === routeId);
    if (!route) return { kind: "remove_route_geometry", routeId };
    return {
      kind: "set_route_path",
      route: structuredClone(route),
    };
  });
}
