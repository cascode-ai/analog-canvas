import { deriveStableId, flattenRichText, foldNetName } from "@icm/model";
import type {
  CircuitProject,
  Net,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  deriveImportedRoutingGuidance,
  deriveNetConnectivity,
  deriveNetConnectivityContext,
  type NetConnectivityContext,
  type RoutedComponent,
} from "./connectivity.js";
import type { RoutingGuide } from "./routing-guidance.js";
import { endpointKey, isVisibleEndpoint, netEndpoints } from "./endpoint.js";
import { directObjectLocator, type ObjectLocator } from "./object-locator.js";
import type { ResolvedNetLabelBinding } from "./net-label.js";
import { resolveAnnotationText } from "./annotation-text.js";
import type { ResolvedDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";

/**
 * Unified read-only connectivity index (ADR 0013). Single source of
 * connectivity truth for routing guidance, net highlight, cross-Cell trace,
 * project search, and ERC. Never persisted, exported, or mutated by GUI state.
 *
 * This first implementation is an additive facade over the existing tested
 * `derive*` primitives, plus the partition-invariant routing-guidance id
 * normalization (ADR 0013 / WP-R0 finding), typed virtual edges, hierarchy
 * edges, and a project object index. Production consumers keep using the old
 * helpers until the R10 migration proves parity and switches them.
 */

export type EndpointRef = RouteEndpoint;

export interface VirtualConnectivityEdge {
  kind: "net-label" | "power-label";
  from: EndpointRef;
  to: EndpointRef;
  /** Label text binding the two endpoints. */
  evidence: string;
}

export interface NetConnectivityRecord {
  netId: string;
  baseNetIds: readonly string[];
  /** Instance terminals — electrical truth, independent of geometry. */
  logicalEndpoints: readonly EndpointRef[];
  /** Visible graph participants (visible terminals + the Net's Junctions). */
  visibleEndpoints: readonly EndpointRef[];
  routedComponents: readonly RoutedComponent[];
  routes: readonly string[];
  junctions: readonly string[];
  virtualEdges: readonly VirtualConnectivityEdge[];
  /** Imported routing guidance with partition-invariant id/direction. */
  routingGuidance: readonly RoutingGuide[];
}

export interface DocumentConnectivityIndex {
  documentId: string;
  /** Physical membership: endpoint key -> Base Net id. */
  endpointToBaseNetId: ReadonlyMap<string, string>;
  /** One canonical record per resolved Logical Net. */
  logicalNets: ReadonlyMap<string, NetConnectivityRecord>;
  /** Total lookup from every Base Net id to its Logical Net record. */
  logicalNetByBaseNetId: ReadonlyMap<string, NetConnectivityRecord>;
  routingGeometry: ResolvedDocumentRoutingGeometry;
}

export interface HierarchyEdge {
  parentDocumentId: string;
  instanceId: string;
  parentPinName: string;
  childDocumentId: string;
  childTerminalName: string;
  childNetId: string;
}

export interface HierarchyConnectivityIndex {
  edges: readonly HierarchyEdge[];
}

export interface NetObjectRef {
  documentId: string;
  netId: string;
}

/** Derived project-wide equivalence for explicitly named global Nets only. */
export interface GlobalNetGroup {
  foldedName: string;
  nets: readonly NetObjectRef[];
}

/**
 * Project-level object identity (ADR 0015). Direct-document locators carry an
 * empty hierarchy path; C6 later supplies non-empty paths for navigation.
 */
export interface ProjectObjectIndex {
  resolve(documentId: string, objectId: string): ObjectLocator | undefined;
}

export interface ProjectConnectivityIndex {
  projectId: string;
  topDocumentId: string;
  documents: ReadonlyMap<string, DocumentConnectivityIndex>;
  hierarchy: HierarchyConnectivityIndex;
  globalNets: ReadonlyMap<string, GlobalNetGroup>;
  objectIndex: ProjectObjectIndex;
}

const junctionEndpoint = (junctionId: string): EndpointRef => ({
  kind: "junction",
  junctionId,
});

const terminalEndpoint = (
  instanceId: string,
  pinName: string,
): EndpointRef => ({ kind: "terminal", instanceId, pinName });

interface CachedDocumentIndex {
  revision: number;
  resolver: SymbolResolver;
  index: DocumentConnectivityIndex;
}

/** Derived-only cache: never persisted and invalidated by revision/resolver. */
const documentIndexCache = new WeakMap<
  SchematicDocument,
  CachedDocumentIndex
>();

/**
 * Returns routing guidance whose `from`/`to` are ordered by `endpointKey` and
 * whose `id` is recomputed from the ordered keys, so the same logical guide
 * yields the same id regardless of how the visible wire is partitioned into
 * Routes (ADR 0013; resolves the WP-R0 partition-sensitivity finding).
 */
function normalizeRoutingGuidance(line: RoutingGuide): RoutingGuide {
  const swap =
    endpointKey(line.from).localeCompare(endpointKey(line.to), "en") > 0;
  const from = swap ? line.to : line.from;
  const to = swap ? line.from : line.to;
  const fromPoint = swap ? line.toPoint : line.fromPoint;
  const toPoint = swap ? line.fromPoint : line.toPoint;
  const fromNetId = swap ? line.toNetId : line.fromNetId;
  const toNetId = swap ? line.fromNetId : line.toNetId;
  return {
    id: deriveStableId(
      "routing-guidance",
      line.netId,
      endpointKey(from),
      endpointKey(to),
    ),
    netId: line.netId,
    fromNetId,
    toNetId,
    ...(line.sourceNetId ? { sourceNetId: line.sourceNetId } : {}),
    from,
    to,
    fromPoint,
    toPoint,
    distance: line.distance,
  };
}

function buildDocumentIndex(
  document: SchematicDocument,
  resolver: SymbolResolver,
): DocumentConnectivityIndex {
  const cached = documentIndexCache.get(document);
  if (cached?.revision === document.revision && cached.resolver === resolver) {
    return cached.index;
  }
  const endpointToBaseNetId = new Map<string, string>();
  for (const net of document.nets) {
    for (const endpoint of netEndpoints(document, net)) {
      endpointToBaseNetId.set(endpointKey(endpoint), net.id);
    }
  }

  const routingGuidanceByNet = new Map<string, RoutingGuide[]>();
  for (const line of deriveImportedRoutingGuidance(document, resolver)) {
    const normalized = normalizeRoutingGuidance(line);
    for (const netId of new Set([line.fromNetId, line.toNetId])) {
      const lines = routingGuidanceByNet.get(netId) ?? [];
      lines.push(normalized);
      routingGuidanceByNet.set(netId, lines);
    }
  }

  const connectivityContext = deriveNetConnectivityContext(document, resolver);
  const routesByNetId = new Map<string, SchematicDocument["routes"]>();
  for (const route of document.routes) {
    const routes = routesByNetId.get(route.netId) ?? [];
    routes.push(route);
    routesByNetId.set(route.netId, routes);
  }
  const junctionsByNetId = new Map<string, SchematicDocument["junctions"]>();
  for (const junction of document.junctions) {
    const junctions = junctionsByNetId.get(junction.netId) ?? [];
    junctions.push(junction);
    junctionsByNetId.set(junction.netId, junctions);
  }

  const baseRecords = new Map<string, NetConnectivityRecord>();
  for (const net of document.nets) {
    baseRecords.set(
      net.id,
      buildNetRecord(
        document,
        resolver,
        net,
        routingGuidanceByNet.get(net.id) ?? [],
        connectivityContext,
        routesByNetId.get(net.id) ?? [],
        junctionsByNetId.get(net.id) ?? [],
      ),
    );
  }
  const logicalNets = new Map<string, NetConnectivityRecord>();
  const logicalNetByBaseNetId = new Map<string, NetConnectivityRecord>();
  for (const group of resolveDocumentLogicalNets(document).groups) {
    const records = group.baseNetIds.map((netId) => baseRecords.get(netId)!);
    const aggregate: NetConnectivityRecord = {
      netId: group.id,
      baseNetIds: group.baseNetIds,
      logicalEndpoints: uniqueEndpoints(
        records.flatMap((record) => record.logicalEndpoints),
      ),
      visibleEndpoints: uniqueEndpoints(
        records.flatMap((record) => record.visibleEndpoints),
      ),
      routedComponents: records.flatMap((record) => record.routedComponents),
      routes: uniqueStrings(records.flatMap((record) => record.routes)),
      junctions: uniqueStrings(records.flatMap((record) => record.junctions)),
      virtualEdges: records.flatMap((record) => record.virtualEdges),
      routingGuidance: uniqueRoutingGuidance(
        records.flatMap((record) => record.routingGuidance),
      ),
    };
    logicalNets.set(group.id, aggregate);
    for (const baseNetId of group.baseNetIds) {
      logicalNetByBaseNetId.set(baseNetId, aggregate);
    }
  }

  const index = {
    documentId: document.id,
    endpointToBaseNetId,
    logicalNets,
    logicalNetByBaseNetId,
    routingGeometry: connectivityContext.routingGeometry,
  };
  documentIndexCache.set(document, {
    revision: document.revision,
    resolver,
    index,
  });
  return index;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function uniqueEndpoints(values: readonly EndpointRef[]): EndpointRef[] {
  return [
    ...new Map(
      values.map((endpoint) => [endpointKey(endpoint), endpoint]),
    ).values(),
  ].sort((left, right) =>
    endpointKey(left).localeCompare(endpointKey(right), "en"),
  );
}

function uniqueRoutingGuidance(
  values: readonly RoutingGuide[],
): RoutingGuide[] {
  return [...new Map(values.map((line) => [line.id, line])).values()].sort(
    (left, right) => left.id.localeCompare(right.id, "en"),
  );
}

function buildNetRecord(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: Net,
  routingGuidance: readonly RoutingGuide[],
  connectivityContext: NetConnectivityContext,
  routesForNet: SchematicDocument["routes"],
  junctionsForNet: SchematicDocument["junctions"],
): NetConnectivityRecord {
  const logicalEndpoints: EndpointRef[] = [
    ...net.terminals.map((terminal) =>
      terminalEndpoint(terminal.instanceId, terminal.pinName),
    ),
  ].sort((a, b) => endpointKey(a).localeCompare(endpointKey(b), "en"));

  const visibleEndpoints = netEndpoints(document, net).filter((endpoint) =>
    isVisibleEndpoint(document, resolver, endpoint),
  );

  const routedComponents = deriveNetConnectivity(
    document,
    resolver,
    net,
    connectivityContext,
  ).components;

  const routes = routesForNet
    .map((route) => route.id)
    .sort((a, b) => a.localeCompare(b, "en"));

  const junctions = junctionsForNet
    .map((junction) => junction.id)
    .sort((a, b) => a.localeCompare(b, "en"));

  const virtualEdges = deriveLabelVirtualEdges(
    document,
    net,
    connectivityContext.netLabelBindingsByNetId.get(net.id) ?? [],
  );

  return {
    netId: net.id,
    baseNetIds: [net.id],
    logicalEndpoints,
    visibleEndpoints,
    routedComponents,
    routes,
    junctions,
    virtualEdges,
    routingGuidance,
  };
}

/**
 * Typed net-label/power-label virtual edges. Net Labels are bound to a Net id
 * and resolved to the nearest routed component; the old Junction-id overload
 * is deliberately not accepted. Power labels retain their legacy Junction
 * compatibility until their separate symbol binding contract is migrated.
 */
function deriveLabelVirtualEdges(
  document: SchematicDocument,
  net: Net,
  bindings: readonly ResolvedNetLabelBinding[],
): VirtualConnectivityEdge[] {
  const groups = new Map<
    string,
    { kind: VirtualConnectivityEdge["kind"]; endpoints: EndpointRef[] }
  >();
  for (const binding of bindings) {
    const annotation = document.annotations.find(
      (candidate) => candidate.id === binding.annotationId,
    )!;
    const label = flattenRichText(
      resolveAnnotationText(document, annotation),
    ).trim();
    if (label.length === 0) continue;
    const group = groups.get(label) ?? {
      kind: "net-label",
      endpoints: [],
    };
    group.endpoints.push(binding.endpoint);
    groups.set(label, group);
  }
  for (const annotation of document.annotations) {
    if (annotation.kind !== "power-label" || annotation.netId !== net.id) {
      continue;
    }
    const binding = bindings.find(
      (candidate) => candidate.annotationId === annotation.id,
    );
    if (!binding) continue;
    const label = flattenRichText(
      resolveAnnotationText(document, annotation),
    ).trim();
    if (label.length === 0) continue;
    const group = groups.get(label) ?? {
      kind: annotation.kind,
      endpoints: [],
    };
    group.endpoints.push(binding.endpoint);
    groups.set(label, group);
  }
  const edges: VirtualConnectivityEdge[] = [];
  for (const [label, group] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "en"),
  )) {
    const ordered = [
      ...new Map(
        group.endpoints.map((endpoint) => [endpointKey(endpoint), endpoint]),
      ).values(),
    ].sort((a, b) => endpointKey(a).localeCompare(endpointKey(b), "en"));
    for (let index = 0; index < ordered.length - 1; index += 1) {
      edges.push({
        kind: group.kind,
        from: ordered[index]!,
        to: ordered[index + 1]!,
        evidence: label,
      });
    }
  }
  return edges;
}

