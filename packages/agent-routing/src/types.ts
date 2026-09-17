// Agent-local route-graph types.
//
// Per ADR 0007, these types live ONLY in @icm/agent-routing. They MUST NOT
// appear in @icm/agent-adapter request/response schemas, MUST NOT appear in
// @icm/model project schema, MUST NOT be persisted into project.icproj.json,
// and MUST NOT survive across sessions. They carry no select/query/region
// capability; their input is a derived slice of an existing Snapshot.
//
// The Agent gives a complete local Route graph (nodes + edges with roles); the
// helper only projects each edge onto legal octilinear coordinates. The helper never
// decides topology, adds a missing node, switches a shape, or reroutes.

import type { Point, RouteEndpoint, SegmentMode } from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";

/**
 * A segment mode for canonical Route legs.
 */
export type { SegmentMode };

/**
 * The role of a node in the Route graph.
 * - `endpoint`: binds to an existing Instance terminal or Junction; no object
 *   is created.
 * - `tap` / `junction`: created by the helper as electrical branch points.
 * - `bend`: created as a degree-two route anchor without a connection dot.
 * - `label-anchor`: a junction positioned where a Net label should appear.
 */
export type RouteGraphNodeRole =
  "endpoint" | "tap" | "junction" | "bend" | "label-anchor";

/**
 * The axis a `tap`/`junction` node shares with a referenced node.
 * - `"x"`: same column (shares x; the perpendicular y comes from offset/other).
 * - `"y"`: same row (shares y; the perpendicular x comes from offset/other).
 */
export type AlignAxis = "x" | "y";

/**
 * A node the Agent places in the Route graph. Endpoint nodes reference existing
 * Instance terminals; positioned nodes are created by the helper.
 */
export interface RouteGraphNode {
  id: string;
  role: RouteGraphNodeRole;
  /** Required for role:"endpoint": the existing Instance terminal to bind to. */
  endpoint?: RouteEndpoint;
  /**
   * For any non-endpoint role. Exactly one positioning hint:
   *  - `at`: an explicit grid-aligned point.
   *  - `alignWith` + `axis` + (`offset` | perpendicular-from-a-second-node):
   *    share one coordinate with the referenced node; the perpendicular
   *    coordinate is `offset` away from it.
   */
  at?: Point;
  alignWith?: string;
  axis?: AlignAxis;
  offset?: number;
}

export type RouteEdgeRole = "trunk" | "escape" | "link" | "label";

/**
 * An edge in the Route graph. Each non-label edge becomes exactly one typed
 * edit; a `label` edge becomes an `upsert_schematic_annotation` net-label.
 */
export interface RouteGraphEdge {
  id: string;
  from: string;
  to: string;
  role: RouteEdgeRole;
  /** For role:"label": text only; electrical binding is graph.netId. */
  label?: { text: string };
  /** For role:"link"|"trunk": the segment mode (default "auto"/"trunk"). */
  segmentMode?: SegmentMode;
}

/**
 * Agent-local, transient Route graph for one Net. Carries the complete visual
 * topology the Agent decided: node count, tap order, which edges are trunk vs.
 * escape vs. link, and where labels go. The helper only resolves coordinates.
 */
export interface RouteGraph {
  documentId: string;
  revision: number;
  netId: string;
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
}

/**
 * A resolved endpoint the helper reads. Built by the caller from the Snapshot:
 * page coordinate and outward escape unit vector (`null` for Junctions).
 */
export interface ResolvedEndpoint {
  id: string;
  endpoint: RouteEndpoint;
  point: Point;
  /** Outward escape unit vector; null for non-terminal endpoints. */
  outward: Point | null;
}

export interface ExpansionConflict {
  code: string;
  message: string;
  objectIds?: string[];
}

export interface PlannedRouteGeometry {
  routeId: string;
  points: Point[];
}

export interface ExpansionMetrics {
  routeCount: number;
  junctionCount: number;
  totalRouteLength: number;
  bendCount: number;
}

/**
 * The helper output: typed edits ready for `transact`, the resolved geometry it
 * computed, metrics, assumptions it made, and conflicts it could not resolve by
 * geometry alone. The caller resolves conflicts by changing the graph or
 * placement — never by the helper inventing topology.
 */
export interface RouteGraphExpansion {
  edits: SchematicEdit[];
  generatedObjectIds: string[];
  resolvedGeometry: PlannedRouteGeometry[];
  metrics: ExpansionMetrics;
  assumptions: string[];
  conflicts: ExpansionConflict[];
}
