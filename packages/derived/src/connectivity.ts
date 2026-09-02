import { deriveStableId, flattenRichText, routeEnd } from "@icm/model";
import type { Net, Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  endpointKey,
  isVisibleEndpoint,
  netEndpoints,
  resolveEndpointPoint,
} from "./endpoint.js";
import { deriveDocumentContactEvidence } from "./contact.js";
import { resolveNetLabelBindings } from "./net-label.js";
import { resolveAnnotationText } from "./annotation-text.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";
import {
  deriveRoutingGuidance,
  type NetGuidanceGraph,
  type RoutingGuide,
} from "./routing-guidance.js";
import {
  buildDocumentDerivedContext,
  type DocumentDerivedContext,
} from "./document-derived-context.js";

export interface VisibleConnectivityNode {
  key: string;
  endpoint: RouteEndpoint;
  point: Point | null;
}

export interface RoutedComponent {
  id: string;
  netId: string;
  nodes: VisibleConnectivityNode[];
  /** Stored Routes whose endpoints belong to this visible component. */
  routes: string[];
}

export interface VisibleNetConnectivity {
  netId: string;
  components: RoutedComponent[];
}

/** @deprecated Use RoutingGuide for new consumers. */
export type Flightline = RoutingGuide;

class DisjointSet {
  readonly #parent = new Map<string, string>();

  add(key: string): void {
    if (!this.#parent.has(key)) this.#parent.set(key, key);
  }

  find(key: string): string {
    const parent = this.#parent.get(key);
    if (!parent) throw new Error(`Unknown visible-connectivity node: ${key}`);
    if (parent === key) return key;
    const root = this.find(parent);
    this.#parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort((a, b) =>
      a.localeCompare(b, "en"),
    );
    this.#parent.set(second!, first!);
  }
}

/**
 * Shared per-document context for connectivity derivation. Deriving it once
 * and passing it through turns an all-nets sweep from quadratic (full
 * contact evidence and label bindings re-derived per net) into one pass.
 */
/** @deprecated Use DocumentDerivedContext for new shared consumers. */
export type NetConnectivityContext = DocumentDerivedContext;

const visibleConnectivityByContext = new WeakMap<
  DocumentDerivedContext,
  Map<string, VisibleNetConnectivity>
>();

export function deriveNetConnectivityContext(
  document: SchematicDocument,
  resolver: SymbolResolver,
): NetConnectivityContext {
  return buildDocumentDerivedContext(document, resolver);
}