function buildHierarchyIndex(
  project: CircuitProject,
  resolver: SymbolResolver,
  documents: ReadonlyMap<string, DocumentConnectivityIndex>,
): HierarchyConnectivityIndex {
  const edges: HierarchyEdge[] = [];
  for (const parent of project.documents) {
    for (const instance of parent.instances) {
      const childId = referencedDocumentId(project, instance);
      if (!childId) continue;
      const child = project.documents.find(
        (candidate) => candidate.id === childId,
      );
      if (!child) continue;
      const childIndex = documents.get(childId);
      if (!childIndex) continue;
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      if (!resolved) continue;
      for (const pin of resolved.definition.pins) {
        const childTerminals = (child.netlist?.terminals ?? []).filter(
          (terminal) => foldNetName(terminal.name) === foldNetName(pin.name),
        );
        const childLogicalNets = childTerminals.map((terminal) =>
          childIndex.logicalNetByBaseNetId.get(terminal.netId),
        );
        // A name identifies the projected interface pin, not electrical
        // equivalence. Only preserve an edge when every authored member is
        // already connected by the child's independent connectivity facts.
        if (
          childLogicalNets.length === 0 ||
          childLogicalNets.some((record) => !record) ||
          new Set(childLogicalNets.map((record) => record!.netId)).size !== 1
        ) {
          continue;
        }
        const childTerminal = childTerminals[0]!;
        edges.push({
          parentDocumentId: parent.id,
          instanceId: instance.id,
          parentPinName: pin.name,
          childDocumentId: childId,
          childTerminalName: childTerminal.name,
          childNetId: childTerminal.netId,
        });
      }
    }
  }
  edges.sort(
    (a, b) =>
      a.parentDocumentId.localeCompare(b.parentDocumentId, "en") ||
      a.instanceId.localeCompare(b.instanceId, "en") ||
      a.parentPinName.localeCompare(b.parentPinName, "en"),
  );
  return { edges };
}

