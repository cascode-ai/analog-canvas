// Dragging one visible wire segment: the Junctions it carries, the Routes
// that stretch around them, and the dogleg when carrying would bury a branch.
import { stretchRouteEndpoint } from "./route-endpoint-stretch.js";
import {
  routeEnd,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  resolveDocumentRoutingGeometry,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import {
  moveRouteSegment,
  planDiagonalSegmentDrag,
  planOrthogonalSegmentDrag,
} from "./route-geometry-edit.js";
import type {
  RouteStretchProposal,
  WireSegmentDragProposal,
} from "./route-operations.js";
import {
  normalizeProposal,
  protectedMode,
  routeEditPathFromGeometry,
  tidyDragProposal,
} from "./route-stretch-proposal.js";

/**
 * A persisted Junction is a topological vertex, not an absolute geometric
 * anchor. Dragging a segment that terminates at one therefore moves the vertex
 * and lets every incident Route stretch around it. Terminals remain hard
 * anchors: their positions belong to their Symbols.
 */
function movableSegmentJunctionId(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): string | null {
  if (endpoint.kind !== "junction") return null;
  const junction = document.junctions.find(
    (candidate) => candidate.id === endpoint.junctionId,
  );
  if (!junction) return null;
  return junction.id;
}

function routeSideEndpoint(
  route: SchematicDocument["routes"][number],
  side: "from" | "to",
): RouteEndpoint {
  return side === "from" ? route.start : routeEnd(route);
}

/**
 * Protect branches whose presentation/ownership prevents coverage union.
 * Ordinary same-Net branches may overlap: the transaction normalizes their
 * coverage and the shared contact classifier re-derives any Junction dot.
 * A dot's previous visibility is not a constraint on conductor movement.
 */
function assertJunctionBranchesStayVisible(
  document: SchematicDocument,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  proposal: WireSegmentDragProposal,
  junctionIds: readonly string[],
): void {
  if (junctionIds.length === 0) return;
  const movedById = new Map(
    proposal.junctions.map((move) => [move.junctionId, move.position]),
  );
  const proposedById = new Map(
    proposal.routes.map((route) => [route.routeId, route.waypoints]),
  );

  const resultingPoints = (
    route: SchematicDocument["routes"][number],
  ): Point[] | null => {
    const original = routingGeometry.routes.get(route.id)?.centerline;
    if (!original || original.length < 2) return null;
    const endpoint = (
      side: "from" | "to",
      fallback: Point,
    ): Point | undefined => {
      const value = routeSideEndpoint(route, side);
      return value.kind === "junction"
        ? (movedById.get(value.junctionId) ?? fallback)
        : fallback;
    };
    const waypoints = proposedById.get(route.id) ?? original.slice(1, -1);
    const from = endpoint("from", original[0]!);
    const to = endpoint("to", original[original.length - 1]!);
    if (!from || !to) return null;
    return [from, ...waypoints, to];
  };

  const headingKey = (from: Point, to: Point): string | null => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const round = (value: number) => Math.round((value / length) * 1e6) / 1e6;
    return `${round(dx)}:${round(dy)}`;
  };

  for (const junctionId of junctionIds) {
    const headings = new Map<string, string>();
    for (const route of document.routes) {
      const points = resultingPoints(route);
      if (!points) continue;
      for (const side of ["from", "to"] as const) {
        const value = routeSideEndpoint(route, side);
        if (value.kind !== "junction" || value.junctionId !== junctionId) {
          continue;
        }
        const at = side === "from" ? points[0]! : points[points.length - 1]!;
        const neighbor =
          side === "from" ? points[1]! : points[points.length - 2]!;
        const key = headingKey(at, neighbor);
        if (!key) continue;
        const existing = headings.get(key);
        if (existing && existing !== route.id) {
          const other = document.routes.find(
            (candidate) => candidate.id === existing,
          )!;
          // Ordinary same-Net coverage is normalized at the transaction
          // boundary. Its former branch role must not pin the drag in place.
          if (
            (route.presentation ?? "wire") === "wire" &&
            (other.presentation ?? "wire") === "wire" &&
            route.netId === other.netId &&
            ![...route.legs, ...other.legs].some((leg) => leg.mode === "locked")
          )
            continue;
          throw new Error(
            `Routes ${existing} and ${route.id} would overlap leaving junction ${junctionId}`,
          );
        }
        headings.set(key, route.id);
      }
    }
  }
}

