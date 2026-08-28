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
}

export interface WireCanvasSnapResult {
  point: Point;
  endpoint?: WireSource;
  route?: { routeId: string; segmentIndex: number; point: Point };
  ambiguous?: boolean;
  guides: SnapGuideLine[];
}

/** Resolve one wire-canvas pointer to a grid, endpoint, or routed conductor. */
/**
 * How far a leg may drift off one axis before it counts as a deliberate turn.
 */
const AXIS_LOCK_RATIO = 1 / 3;

/**
 * Hold a free leg to a single axis.
 *
 * A hand that drifts a grid sideways while pulling a wire down turned the leg
 * into a corner, and at the next click the wire folded back over the line it
 * had just drawn. A leg that is overwhelmingly one direction is meant to be
 * that direction. A deliberate diagonal, where both components are
 * comparable, still opens a corner — that is what the corner-order modes are
 * for.
 */
function holdLegToOneAxis(from: Point, to: Point): Point {
  const alongX = Math.abs(to.x - from.x);
  const alongY = Math.abs(to.y - from.y);
  if (alongX === 0 || alongY === 0) return to;
  if (alongY > alongX && alongX <= alongY * AXIS_LOCK_RATIO) {
    return { x: from.x, y: to.y };
  }
  if (alongX > alongY && alongY <= alongX * AXIS_LOCK_RATIO) {
    return { x: to.x, y: from.y };
  }
  return to;
}

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
  const routeTargets = routeGeometryRecords.flatMap(({ route, geometry }) =>
    geometry.centerline.slice(0, -1).map((from, segmentIndex) => ({
      anchor: {
        id: `wire-route:${route.id}:${segmentIndex}`,
        point: routeTapPoint(
          point,
          from,
          geometry.centerline[segmentIndex + 1]!,
          document.presentation.grid,
          arrival,
        ),
        kind: "route" as const,
      },
      routeId: route.id,
      segmentIndex,
    })),
  );
  const endpointTargets = wiringEndpoints.map((source) => ({
    source,
    anchor: endpointSnapAnchor(source),
  }));
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
        netId: document.routes.find((route) => route.id === candidate.routeId)!
          .netId,
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
  // Only a landing that hit nothing is free to be straightened; a leg aimed at
  // a terminal, a junction, or a route has to reach it exactly.
  const landing =
    !endpoint && !route && !ambiguous && arrival
      ? holdLegToOneAxis(arrival, snappedPoint)
      : snappedPoint;
  return {
    point: landing,
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
