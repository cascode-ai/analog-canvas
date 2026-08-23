import type { ProjectConnectivityIndex } from "./connectivity-index.js";
import type {
  EndpointRef,
  VirtualConnectivityEdge,
} from "./connectivity-index.js";
import type { RoutingGuide } from "./routing-guidance.js";
import { endpointKey } from "./endpoint.js";
import { findHierarchyPaths } from "./hierarchy-navigation.js";
import type { HierarchyFrame } from "./object-locator.js";

/**
 * Net highlight and cross-cell trace (ADR 0013 index / roadmap WP-R6 core).
 * Pure computation over the `ProjectConnectivityIndex`; the editor overlay that
 * paints the highlight is deferred to WP-R9.
 */

export interface NetHighlight {
  documentId: string;
  hierarchyPath: readonly HierarchyFrame[];
  netId: string;
  visibleEndpoints: readonly EndpointRef[];
  routes: readonly string[];
  junctions: readonly string[];
  virtualEdges: readonly VirtualConnectivityEdge[];
  routingGuidance: readonly RoutingGuide[];
}

export interface CrossCellTraceFrame {
  parentDocumentId: string;
  instanceId: string;
  parentPinName: string;
  childDocumentId: string;
  childTerminalName: string;
  childNetId: string;
}

export interface NetTrace {
  primary: NetHighlight;
  crossCell: readonly CrossCellTraceFrame[];
}

export interface HierarchyNetRef {
  documentId: string;
  netId: string;
  hierarchyPath: readonly HierarchyFrame[];
}

export interface HierarchyNetTraceHop {
  direction: "down" | "up";
  from: HierarchyNetRef;
  to: HierarchyNetRef;
  frame: CrossCellTraceFrame;
}

export interface GlobalNetTraceHop {
  direction: "global";
  from: HierarchyNetRef;
  to: HierarchyNetRef;
  foldedName: string;
}

export interface HierarchyNetTrace {
  primary: NetHighlight;
  /** One highlight for every reachable logical net, including the primary. */
  highlights: readonly NetHighlight[];
  /** Every concrete parent-instance/child-formal-terminal traversal edge. */
  hops: readonly (HierarchyNetTraceHop | GlobalNetTraceHop)[];
}

function hierarchyPathKey(path: readonly HierarchyFrame[]): string {
  return path
    .map(
      (frame) =>
        `${frame.parentDocumentId}/${frame.instanceId}/${frame.childDocumentId}`,
    )
    .join(">");
}

function sameHierarchyPath(
  left: readonly HierarchyFrame[],
  right: readonly HierarchyFrame[],
): boolean {
  return hierarchyPathKey(left) === hierarchyPathKey(right);
}

export function computeNetHighlight(
  index: ProjectConnectivityIndex,
  documentId: string,
  netId: string,
  origin?: EndpointRef,
  hierarchyPath: readonly HierarchyFrame[] = [],
): NetHighlight | undefined {
  const documentIndex = index.documents.get(documentId);
  const record =
    documentIndex?.logicalNets.get(netId) ??
    documentIndex?.logicalNetByBaseNetId.get(netId);
  if (!record) return undefined;
  const component =
    origin && record.baseNetIds.length === 1
      ? record.routedComponents.find((candidate) =>
          candidate.nodes.some((node) => node.key === endpointKey(origin)),
        )
      : undefined;
  if (origin && record.baseNetIds.length === 1 && !component) return undefined;
  const visibleEndpoints = component
    ? component.nodes.map((node) => node.endpoint)
    : record.visibleEndpoints;
  const visibleEndpointKeys = new Set(visibleEndpoints.map(endpointKey));
  return {
    documentId,
    hierarchyPath,
    netId,
    visibleEndpoints,
    routes: component?.routes ?? record.routes,
    junctions: component
      ? component.nodes.flatMap((node) =>
          node.endpoint.kind === "junction" ? [node.endpoint.junctionId] : [],
        )
      : record.junctions,
    virtualEdges: component
      ? record.virtualEdges.filter(
          (edge) =>
            visibleEndpointKeys.has(endpointKey(edge.from)) &&
            visibleEndpointKeys.has(endpointKey(edge.to)),
        )
      : record.virtualEdges,
    routingGuidance: record.routingGuidance,
  };
}