/**
 * Move a visible orthogonal segment perpendicular to itself while preserving
 * connectivity across persisted Route boundaries. The caller commits the
 * returned Junction and Route edits together in one transaction.
 */
export function proposeWireSegmentDrag(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
  origin?: Point,
): WireSegmentDragProposal {
  const plan = (at: Point) =>
    tidyDragProposal(
      document,
      resolver,
      proposeWireSegmentDragGeometry(
        document,
        resolver,
        routeId,
        segmentIndex,
        at,
        origin,
      ),
    );
  try {
    return plan(target);
  } catch (error) {
    // A 45-degree segment lands on the same line whether it moves along x or
    // along y. When the pointer's axis would fold the wire back (a pin jog
    // doubling against the slant), take the other axis before refusing.
    const alternate = equivalentDiagonalTarget(
      document,
      resolver,
      routeId,
      segmentIndex,
      target,
      origin,
    );
    if (!alternate) throw error;
    try {
      return plan(alternate);
    } catch {
      throw error;
    }
  }
}

/**
 * The target that moves a 45-degree segment onto the same line as the
 * pointer's drag does, but along the other axis: for a slope `s`, a vertical
 * move `d` equals a horizontal move `-s·d`. Null for any other segment.
 */
function equivalentDiagonalTarget(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
  origin: Point | undefined,
): Point | null {
  if (!origin) return null;
  const polyline = routeEditPathFromGeometry(
    resolveDocumentRoutingGeometry(document, resolver),
    routeId,
  );
  const from = polyline?.points[segmentIndex];
  const to = polyline?.points[segmentIndex + 1];
  if (!from || !to) return null;
  const run = { x: to.x - from.x, y: to.y - from.y };
  if (run.x === 0 || Math.abs(run.x) !== Math.abs(run.y)) return null;
  const slope = Math.sign(run.y / run.x);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (dx === 0 && dy === 0) return null;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: origin.x, y: origin.y - slope * dx }
    : { x: origin.x - slope * dy, y: origin.y };
}

/** Stretch every other Route at the Junctions a segment drag carries. */
function stretchRoutesAtMovedJunctions(
  document: SchematicDocument,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  draggedRouteId: string,
  movedJunctions: ReadonlyMap<string, Point>,
): RouteStretchProposal[] {
  const proposals: RouteStretchProposal[] = [];
  for (const route of document.routes) {
    if (route.id === draggedRouteId) continue;
    const fromAnchor = movableSegmentJunctionId(document, route.start);
    const toAnchor = movableSegmentJunctionId(document, routeEnd(route));
    const movedFrom = fromAnchor ? movedJunctions.get(fromAnchor) : undefined;
    const movedTo = toAnchor ? movedJunctions.get(toAnchor) : undefined;
    if (!movedFrom && !movedTo) continue;
    const polyline = routeEditPathFromGeometry(routingGeometry, route.id);
    if (!polyline) throw new Error(`Route ${route.id} has unresolved geometry`);
    const points = polyline.points.map((point) => ({ ...point }));
    const modes = [...polyline.segmentModes];
    if (movedFrom) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "from",
        polyline.points[0]!,
        movedFrom,
      );
    }
    if (movedTo) {
      stretchRouteEndpoint(
        route.id,
        points,
        modes,
        "to",
        polyline.points.at(-1)!,
        movedTo,
      );
    }
    proposals.push(normalizeProposal(route.id, points, modes));
  }
  return proposals;
}

function segmentDragProposal(
  routes: readonly RouteStretchProposal[],
  movedJunctions: ReadonlyMap<string, Point>,
): WireSegmentDragProposal {
  return {
    routes: [...routes].sort((left, right) =>
      left.routeId.localeCompare(right.routeId, "en"),
    ),
    junctions: [...movedJunctions.entries()]
      .map(([junctionId, position]) => ({ junctionId, position }))
      .sort((left, right) =>
        left.junctionId.localeCompare(right.junctionId, "en"),
      ),
  };
}

