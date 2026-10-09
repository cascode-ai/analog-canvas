// Route-graph geometry helper.
//
// The Agent supplies the complete local graph. This helper snaps coordinates,
// validates straight octilinear segments, folds explicit degree-two bend nodes
// into Route waypoints, and emits typed edits. It never invents topology,
// chooses a bend, switches a shape, or calls route_orthogonal.

import { createRoutePath, type Point, type RouteEndpoint } from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";
import { isSegmentAllowed, segmentLength } from "@icm/derived";
import type {
  ExpansionConflict,
  ResolvedEndpoint,
  RouteGraph,
  RouteGraphEdge,
  RouteGraphNode,
  RouteGraphExpansion,
  SegmentMode,
} from "./types.js";

const GRID = 10;

export interface InstanceBox {
  instanceId: string;
  min: Point;
  max: Point;
}

export interface ExpansionInput {
  endpoints: ReadonlyMap<string, ResolvedEndpoint>;
  existingRoutePaths: ReadonlyArray<{ routeId: string; points: Point[] }>;
  instanceBoxes: ReadonlyArray<InstanceBox>;
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function segmentHitsInstance(
  from: Point,
  to: Point,
  boxes: ReadonlyArray<InstanceBox>,
  fromInstanceId?: string,
  toInstanceId?: string,
): InstanceBox | undefined {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  return boxes.find(
    (box) =>
      maxX > box.min.x &&
      minX < box.max.x &&
      maxY > box.min.y &&
      minY < box.max.y &&
      box.instanceId !== fromInstanceId &&
      box.instanceId !== toInstanceId,
  );
}

function segmentModeFor(edge: RouteGraphEdge): SegmentMode {
  return (
    edge.segmentMode ??
    (edge.role === "escape"
      ? "escape"
      : edge.role === "trunk"
        ? "trunk"
        : "auto")
  );
}

/**
 * Expand one Agent-owned Route graph atomically.
 * @public The repository-only RouteGraph helper (docs/agent/routegraph.md).
 */
export function expandRouteGraph(
  graph: RouteGraph,
  input: ExpansionInput,
): RouteGraphExpansion {
  const edits: SchematicEdit[] = [];
  const resolvedGeometry: RouteGraphExpansion["resolvedGeometry"] = [];
  const assumptions: string[] = [];
  const conflicts: ExpansionConflict[] = [];
  const nodeCoords = new Map<string, Point>();
  const nodeOutward = new Map<string, Point | null>();
  const endpointNodes = new Map<string, RouteEndpoint>();
  const junctionIds = new Set<string>();
  const nodeById = new Map<string, RouteGraphNode>();

  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) {
      conflicts.push({
        code: "DUPLICATE_NODE_ID",
        message: `Route graph contains duplicate node id ${node.id}`,
        objectIds: [node.id],
      });
      continue;
    }
    nodeById.set(node.id, node);
  }

  for (const node of graph.nodes) {
    if (node.role !== "endpoint") continue;
    if (!node.endpoint) {
      conflicts.push({
        code: "MISSING_ENDPOINT_REF",
        message: `Endpoint node ${node.id} has no endpoint reference`,
        objectIds: [node.id],
      });
      continue;
    }
    const resolved = resolveEndpointInInput(node.endpoint, input);
    if (!resolved) {
      conflicts.push({
        code: "MISSING_ENDPOINT",
        message: `Endpoint node ${node.id} is not present in the input`,
        objectIds: [node.id],
      });
      continue;
    }
    nodeCoords.set(node.id, resolved.point);
    nodeOutward.set(node.id, resolved.outward);
    endpointNodes.set(node.id, node.endpoint);
  }

  let changed = true;
  let passes = 0;
  while (changed && passes < graph.nodes.length + 1) {
    changed = false;
    passes += 1;
    for (const node of graph.nodes) {
      if (node.role === "endpoint" || nodeCoords.has(node.id)) continue;
      const position = resolvePositionedNode(node, nodeCoords);
      if (!position) continue;
      const snapped = { x: snap(position.x), y: snap(position.y) };
      nodeCoords.set(node.id, snapped);
      nodeOutward.set(node.id, null);
      if (node.role !== "bend") junctionIds.add(node.id);
      changed = true;
    }
  }

  for (const node of graph.nodes) {
    if (node.role !== "endpoint" && !nodeCoords.has(node.id)) {
      conflicts.push({
        code: "MISSING_NODE_POSITION",
        message: `Node ${node.id} (${node.role}) has no resolvable position`,
        objectIds: [node.id],
      });
    }
  }

  // Only semantic branch/label nodes survive in the Project. Bend nodes are
  // transient planning objects and become ordinary Route waypoints.
  for (const node of graph.nodes) {
    if (node.role === "endpoint" || node.role === "bend") continue;
    const point = nodeCoords.get(node.id);
    if (!point) continue;
    edits.push({
      kind: "add_junction",
      junctionId: node.id,
      netId: graph.netId,
      position: { ...point },
      role: node.role === "label-anchor" ? "label-anchor" : "branch",
    });
    assumptions.push(
      `node ${node.id} (${node.role}) at (${point.x},${point.y})`,
    );
  }

  const routableEdges: RouteGraphEdge[] = [];
  const edgeIds = new Set<string>();
  let labelIndex = 0;
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      conflicts.push({
        code: "DUPLICATE_EDGE_ID",
        message: `Route graph contains duplicate edge id ${edge.id}`,
        objectIds: [edge.id],
      });
      continue;
    }
    edgeIds.add(edge.id);
    const from = nodeCoords.get(edge.from);
    const to = nodeCoords.get(edge.to);
    if (!from || !to) {
      conflicts.push({
        code: "EDGE_UNRESOLVED_NODE",
        message: `Edge ${edge.id} references an unresolved node`,
        objectIds: [edge.id],
      });
      continue;
    }

    if (edge.role === "label") {
      labelIndex += 1;
      edits.push({
        kind: "upsert_schematic_annotation",
        annotation: {
          id: `route-${graph.netId}-label-${labelIndex}`,
          kind: "net-label",
          content: {
            runs: [{ kind: "text", value: edge.label?.text || "Net" }],
          },
          netId: graph.netId,
          anchor: { kind: "free", position: { ...to } },
          alignment: "middle",
          rotation: 0,
          locked: false,
        },
      });
      continue;
    }

    // A terminal escape must remain cardinal so it visibly leaves the pin in
    // its declared outward direction.  Every other RouteGraph edge uses the
    // same octilinear constraint as the interactive and Agent wire planner.
    const constraint = edge.role === "escape" ? "orthogonal" : "octilinear";
    if (!isSegmentAllowed(from, to, constraint)) {
      conflicts.push({
        code: "MISALIGNED_EDGE",
        message: `${edge.role} edge ${edge.id}: (${from.x},${from.y}) to (${to.x},${to.y}) is not ${constraint}; add a bend node`,
        objectIds: [edge.id],
      });
      continue;
    }
    if (samePoint(from, to)) {
      conflicts.push({
        code: "ZERO_LENGTH_SEGMENT",
        message: `${edge.role} edge ${edge.id}: from and to are at the same position (${from.x},${from.y})`,
        objectIds: [edge.id],
      });
      continue;
    }

    const fromEndpoint = endpointNodes.get(edge.from);
    const toEndpoint = endpointNodes.get(edge.to);
    if (edge.role === "escape") {
      if (Boolean(fromEndpoint) === Boolean(toEndpoint)) {
        conflicts.push({
          code: "ESCAPE_MALFORMED",
          message: `Escape edge ${edge.id} must connect exactly one endpoint to a positioned node`,
          objectIds: [edge.id],
        });
        continue;
      }
      const terminalNodeId = fromEndpoint ? edge.from : edge.to;
      const terminalPoint = fromEndpoint ? from : to;
      const otherPoint = fromEndpoint ? to : from;
      const outward = nodeOutward.get(terminalNodeId);
      if (outward) {
        const dx = otherPoint.x - terminalPoint.x;
        const dy = otherPoint.y - terminalPoint.y;
        const alignedWithOutward =
          (outward.x !== 0 && Math.sign(dx) === outward.x) ||
          (outward.y !== 0 && Math.sign(dy) === outward.y);
        if (!alignedWithOutward) {
          conflicts.push({
            code: "ESCAPE_DIRECTION",
            message: `Escape edge ${edge.id} does not leave terminal along outward direction (${outward.x},${outward.y})`,
            objectIds: [edge.id],
          });
          continue;
        }
      }
    }

    const hit = segmentHitsInstance(
      from,
      to,
      input.instanceBoxes,
      fromEndpoint?.kind === "terminal" ? fromEndpoint.instanceId : undefined,
      toEndpoint?.kind === "terminal" ? toEndpoint.instanceId : undefined,
    );
    if (hit) {
      conflicts.push({
        code: "WIRE_THROUGH_SYMBOL",
        message: `${edge.role} edge ${edge.id} crosses instance ${hit.instanceId}`,
        objectIds: [edge.id, hit.instanceId],
      });
      continue;
    }
    routableEdges.push(edge);
  }

  const adjacency = new Map<string, RouteGraphEdge[]>();
  for (const edge of routableEdges) {
    for (const nodeId of [edge.from, edge.to]) {
      const incident = adjacency.get(nodeId) ?? [];
      incident.push(edge);
      adjacency.set(nodeId, incident);
    }
  }
  for (const node of graph.nodes.filter(
    (candidate) => candidate.role === "bend",
  )) {
    const degree = adjacency.get(node.id)?.length ?? 0;
    if (degree !== 2) {
      conflicts.push({
        code: "BEND_DEGREE",
        message: `Bend node ${node.id} must have degree 2, got ${degree}`,
        objectIds: [node.id],
      });
    }
  }

  if (conflicts.length > 0) return assemble([], [], assumptions, conflicts);

  const visitedEdges = new Set<string>();
  let routeIndex = 0;
  const anchors = graph.nodes.filter((node) => node.role !== "bend");
  for (const anchor of anchors) {
    for (const firstEdge of adjacency.get(anchor.id) ?? []) {
      if (visitedEdges.has(firstEdge.id)) continue;
      const pathNodeIds = [anchor.id];
      const modes: SegmentMode[] = [];
      let currentNodeId = anchor.id;
      let currentEdge = firstEdge;
      while (true) {
        visitedEdges.add(currentEdge.id);
        const nextNodeId =
          currentEdge.from === currentNodeId
            ? currentEdge.to
            : currentEdge.from;
        pathNodeIds.push(nextNodeId);
        modes.push(segmentModeFor(currentEdge));
        const nextNode = nodeById.get(nextNodeId)!;
        if (nextNode.role !== "bend") break;
        const nextEdge = (adjacency.get(nextNodeId) ?? []).find(
          (candidate) => candidate.id !== currentEdge.id,
        );
        if (!nextEdge) break;
        currentNodeId = nextNodeId;
        currentEdge = nextEdge;
      }

      const endNodeId = pathNodeIds.at(-1)!;
      if (endNodeId === anchor.id) {
        conflicts.push({
          code: "ROUTE_SELF_LOOP",
          message: `Route path from ${anchor.id} loops back to itself`,
          objectIds: pathNodeIds,
        });
        continue;
      }
      routeIndex += 1;
      const routeId = `route-${graph.netId}-${routeIndex}`;
      const points = pathNodeIds.map((nodeId) => nodeCoords.get(nodeId)!);
      edits.push(
        setRouteEdit(
          routeId,
          graph.netId,
          routeEndpointFor(anchor.id, endpointNodes, junctionIds),
          routeEndpointFor(endNodeId, endpointNodes, junctionIds),
          points.slice(1, -1),
          modes,
        ),
      );
      resolvedGeometry.push({ routeId, points });
    }
  }

  if (visitedEdges.size !== routableEdges.length) {
    conflicts.push({
      code: "UNANCHORED_ROUTE_CYCLE",
      message: "Route graph contains an unanchored cycle of bend nodes",
    });
  }
  if (conflicts.length > 0) return assemble([], [], assumptions, conflicts);
  return assemble(edits, resolvedGeometry, assumptions, conflicts);
}