function buildGlobalNetIndex(
  project: CircuitProject,
): ReadonlyMap<string, GlobalNetGroup> {
  const groups = new Map<string, NetObjectRef[]>();
  for (const document of project.documents) {
    for (const logicalNet of resolveDocumentLogicalNets(document).groups) {
      if (logicalNet.scope !== "global" || !logicalNet.name) continue;
      const foldedName = foldNetName(logicalNet.name);
      const refs = groups.get(foldedName) ?? [];
      refs.push({ documentId: document.id, netId: logicalNet.id });
      groups.set(foldedName, refs);
    }
  }
  return new Map(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([foldedName, nets]) => [
        foldedName,
        {
          foldedName,
          nets: nets.sort(
            (left, right) =>
              left.documentId.localeCompare(right.documentId, "en") ||
              left.netId.localeCompare(right.netId, "en"),
          ),
        },
      ]),
  );
}

/** Resolve only the stable imported hierarchy link written by the importer. */
function referencedDocumentId(
  project: CircuitProject,
  instance: SchematicDocument["instances"][number],
): string | null {
  const binding = instance.netlist?.binding;
  const childId =
    binding?.kind === "subcircuit" ? binding.childDocumentId : undefined;
  if (
    typeof childId === "string" &&
    project.documents.some((candidate) => candidate.id === childId)
  ) {
    return childId;
  }
  return null;
}