function proposeWireSegmentDragGeometry(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  segmentIndex: number,
  target: Point,
  origin: Point | undefined,
): WireSegmentDragProposal {
  const selectedRoute = document.routes.find((route) => route.id === routeId);
  if (!selectedRoute) throw new Error(`Route not found: ${routeId}`);
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const selectedPolyline = routeEditPathFromGeometry(routingGeometry, routeId);
  if (!selectedPolyline)
    throw new Error(`Route ${routeId} has unresolved geometry`);
  if (segmentIndex < 0 || segmentIndex >= selectedPolyline.points.length - 1) {
    throw new Error(`Route segment index is out of range: ${segmentIndex}`);
  }
  const affectedModes = [
    selectedPolyline.segmentModes[segmentIndex - 1],
    selectedPolyline.segmentModes[segmentIndex],
    selectedPolyline.segmentModes[segmentIndex + 1],
  ];
  if (affectedModes.some(protectedMode)) {
    throw new Error("Route segment or its neighbor is protected");
  }

  const fromPoint = selectedPolyline.points[segmentIndex]!;
  const toPoint = selectedPolyline.points[segmentIndex + 1]!;
  const horizontal = fromPoint.y === toPoint.y;
  const vertical = fromPoint.x === toPoint.x;
  const slanted = !horizontal && !vertical;
  // Only an exact 45-degree leg keeps its perpendicular-offset drag; any
  // other slant is repaired by the dominant-axis path below.
  const diagonal =
    slanted &&
    Math.abs(toPoint.x - fromPoint.x) === Math.abs(toPoint.y - fromPoint.y);
  if (horizontal && vertical) {
    throw new Error(`Route ${routeId} segment is degenerate`);
  }

  const lastPointIndex = selectedPolyline.points.length - 1;
  const selectedEndpointJunction = (pointIndex: number): string | null => {
    if (pointIndex === 0) {
      return movableSegmentJunctionId(document, selectedRoute.start);
    }
    if (pointIndex === lastPointIndex) {
      return movableSegmentJunctionId(document, routeEnd(selectedRoute));
    }
    return null;
  };
  const leftAnchorId = selectedEndpointJunction(segmentIndex);
  const rightAnchorId = selectedEndpointJunction(segmentIndex + 1);

  // A 45-degree segment, or an orthogonal one beside a slanted neighbor,
  // translates as one rigid run. A Junction at either end of that run travels
  // with it, and its other branches stretch, as for an orthogonal segment.
  const drag = diagonal
    ? planDiagonalSegmentDrag(
        selectedPolyline.points,
        segmentIndex,
        target,
        origin,
      )
    : slanted
      ? null
      : planOrthogonalSegmentDrag(
          selectedPolyline.points,
          segmentIndex,
          target,
        );
  if (
    drag &&
    (diagonal || drag.first < segmentIndex || drag.last > segmentIndex + 1)
  ) {
    const firstAnchorId = selectedEndpointJunction(drag.first);
    const lastAnchorId = selectedEndpointJunction(drag.last);
    const doglegged = (): WireSegmentDragProposal => ({
      routes: [
        {
          routeId,
          ...moveRouteSegment(selectedPolyline, segmentIndex, target, {
            origin,
          }),
        },
      ],
      junctions: [],
    });
    const anchorIds = [firstAnchorId, lastAnchorId].filter(
      (value): value is string => value !== null,
    );
    if (anchorIds.length === 0) return doglegged();
    try {
      const movedJunctions = new Map<string, Point>();
      for (const anchorId of anchorIds) {
        const junction = document.junctions.find(
          (candidate) => candidate.id === anchorId,
        )!;
        movedJunctions.set(anchorId, {
          x: junction.position.x + drag.move.x,
          y: junction.position.y + drag.move.y,
        });
      }
      const planned = segmentDragProposal(
        [
          {
            routeId,
            ...moveRouteSegment(selectedPolyline, segmentIndex, target, {
              origin,
              carried: {
                from: firstAnchorId !== null,
                to: lastAnchorId !== null,
              },
            }),
          },
          ...stretchRoutesAtMovedJunctions(
            document,
            routingGeometry,
            routeId,
            movedJunctions,
          ),
        ],
        movedJunctions,
      );
      assertJunctionBranchesStayVisible(
        document,
        routingGeometry,
        planned,
        anchorIds,
      );
      return planned;
    } catch {
      // As for an orthogonal segment: leave the Junction and jog to it.
      const fallback = doglegged();
      assertJunctionBranchesStayVisible(
        document,
        routingGeometry,
        fallback,
        anchorIds,
      );
      return fallback;
    }
  }

  // Ordinary single-Route bends keep the established dogleg behavior. The
  // topology-aware path is required only when a persisted Junction makes the
  // graph vertex observable.
  if (!leftAnchorId && !rightAnchorId) {
    return {
      routes: [
        {
          routeId,
          ...moveRouteSegment(selectedPolyline, segmentIndex, target),
        },
      ],
      junctions: [],
    };
  }

  // A slanted (non-45) leg is dragged along its dominant axis: a nearly
  // vertical leg moves horizontally like a vertical one, and the planned
  // geometry lands orthogonal, so the drag repairs the slant it touches.
  const axis: "x" | "y" =
    horizontal ||
    (slanted &&
      Math.abs(toPoint.x - fromPoint.x) > Math.abs(toPoint.y - fromPoint.y))
      ? "y"
      : "x";
  const coordinate = target[axis];
  const movedJunctions = new Map<string, Point>();
  for (const anchorId of [leftAnchorId, rightAnchorId]) {
    if (!anchorId || movedJunctions.has(anchorId)) continue;
    const junction = document.junctions.find(
      (candidate) => candidate.id === anchorId,
    )!;
    movedJunctions.set(anchorId, { ...junction.position, [axis]: coordinate });
  }

  const selectedPoints = selectedPolyline.points.map((point) => ({ ...point }));
  const selectedModes = [...selectedPolyline.segmentModes];
  const left = selectedPoints[segmentIndex]!;
  const right = selectedPoints[segmentIndex + 1]!;
  if (segmentIndex > 0 || leftAnchorId) left[axis] = coordinate;
  if (segmentIndex + 1 < lastPointIndex || rightAnchorId) {
    right[axis] = coordinate;
  }

  // A hard endpoint stays in place; split only that boundary segment to form
  // the local dogleg. Internal bends and soft anchors move with the segment.
  if (segmentIndex === 0 && !leftAnchorId && left[axis] !== coordinate) {
    const mode = selectedModes[0]!;
    selectedPoints.splice(1, 0, { ...left, [axis]: coordinate });
    selectedModes.splice(0, 1, mode, mode);
  }
  const selectedRightIndex = selectedPoints.indexOf(right);
  if (
    segmentIndex + 1 === lastPointIndex &&
    !rightAnchorId &&
    right[axis] !== coordinate
  ) {
    const modeIndex = selectedRightIndex - 1;
    const mode = selectedModes[modeIndex]!;
    selectedPoints.splice(selectedRightIndex, 0, {
      ...right,
      [axis]: coordinate,
    });
    selectedModes.splice(modeIndex, 1, mode, mode);
  }

  const planned = segmentDragProposal(
    [
      normalizeProposal(routeId, selectedPoints, selectedModes),
      ...stretchRoutesAtMovedJunctions(
        document,
        routingGeometry,
        routeId,
        movedJunctions,
      ),
    ],
    movedJunctions,
  );
  // Carrying the Junction is the nicer result while it works — the tap slides
  // and nothing bends. Once it would bury a branch, the Junction stays put and
  // the dragged Route doglegs to reach it instead, so the pointer is still
  // followed and the contact still reads as a branch.
  const anchorIds = [leftAnchorId, rightAnchorId].filter(
    (value): value is string => value !== null,
  );
  try {
    assertJunctionBranchesStayVisible(
      document,
      routingGeometry,
      planned,
      anchorIds,
    );
    return planned;
  } catch {
    // The dogleg is checked too: dragged far enough past a branch, its own
    // leg comes down that branch's line and buries it just as moving the
    // Junction would. When neither plan keeps every branch visible the error
    // stands, and the drag holds at the last position that did.
    const doglegged: WireSegmentDragProposal = {
      routes: [
        {
          routeId,
          ...moveRouteSegment(selectedPolyline, segmentIndex, target),
        },
      ],
      junctions: [],
    };
    assertJunctionBranchesStayVisible(
      document,
      routingGeometry,
      doglegged,
      anchorIds,
    );
    return doglegged;
  }
}
