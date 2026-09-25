import { deriveStableId } from "@icm/model";
import type { Point, RouteEndpoint } from "@icm/model";

/** A device-neutral visible graph node supplied by the connectivity adapter. */
export interface RoutingGuidanceNode {
  key: string;
  endpoint: RouteEndpoint;
  point: Point;
  /** Deterministic upstream tie-breaker; lower values win. */
  priority: number;
}

export interface RoutingGuidanceComponent {
  id: string;
  /** Representative Base Net; semantic drawing edges may span several Nets. */
  netId: string | null;
  nodes: readonly RoutingGuidanceNode[];
}

export interface NetGuidanceGraph {
  /** Current representative Base Net used only for guide grouping/focus. */
  netId: string;
  /** Original imported Net identity; never an electrical Net authority. */
  sourceNetId?: string;
  components: readonly RoutingGuidanceComponent[];
}

/** A derived, non-persisted route suggestion between visible components. */
export interface RoutingGuide {
  id: string;
  /** Current representative Base Net used for grouping and focus. */
  netId: string;
  /** Actual current Base Nets at the endpoints; null means electrically unbound. */
  fromNetId: string | null;
  toNetId: string | null;
  /** Original imported Net identity when this is source routing guidance. */
  sourceNetId?: string;
  from: RouteEndpoint;
  to: RouteEndpoint;
  fromPoint: Point;
  toPoint: Point;
  distance: number;
}

class DisjointSet {
  readonly #parent = new Map<string, string>();

  add(key: string): void {
    if (!this.#parent.has(key)) this.#parent.set(key, key);
  }

  find(key: string): string {
    const parent = this.#parent.get(key);
    if (!parent) throw new Error(`Unknown routing-guidance component: ${key}`);
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

function straightLineDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/**
 * Pure MST guidance calculation. It has no dependency on symbols, instances,
 * SPICE, Documents, labels, or Net policy; callers provide already-realized
 * visible connectivity components.
 */
export function deriveRoutingGuidance(graph: NetGuidanceGraph): RoutingGuide[] {
  const components = graph.components
    .map((component) => ({
      ...component,
      nodes: [...component.nodes].sort((left, right) =>
        left.key.localeCompare(right.key, "en"),
      ),
    }))
    .filter((component) => component.nodes.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (components.length < 2) return [];

  const edges: Array<{
    fromComponentId: string;
    toComponentId: string;
    from: RoutingGuidanceNode;
    to: RoutingGuidanceNode;
    distance: number;
    priority: number;
  }> = [];
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      const fromComponent = components[left]!;
      const toComponent = components[right]!;
      const best = fromComponent.nodes
        .flatMap((from) =>
          toComponent.nodes.map((to) => ({
            from,
            to,
            distance: straightLineDistance(from.point, to.point),
            priority: from.priority + to.priority,
          })),
        )
        .sort(
          (leftCandidate, rightCandidate) =>
            leftCandidate.distance - rightCandidate.distance ||
            leftCandidate.priority - rightCandidate.priority ||
            leftCandidate.from.key.localeCompare(
              rightCandidate.from.key,
              "en",
            ) ||
            leftCandidate.to.key.localeCompare(rightCandidate.to.key, "en"),
        )[0]!;
      edges.push({
        fromComponentId: fromComponent.id,
        toComponentId: toComponent.id,
        ...best,
      });
    }
  }

  edges.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.priority - right.priority ||
      left.from.key.localeCompare(right.from.key, "en") ||
      left.to.key.localeCompare(right.to.key, "en"),
  );
  const sets = new DisjointSet();
  for (const component of components) sets.add(component.id);
  const result: RoutingGuide[] = [];
  for (const edge of edges) {
    if (sets.find(edge.fromComponentId) === sets.find(edge.toComponentId)) {
      continue;
    }
    sets.union(edge.fromComponentId, edge.toComponentId);
    result.push({
      id: deriveStableId(
        "routing-guide",
        graph.sourceNetId ?? graph.netId,
        edge.from.key,
        edge.to.key,
      ),
      netId: graph.netId,
      fromNetId: components.find(
        (component) => component.id === edge.fromComponentId,
      )!.netId,
      toNetId: components.find(
        (component) => component.id === edge.toComponentId,
      )!.netId,
      ...(graph.sourceNetId ? { sourceNetId: graph.sourceNetId } : {}),
      from: edge.from.endpoint,
      to: edge.to.endpoint,
      fromPoint: edge.from.point,
      toPoint: edge.to.point,
      distance: edge.distance,
    });
  }
  return result;
}
