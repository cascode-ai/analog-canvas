import { deriveStableId, flattenRichText } from "@icm/model";
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

export function deriveNetConnectivity(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: Net,
): VisibleNetConnectivity {
  const endpoints = netEndpoints(document, net).filter((endpoint) =>
    isVisibleEndpoint(document, resolver, endpoint),
  );
  const nodes = new Map(
    endpoints.map((endpoint) => {
      const key = endpointKey(endpoint);
      return [
        key,
        {
          key,
          endpoint,
          point: resolveEndpointPoint(document, resolver, endpoint),
        },
      ];
    }),
  );
  const sets = new DisjointSet();
  for (const key of nodes.keys()) sets.add(key);
  for (const route of document.routes.filter(
    (candidate) => candidate.netId === net.id,
  )) {
    const from = endpointKey(route.from);
    const to = endpointKey(route.to);
    if (nodes.has(from) && nodes.has(to)) sets.union(from, to);
  }
  const contacts = deriveDocumentContactEvidence(document, resolver);
  for (const contact of contacts.contacts.filter(
    (candidate) => candidate.netId === net.id,
  )) {
    const keys = contact.endpoints
      .map(endpointKey)
      .filter((key) => nodes.has(key));
    const first = keys[0];
    if (!first) continue;
    for (const key of keys.slice(1)) sets.union(first, key);
  }
  const labeledEndpoints = new Map<string, string[]>();
  for (const binding of resolveNetLabelBindings(document, resolver, net.id)) {
    const annotation = document.annotations.find(
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
  for (const annotation of document.annotations) {
    if (annotation.kind !== "power-label" || annotation.netId !== net.id) {
      continue;
    }
    const binding = resolveNetLabelBindings(document, resolver, net.id).find(
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
      return {
        id: deriveStableId("component", net.id, componentNodes[0]!.key),
        netId: net.id,
        nodes: componentNodes,
        routes: document.routes
          .filter(
            (route) =>
              route.netId === net.id &&
              componentNodes.some(
                (node) =>
                  node.key === endpointKey(route.from) ||
                  node.key === endpointKey(route.to),
              ),
          )
          .map((route) => route.id)
          .sort((left, right) => left.localeCompare(right, "en")),
      };
    })
    .sort((left, right) =>
      left.nodes[0]!.key.localeCompare(right.nodes[0]!.key, "en"),
    );
  return { netId: net.id, components };
}

export function deriveVisibleConnectivity(
  document: SchematicDocument,
  resolver: SymbolResolver,
): VisibleNetConnectivity[] {
  return [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((net) => deriveNetConnectivity(document, resolver, net));
}

function flightlineNodePriority(
  document: SchematicDocument,
  node: VisibleConnectivityNode,
): number {
  if (node.endpoint.kind !== "junction") return 1;
  const junctionId = node.endpoint.junctionId;
  const junction = document.junctions.find(
    (candidate) => candidate.id === junctionId,
  );
  const degree = document.routes.filter(
    (route) =>
      (route.from.kind === "junction" &&
        route.from.junctionId === junctionId) ||
      (route.to.kind === "junction" && route.to.junctionId === junctionId),
  ).length;
  return junction?.role === "route-anchor" && degree <= 1 ? 0 : 2;
}

function guidanceGraphForNet(
  document: SchematicDocument,
  resolver: SymbolResolver,
  net: Net,
): NetGuidanceGraph | null {
  // A named global Net is already an explicit semantic bridge. Multiple
  // Ground/VDD markers may intentionally have no visible trunk between them.
  const logicalNet = resolveDocumentLogicalNets(document).byBaseNetId.get(
    net.id,
  );
  if (logicalNet?.scope === "global" && logicalNet.name) return null;
  const components = deriveNetConnectivity(document, resolver, net)
    .components.map((component) => ({
      id: component.id,
      nodes: component.nodes.flatMap((node) =>
        node.point === null
          ? []
          : [
              {
                key: node.key,
                endpoint: node.endpoint,
                point: node.point,
                priority: flightlineNodePriority(document, node),
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
  logicalNetId: string,
  baseNetIds: readonly string[],
): NetGuidanceGraph | null {
  const logicalNet =
    resolveDocumentLogicalNets(document).byId.get(logicalNetId);
  if (logicalNet?.scope === "global" && logicalNet.name) return null;
  const baseNetIdSet = new Set(baseNetIds);
  const components = document.nets
    .filter((net) => baseNetIdSet.has(net.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap(
      (net) => guidanceGraphForNet(document, resolver, net)?.components ?? [],
    );
  return { netId: logicalNetId, components };
}

/**
 * Compatibility adapter for callers that need visible-guidance candidates for
 * every Net. Product UI should use deriveImportedRoutingGuidance instead.
 */
export function deriveFlightlines(
  document: SchematicDocument,
  resolver: SymbolResolver,
): Flightline[] {
  return [...document.nets]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .flatMap((net) => {
      const graph = guidanceGraphForNet(document, resolver, net);
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
): RoutingGuide[] {
  return resolveDocumentLogicalNets(document)
    .groups.filter((logicalNet) => logicalNet.sourceNetIds.length > 0)
    .flatMap((logicalNet) => {
      const graph = importedGuidanceGraph(
        document,
        resolver,
        logicalNet.id,
        logicalNet.baseNetIds,
      );
      return graph ? deriveRoutingGuidance(graph) : [];
    });
}