export function deriveNetConnectivity(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: Net,
  context?: NetConnectivityContext,
): VisibleNetConnectivity {
  if (
    context &&
    (context.documentId !== document.id ||
      context.documentRevision !== document.revision)
  ) {
    throw new Error("Connectivity received a stale DocumentDerivedContext");
  }
  const contextCache = context
    ? (visibleConnectivityByContext.get(context) ?? new Map())
    : undefined;
  if (context && !visibleConnectivityByContext.has(context)) {
    visibleConnectivityByContext.set(context, contextCache!);
  }
  const cached = contextCache?.get(net.id);
  if (cached) return cached;
  const endpoints = netEndpoints(document, net).filter((endpoint) =>
    isVisibleEndpoint(document, resolver, endpoint, context),
  );
  const nodes = new Map(
    endpoints.map((endpoint) => {
      const key = endpointKey(endpoint);
      return [
        key,
        {
          key,
          endpoint,
          point:
            context?.endpointConnections.get(key)?.contactPoint ??
            resolveEndpointPoint(document, resolver, endpoint, context),
        },
      ];
    }),
  );
  const sets = new DisjointSet();
  for (const key of nodes.keys()) sets.add(key);
  const routesForNet =
    context?.routesByNetId.get(net.id) ??
    document.routes.filter((candidate) => candidate.netId === net.id);
  for (const route of routesForNet) {
    const from = endpointKey(route.start);
    const to = endpointKey(routeEnd(route));
    if (nodes.has(from) && nodes.has(to)) sets.union(from, to);
  }
  const contacts = context
    ? (context.contactsByNetId.get(net.id) ?? [])
    : deriveDocumentContactEvidence(document, resolver).contacts.filter(
        (candidate) => candidate.netId === net.id,
      );
  for (const contact of contacts) {
    const keys = contact.endpoints
      .map(endpointKey)
      .filter((key) => nodes.has(key));
    const first = keys[0];
    if (!first) continue;
    for (const key of keys.slice(1)) sets.union(first, key);
  }
  const labeledEndpoints = new Map<string, string[]>();
  const netLabelBindings = context
    ? (context.netLabelBindingsByNetId.get(net.id) ?? [])
    : resolveNetLabelBindings(document, resolver, net.id);
  for (const binding of netLabelBindings) {
    const annotation =
      context?.annotationsById.get(binding.annotationId) ??
      document.annotations.find(
        (candidate) => candidate.id === binding.annotationId,
      )!;
    const label = flattenRichText(
      resolveAnnotationText(document, annotation),
    ).trim();
    const key = endpointKey(binding.endpoint);
    if (label.length === 0 || !nodes.has(key)) continue;
    const group = labeledEndpoints.get(label) ?? [];
    group.push(key);
    labeledEndpoints.set(label, group);
  }
  for (const annotation of context?.annotationsByNetId.get(net.id) ??
    document.annotations) {
    if (annotation.kind !== "power-label" || annotation.netId !== net.id) {
      continue;
    }
    const binding = netLabelBindings.find(
      (candidate) => candidate.annotationId === annotation.id,
    );
    if (!binding) continue;
    const key = endpointKey(binding.endpoint);
    if (!nodes.has(key)) continue;
    const label = flattenRichText(
      resolveAnnotationText(document, annotation),
    ).trim();
    if (label.length === 0) continue;
    const group = labeledEndpoints.get(label) ?? [];
    group.push(key);
    labeledEndpoints.set(label, group);
  }
  for (const keys of labeledEndpoints.values()) {
    const first = keys[0];
    if (!first) continue;
    for (const key of keys.slice(1)) sets.union(first, key);
  }
  const grouped = new Map<string, VisibleConnectivityNode[]>();
  for (const node of nodes.values()) {
    const root = sets.find(node.key);
    const group = grouped.get(root) ?? [];
    group.push(node);
    grouped.set(root, group);
  }
  const components = [...grouped.values()]
    .map((componentNodes) => {
      componentNodes.sort((left, right) =>
        left.key.localeCompare(right.key, "en"),
      );
      const componentNodeKeys = new Set(componentNodes.map((node) => node.key));
      return {
        id: deriveStableId("component", net.id, componentNodes[0]!.key),
        netId: net.id,
        nodes: componentNodes,
        routes: routesForNet
          .filter(
            (route) =>
              componentNodeKeys.has(endpointKey(route.start)) ||
              componentNodeKeys.has(endpointKey(routeEnd(route))),
          )
          .map((route) => route.id)
          .sort((left, right) => left.localeCompare(right, "en")),
      };
    })
    .sort((left, right) =>
      left.nodes[0]!.key.localeCompare(right.nodes[0]!.key, "en"),
    );
  const result = { netId: net.id, components };
  contextCache?.set(net.id, result);
  return result;
}

