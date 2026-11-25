import { groupedBy } from "./grouped-by.js";
import { registerDocumentCache } from "./document-caches.js";
import {
  routeEnd,
  isFrozenSnapshot,
  junctionElectricalEndpoints,
  routeElectricalConnections,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  collectDocumentContactEvidence,
  type CoincidentContact,
  type DocumentContactEvidence,
} from "./contact.js";
import type { ResolvedDocumentLogicalNets } from "./logical-net.js";
import {
  resolveNetLabelBinding,
  type ResolvedNetLabelBinding,
} from "./net-label.js";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "./resolved-route-geometry.js";
import {
  buildDocumentSpatialIndex,
  type DocumentSpatialIndex,
} from "./spatial-index.js";
import {
  endpointKey,
  indexJunctionsByNet,
  buildEndpointObjectLookup,
  resolveEndpointConnection,
  type EndpointConnection,
} from "./endpoint.js";

type Instance = SchematicDocument["instances"][number];
type Net = SchematicDocument["nets"][number];
type Route = SchematicDocument["routes"][number];
type Junction = SchematicDocument["junctions"][number];
type Annotation = SchematicDocument["annotations"][number];

/**
 * One immutable-revision read context for every derived consumer. This is an
 * implementation object only: it is never persisted and never becomes a
 * second electrical protocol.
 */
export interface DocumentDerivedContext {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly instancesById: ReadonlyMap<string, Instance>;
  readonly netsById: ReadonlyMap<string, Net>;
  readonly routesById: ReadonlyMap<string, Route>;
  readonly junctionsById: ReadonlyMap<string, Junction>;
  readonly annotationsById: ReadonlyMap<string, Annotation>;
  readonly routesByNetId: ReadonlyMap<string, readonly Route[]>;
  readonly junctionsByNetId: ReadonlyMap<string, readonly Junction[]>;
  readonly annotationsByNetId: ReadonlyMap<string, readonly Annotation[]>;
  readonly routeDegreeByEndpointKey: ReadonlyMap<string, number>;
  readonly endpointConnections: ReadonlyMap<string, EndpointConnection>;
  readonly routingGeometry: ResolvedDocumentRoutingGeometry;
  readonly contactEvidence: DocumentContactEvidence;
  readonly contactsByNetId: ReadonlyMap<string, readonly CoincidentContact[]>;
  readonly netLabelBindingsByNetId: ReadonlyMap<
    string,
    readonly ResolvedNetLabelBinding[]
  >;
  readonly logicalNetResolution: ResolvedDocumentLogicalNets;
  readonly spatialIndex: DocumentSpatialIndex;
}

interface CachedDocumentDerivedContext {
  readonly revision: number;
  readonly symbols: string;
  readonly context: DocumentDerivedContext;
}

const contextCache = registerDocumentCache(
  new WeakMap<SchematicDocument, CachedDocumentDerivedContext>(),
);

