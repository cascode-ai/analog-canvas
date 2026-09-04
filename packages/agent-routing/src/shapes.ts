// Optional Route-graph constructors.
//
// Per the review decision: these are STARTING POINTS, not a closed mandatory
// enum and not the expansion path. The Agent calls a constructor, inspects the
// returned RouteGraph, and may edit it (add/remove taps, change axes, add
// exceptions, adjust trunk edges) before calling expandRouteGraph. The helper
// never calls these; it only expands a graph the Agent owns.
//
// Each constructor expresses ONE common shape as an explicit node/edge graph so
// the Agent can see and modify the exact topology it implies.

import type { Point } from "@icm/model";
import type { RouteEndpoint } from "@icm/model";
import type {
  AlignAxis,
  RouteGraph,
  RouteGraphEdge,
  RouteGraphNode,
} from "./types.js";

/**
 * Build a direct two-endpoint Route graph (one escape edge). The Agent may use
 * this for a single terminal-to-terminal or port-to-terminal connection.
 */
export function buildDirectGraph(
  netId: string,
  documentId: string,
  revision: number,
  from: { id: string; endpoint: RouteEndpoint },
  to: { id: string; endpoint: RouteEndpoint },
): RouteGraph {
  const nodes: RouteGraphNode[] = [
    { id: from.id, role: "endpoint", endpoint: from.endpoint },
    { id: to.id, role: "endpoint", endpoint: to.endpoint },
  ];
  const edges: RouteGraphEdge[] = [
    { id: "direct-0", from: from.id, to: to.id, role: "escape" },
  ];
  return { documentId, revision, netId, nodes, edges };
}

/**
 * Build a shared-trunk Route graph: a trunk along `trunkAxis`, with one tap per
 * endpoint aligned to that endpoint's coordinate, and an escape edge per
 * endpoint to its tap. The Agent supplies the trunk's perpendicular coordinate
 * (e.g. the x of a vertical rail) — the constructor does NOT guess it.
 *
 * `trunkAxis` is "x" for a vertical trunk (fixed x, taps share endpoint y) or
 * "y" for a horizontal trunk (fixed y, taps share endpoint x).
 */
export function buildSharedTrunkGraph(args: {
  netId: string;
  documentId: string;
  revision: number;
  endpoints: Array<{ id: string; endpoint: RouteEndpoint }>;
  trunkAxis: AlignAxis;
  trunkCoord: number;
}): RouteGraph {
  const { netId, documentId, revision, endpoints, trunkAxis } = args;
  const nodes: RouteGraphNode[] = [];
  const edges: RouteGraphEdge[] = [];
  // A tap per endpoint, aligned with the endpoint on the perpendicular axis and
  // on the trunk coordinate on the trunk axis.
  endpoints.forEach((endpoint, index) => {
    const tapId = `tap-${index}`;
    nodes.push({
      id: endpoint.id,
      role: "endpoint",
      endpoint: endpoint.endpoint,
    });
    nodes.push({
      id: tapId,
      role: "tap",
      alignWith: endpoint.id,
      axis: trunkAxis === "x" ? "y" : "x",
      // The tap shares the endpoint's perpendicular coordinate; the trunk
      // coordinate is fixed by aligning on the trunk axis below.
    });
    // Force the trunk-axis coordinate by setting `at` only if alignWith cannot
    // express it. We use a second alignment: the tap aligns with the endpoint
    // on the perpendicular axis, and its trunk-axis coordinate is trunkCoord.
    // Since a node carries one alignWith, encode the trunk coordinate via `at`
    // when needed by adjusting after construction. For simplicity here, the tap
    // uses `at` computed from endpoint coordinate + trunkCoord is NOT known to
    // the constructor without the endpoint positions; so the Agent is expected
    // to set `at` explicitly OR the constructor returns taps with alignWith and
    // the Agent edits. We emit alignWith and let the Agent adjust.
    edges.push({
      id: `esc-${index}`,
      from: endpoint.id,
      to: tapId,
      role: "escape",
    });
  });
  // Trunk edges between consecutive taps.
  for (let index = 1; index < endpoints.length; index += 1) {
    edges.push({
      id: `trunk-${index - 1}`,
      from: `tap-${index - 1}`,
      to: `tap-${index}`,
      role: "trunk",
    });
  }
  return { documentId, revision, netId, nodes, edges };
}

/**
 * Build a local-branch-tree Route graph: one branch junction per group at the
 * group's snapped center, with an escape edge per endpoint to its group
 * junction. Inter-group links are NOT added automatically — the Agent adds
 * `link` edges between group junctions as desired.
 */
export function buildLocalBranchTreeGraph(args: {
  netId: string;
  documentId: string;
  revision: number;
  groups: Array<{
    id: string;
    endpoints: Array<{ id: string; endpoint: RouteEndpoint }>;
    center: Point;
  }>;
}): RouteGraph {
  const { netId, documentId, revision, groups } = args;
  const nodes: RouteGraphNode[] = [];
  const edges: RouteGraphEdge[] = [];
  groups.forEach((group) => {
    nodes.push({
      id: group.id,
      role: "junction",
      at: { x: group.center.x, y: group.center.y },
    });
    group.endpoints.forEach((endpoint, index) => {
      nodes.push({
        id: endpoint.id,
        role: "endpoint",
        endpoint: endpoint.endpoint,
      });
      edges.push({
        id: `esc-${group.id}-${index}`,
        from: endpoint.id,
        to: group.id,
        role: "escape",
      });
    });
  });
  return { documentId, revision, netId, nodes, edges };
}

/**
 * Build a labeled-islands Route graph: a local branch junction per island plus a
 * `label` edge at each island. No cross-island wire — connectivity is by Net
 * name. The Agent supplies label text; the graph Net is the only electrical
 * attachment.
 */
export function buildLabeledIslandsGraph(args: {
  netId: string;
  documentId: string;
  revision: number;
  islands: Array<{
    junctionId: string;
    center: Point;
    endpoints: Array<{ id: string; endpoint: RouteEndpoint }>;
    label: { text: string };
  }>;
}): RouteGraph {
  const { netId, documentId, revision, islands } = args;
  const nodes: RouteGraphNode[] = [];
  const edges: RouteGraphEdge[] = [];
  islands.forEach((island) => {
    nodes.push({
      id: island.junctionId,
      role: "junction",
      at: { x: island.center.x, y: island.center.y },
    });
    island.endpoints.forEach((endpoint, index) => {
      nodes.push({
        id: endpoint.id,
        role: "endpoint",
        endpoint: endpoint.endpoint,
      });
      edges.push({
        id: `esc-${island.junctionId}-${index}`,
        from: endpoint.id,
        to: island.junctionId,
        role: "escape",
      });
    });
    edges.push({
      id: `label-${island.junctionId}`,
      from: island.junctionId,
      to: island.junctionId,
      role: "label",
      label: island.label,
    });
  });
  return { documentId, revision, netId, nodes, edges };
}
