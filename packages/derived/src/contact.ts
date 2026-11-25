import {
  deriveStableId,
  routeEnd,
  routeElectricalConnections,
} from "@icm/model";
import type { Net, Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { DocumentSpatialIndex } from "./spatial-index.js";

import {
  buildEndpointObjectLookup,
  endpointKey,
  isVisibleEndpoint,
  netEndpoints,
  indexJunctionsByNet,
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
  evidence?: DocumentContactEvidence,
): DirectContactPair[] {
  const pairs: DirectContactPair[] = [];
  for (const contact of (
    evidence ?? deriveDocumentContactEvidence(document, resolver)
  ).contacts) {
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
  evidence?: {
    before?: DocumentContactEvidence;
    after?: DocumentContactEvidence;
  },
): DirectContactDelta {
  const beforePairs = directContactPairs(before, resolver, evidence?.before);
  const afterPairs = directContactPairs(after, resolver, evidence?.after);
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
  endpointLookup?: EndpointObjectLookup,
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
      resolveEndpointOutwardDirection(
        document,
        resolver,
        endpoint,
        endpointLookup,
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

/** Coincidence among one Net's explicit visible endpoints. The edit graph
 * uses the same contacts as scene derivation without resolving route arms. */
export function groupCoincidentEndpoints(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoints: readonly RouteEndpoint[],
  endpointLookup: EndpointObjectLookup | undefined,
  endpointConnections?: ReadonlyMap<string, EndpointConnection>,
) {
  const byPoint = new Map<
    string,
    { point: Point; endpoints: RouteEndpoint[] }
  >();
  for (const endpoint of endpoints) {
    if (!isVisibleEndpoint(document, resolver, endpoint, endpointLookup)) {
      continue;
    }
    const point =
      endpointConnections?.get(endpointKey(endpoint))?.contactPoint ??
      resolveEndpointPoint(document, resolver, endpoint, endpointLookup);
    if (!point) continue;
    const key = pointKey(point);
    const group = byPoint.get(key) ?? { point, endpoints: [] };
    group.endpoints.push(endpoint);
    byPoint.set(key, group);
  }
  return byPoint.values();
}

const SPATIAL_CONTACT_ROUTE_THRESHOLD = 32;

interface ContactContext {
  document: SchematicDocument;
  resolver: SymbolResolver;
  geometry: ResolvedDocumentRoutingGeometry;
  endpointLookup: EndpointObjectLookup;
  endpointConnections: ReadonlyMap<string, EndpointConnection> | undefined;
  routeLookup:
    | {
        spatialIndex: DocumentSpatialIndex;
        routesById: ReadonlyMap<string, SchematicDocument["routes"][number]>;
      }
    | undefined;
}

function netContacts(
  context: ContactContext,
  net: Net,
  routesForNet: readonly SchematicDocument["routes"][number][],
  junctionsForNet: readonly SchematicDocument["junctions"][number][],
): CoincidentContact[] {
  const {
    document,
    resolver,
    geometry,
    endpointLookup,
    endpointConnections,
    routeLookup,
  } = context;
  return [
    ...groupCoincidentEndpoints(
      document,
      resolver,
      netEndpoints(document, net, junctionsForNet),
      endpointLookup,
      endpointConnections,
    ),
  ]
    .map(({ endpoints, point }) => {
      // Scanning a small Net is cheaper than querying all spatial buckets.
      // Larger Nets reuse the context's already-built broad-phase index.
      const nearbyRoutes =
        routeLookup && routesForNet.length > SPATIAL_CONTACT_ROUTE_THRESHOLD
          ? [
              ...new Set(
                routeLookup.spatialIndex.routeSegments
                  .queryPoint(point)
                  .map((segment) => segment.routeId),
              ),
            ].flatMap((id) => {
              const route = routeLookup.routesById.get(id);
              return route &&
                routeElectricalConnections(route).some(
                  (edge) => edge.netId === net.id,
                )
                ? [route]
                : [];
            })
          : routesForNet;
      const incidents = contactIncidents(
        document,
        resolver,
        endpoints,
        point,
        geometry,
        nearbyRoutes,
        endpointConnections,
        endpointLookup,
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

interface ContactLookups {
  junctionsByNetId?: ReturnType<typeof indexJunctionsByNet>;
  routesByNetId?: ReadonlyMap<
    string,
    readonly SchematicDocument["routes"][number][]
  >;
  endpointConnections?: ReadonlyMap<string, EndpointConnection>;
  endpointLookup?: EndpointObjectLookup;
  spatialIndex?: DocumentSpatialIndex;
  routesById?: ReadonlyMap<string, SchematicDocument["routes"][number]>;
}

// At most one contact result per structurally shared Net. No entry owns a
// Project, Document or resolver, so closing a Project releases its history.
type ContactDependency = object | number | boolean;
const contactCache = new WeakMap<
  Net,
  { dependencies: ContactDependency[]; contacts: CoincidentContact[] }
>();

// All records and points returned by netContacts belong to this derivation.
// Freezing these small JSON trees needs no model snapshot ownership tracking.
function freezeContactData(value: object): void {
  if (Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value) as unknown[]) {
    if (child !== null && typeof child === "object") freezeContactData(child);
  }
}

function netContactDependencies(
  context: ContactContext,
  net: Net,
  routes: readonly SchematicDocument["routes"][number][],
  junctions: readonly SchematicDocument["junctions"][number][],
): ContactDependency[] | undefined {
  const { document, resolver, geometry, endpointLookup, endpointConnections } =
    context;
  // The small-Net calculation reads only its own routes. The spatial path
  // queries a Document-wide index and retains its ordinary derivation.
  if (!endpointConnections || routes.length > SPATIAL_CONTACT_ROUTE_THRESHOLD)
    return;
  const dependencies: ContactDependency[] = [junctions.length, routes.length];
  for (const junction of junctions) {
    if (
      junction.members ||
      junction.contactAnchor ||
      // Legacy scalar IDs can spell another endpoint's encoded bus member.
      // Only the effective indexed point establishes this row as the source.
      endpointConnections.get(
        endpointKey({ kind: "junction", junctionId: junction.id }),
      )?.contactPoint !== junction.position
    )
      return;
    dependencies.push(junction);
  }
  for (const route of routes) {
    const resolved = geometry.routes.get(route.id);
    if (route.members || !resolved) return;
    // The same Route row can land differently after a connected part moves.
    dependencies.push(route, resolved);
  }
  for (const terminal of net.terminals) {
    if (terminal.memberId !== undefined) return;
    const endpoint = { kind: "terminal" as const, ...terminal };
    const visible = isVisibleEndpoint(
      document,
      resolver,
      endpoint,
      endpointLookup,
    );
    dependencies.push(visible);
    if (!visible) continue;
    // A symbol or hidden-bulk policy can change without changing the Net.
    const connection = endpointConnections.get(endpointKey(endpoint));
    if (!connection?.outward) return;
    dependencies.push(
      connection.contactPoint.x,
      connection.contactPoint.y,
      connection.outward.x,
      connection.outward.y,
    );
  }
  return dependencies;
}

export function deriveDocumentContactEvidence(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry = resolveDocumentRoutingGeometry(document, resolver),
  options: ContactLookups = {},
): DocumentContactEvidence {
  return collectDocumentContactEvidence(
    document,
    resolver,
    routingGeometry,
    options,
    false,
  );
}

/** Only the canonical immutable derived context can supply reusable inputs. */
export function collectDocumentContactEvidence(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  options: ContactLookups,
  reuseSnapshotContacts: boolean,
): DocumentContactEvidence {
  const endpointLookup =
    options.endpointLookup ?? buildEndpointObjectLookup(document);
  const routeLookup = options.spatialIndex
    ? {
        spatialIndex: options.spatialIndex,
        routesById:
          options.routesById ??
          new Map(document.routes.map((route) => [route.id, route])),
      }
    : undefined;
  const routesByNetId =
    options.routesByNetId ??
    (() => {
      const grouped = new Map<string, SchematicDocument["routes"][number][]>();
      for (const route of document.routes) {
        for (const netId of new Set(
          routeElectricalConnections(route).map((edge) => edge.netId),
        )) {
          const routes = grouped.get(netId) ?? [];
          routes.push(route);
          grouped.set(netId, routes);
        }
      }
      return grouped;
    })();
  const junctionsByNetId =
    options.junctionsByNetId ?? indexJunctionsByNet(document.junctions);
  const context: ContactContext = {
    document,
    resolver,
    geometry: routingGeometry,
    endpointLookup,
    endpointConnections: options.endpointConnections,
    routeLookup,
  };
  const contacts = [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((net) => {
      const routes = routesByNetId.get(net.id) ?? [];
      const junctions = junctionsByNetId.get(net.id) ?? [];
      const dependencies = reuseSnapshotContacts
        ? netContactDependencies(context, net, routes, junctions)
        : undefined;
      if (dependencies) {
        const prior = contactCache.get(net);
        if (
          prior &&
          prior.dependencies.length === dependencies.length &&
          dependencies.every((value, i) =>
            Object.is(value, prior.dependencies[i]),
          )
        )
          return prior.contacts;
      }
      const contacts = netContacts(context, net, routes, junctions);
      if (dependencies) {
        freezeContactData(contacts);
        contactCache.set(net, { dependencies, contacts });
      }
      return contacts;
    });
  const byEndpointKey = new Map<string, CoincidentContact>();
  for (const contact of contacts) {
    for (const endpoint of contact.endpoints) {
      byEndpointKey.set(endpointKey(endpoint), contact);
    }
  }
  return { contacts, byEndpointKey };
}
