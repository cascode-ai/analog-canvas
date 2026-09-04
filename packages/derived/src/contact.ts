import { deriveStableId, routeEnd } from "@icm/model";
import type { Net, Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  endpointKey,
  isVisibleEndpoint,
  netEndpoints,
  resolveEndpointOutwardDirection,
  resolveEndpointPoint,
  type EndpointConnection,
  type EndpointObjectLookup,
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

/**
 * One pairwise projection of a confirmed same-Net {@link CoincidentContact}.
 * It is the transform-time input used to detect when a previously confirmed
 * direct contact has been separated. Gained contacts are committed by the Edit
 * Engine's transaction connectivity normalizer; this read model continues to
 * describe only already-confirmed same-Net contacts.
 */
export interface DirectContactPair {
  id: string;
  netId: string;
  point: Point;
  endpoints: readonly [RouteEndpoint, RouteEndpoint];
}

export interface DirectContactDelta {
  gained: readonly DirectContactPair[];
  lost: readonly DirectContactPair[];
  retained: readonly DirectContactPair[];
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function directContactPairs(
  document: SchematicDocument,
  resolver: SymbolResolver,
): DirectContactPair[] {
  const pairs: DirectContactPair[] = [];
  for (const contact of deriveDocumentContactEvidence(document, resolver)
    .contacts) {
    for (let leftIndex = 0; leftIndex < contact.endpoints.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < contact.endpoints.length;
        rightIndex++
      ) {
        const left = contact.endpoints[leftIndex]!;
        const right = contact.endpoints[rightIndex]!;
        pairs.push({
          id: [endpointKey(left), endpointKey(right)]
            .sort((a, b) => a.localeCompare(b, "en"))
            .join("|"),
          netId: contact.netId,
          point: { ...contact.point },
          endpoints: [left, right],
        });
      }
    }
  }
  return pairs.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

/**
 * Compare confirmed direct contacts across one projected edit. Pair identity
 * is endpoint-based, so two endpoints translated together are retained even
 * though their page coordinate changes.
 */
export function deriveDirectContactDelta(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
): DirectContactDelta {
  const beforePairs = directContactPairs(before, resolver);
  const afterPairs = directContactPairs(after, resolver);
  const beforeById = new Map(beforePairs.map((pair) => [pair.id, pair]));
  const afterById = new Map(afterPairs.map((pair) => [pair.id, pair]));
  return {
    gained: afterPairs.filter((pair) => !beforeById.has(pair.id)),
    lost: beforePairs.filter((pair) => !afterById.has(pair.id)),
    retained: afterPairs.filter((pair) => beforeById.has(pair.id)),
  };
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

/**
 * Directions of a same-Net conductor whose interior runs through `point`.
 * A route the model never split still reads as one continuous wire under a
 * parked endpoint, so the visual branch needs its two through arms counted.
 * Pure crossings stay out: with no endpoint at the point there is no contact
 * to attach these directions to.
 */
function routeThroughDirections(
  centerline: readonly Point[],
  point: Point,
): Point[] {
  for (let index = 1; index < centerline.length - 1; index += 1) {
    const vertex = centerline[index]!;
    if (vertex.x === point.x && vertex.y === point.y) {
      return [
        {
          x: Math.sign(centerline[index - 1]!.x - point.x),
          y: Math.sign(centerline[index - 1]!.y - point.y),
        },
        {
          x: Math.sign(centerline[index + 1]!.x - point.x),
          y: Math.sign(centerline[index + 1]!.y - point.y),
        },
      ];
    }
  }
  for (let index = 0; index < centerline.length - 1; index += 1) {
    const from = centerline[index]!;
    const to = centerline[index + 1]!;
    const cross =
      (to.x - from.x) * (point.y - from.y) -
      (to.y - from.y) * (point.x - from.x);
    if (cross !== 0) continue;
    const dot =
      (point.x - from.x) * (to.x - from.x) +
      (point.y - from.y) * (to.y - from.y);
    const length =
      (to.x - from.x) * (to.x - from.x) + (to.y - from.y) * (to.y - from.y);
    if (dot <= 0 || dot >= length) continue;
    return [
      { x: Math.sign(from.x - point.x), y: Math.sign(from.y - point.y) },
      { x: Math.sign(to.x - point.x), y: Math.sign(to.y - point.y) },
    ];
  }
  return [];
}

function routeEndpointDirections(
  route: SchematicDocument["routes"][number],
  centerline: readonly Point[],
  endpointKeys: ReadonlySet<string>,
): Point[] {
  const directions: Point[] = [];
  if (centerline.length < 2) return directions;
  if (endpointKeys.has(endpointKey(route.start))) {
    directions.push({
      x: Math.sign(centerline[1]!.x - centerline[0]!.x),
      y: Math.sign(centerline[1]!.y - centerline[0]!.y),
    });
  }
  if (endpointKeys.has(endpointKey(routeEnd(route)))) {
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
  endpoints: readonly RouteEndpoint[],
  point: Point,
  geometry: ResolvedDocumentRoutingGeometry,
  routesForNet: readonly SchematicDocument["routes"][number][],
  endpointConnections?: ReadonlyMap<string, EndpointConnection>,
): ContactIncident[] {
  const incidents: ContactIncident[] = [];
  const explicitEndpointKeys = new Set(endpoints.map(endpointKey));
  for (const route of routesForNet) {
    const centerline = geometry.routes.get(route.id)?.centerline;
    if (!centerline) continue;
    const endpointDirections = routeEndpointDirections(
      route,
      centerline,
      explicitEndpointKeys,
    );
    for (const direction of endpointDirections) {
      incidents.push({ kind: "route", objectId: route.id, direction });
    }
    if (endpointDirections.length === 0) {
      for (const direction of routeThroughDirections(centerline, point)) {
        incidents.push({ kind: "route", objectId: route.id, direction });
      }
    }
  }
  for (const endpoint of endpoints) {
    if (endpoint.kind !== "terminal") continue;
    const outward =
      endpointConnections?.get(endpointKey(endpoint))?.outward ??
      resolveEndpointOutwardDirection(document, resolver, endpoint);
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
  routesForNet: readonly SchematicDocument["routes"][number][],
  endpointConnections?: ReadonlyMap<string, EndpointConnection>,
  endpointLookup?: EndpointObjectLookup,
): CoincidentContact[] {
  const grouped = new Map<
    string,
    Array<{ endpoint: RouteEndpoint; point: Point }>
  >();
  for (const endpoint of netEndpoints(document, net)) {
    if (!isVisibleEndpoint(document, resolver, endpoint, endpointLookup)) {
      continue;
    }
    const point =
      endpointConnections?.get(endpointKey(endpoint))?.contactPoint ??
      resolveEndpointPoint(document, resolver, endpoint, endpointLookup);
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
        endpoints,
        point,
        geometry,
        routesForNet,
        endpointConnections,
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
  options: {
    routesByNetId?: ReadonlyMap<
      string,
      readonly SchematicDocument["routes"][number][]
    >;
    endpointConnections?: ReadonlyMap<string, EndpointConnection>;
    endpointLookup?: EndpointObjectLookup;
  } = {},
): DocumentContactEvidence {
  const routesByNetId =
    options.routesByNetId ??
    (() => {
      const grouped = new Map<string, SchematicDocument["routes"][number][]>();
      for (const route of document.routes) {
        const routes = grouped.get(route.netId) ?? [];
        routes.push(route);
        grouped.set(route.netId, routes);
      }
      return grouped;
    })();
  const contacts = [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((net) =>
      netContacts(
        document,
        resolver,
        net,
        routingGeometry,
        routesByNetId.get(net.id) ?? [],
        options.endpointConnections,
        options.endpointLookup,
      ),
    );
  const byEndpointKey = new Map<string, CoincidentContact>();
  for (const contact of contacts) {
    for (const endpoint of contact.endpoints) {
      byEndpointKey.set(endpointKey(endpoint), contact);
    }
  }
  return { contacts, byEndpointKey };
}