export function traceNet(
  index: ProjectConnectivityIndex,
  documentId: string,
  netId: string,
): NetTrace | undefined {
  const primary = computeNetHighlight(index, documentId, netId);
  if (!primary) return undefined;

  const parentEndpointToNet =
    index.documents.get(documentId)?.endpointToBaseNetId;
  const logicalRecord = index.documents
    .get(documentId)
    ?.logicalNetByBaseNetId.get(netId);
  const crossCell: CrossCellTraceFrame[] = [];
  for (const edge of index.hierarchy.edges) {
    if (edge.parentDocumentId !== documentId) continue;
    const parentPinKey = endpointKey({
      kind: "terminal",
      instanceId: edge.instanceId,
      pinName: edge.parentPinName,
    });
    const parentNetId = parentEndpointToNet?.get(parentPinKey);
    if (!parentNetId || !logicalRecord?.baseNetIds.includes(parentNetId)) {
      continue;
    }
    crossCell.push({
      parentDocumentId: edge.parentDocumentId,
      instanceId: edge.instanceId,
      parentPinName: edge.parentPinName,
      childDocumentId: edge.childDocumentId,
      childTerminalName: edge.childTerminalName,
      childNetId: edge.childNetId,
    });
  }

  crossCell.sort(
    (left, right) =>
      left.instanceId.localeCompare(right.instanceId, "en") ||
      left.parentPinName.localeCompare(right.parentPinName, "en"),
  );

  return { primary, crossCell };
}

/**
 * Traverse hierarchy connectivity in both directions. The visited key is the
 * logical document/net pair, preventing cyclic hierarchy projects from looping;
 * hops are retained independently so two parent instances of one child Cell
 * remain distinguishable to a later hierarchy-aware UI.
 */
