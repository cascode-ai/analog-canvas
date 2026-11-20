import { foldNetName } from "@icm/model";
import type {
  GlobalNetGroup,
  ProjectConnectivityIndex,
} from "./connectivity-index.js";
import type {
  EndpointRef,
  HierarchyEdge,
  VirtualConnectivityEdge,
} from "./connectivity-index.js";
import type { RoutingGuide } from "./routing-guidance.js";
import { endpointKey } from "./endpoint.js";
import { findHierarchyPaths } from "./hierarchy-navigation.js";
import type { HierarchyFrame } from "./object-locator.js";

/**
 * Net highlight and occurrence-aware cross-Cell trace (Net connectivity rationale).
 * Pure computation over the Project connectivity index.
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

export type CrossCellTraceFrame = HierarchyEdge;

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

type TraceHop = HierarchyNetTraceHop | GlobalNetTraceHop;

/** The editor can visit any ordered hop without constructing the others. */
export interface HierarchyNetTraceView extends Omit<HierarchyNetTrace, "hops"> {
  hops: Pick<readonly TraceHop[], "length" | "at">;
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

function occurrenceKey(ref: HierarchyNetRef): string {
  return `${hierarchyPathKey(ref.hierarchyPath)}\u0000${ref.documentId}\u0000${ref.netId}`;
}

interface HopRun {
  key: string;
  length: number;
  hopAt(offset: number): TraceHop;
}

function hopOrder(
  direction: TraceHop["direction"],
  from: HierarchyNetRef,
  suffix: string,
): string {
  return `${direction}\u0000${from.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${from.documentId}\u0000${from.netId}\u0000${suffix}`;
}

function hierarchyRun(hop: HierarchyNetTraceHop): HopRun {
  const { frame } = hop;
  return {
    key: hopOrder(
      hop.direction,
      hop.from,
      `${frame.instanceId}\u0000${frame.parentPinName}\u0000${frame.parentMemberId ?? ""}`,
    ),
    length: 1,
    hopAt: () => hop,
  };
}

interface GlobalOccurrences {
  targets: HierarchyNetRef[];
  positions: Map<string, number[]>;
}

function globalRun(
  group: GlobalNetGroup,
  occurrences: GlobalOccurrences,
  from: HierarchyNetRef,
): HopRun {
  const excluded = occurrences.positions.get(occurrenceKey(from)) ?? [];
  return {
    key: hopOrder("global", from, group.foldedName),
    length: occurrences.targets.length - excluded.length,
    hopAt(offset) {
      // The original directed traversal visits all targets except this occurrence.
      for (const i of excluded) {
        if (i > offset) break;
        offset++;
      }
      return {
        direction: "global",
        from,
        to: occurrences.targets[offset]!,
        foldedName: group.foldedName,
      };
    },
  };
}

function orderedHops(runs: HopRun[]): HierarchyNetTraceView["hops"] {
  runs.sort((left, right) => left.key.localeCompare(right.key, "en"));
  let length = 0;
  const ends = runs.map((run) => (length += run.length));
  return {
    length,
    at(index) {
      const offset = Math.trunc(index) || 0;
      const row = offset < 0 ? length + offset : offset;
      if (row < 0 || row >= length) return undefined;
      let low = 0;
      let high = ends.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (row < ends[mid]!) high = mid;
        else low = mid + 1;
      }
      return runs[low]!.hopAt(row - (ends[low]! - runs[low]!.length));
    },
  };
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

/**
 * Traverse hierarchy connectivity in both directions. The visited key is the
 * concrete occurrence path and logical document/net pair;
 * hops are retained independently so two parent instances of one child Cell
 * remain distinguishable to a later hierarchy-aware UI.
 */
export function traceHierarchyNetView(
  index: ProjectConnectivityIndex,
  documentId: string,
  netId: string,
  origin?: EndpointRef,
  hierarchyPath: readonly HierarchyFrame[] = [],
): HierarchyNetTraceView | undefined {
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
  const runs: HopRun[] = [];
  const globalOccurrences = new Map<GlobalNetGroup, GlobalOccurrences>();
  const pathsByCell = new Map<string, readonly (readonly HierarchyFrame[])[]>();

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    const key = occurrenceKey(current);
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
            ...(edge.parentMemberId ? { memberId: edge.parentMemberId } : {}),
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
        runs.push(
          hierarchyRun({ direction: "down", from: current, to, frame }),
        );
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
              ...(edge.parentMemberId ? { memberId: edge.parentMemberId } : {}),
            }),
          );
        if (!parentNetId) continue;
        const frame: CrossCellTraceFrame = { ...edge };
        const to = canonicalRef({
          documentId: edge.parentDocumentId,
          netId: parentNetId,
          hierarchyPath: current.hierarchyPath.slice(0, -1),
        });
        runs.push(hierarchyRun({ direction: "up", from: current, to, frame }));
        queue.push(to);
      }
    }

    const logicalNet = currentDocumentIndex?.logicalNetResolution.byId.get(
      current.netId,
    );
    const group =
      logicalNet?.scope === "global" && logicalNet.name
        ? index.globalNets.get(foldNetName(logicalNet.name))
        : undefined;
    if (!group) continue;
    let occurrences = globalOccurrences.get(group);
    if (!occurrences) {
      occurrences = { targets: [], positions: new Map() };
      for (const target of group.nets) {
        let targetPaths = pathsByCell.get(target.documentId);
        if (!targetPaths) {
          targetPaths = findHierarchyPaths(
            index,
            index.topDocumentId,
            target.documentId,
          ) ?? [[]];
          pathsByCell.set(target.documentId, targetPaths);
        }
        for (const targetPath of targetPaths) {
          const to = canonicalRef({ ...target, hierarchyPath: targetPath });
          const targetKey = occurrenceKey(to);
          const positions = occurrences.positions.get(targetKey) ?? [];
          positions.push(occurrences.targets.length);
          occurrences.positions.set(targetKey, positions);
          occurrences.targets.push(to);
          queue.push(to);
        }
      }
      globalOccurrences.set(group, occurrences);
    }
    runs.push(globalRun(group, occurrences, current));
  }

  highlights.sort((left, right) =>
    `${left.documentId}\u0000${left.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${left.netId}`.localeCompare(
      `${right.documentId}\u0000${right.hierarchyPath.map((frame) => frame.instanceId).join("/")}\u0000${right.netId}`,
      "en",
    ),
  );
  return { primary, highlights, hops: orderedHops(runs) };
}

/** Materialize every ordered edge for complete reads, including Agent snapshots. */
export function traceHierarchyNet(
  index: ProjectConnectivityIndex,
  documentId: string,
  netId: string,
  origin?: EndpointRef,
  hierarchyPath: readonly HierarchyFrame[] = [],
): HierarchyNetTrace | undefined {
  const view = traceHierarchyNetView(
    index,
    documentId,
    netId,
    origin,
    hierarchyPath,
  );
  if (!view) return undefined;
  const hops = Array.from({ length: view.hops.length }, (_, i) =>
    view.hops.at(i)!,
  );
  return { primary: view.primary, highlights: view.highlights, hops };
}
