import {
  createRoutePath,
  electricalConnectionGrid,
  routeEnd,
  routeModes,
  snapGridPoint,
} from "@icm/model";
import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SegmentMode,
  SchematicDocument,
} from "@icm/model";
import {
  deriveInternalGroupSelection,
  endpointKey,
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
import {
  resolveRouteEditPath,
  smoothRouteAfterInstanceTransform,
} from "./route-operations.js";
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
      ...(route.documentStyle ? { documentStyle: route.documentStyle } : {}),
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
      ...(route.documentStyle ? { documentStyle: route.documentStyle } : {}),
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
    ...(route.documentStyle ? { documentStyle: route.documentStyle } : {}),
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
    ...(route.documentStyle ? { documentStyle: route.documentStyle } : {}),
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

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * Move one resolved terminal endpoint while preserving the axis of its
 * adjacent persisted segment. This changes geometry only; it never changes
 * Route topology or connectivity.
 */
function followRouteEndpoint(
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
 * Wiring that hangs only from parts this transaction slides by one offset
 * travels with them, rigidly (#1308): an open stub from a pin keeps its
 * shape, its bends, its open Junctions and its labels, as the movement
 * closure carries it in a selection move. Stretching it instead dragged the
 * pin end along and left the open end behind, folding the stub back through
 * the part. A component reaching any other pin, a part that also turns,
 * mirrors or changes its pins, an offset off the electrical lattice, geometry
 * this transaction states itself, or a locked segment is left to the
 * ordinary follow. Returns the carried Route IDs.
 */
export function carryTranslatedRouteComponents(
  draft: SchematicDocument,
  originalDocument: SchematicDocument,
  instanceIds: ReadonlySet<string>,
  authoredRouteIds: ReadonlySet<string>,
  movedJunctionIds: ReadonlySet<string>,
  changedObjectIds: Set<string>,
): Set<string> {
  const lattice = electricalConnectionGrid(draft.presentation.grid);
  const groups = new Map<string, { delta: Point; instanceIds: string[] }>();
  for (const id of instanceIds) {
    const before = originalDocument.instances.find((item) => item.id === id);
    const after = draft.instances.find((item) => item.id === id);
    const from = before?.placement;
    const to = after?.placement;
    if (
      !before ||
      !after ||
      !from ||
      !to ||
      from.rotation !== to.rotation ||
      from.mirror !== to.mirror ||
      before.symbolId !== after.symbolId ||
      before.symbolVariantId !== after.symbolVariantId ||
      JSON.stringify(before.signalFlowParameters) !==
        JSON.stringify(after.signalFlowParameters)
    )
      continue;
    const delta = {
      x: to.position.x - from.position.x,
      y: to.position.y - from.position.y,
    };
    if (
      (delta.x === 0 && delta.y === 0) ||
      delta.x % lattice !== 0 ||
      delta.y % lattice !== 0
    )
      continue;
    const key = `${delta.x},${delta.y}`;
    const group = groups.get(key) ?? { delta, instanceIds: [] };
    group.instanceIds.push(id);
    groups.set(key, group);
  }
  const carried = new Set<string>();
  for (const { delta, instanceIds: members } of groups.values()) {
    const internal = new Set(
      deriveInternalGroupSelection(draft, members).routeIds,
    );
    const routes = draft.routes.filter((route) => internal.has(route.id));
    // Components of the internal wiring, joined where Routes share an end.
    const byEndpoint = new Map<string, RouteBranch[]>();
    for (const route of routes)
      for (const endpoint of [route.start, routeEnd(route)]) {
        const key = endpointKey(endpoint);
        byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), route]);
      }
    const seen = new Set<string>();
    for (const seed of routes) {
      if (seen.has(seed.id)) continue;
      const component: RouteBranch[] = [];
      const queue = [seed];
      seen.add(seed.id);
      while (queue.length) {
        const route = queue.shift()!;
        component.push(route);
        for (const endpoint of [route.start, routeEnd(route)])
          for (const next of byEndpoint.get(endpointKey(endpoint)) ?? [])
            if (!seen.has(next.id)) {
              seen.add(next.id);
              queue.push(next);
            }
      }
      const junctionIds = new Set(
        component.flatMap((route) =>
          [route.start, routeEnd(route)].flatMap((endpoint) =>
            endpoint.kind === "junction" ? [endpoint.junctionId] : [],
          ),
        ),
      );
      if (
        component.some(
          (route) =>
            authoredRouteIds.has(route.id) ||
            route.legs.some(
              (leg) => leg.mode === "locked" || leg.mode === "trunk",
            ),
        ) ||
        [...junctionIds].some((id) => movedJunctionIds.has(id))
      )
        continue;
      for (const route of component) {
        for (const leg of route.legs)
          if (leg.to.kind === "bend")
            leg.to.position = {
              x: leg.to.position.x + delta.x,
              y: leg.to.position.y + delta.y,
            };
        carried.add(route.id);
        changedObjectIds.add(route.id);
      }
      for (const junction of draft.junctions)
        if (junctionIds.has(junction.id)) {
          junction.position = {
            x: junction.position.x + delta.x,
            y: junction.position.y + delta.y,
          };
          changedObjectIds.add(junction.id);
        }
    }
  }
  return carried;
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
    let movesFrom =
      originalRoute.start.kind === "terminal" &&
      instanceIds.has(originalRoute.start.instanceId);
    let movesTo =
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

    const oldFrom = resolveEndpointConnection(
      originalDocument,
      originalResolver,
      originalRoute.start,
    );
    const oldTo = resolveEndpointConnection(
      originalDocument,
      originalResolver,
      originalEnd,
    );
    const sameConnection = (before: typeof oldFrom, after: typeof newFrom) =>
      before !== null &&
      samePoint(before.contactPoint, after.contactPoint) &&
      (before.outward === null
        ? after.outward === null
        : after.outward !== null && samePoint(before.outward, after.outward));
    movesFrom = movesFrom && !sameConnection(oldFrom, newFrom);
    movesTo = movesTo && !sameConnection(oldTo, newTo);
    // A definition's model or interface spelling can change without moving
    // its contacts. Preserve authored geometry in that case.
    if (!movesFrom && !movesTo) continue;

    const points = original.points.map((point) => ({ ...point }));
    const modes = [...original.segmentModes];
    const coarseGrid = draft.presentation.grid;
    const needsFineGrid = [
      newFrom.gridLanding,
      newTo.gridLanding,
      ...original.points.slice(1, -1),
    ].some((point) => point.x % coarseGrid !== 0 || point.y % coarseGrid !== 0);
    const routeGrid = needsFineGrid
      ? electricalConnectionGrid(coarseGrid)
      : coarseGrid;
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
      grid: routeGrid,
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

    const stretched = normalizeRouteGeometry(points, modes);
    const touchesSlantedInstance = [originalRoute.start, originalEnd].some(
      (endpoint) => {
        if (
          endpoint.kind !== "terminal" ||
          !instanceIds.has(endpoint.instanceId)
        )
          return false;
        const originalRotation = originalDocument.instances.find(
          (instance) => instance.id === endpoint.instanceId,
        )?.placement?.rotation;
        const movedRotation = draft.instances.find(
          (instance) => instance.id === endpoint.instanceId,
        )?.placement?.rotation;
        return (
          (originalRotation !== undefined && originalRotation % 90 !== 0) ||
          (movedRotation !== undefined && movedRotation % 90 !== 0)
        );
      },
    );
    let normalized = stretched;
    if (stretched.points.length >= 2 && touchesSlantedInstance) {
      const smoothed = smoothRouteAfterInstanceTransform(
        originalDocument,
        draft,
        resolver,
        instanceIds,
        originalRoute,
        original.points.length - 2,
        {
          routeId: route.id,
          waypoints: stretched.points.slice(1, -1),
          segmentModes: stretched.segmentModes,
        },
        stretched.points.length - 2,
      );
      normalized = normalizeRouteGeometry(
        [newFrom.contactPoint, ...smoothed.waypoints, newTo.contactPoint],
        smoothed.segmentModes,
      );
    }
    if (normalized.points.length >= 2) {
      // Rotated terminal contacts are exact derived geometry and may be
      // fractional. Endpoint stretch uses those contacts to preserve the pin
      // lead, but every intermediate point becomes a persisted Route bend and
      // therefore must return to the applicable electrical lattice before commit.
      normalized = normalizeRouteGeometry(
        [
          normalized.points[0]!,
          ...normalized.points
            .slice(1, -1)
            .map((point) => snapGridPoint(point, routeGrid)),
          normalized.points.at(-1)!,
        ],
        normalized.segmentModes,
      );
    }
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