export function traceHierarchyNet(
  index: ProjectConnectivityIndex,
  documentId: string,
  netId: string,
  origin?: EndpointRef,
  hierarchyPath: readonly HierarchyFrame[] = [],
): HierarchyNetTrace | undefined {
  const primary = computeNetHighlight(
    index,
    documentId,
    netId,
    origin,
    hierarchyPath,
  );
  if (!primary) return undefined;
  const canonicalRef = (ref: HierarchyNetRef): HierarchyNetRef => ({
    documentId: ref.documentId,
    hierarchyPath: ref.hierarchyPath,
    netId:
      index.documents.get(ref.documentId)?.logicalNetByBaseNetId.get(ref.netId)
        ?.netId ?? ref.netId,
  });
  const queue: HierarchyNetRef[] = [
    canonicalRef({ documentId, netId, hierarchyPath }),
  ];
  const visited = new Set<string>();
  const highlights: NetHighlight[] = [];
  const hops: Array<HierarchyNetTraceHop | GlobalNetTraceHop> = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const pathKey = hierarchyPathKey(current.hierarchyPath);
    const key = `${pathKey}\u0000${current.documentId}\u0000${current.netId}`;
    if (visited.has(key)) continue;
    const highlight =
      current.documentId === documentId &&
      current.netId === primary.netId &&
      sameHierarchyPath(current.hierarchyPath, hierarchyPath)
        ? computeNetHighlight(
            index,
            current.documentId,
            current.netId,
            origin,
            current.hierarchyPath,
          )
        : computeNetHighlight(
            index,
            current.documentId,
            current.netId,
            undefined,
            current.hierarchyPath,
          );
    if (!highlight) continue;
    visited.add(key);
    highlights.push(highlight);
    const currentDocumentIndex = index.documents.get(current.documentId);
    const endpointToNet = currentDocumentIndex?.endpointToBaseNetId;
    const currentRecord =
      currentDocumentIndex?.logicalNets.get(current.netId) ??
      currentDocumentIndex?.logicalNetByBaseNetId.get(current.netId);

    for (const edge of index.hierarchy.edges) {
      if (edge.parentDocumentId === current.documentId) {
        const parentNetId = endpointToNet?.get(
          endpointKey({
            kind: "terminal",
            instanceId: edge.instanceId,
            pinName: edge.parentPinName,
          }),
        );
        if (!parentNetId || !currentRecord?.baseNetIds.includes(parentNetId)) {
          continue;
        }
        const frame: CrossCellTraceFrame = { ...edge };
        const to = canonicalRef({
          documentId: edge.childDocumentId,
          netId: edge.childNetId,
          hierarchyPath: [
            ...current.hierarchyPath,
            {
              parentDocumentId: edge.parentDocumentId,
              instanceId: edge.instanceId,
              childDocumentId: edge.childDocumentId,
            },
          ],
        });
        hops.push({ direction: "down", from: current, to, frame });
        queue.push(to);
      }
      if (edge.childDocumentId === current.documentId) {
        const caller = current.hierarchyPath.at(-1);
        if (
          !caller ||
          caller.parentDocumentId !== edge.parentDocumentId ||
          caller.instanceId !== edge.instanceId ||
          caller.childDocumentId !== edge.childDocumentId
        ) {
          continue;
        }
        if (!currentRecord?.baseNetIds.includes(edge.childNetId)) continue;
        const parentNetId = index.documents
          .get(edge.parentDocumentId)
          ?.endpointToBaseNetId.get(
            endpointKey({
              kind: "terminal",
              instanceId: edge.instanceId,
              pinName: edge.parentPinName,
            }),
          );
        if (!parentNetId) continue;
        const frame: CrossCellTraceFrame = { ...edge };
        const to = canonicalRef({
          documentId: edge.parentDocumentId,
          netId: parentNetId,
          hierarchyPath: current.hierarchyPath.slice(0, -1),
        });
        hops.push({ direction: "up", from: current, to, frame });
        queue.push(to);
      }
    }

    const globalRecord = currentRecord;
    // The index record intentionally contains no persisted name. Resolve the
    // group through the global map by matching the stable local Net reference.
    const group = [...index.globalNets.values()].find((candidate) =>
      candidate.nets.some(
        (ref) =>
          ref.documentId === current.documentId && ref.netId === current.netId,
      ),
    );
    if (globalRecord && group) {
      for (const target of group.nets) {
        const targetPaths =
          target.documentId === index.topDocumentId
            ? [[]]
            : (findHierarchyPaths(
                index,
                index.topDocumentId,
                target.documentId,
              ) ?? [[]]);
        for (const targetPath of targetPaths) {
          const to = canonicalRef({ ...target, hierarchyPath: targetPath });
          const samePath = sameHierarchyPath(targetPath, current.hierarchyPath);
          if (
            to.documentId === current.documentId &&
            to.netId === current.netId &&
            samePath
          ) {
            continue;
          }
          hops.push({
            direction: "global",
            from: current,
            to,
            foldedName: group.foldedName,
          });
          queue.push(to);
        }
      }
    }
  }

  highlights.sort((left, right) =>
    `${left.documentId}\u0000${left.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${left.netId}`.localeCompare(
      `${right.documentId}\u0000${right.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${right.netId}`,
      "en",
    ),
  );
  hops.sort((left, right) => {
    const leftSuffix =
      left.direction === "global"
        ? left.foldedName
        : `${left.frame.instanceId}\u0000${left.frame.parentPinName}`;
    const rightSuffix =
      right.direction === "global"
        ? right.foldedName
        : `${right.frame.instanceId}\u0000${right.frame.parentPinName}`;
    return `${left.direction}\u0000${left.from.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${left.from.documentId}\u0000${left.from.netId}\u0000${leftSuffix}`.localeCompare(
      `${right.direction}\u0000${right.from.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${right.from.documentId}\u0000${right.from.netId}\u0000${rightSuffix}`,
      "en",
    );
  });
  return { primary, highlights, hops };
}