function resolveEndpointInInput(
  endpoint: RouteEndpoint,
  input: ExpansionInput,
): ResolvedEndpoint | undefined {
  for (const candidate of input.endpoints.values()) {
    if (sameEndpoint(candidate.endpoint, endpoint)) return candidate;
  }
  return undefined;
}

function sameEndpoint(left: RouteEndpoint, right: RouteEndpoint): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "terminal" && right.kind === "terminal") {
    return (
      left.instanceId === right.instanceId && left.pinName === right.pinName
    );
  }
  if (left.kind === "junction" && right.kind === "junction") {
    return left.junctionId === right.junctionId;
  }
  return false;
}

function resolvePositionedNode(
  node: RouteGraphNode,
  resolved: Map<string, Point>,
): Point | undefined {
  if (node.at) return node.at;
  if (!node.alignWith || !node.axis) return undefined;
  const reference = resolved.get(node.alignWith);
  if (!reference) return undefined;
  const offset = node.offset ?? 0;
  return node.axis === "x"
    ? { x: reference.x, y: reference.y + offset }
    : { x: reference.x + offset, y: reference.y };
}

function routeEndpointFor(
  nodeId: string,
  endpointNodes: Map<string, RouteEndpoint>,
  junctionIds: Set<string>,
): RouteEndpoint {
  const endpoint = endpointNodes.get(nodeId);
  if (endpoint) return endpoint;
  if (junctionIds.has(nodeId)) return { kind: "junction", junctionId: nodeId };
  throw new Error(`Route path ended on transient bend node ${nodeId}`);
}