function buildObjectIndex(project: CircuitProject): ProjectObjectIndex {
  return {
    resolve(documentId, objectId) {
      const document = project.documents.find(
        (candidate) => candidate.id === documentId,
      );
      if (!document) return undefined;
      if (document.id === objectId) {
        return directObjectLocator(documentId, "document", objectId);
      }
      if (document.instances.some((candidate) => candidate.id === objectId)) {
        return directObjectLocator(documentId, "instance", objectId);
      }
      if (document.nets.some((candidate) => candidate.id === objectId)) {
        return directObjectLocator(documentId, "net", objectId);
      }
      if (document.routes.some((candidate) => candidate.id === objectId)) {
        return directObjectLocator(documentId, "route", objectId);
      }
      if (document.junctions.some((candidate) => candidate.id === objectId)) {
        return directObjectLocator(documentId, "junction", objectId);
      }
      if (document.annotations.some((candidate) => candidate.id === objectId)) {
        return directObjectLocator(documentId, "annotation", objectId);
      }
      return undefined;
    },
  };
}

export function buildProjectConnectivityIndex(
  project: CircuitProject,
  resolver: SymbolResolver,
): ProjectConnectivityIndex {
  const documents = new Map<string, DocumentConnectivityIndex>();
  for (const document of project.documents) {
    documents.set(document.id, buildDocumentIndex(document, resolver));
  }
  return {
    projectId: project.id,
    topDocumentId: project.topDocumentId,
    documents,
    hierarchy: buildHierarchyIndex(project, resolver, documents),
    globalNets: buildGlobalNetIndex(project),
    objectIndex: buildObjectIndex(project),
  };
}
