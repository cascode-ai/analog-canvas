import { buildProjectConnectivityRelations } from "./project-connectivity-relations.js";
import { registerDocumentCache } from "./document-caches.js";
import {
  createAnnotationNameClaimReader,
  deriveStableId,
  documentContentSource,
  readDocumentChangeJournal,
  isFrozenSnapshot,
  foldNetName,
  freezeSnapshot,
} from "@icm/model";
import type {
  AnnotationNameClaimReader,
  CircuitProject,
  Net,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { InMemorySymbolResolver, type SymbolResolver } from "@icm/symbols";
import {
  changedRecordOwners,
  hasLocalRecordDependencies,
  sameRecordInputs,
  sameConnectivitySymbols,
  type RecordInputs,
} from "./connectivity-record-reuse.js";

import {
  deriveImportedRoutingGuidance,
  deriveNetConnectivity,
  deriveNetConnectivityContext,
  type NetConnectivityContext,
  type RoutedComponent,
} from "./connectivity.js";
import type { RoutingGuide } from "./routing-guidance.js";
import { endpointKey, isVisibleEndpoint, netEndpoints } from "./endpoint.js";
import {
  directObjectLocator,
  type ObjectLocator,
  type HierarchyFrame,
} from "./object-locator.js";
import { resolveAnnotationName } from "./annotation-text.js";
import type { DocumentDerivedContext } from "./document-derived-context.js";

/**
 * Shared derived connectivity read model; see docs/specs/connectivity-and-routing.md.
 * Physical membership, logical equivalence, guidance and occurrence-aware lookup
 * remain projections of Project facts, never another persisted authority.
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

export interface DocumentConnectivityIndex extends DocumentDerivedContext {
  /** Also includes guides to extant but electrically unbound terminals. */
  routingGuidance: readonly RoutingGuide[];
  /** Physical membership: endpoint key -> Base Net id. */
  endpointToBaseNetId: ReadonlyMap<string, string>;
  /** One canonical record per resolved Logical Net. */
  logicalNets: ReadonlyMap<string, NetConnectivityRecord>;
  /** Total lookup from every Base Net id to its Logical Net record. */
  logicalNetByBaseNetId: ReadonlyMap<string, NetConnectivityRecord>;
}

export interface HierarchyEdge {
  parentDocumentId: string;
  instanceId: string;
  parentPinName: string;
  childDocumentId: string;
  childTerminalName: string;
  childNetId: string;
  parentMemberId?: string;
  parentMemberName?: string;
  childMemberId?: string;
  childMemberName?: string;
}

