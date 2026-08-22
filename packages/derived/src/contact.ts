import { deriveStableId } from "@icm/model";
import type { Net, Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  endpointKey,
  isVisibleEndpoint,
  netEndpoints,
  resolveEndpointOutwardDirection,
  resolveEndpointPoint,
} from "./endpoint.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";

export interface ContactIncident {
  kind: "route" | "terminal";
  objectId: string;
  direction: Point;
}

/**
 * One derived electrical contact between explicit graph nodes on the same Net.
 *
 * Contact locations come only from explicit same-Net endpoints. Route arms
 * contribute only when the Route explicitly references one of those
 * endpoints; a same-Net segment that merely passes through the coordinate is
 * still a geometric crossing. This is the shared evidence used by visible
 * connectivity, junction rendering, and diagnostics.
 */
export interface CoincidentContact {
  id: string;
  netId: string;
  point: Point;
  endpoints: readonly RouteEndpoint[];
  incidents: readonly ContactIncident[];
  /** Distinct visible directions across both Route arms and terminal stems. */
  branchDirections: readonly Point[];
}

export interface DocumentContactEvidence {
  contacts: readonly CoincidentContact[];
  byEndpointKey: ReadonlyMap<string, CoincidentContact>;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function directionKey(direction: Point): string {
  return `${Math.sign(direction.x)},${Math.sign(direction.y)}`;
}

function inverseAxisDirection(direction: Point): Point {
  return {
    x: direction.x === 0 ? 0 : -Math.sign(direction.x),
    y: direction.y === 0 ? 0 : -Math.sign(direction.y),
  };
}

function routeEndpointDirections(
  route: SchematicDocument["routes"][number],
  centerline: readonly Point[],
  endpointKeys: ReadonlySet<string>,
): Point[] {
  const directions: Point[] = [];
  if (centerline.length < 2) return directions;
  if (endpointKeys.has(endpointKey(route.from))) {
    directions.push({
      x: Math.sign(centerline[1]!.x - centerline[0]!.x),
      y: Math.sign(centerline[1]!.y - centerline[0]!.y),
    });
  }
  if (endpointKeys.has(endpointKey(route.to))) {
    directions.push({
      x: Math.sign(centerline.at(-2)!.x - centerline.at(-1)!.x),
      y: Math.sign(centerline.at(-2)!.y - centerline.at(-1)!.y),
    });
  }
  return directions;
}

function contactIncidents(
  document: SchematicDocument,
  resolver: SymbolResolver,
  netId: string,
  endpoints: readonly RouteEndpoint[],
  geometry: ResolvedDocumentRoutingGeometry,
): ContactIncident[] {
  const incidents: ContactIncident[] = [];
  const explicitEndpointKeys = new Set(endpoints.map(endpointKey));
  for (const route of document.routes) {
    if (route.netId !== netId) continue;
    const centerline = geometry.routes.get(route.id)?.centerline;
    if (!centerline) continue;
    for (const direction of routeEndpointDirections(
      route,
      centerline,
      explicitEndpointKeys,
    )) {
      incidents.push({ kind: "route", objectId: route.id, direction });
    }
  }
  for (const endpoint of endpoints) {
    if (endpoint.kind !== "terminal") continue;
    const outward = resolveEndpointOutwardDirection(
      document,
      resolver,
      endpoint,
    );
    if (outward) {
      incidents.push({
        kind: "terminal",
        objectId: endpoint.instanceId,
        direction: inverseAxisDirection(outward),
      });
    }
  }
  return incidents.sort(
    (left, right) =>
      directionKey(left.direction).localeCompare(
        directionKey(right.direction),
        "en",
      ) ||
      left.kind.localeCompare(right.kind, "en") ||
      left.objectId.localeCompare(right.objectId, "en"),
  );
}

function netContacts(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: Net,
  geometry: ResolvedDocumentRoutingGeometry,
): CoincidentContact[] {
  const grouped = new Map<
    string,
    Array<{ endpoint: RouteEndpoint; point: Point }>
  >();
  for (const endpoint of netEndpoints(document, net)) {
    if (!isVisibleEndpoint(document, resolver, endpoint)) continue;
    const point = resolveEndpointPoint(document, resolver, endpoint);
    if (!point) continue;
    const key = pointKey(point);
    grouped.set(key, [...(grouped.get(key) ?? []), { endpoint, point }]);
  }
  return [...grouped.values()]
    .map((entries) => {
      const endpoints = entries
        .map((entry) => entry.endpoint)
        .sort((left, right) =>
          endpointKey(left).localeCompare(endpointKey(right), "en"),
        );
      const point = entries[0]!.point;
      const incidents = contactIncidents(
        document,
        resolver,
        net.id,
        endpoints,
        geometry,
      );
      const directions = new Map<string, Point>();
      for (const incident of incidents) {
        directions.set(directionKey(incident.direction), incident.direction);
      }
      return {
        id: deriveStableId(
          "contact",
          net.id,
          pointKey(point),
          endpoints.map(endpointKey).join("|"),
        ),
        netId: net.id,
        point: { ...point },
        endpoints,
        incidents,
        branchDirections: [...directions.values()],
      };
    })
    .sort(
      (left, right) =>
        left.netId.localeCompare(right.netId, "en") ||
        left.point.x - right.point.x ||
        left.point.y - right.point.y ||
        left.id.localeCompare(right.id, "en"),
    );
}

/**
 * Whether a confirmed same-Net contact needs a visible junction dot.
 *
 * A dot communicates a visible branch, not the number of model objects at a
 * contact. Route arms and terminal stems that leave in the same direction
 * paint as one conductor. A straight join, a corner, and a terminal stem that
 * is collinear with a through-wire therefore remain dotless. Three distinct
 * visible directions require a dot. Three coincident terminals also require a
 * dot even when some symbol stems overlap geometrically.
 */
export function contactRequiresJunctionDot(
  contact: CoincidentContact,
): boolean {
  const terminalCount = contact.endpoints.filter(
    (endpoint) => endpoint.kind === "terminal",
  ).length;
  return terminalCount >= 3 || contact.branchDirections.length >= 3;
}

export function deriveDocumentContactEvidence(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry = resolveDocumentRoutingGeometry(document, resolver),
): DocumentContactEvidence {
  const contacts = [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((net) => netContacts(document, resolver, net, routingGeometry));
  const byEndpointKey = new Map<string, CoincidentContact>();
  for (const contact of contacts) {
    for (const endpoint of contact.endpoints) {
      byEndpointKey.set(endpointKey(endpoint), contact);
    }
  }
  return { contacts, byEndpointKey };
}
