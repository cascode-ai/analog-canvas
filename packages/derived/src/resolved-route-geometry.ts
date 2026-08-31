import type {
  Point,
  RouteEndpoint,
  SegmentMode,
  SchematicDocument,
} from "@icm/model";
import { routeEnd } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  type EndpointConnection,
  resolveEndpointConnection,
} from "./endpoint.js";
import { unitDirection } from "./segment-geometry.js";

/** A segment address is valid only for the current document revision. */
export interface RouteSegmentAddress {
  routeId: string;
  legId: string;
  /** Revision-scoped ordered traversal index; never persisted identity. */
  segmentIndex: number;
}

export interface ResolvedRouteSegment {
  address: RouteSegmentAddress;
  from: Point;
  to: Point;
  mode: SegmentMode;
}

export type ResolvedRouteVertexKind =
  "terminal" | "junction" | "bend" | "route-anchor";

export interface ResolvedRouteVertex {
  index: number;
  point: Point;
  kind: ResolvedRouteVertexKind;
}

export type EndpointJoin =
  | {
      kind: "terminal-miter";
      routeId: string;
      at: Point;
      pinOutward: Point;
      routeDirection: Point;
    }
  | {
      kind: "junction-miter";
      junctionId: string;
      at: Point;
      directions: readonly [Point, Point];
    };

export interface ResolvedRouteGeometry {
  routeId: string;
  netId: string;
  centerline: readonly Point[];
  segments: readonly ResolvedRouteSegment[];
  vertices: readonly ResolvedRouteVertex[];
  endpointJoins: readonly EndpointJoin[];
  endpointConnections: Readonly<{
    from: EndpointConnection;
    to: EndpointConnection;
  }>;
}

/** Complete pure routing read model for one Document. */
export interface ResolvedDocumentRoutingGeometry {
  documentId: string;
  documentRevision: number;
  routes: ReadonlyMap<string, ResolvedRouteGeometry>;
  endpointJoins: readonly EndpointJoin[];
}

function vertexKindForEndpoint(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): ResolvedRouteVertexKind {
  if (endpoint.kind === "terminal") return "terminal";
  const junction = document.junctions.find(
    (candidate) => candidate.id === endpoint.junctionId,
  );
  return junction?.role === "route-anchor" ? "route-anchor" : "junction";
}

export function resolveRouteGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: SchematicDocument["routes"][number],
): ResolvedRouteGeometry | null {
  const end = routeEnd(route);
  const fromConnection = resolveEndpointConnection(
    document,
    resolver,
    route.start,
  );
  const toConnection = resolveEndpointConnection(document, resolver, end);
  if (!fromConnection || !toConnection) return null;
  const from = fromConnection.contactPoint;
  const to = toConnection.contactPoint;
  const centerline = [
    from,
    ...route.legs.flatMap((leg) =>
      leg.to.kind === "bend" ? [leg.to.position] : [],
    ),
    to,
  ];
  const segments: ResolvedRouteSegment[] = route.legs.map(
    (leg, segmentIndex) => ({
      address: { routeId: route.id, legId: leg.id, segmentIndex },
      from: centerline[segmentIndex]!,
      to: centerline[segmentIndex + 1]!,
      mode: leg.mode,
    }),
  );
  const vertices: ResolvedRouteVertex[] = centerline.map((point, index) => ({
    index,
    point,
    kind:
      index === 0
        ? vertexKindForEndpoint(document, route.start)
        : index === centerline.length - 1
          ? vertexKindForEndpoint(document, end)
          : "bend",
  }));

  const endpointJoins: EndpointJoin[] = [];
  if (route.start.kind === "terminal" && centerline.length >= 2) {
    const pinOutward = fromConnection.outward;
    const routeDirection = unitDirection(centerline[0]!, centerline[1]!);
    if (pinOutward && routeDirection) {
      endpointJoins.push({
        kind: "terminal-miter",
        routeId: route.id,
        at: centerline[0]!,
        pinOutward,
        routeDirection,
      });
    }
  }
  if (end.kind === "terminal" && centerline.length >= 2) {
    const pinOutward = toConnection.outward;
    const routeDirection = unitDirection(
      centerline.at(-1)!,
      centerline.at(-2)!,
    );
    if (pinOutward && routeDirection) {
      endpointJoins.push({
        kind: "terminal-miter",
        routeId: route.id,
        at: centerline.at(-1)!,
        pinOutward,
        routeDirection,
      });
    }
  }

  return {
    routeId: route.id,
    netId: route.netId,
    centerline,
    segments,
    vertices,
    endpointJoins,
    endpointConnections: { from: fromConnection, to: toConnection },
  };
}

export function resolveDocumentRoutingGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
): ResolvedDocumentRoutingGeometry {
  const routes = new Map<string, ResolvedRouteGeometry>();
  const terminalJoins: EndpointJoin[] = [];
  for (const route of [...document.routes].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  )) {
    const geometry = resolveRouteGeometry(document, resolver, route);
    if (!geometry) continue;
    routes.set(route.id, geometry);
    terminalJoins.push(...geometry.endpointJoins);
  }
  return {
    documentId: document.id,
    documentRevision: document.revision,
    routes,
    endpointJoins: [
      ...terminalJoins,
      ...resolveJunctionJoinsFromGeometry(document, routes),
    ],
  };
}

export function resolveJunctionJoins(
  document: SchematicDocument,
  resolver: SymbolResolver,
): EndpointJoin[] {
  const routes = new Map<string, ResolvedRouteGeometry>();
  for (const route of document.routes) {
    const geometry = resolveRouteGeometry(document, resolver, route);
    if (geometry) routes.set(route.id, geometry);
  }
  return resolveJunctionJoinsFromGeometry(document, routes);
}

function resolveJunctionJoinsFromGeometry(
  document: SchematicDocument,
  routes: ReadonlyMap<string, ResolvedRouteGeometry>,
): EndpointJoin[] {
  const anchors = new Map<string, { point: Point; directions: Point[] }>();
  for (const junction of document.junctions) {
    const role = junction.role ?? "branch";
    if (role === "branch" || role === "route-anchor") {
      anchors.set(junction.id, { point: junction.position, directions: [] });
    }
  }
  const record = (endpoint: RouteEndpoint, point: Point, neighbor: Point) => {
    if (endpoint.kind !== "junction") return;
    const anchor = anchors.get(endpoint.junctionId);
    if (!anchor) return;
    const direction = unitDirection(point, neighbor);
    if (direction) anchor.directions.push(direction);
  };
  for (const route of document.routes) {
    const centerline = routes.get(route.id)?.centerline;
    if (!centerline || centerline.length < 2) continue;
    record(route.start, centerline[0]!, centerline[1]!);
    record(routeEnd(route), centerline.at(-1)!, centerline.at(-2)!);
  }
  return [...anchors.entries()]
    .filter(([, anchor]) => anchor.directions.length === 2)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([junctionId, anchor]): EndpointJoin => ({
      kind: "junction-miter",
      junctionId,
      at: anchor.point,
      directions: [anchor.directions[0]!, anchor.directions[1]!] as readonly [
        Point,
        Point,
      ],
    }));
}