export interface HierarchyConnectivityIndex {
  /** Structural calls exist even without pins, wiring or resolved symbols. */
  calls: readonly HierarchyFrame[];
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
 * Project-level object identity (Net connectivity rationale). Direct-document locators carry an
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

const terminalEndpoint = (
  instanceId: string,
  pinName: string,
  memberId?: string,
): EndpointRef => ({
  kind: "terminal",
  instanceId,
  pinName,
  ...(memberId ? { memberId } : {}),
});

interface BaseRecord {
  record: NetConnectivityRecord;
  endpointKeys: readonly string[];
  bodies?: { endpoint: RouteEndpoint; visible: boolean }[];
}
interface GlobalMembership {
  foldedName: string;
  netId: string;
}
interface CellRecordState {
  baseRecords: ReadonlyMap<string, BaseRecord>;
  globals: readonly GlobalMembership[];
  hasBodyPins: boolean;
  local: boolean;
}
const emptyGlobals: readonly GlobalMembership[] = Object.freeze([]);
const emptyBaseRecords = new Map<string, BaseRecord>();
const recordStates = new WeakMap<DocumentConnectivityIndex, CellRecordState>();

interface CachedDocumentIndex {
  revision: number;
  resolver: SymbolResolver;
  index: DocumentConnectivityIndex;
}

/** Derived-only cache: never persisted and invalidated by revision/resolver. */
const documentIndexCache = registerDocumentCache(
  new WeakMap<SchematicDocument, CachedDocumentIndex>(),
);

// Public views are independently mutable. They can never seed a committed
// record cache or expose one of its maps, records or geometry points.
const publicIndexCache = registerDocumentCache(
  new WeakMap<SchematicDocument, CachedDocumentIndex>(),
);

/** Read a previously indexed immutable Cell. Internal readers share the committed projection. */
export function cachedDocumentConnectivityIndex(
  document: SchematicDocument,
  resolver?: SymbolResolver,
  ownership: "public" | "committed" = "public",
) {
  const shared = ownership === "committed";
  if (!resolver || !isFrozenSnapshot(document)) return undefined;
  const requestedCache = shared ? documentIndexCache : publicIndexCache;
  const existing = requestedCache.get(document);
  if (
    existing?.revision === document.revision &&
    existing.resolver === resolver
  )
    return existing.index;
  const other = (shared ? publicIndexCache : documentIndexCache).get(document);
  if (other?.revision === document.revision && other.resolver === resolver)
    return buildDocumentIndex(document, resolver, false, shared);
  return undefined;
}

/**
 * Returns routing guidance whose `from`/`to` are ordered by `endpointKey` and
 * whose `id` is recomputed from the ordered keys, so the same logical guide
 * yields the same id regardless of how the visible wire is partitioned into
 * Routes (Net connectivity rationale).
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
      line.sourceNetId ?? line.netId,
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

interface PreviousRecords extends RecordInputs {
  index: DocumentConnectivityIndex;
  touched: ReadonlySet<string>;
  baseRecords: ReadonlyMap<string, BaseRecord>;
}

function previousCellRecords(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context: DocumentDerivedContext,
) {
  const journal = readDocumentChangeJournal(document);
  const cached = journal && documentIndexCache.get(journal.before);
  const source = cached && recordStates.get(cached.index);
  const local =
    isFrozenSnapshot(document) &&
    InMemorySymbolResolver.hasStableDefinitions(resolver) &&
    hasLocalRecordDependencies(
      document,
      context,
      Boolean(source?.local),
      journal,
    );
  let previous: PreviousRecords | undefined;
  let isolatedAddition = false;
  if (
    local &&
    source?.local &&
    cached &&
    journal &&
    cached.revision === journal.before.revision &&
    sameConnectivitySymbols(journal.before, cached.resolver, resolver)
  ) {
    const touched = changedRecordOwners(journal);
    if (touched) {
      previous = {
        document: journal.before,
        index: cached.index,
        claims: createAnnotationNameClaimReader(journal.before),
        baseRecords: source.baseRecords,
        touched,
      };
      isolatedAddition =
        !touched.size &&
        !source.hasBodyPins &&
        !document.netlist?.terminals.length &&
        !context.netLabelBindingsByNetId.size &&
        !cached.index.netLabelBindingsByNetId.size &&
        journal.fields.every(
          (field) =>
            field === "revision" ||
            field === "instances" ||
            field === "annotations" ||
            field === "sourceStatus" ||
            field === "drawingOrder",
        ) &&
        journal.rows.every(
          (row) =>
            row.change === "added" &&
            (row.collection === "instances" ||
              (row.collection === "annotations" &&
                !context.annotationsById.get(row.id)?.netId)),
        );
    }
  }
  return { local, previous, isolatedAddition, priorGlobals: source?.globals };
}

function reusableRecord(
  net: Net,
  previous: PreviousRecords | undefined,
  current: RecordInputs,
  resolver: SymbolResolver,
) {
  if (
    !previous ||
    previous.touched.has(net.id) ||
    previous.index.netsById.get(net.id) !== net
  )
    return undefined;
  const prior = previous.baseRecords.get(net.id);
  if (!prior || !sameRecordInputs(net.id, previous, current)) return undefined;
  // MOS body visibility can change when a different Net becomes the supply.
  if (
    prior.bodies?.some(
      ({ endpoint, visible }) =>
        isVisibleEndpoint(
          current.document,
          resolver,
          endpoint,
          current.index,
        ) !== visible,
    )
  )
    return undefined;
  return prior;
}

function buildDocumentIndex(
  snapshot: SchematicDocument,
  resolver: SymbolResolver,
  reuseRestoredContent: boolean,
  shared: boolean,
): DocumentConnectivityIndex {
  const cache = shared ? documentIndexCache : publicIndexCache;
  const cached = cache.get(snapshot);
  if (cached?.revision === snapshot.revision && cached.resolver === resolver) {
    return cached.index;
  }
  if (reuseRestoredContent) {
    const source = documentContentSource(snapshot);
    const prior = source !== snapshot ? cache.get(source) : undefined;
    if (prior?.revision === source.revision && prior.resolver === resolver) {
      const documentRevision = snapshot.revision;
      const routingGeometry = {
        ...prior.index.routingGeometry,
        documentRevision,
      };
      const index = {
        ...prior.index,
        documentRevision,
        routingGeometry,
        directRoutingGeometry:
          prior.index.directRoutingGeometry === prior.index.routingGeometry
            ? routingGeometry
            : { ...prior.index.directRoutingGeometry, documentRevision },
        spatialIndex: { ...prior.index.spatialIndex, documentRevision },
      };
      const records = recordStates.get(prior.index);
      if (records) recordStates.set(index, records);
      cache.set(snapshot, {
        revision: documentRevision,
        resolver,
        index,
      });
      return index;
    }
  }
  // Public geometry helpers expose writable maps and routed nodes for their Cell.
  // Private derivation keys keep those caches separate while sharing frozen authored rows.
  const document = isFrozenSnapshot(snapshot)
    ? shared
      ? freezeSnapshot({ ...snapshot })
      : { ...snapshot }
    : snapshot;
  const connectivityContext = deriveNetConnectivityContext(document, resolver);
  const { local, previous, isolatedAddition, priorGlobals } = shared
    ? previousCellRecords(snapshot, resolver, connectivityContext)
    : {
        local: false,
        previous: undefined,
        isolatedAddition: false,
        priorGlobals: undefined,
      };

  // A newly placed, unattached part changes the scene, but no electrical
  // membership, label, formal or body visibility. Keep the ordered directories.
  const isolatedState =
    isolatedAddition && previous && recordStates.get(previous.index);
  if (previous && isolatedState) {
    const index = { ...previous.index, ...connectivityContext };
    recordStates.set(index, isolatedState);
    cache.set(snapshot, {
      revision: document.revision,
      resolver,
      index,
    });
    return index;
  }

  const routingGuidanceByNet = new Map<string, RoutingGuide[]>();
  const routingGuidance = deriveImportedRoutingGuidance(
    document,
    resolver,
    connectivityContext,
  ).map(normalizeRoutingGuidance);
  for (const line of routingGuidance) {
    for (const netId of new Set([line.fromNetId, line.toNetId])) {
      if (netId === null) continue;
      const lines = routingGuidanceByNet.get(netId) ?? [];
      lines.push(line);
      routingGuidanceByNet.set(netId, lines);
    }
  }

  const baseRecords = new Map<string, BaseRecord>();
  const readClaims = createAnnotationNameClaimReader(document);
  const inputs = { document, index: connectivityContext, claims: readClaims };
  const sharedOwners =
    previous &&
    previous.document.nets === document.nets &&
    previous.document.junctions === document.junctions
      ? previous.index.endpointToBaseNetId
      : undefined;
  const newOwners = new Map<string, string>();
  let hasBodyPins = false;
  for (const net of document.nets) {
    const entry =
      reusableRecord(net, previous, inputs, resolver) ??
      buildNetRecord(
        document,
        resolver,
        net,
        routingGuidanceByNet.get(net.id) ?? [],
        connectivityContext,
        readClaims,
      );
    baseRecords.set(net.id, entry);
    hasBodyPins ||= Boolean(entry.bodies);
    if (!sharedOwners)
      for (const key of entry.endpointKeys) newOwners.set(key, net.id);
  }
  const endpointToBaseNetId = sharedOwners ?? newOwners;
  const logicalNets = new Map<string, NetConnectivityRecord>();
  const logicalNetByBaseNetId = new Map<string, NetConnectivityRecord>();
  const globals: GlobalMembership[] = [];
  for (const group of connectivityContext.logicalNetResolution.groups) {
    const prior = previous?.index.logicalNets.get(group.id);
    const reuse =
      prior &&
      prior.baseNetIds.length === group.baseNetIds.length &&
      group.baseNetIds.every(
        (id, i) =>
          prior.baseNetIds[i] === id &&
          previous?.baseRecords.get(id) === baseRecords.get(id),
      );
    const aggregate = reuse
      ? prior
      : aggregateNetRecords(
          group,
          group.baseNetIds.map((id) => baseRecords.get(id)!.record),
        );
    if (group.scope === "global" && group.name)
      globals.push({ foldedName: foldNetName(group.name), netId: group.id });
    logicalNets.set(group.id, aggregate);
    for (const baseNetId of group.baseNetIds) {
      logicalNetByBaseNetId.set(baseNetId, aggregate);
    }
  }

  const index: DocumentConnectivityIndex = {
    ...connectivityContext,
    routingGuidance,
    endpointToBaseNetId,
    logicalNets,
    logicalNetByBaseNetId,
  };
  cache.set(snapshot, {
    revision: document.revision,
    resolver,
    index,
  });
  const memberships = !globals.length
    ? emptyGlobals
    : priorGlobals &&
        priorGlobals.length === globals.length &&
        globals.every(
          (entry, i) =>
            entry.netId === priorGlobals[i]?.netId &&
            entry.foldedName === priorGlobals[i]?.foldedName,
        )
      ? priorGlobals
      : globals;
  recordStates.set(index, {
    baseRecords: local ? baseRecords : emptyBaseRecords,
    globals: memberships,
    hasBodyPins,
    local,
  });
  return index;
}

function aggregateNetRecords(
  group: { id: string; baseNetIds: readonly string[] },
  records: readonly NetConnectivityRecord[],
): NetConnectivityRecord {
  return {
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
  readClaims: AnnotationNameClaimReader,
): BaseRecord {
  const routesForNet = connectivityContext.routesByNetId.get(net.id) ?? [];
  const junctionsForNet =
    connectivityContext.junctionsByNetId.get(net.id) ?? [];
  const logicalEndpoints: EndpointRef[] = [
    ...net.terminals.map((terminal) =>
      terminalEndpoint(
        terminal.instanceId,
        terminal.pinName,
        terminal.memberId,
      ),
    ),
  ].sort((a, b) => endpointKey(a).localeCompare(endpointKey(b), "en"));

  const endpoints = netEndpoints(document, net, junctionsForNet);
  let bodies: BaseRecord["bodies"];
  const visibleEndpoints = endpoints.filter((endpoint) => {
    const visible = isVisibleEndpoint(
      document,
      resolver,
      endpoint,
      connectivityContext,
    );
    if (endpoint.kind === "terminal" && endpoint.pinName === "B")
      (bodies ??= []).push({ endpoint, visible });
    return visible;
  });

  const routedComponents = deriveNetConnectivity(
    document,
    resolver,
    net,
    connectivityContext,
    readClaims,
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
    connectivityContext,
    readClaims,
  );

  return {
    endpointKeys: endpoints.map(endpointKey),
    ...(bodies ? { bodies } : {}),
    record: {
      netId: net.id,
      baseNetIds: [net.id],
      logicalEndpoints,
      visibleEndpoints,
      routedComponents,
      routes,
      junctions,
      virtualEdges,
      routingGuidance,
    },
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
  context: NetConnectivityContext,
  readClaims: AnnotationNameClaimReader,
): VirtualConnectivityEdge[] {
  const bindings = context.netLabelBindingsByNetId.get(net.id) ?? [];
  const logicalNets = context.logicalNetResolution;
  const groups = new Map<
    string,
    { kind: VirtualConnectivityEdge["kind"]; endpoints: EndpointRef[] }
  >();
  for (const binding of bindings) {
    // The ID index keeps the last duplicate; drafts historically use the first.
    const annotation =
      context.annotationsById.size === document.annotations.length
        ? context.annotationsById.get(binding.annotationId)!
        : document.annotations.find(
            (item) => item.id === binding.annotationId,
          )!;
    if (
      annotation.binding?.kind === "net-name" &&
      (annotation.binding.memberEndpoint || annotation.binding.memberEndpoints)
    )
      continue;
    const label = resolveAnnotationName(
      document,
      annotation,
      logicalNets,
      readClaims,
    ).trim();
    if (label.length === 0) continue;
    const group = groups.get(label) ?? {
      kind: "net-label",
      endpoints: [],
    };
    group.endpoints.push(binding.endpoint);
    groups.set(label, group);
  }
  for (const annotation of context.annotationsByNetId.get(net.id) ?? []) {
    if (annotation.kind !== "power-label") {
      continue;
    }
    const binding = bindings.find(
      (candidate) => candidate.annotationId === annotation.id,
    );
    if (!binding) continue;
    const label = resolveAnnotationName(
      document,
      annotation,
      logicalNets,
      readClaims,
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

function buildObjectIndex(
  documents: ReadonlyMap<string, DocumentConnectivityIndex>,
): ProjectObjectIndex {
  return {
    resolve(documentId, objectId) {
      const documentIndex = documents.get(documentId);
      if (!documentIndex) return undefined;
      if (documentId === objectId) {
        return directObjectLocator(documentId, "document", objectId);
      }
      if (documentIndex.instancesById.has(objectId)) {
        return directObjectLocator(documentId, "instance", objectId);
      }
      if (documentIndex.netsById.has(objectId)) {
        return directObjectLocator(documentId, "net", objectId);
      }
      if (documentIndex.routesById.has(objectId)) {
        return directObjectLocator(documentId, "route", objectId);
      }
      if (documentIndex.junctionsById.has(objectId)) {
        return directObjectLocator(documentId, "junction", objectId);
      }
      if (documentIndex.annotationsById.has(objectId)) {
        return directObjectLocator(documentId, "annotation", objectId);
      }
      return undefined;
    },
  };
}

/** The local geometry, connectivity and object locators needed by diagnostic rules. */
export function buildCellDiagnosticIndex(
  document: SchematicDocument,
  resolver: SymbolResolver,
  ownership: "public" | "committed" = "public",
): Pick<ProjectConnectivityIndex, "documents" | "objectIndex"> {
  const shared = ownership === "committed" && isFrozenSnapshot(document);
  const documents = new Map([
    [document.id, buildDocumentIndex(document, resolver, false, shared)],
  ]);
  return { documents, objectIndex: buildObjectIndex(documents) };
}

function projectIndex(
  project: CircuitProject,
  resolver: SymbolResolver,
  reuseRestoredContent: boolean,
  shared: boolean,
): ProjectConnectivityIndex {
  const documents = new Map<string, DocumentConnectivityIndex>();
  for (const document of project.documents) {
    documents.set(
      document.id,
      buildDocumentIndex(document, resolver, reuseRestoredContent, shared),
    );
  }
  return {
    projectId: project.id,
    topDocumentId: project.topDocumentId,
    documents,
    ...buildProjectConnectivityRelations(
      project,
      resolver,
      documents,
      (index) => recordStates.get(index)?.globals ?? emptyGlobals,
      shared,
    ),
    objectIndex: buildObjectIndex(documents),
  };
}

export function buildProjectConnectivityIndex(
  project: CircuitProject,
  resolver: SymbolResolver,
  options?: { reuseRestoredContent: boolean },
): ProjectConnectivityIndex {
  return projectIndex(
    project,
    resolver,
    options?.reuseRestoredContent === true,
    false,
  );
}

/** Canvas and Agent reads consume immutable committed records, and return their own serializable results. */
export function buildCommittedProjectConnectivityIndex(
  project: CircuitProject,
  resolver: SymbolResolver,
): ProjectConnectivityIndex {
  return projectIndex(project, resolver, true, isFrozenSnapshot(project));
}
