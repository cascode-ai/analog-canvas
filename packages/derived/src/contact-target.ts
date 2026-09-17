import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { endpointKey } from "./endpoint.js";
import { deriveVisibleConnectivity } from "./connectivity.js";
import type { RoutedComponent } from "./connectivity.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { unitDirection } from "./segment-geometry.js";

export type ElectricalContactCandidate =
  | {
      kind: "endpoint";
      id: string;
      point: Point;
      netId: string | null;
      endpoint: RouteEndpoint;
    }
  | {
      kind: "route";
      id: string;
      point: Point;
      netId: string;
      routeId: string;
      segmentIndex: number;
    };

export interface ElectricalContactTarget {
  /** Stable identity of one actually connected visible conductor. */
  conductorId: string;
  point: Point;
  netId: string | null;
  candidates: readonly ElectricalContactCandidate[];
  endpoint?: Extract<ElectricalContactCandidate, { kind: "endpoint" }>;
  route?: Extract<ElectricalContactCandidate, { kind: "route" }>;
}

/**
 * Collapse raw SVG/snap hits into electrical conductors.
 *
 * Two segments at one Route corner, a pin plus its incident Route, or a
 * Junction plus all of its branches are one target. Two geometrically crossing
 * but visibly disconnected components stay separate even when storage happens
 * to assign them the same Net id.
 */
export function resolveElectricalContactTargets(
  document: SchematicDocument,
  resolver: SymbolResolver,
  candidates: readonly ElectricalContactCandidate[],
  precomputedComponents?: readonly RoutedComponent[],
): ElectricalContactTarget[] {
  const endpointComponents = new Map<string, string>();
  const routeComponents = new Map<string, string>();
  const components =
    precomputedComponents ??
    deriveVisibleConnectivity(document, resolver).flatMap(
      (net) => net.components,
    );
  for (const component of components) {
    for (const node of component.nodes) {
      endpointComponents.set(node.key, component.id);
    }
    for (const routeId of component.routes) {
      routeComponents.set(routeId, component.id);
    }
  }
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const collinearSignature = (
    candidate: Extract<ElectricalContactCandidate, { kind: "route" }>,
  ): string | null => {
    const segment = routingGeometry.routes
      .get(candidate.routeId)
      ?.segments.find(
        (entry) => entry.address.segmentIndex === candidate.segmentIndex,
      );
    const direction = segment ? unitDirection(segment.from, segment.to) : null;
    if (!direction) return null;
    const canonical =
      direction.x < 0 || (direction.x === 0 && direction.y < 0)
        ? { x: -direction.x, y: -direction.y }
        : direction;
    return [
      candidate.netId,
      candidate.point.x,
      candidate.point.y,
      canonical.x.toFixed(9),
      canonical.y.toFixed(9),
    ].join(":");
  };
  const collinearCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.kind !== "route") continue;
    const signature = collinearSignature(candidate);
    if (!signature) continue;
    collinearCounts.set(signature, (collinearCounts.get(signature) ?? 0) + 1);
  }
  // A candidate joins its visible component, and a collinear same-Net overlap
  // joins its overlapping partners. Overlap only merges: the two collinear
  // arms of a T-Junction must stay one target with the Junction and its
  // perpendicular arm, not become a second target beside them.
  const parent = candidates.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index]!;
    return index;
  };
  const keys = candidates.map(() => [] as string[]);
  const firstByKey = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const signature =
      candidate.kind === "route" ? collinearSignature(candidate) : null;
    const componentId =
      candidate.kind === "endpoint"
        ? endpointComponents.get(endpointKey(candidate.endpoint))
        : routeComponents.get(candidate.routeId);
    const candidateKeys = [
      componentId ??
        (candidate.kind === "endpoint"
          ? `endpoint:${endpointKey(candidate.endpoint)}`
          : `route:${candidate.routeId}`),
      ...(signature && (collinearCounts.get(signature) ?? 0) > 1
        ? [`collinear:${signature}`]
        : []),
    ];
    for (const key of candidateKeys) {
      keys[index]!.push(key);
      const first = firstByKey.get(key);
      if (first === undefined) {
        firstByKey.set(key, index);
        continue;
      }
      const [left, right] = [root(first), root(index)];
      if (left !== right) parent[Math.max(left, right)] = Math.min(left, right);
    }
  });
  const grouped = new Map<number, number[]>();
  candidates.forEach((_, index) => {
    const group = root(index);
    grouped.set(group, [...(grouped.get(group) ?? []), index]);
  });
  return [...grouped.values()]
    .map((members) => {
      // The smallest key names the conductor, independent of candidate order.
      const conductorId = members.flatMap((index) => keys[index]!).sort()[0]!;
      const sorted = members
        .map((index) => candidates[index]!)
        .sort((left, right) => left.id.localeCompare(right.id, "en"));
      const endpoint = sorted.find(
        (
          candidate,
        ): candidate is Extract<
          ElectricalContactCandidate,
          { kind: "endpoint" }
        > => candidate.kind === "endpoint",
      );
      const route = sorted.find(
        (
          candidate,
        ): candidate is Extract<
          ElectricalContactCandidate,
          { kind: "route" }
        > => candidate.kind === "route",
      );
      return {
        conductorId,
        point: { ...sorted[0]!.point },
        netId: sorted[0]!.netId,
        candidates: sorted,
        ...(endpoint ? { endpoint } : {}),
        ...(route ? { route } : {}),
      };
    })
    .sort((left, right) => left.conductorId.localeCompare(right.conductorId));
}