export function deriveVisibleConnectivity(
  document: SchematicDocument,
  resolver: SymbolResolver,
): VisibleNetConnectivity[] {
  const context = deriveNetConnectivityContext(document, resolver);
  return [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((net) => deriveNetConnectivity(document, resolver, net, context));
}

function flightlineNodePriority(
  document: SchematicDocument,
  node: VisibleConnectivityNode,
  context?: DocumentDerivedContext,
): number {
  if (node.endpoint.kind !== "junction") return 1;
  const junctionId = node.endpoint.junctionId;
  const junction =
    context?.junctionsById.get(junctionId) ??
    document.junctions.find((candidate) => candidate.id === junctionId);
  const degree = context
    ? (context.routeDegreeByEndpointKey.get(endpointKey(node.endpoint)) ?? 0)
    : document.routes.filter((route) => {
        const end = routeEnd(route);
        return (
          (route.start.kind === "junction" &&
            route.start.junctionId === junctionId) ||
          (end.kind === "junction" && end.junctionId === junctionId)
        );
      }).length;
  return junction?.role === "route-anchor" && degree <= 1 ? 0 : 2;
}

function guidanceGraphForNet(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: Net,
  context?: DocumentDerivedContext,
): NetGuidanceGraph | null {
  // A named global Net is already an explicit semantic bridge. Multiple
  // Ground/VDD markers may intentionally have no visible trunk between them.
  const logicalNet = (
    context?.logicalNetResolution ?? resolveDocumentLogicalNets(document)
  ).byBaseNetId.get(net.id);
  if (logicalNet?.scope === "global" && logicalNet.name) return null;
  const components = deriveNetConnectivity(document, resolver, net, context)
    .components.map((component) => ({
      id: component.id,
      netId: net.id,
      nodes: component.nodes.flatMap((node) =>
        node.point === null
          ? []
          : [
              {
                key: node.key,
                endpoint: node.endpoint,
                point: node.point,
                priority: flightlineNodePriority(document, node, context),
              },
            ],
      ),
    }))
    .filter((component) => component.nodes.length > 0);
  return { netId: net.id, components };
}

function importedGuidanceGraph(
  document: SchematicDocument,
  resolver: SymbolResolver,
  sourceNetId: string,
  baseNetIds: readonly string[],
  context?: DocumentDerivedContext,
): NetGuidanceGraph | null {
  const baseNetIdSet = new Set(baseNetIds);
  const logicalNets =
    context?.logicalNetResolution ?? resolveDocumentLogicalNets(document);
  const logicalGroups = new Map(
    baseNetIds.flatMap((baseNetId) => {
      const group = logicalNets.byBaseNetId.get(baseNetId);
      return group ? [[group.id, group] as const] : [];
    }),
  );
  if (
    logicalGroups.size === 1 &&
    [...logicalGroups.values()].every(
      (group) => group.scope === "global" && Boolean(group.name),
    )
  ) {
    return null;
  }
  const components = document.nets
    .filter((net) => baseNetIdSet.has(net.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap(
      (net) =>
        guidanceGraphForNet(document, resolver, net, context)?.components ?? [],
    );
  const representativeNetId = baseNetIdSet.has(sourceNetId)
    ? sourceNetId
    : [...baseNetIdSet].sort((left, right) =>
        left.localeCompare(right, "en"),
      )[0];
  return representativeNetId
    ? { netId: representativeNetId, sourceNetId, components }
    : null;
}

/**
 * Compatibility adapter for callers that need visible-guidance candidates for
 * every Net. Product UI should use deriveImportedRoutingGuidance instead.
 */
export function deriveFlightlines(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Flightline[] {
  const context = deriveNetConnectivityContext(document, resolver);
  return [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((net) => {
      const graph = guidanceGraphForNet(document, resolver, net, context);
      return graph ? deriveRoutingGuidance(graph) : [];
    });
}

/**
 * Routing assistance for topology imported from SPICE. Hand-authored Nets are
 * deliberately excluded even when they share a source-bound Document.
 */
export function deriveImportedRoutingGuidance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  context = deriveNetConnectivityContext(document, resolver),
): RoutingGuide[] {
  const baseNetIdsBySource = new Map<string, Set<string>>();
  for (const evidence of document.connectivityEvidence) {
    if (evidence.kind !== "spice-source") continue;
    const netIds = baseNetIdsBySource.get(evidence.sourceNetId) ?? new Set();
    netIds.add(evidence.netId);
    baseNetIdsBySource.set(evidence.sourceNetId, netIds);
  }
  return [...baseNetIdsBySource]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .flatMap(([sourceNetId, baseNetIds]) => {
      const graph = importedGuidanceGraph(
        document,
        resolver,
        sourceNetId,
        [...baseNetIds],
        context,
      );
      return graph ? deriveRoutingGuidance(graph) : [];
    });
}
