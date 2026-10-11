import { registerDocumentCache } from "./document-caches.js";
import { routeEnd, isFrozenSnapshot } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  deriveDocumentContactEvidence,
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

function groupedBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string | undefined,
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

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
  const {
    instancesById,
    junctionsById,
    logicalNets: logicalNetResolution,
  } = endpointLookup;
  const routesByNetId = groupedBy(document.routes, (item) => item.netId);
  const routesById = new Map(document.routes.map((route) => [route.id, route]));
  const junctionsByNetId = groupedBy(document.junctions, (item) => item.netId);
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
  );
  const spatialIndex = buildDocumentSpatialIndex(document, routingGeometry);
  const contactEvidence = deriveDocumentContactEvidence(
    document,
    resolver,
    routingGeometry,
    {
      routesByNetId,
      routesById,
      spatialIndex,
      endpointConnections,
      endpointLookup,
    },
  );
  const netLabelBindingsByNetId = new Map<string, ResolvedNetLabelBinding[]>();
  for (const annotation of document.annotations) {
    const binding = resolveNetLabelBinding(
      document,
      resolver,
      annotation,
      routingGeometry,
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
    for (const endpoint of [route.start, routeEnd(route)]) {
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
    netsById: new Map(document.nets.map((item) => [item.id, item])),
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