function setRouteEdit(
  routeId: string,
  netId: string,
  from: RouteEndpoint,
  to: RouteEndpoint,
  waypoints: Point[],
  segmentModes: SegmentMode[],
): SchematicEdit {
  return {
    kind: "set_route_path",
    route: createRoutePath({
      id: routeId,
      netId,
      start: from,
      end: to,
      bends: waypoints,
      modes: segmentModes,
    }),
  };
}

function assemble(
  edits: SchematicEdit[],
  resolvedGeometry: RouteGraphExpansion["resolvedGeometry"],
  assumptions: string[],
  conflicts: ExpansionConflict[],
): RouteGraphExpansion {
  return {
    edits,
    generatedObjectIds: collectIds(edits),
    resolvedGeometry,
    metrics: computeMetrics(edits, resolvedGeometry),
    assumptions,
    conflicts,
  };
}

function collectIds(edits: SchematicEdit[]): string[] {
  const ids: string[] = [];
  for (const edit of edits) {
    if (edit.kind === "add_junction") ids.push(edit.junctionId);
    if (edit.kind === "set_route_path") ids.push(edit.route.id);
    if (edit.kind === "upsert_schematic_annotation")
      ids.push(edit.annotation.id);
  }
  return ids;
}

function computeMetrics(
  edits: SchematicEdit[],
  resolvedGeometry: RouteGraphExpansion["resolvedGeometry"],
): RouteGraphExpansion["metrics"] {
  let totalRouteLength = 0;
  let bendCount = 0;
  for (const route of resolvedGeometry) {
    for (let index = 1; index < route.points.length; index += 1) {
      totalRouteLength += segmentLength(
        route.points[index - 1]!,
        route.points[index]!,
      );
    }
    bendCount += Math.max(0, route.points.length - 2);
  }
  return {
    routeCount: edits.filter((edit) => edit.kind === "set_route_path").length,
    junctionCount: edits.filter((edit) => edit.kind === "add_junction").length,
    totalRouteLength,
    bendCount,
  };
}