export function buildDocumentDerivedContext(
  document: SchematicDocument,
  resolver: SymbolResolver,
): DocumentDerivedContext {
  const symbols = isFrozenSnapshot(document)
    ? resolvedSymbolContext(document, resolver)
    : undefined;
  const cached = symbols === undefined ? undefined : contextCache.get(document);
  if (cached?.revision === document.revision && cached.symbols === symbols) {
    return cached.context;
  }
  const endpointLookup = buildEndpointObjectLookup(document);
  const { instancesById, junctionsById, logicalNetResolution } = endpointLookup;
  const routesByNetId = groupedBy(
    document.routes,
    (item) => item.members?.map((member) => member.netId) ?? item.netId,
  );
  const routesById = new Map(document.routes.map((route) => [route.id, route]));
  const junctionsByNetId = indexJunctionsByNet(document.junctions);
  const annotationsByNetId = groupedBy(
    document.annotations,
    (item) => item.netId,
  );
  const endpoints = new Map(
    [
      ...document.nets.flatMap((net) =>
        net.terminals.map((terminal) => ({
          kind: "terminal" as const,
          ...terminal,
        })),
      ),
      ...document.junctions.map((junction) => ({
        kind: "junction" as const,
        junctionId: junction.id,
      })),
      ...document.junctions
        .flatMap(junctionElectricalEndpoints)
        .map((item) => item.endpoint),
      ...document.routes
        .flatMap(routeElectricalConnections)
        .flatMap((edge) => edge.endpoints),
      ...document.routes.flatMap((route) => [route.start, routeEnd(route)]),
    ].map((endpoint) => [endpointKey(endpoint), endpoint] as const),
  );
  const endpointConnections = new Map<string, EndpointConnection>();
  for (const [key, endpoint] of endpoints) {
    const connection = resolveEndpointConnection(
      document,
      resolver,
      endpoint,
      endpointLookup,
    );
    if (connection) endpointConnections.set(key, connection);
  }
  const routingGeometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
    endpointConnections,
    endpointLookup,
  );
  const spatialIndex = buildDocumentSpatialIndex(document, routingGeometry);
  const contactEvidence = collectDocumentContactEvidence(
    document,
    resolver,
    routingGeometry,
    {
      junctionsByNetId,
      routesByNetId,
      routesById,
      spatialIndex,
      endpointConnections,
      endpointLookup,
    },
    symbols !== undefined,
  );
  const netsById = new Map(document.nets.map((net) => [net.id, net]));
  // A free label attaches to a Route on its primary Net. Electrical bus
  // membership also indexes the other lanes, which are not attachment targets.
  const routesByPrimaryNetId = document.routes.some((route) => route.members)
    ? groupedBy(document.routes, (route) => route.netId)
    : routesByNetId;
  const labelLookup = {
    netsById,
    routesById,
    routesByPrimaryNetId,
    junctionsByNetId,
    junctionsById,
    // The geometry lookup keeps the last duplicate object. Legacy drafts
    // resolve the first one when measuring distances to fallback endpoints.
    ...(junctionsById.size === document.junctions.length &&
    instancesById.size === document.instances.length
      ? { endpointLookup }
      : {}),
  };
  const netLabelBindingsByNetId = new Map<string, ResolvedNetLabelBinding[]>();
  for (const annotation of document.annotations) {
    const binding = resolveNetLabelBinding(
      document,
      resolver,
      annotation,
      routingGeometry,
      labelLookup,
    );
    if (!binding) continue;
    const bindings = netLabelBindingsByNetId.get(binding.netId) ?? [];
    bindings.push(binding);
    netLabelBindingsByNetId.set(binding.netId, bindings);
  }
  for (const bindings of netLabelBindingsByNetId.values()) {
    bindings.sort((left, right) =>
      left.annotationId.localeCompare(right.annotationId, "en"),
    );
  }
  const routeDegreeByEndpointKey = new Map<string, number>();
  for (const route of document.routes) {
    for (const endpoint of route.members
      ? [
          ...routeElectricalConnections(route).flatMap(
            (edge) => edge.endpoints,
          ),
          route.start,
          routeEnd(route),
        ]
      : [route.start, routeEnd(route)]) {
      const key = endpointKey(endpoint);
      routeDegreeByEndpointKey.set(
        key,
        (routeDegreeByEndpointKey.get(key) ?? 0) + 1,
      );
    }
  }
  const context: DocumentDerivedContext = {
    documentId: document.id,
    documentRevision: document.revision,
    instancesById,
    netsById,
    routesById,
    junctionsById,
    annotationsById: new Map(
      document.annotations.map((item) => [item.id, item]),
    ),
    routesByNetId,
    junctionsByNetId,
    annotationsByNetId,
    routeDegreeByEndpointKey,
    endpointConnections,
    routingGeometry,
    contactEvidence,
    contactsByNetId: groupedBy(contactEvidence.contacts, (item) => item.netId),
    netLabelBindingsByNetId,
    logicalNetResolution,
    spatialIndex,
  };
  if (symbols !== undefined)
    contextCache.set(document, {
      revision: document.revision,
      symbols,
      context,
    });
  return context;
}

function resolvedSymbolContext(
  document: SchematicDocument,
  resolver: SymbolResolver,
): string {
  const references = new Map<string, readonly [string, string | undefined]>();
  for (const instance of document.instances) {
    const reference = [instance.symbolId, instance.symbolVariantId] as const;
    references.set(JSON.stringify(reference), reference);
  }
  for (const object of document.drafting?.objects ?? []) {
    if (object.kind !== "floating-symbol") continue;
    const reference = [object.symbolId, undefined] as const;
    references.set(JSON.stringify(reference), reference);
  }
  return JSON.stringify(
    [...references.values()].map(
      ([id, variant]) => resolver.resolve(id, variant) ?? null,
    ),
  );
}
