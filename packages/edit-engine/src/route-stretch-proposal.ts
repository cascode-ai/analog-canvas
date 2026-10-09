// The Route-proposal shaping the move planners share: the edit path read from
// resolved geometry, normalization and terminal tidying, a wire carried or
// collapsed whole, and the straight Power Rail guard.
import { cancelDoubledBackLegs } from "./wire-draft.js";
import { routeHasExternalOwner } from "./direct-contact-route-normalization.js";
import { endpointOwnerNetId } from "./transaction-routing.js";
import { tidyRouteTerminalApproaches } from "./route-terminal-approach.js";
import {
  routeBends,
  routeEnd,
  routeModes,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  polylineSatisfiesConstraint,
  resolveEndpointConnection,
  type ResolvedDocumentRoutingGeometry,
} from "@icm/derived";
import {
  normalizeRouteGeometry,
  type RouteEditPath,
  type SegmentMode,
} from "./route-geometry-edit.js";
import type {
  RouteStretchProposal,
  WireSegmentDragProposal,
} from "./route-operations.js";

/**
 * A wire whose ends already meet at one point — a pin set straight onto
 * another, as older versions drew it — has no geometry for a transform to
 * carry, and rewriting it leaves a zero-length wire that no check accepts,
 * so the whole move, turn or mirror was refused. When both ends still belong
 * to its Net and nothing else owns the wire, a transform that carries both
 * ends together drops the redundant geometry and keeps the contact, exactly
 * as opening a file already does.
 */
export function collapsedDirectContact(
  document: SchematicDocument,
  routingGeometry: ResolvedDocumentRoutingGeometry,
  route: SchematicDocument["routes"][number],
): RouteStretchProposal | null {
  if (
    (route.presentation ?? "wire") !== "wire" ||
    routeHasExternalOwner(document, route.id)
  )
    return null;
  const path = routeEditPathFromGeometry(routingGeometry, route.id);
  const first = path?.points[0];
  if (
    !path ||
    !first ||
    !path.points.every((point) => point.x === first.x && point.y === first.y)
  )
    return null;
  if (
    endpointOwnerNetId(document, route.start) !== route.netId ||
    endpointOwnerNetId(document, routeEnd(route)) !== route.netId
  )
    return null;
  return {
    routeId: route.id,
    waypoints: [],
    segmentModes: [],
    collapsedToContact: true,
  };
}

/**
 * A wire a transform carries whole keeps its own bends, mapped. A step of
 * zero length an older version left in it — a bend sitting on its own
 * endpoint — is dropped, since a rewritten wire may not keep one.
 */
export function carriedRouteProposal(
  routingGeometry: ResolvedDocumentRoutingGeometry,
  route: SchematicDocument["routes"][number],
  map: (point: Point) => Point,
): RouteStretchProposal {
  const carried = {
    routeId: route.id,
    waypoints: routeBends(route).map(map),
    segmentModes: routeModes(route),
  };
  const path = routeEditPathFromGeometry(routingGeometry, route.id);
  const hasZeroStep = path?.points.some(
    (point, index) =>
      index > 0 &&
      point.x === path.points[index - 1]!.x &&
      point.y === path.points[index - 1]!.y,
  );
  if (!path || !hasZeroStep) return carried;
  const normalized = normalizeRouteGeometry(
    path.points.map(map),
    path.segmentModes,
  );
  return {
    routeId: route.id,
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

export function protectedMode(mode: SegmentMode | undefined): boolean {
  return mode === "locked" || mode === "trunk";
}

export function routeEditPathFromGeometry(
  routingGeometry: ResolvedDocumentRoutingGeometry,
  routeId: string,
): RouteEditPath | null {
  const geometry = routingGeometry.routes.get(routeId);
  if (!geometry) return null;
  return {
    points: [...geometry.centerline],
    segmentModes: geometry.segments.map((segment) => segment.mode),
  };
}

/**
 * Every stored step must advance; heading itself is unconstrained. Fewer
 * than two points is a collapsed conductor, not a Route — the vacuous
 * "every segment" reading let a fully collapsed stretch slip past this
 * guard and die later inside the Route factory with an internal message.
 */
function isSegmentGeometryUsable(points: readonly Point[]): boolean {
  return points.length >= 2 && polylineSatisfiesConstraint(points, "any-angle");
}

export function normalizeProposal(
  routeId: string,
  points: readonly Point[],
  modes: readonly SegmentMode[],
): RouteStretchProposal {
  let normalized = normalizeRouteGeometry(points, modes);
  // A stretch can slide a bend back over its neighbor, leaving a leg that
  // retraces the previous one. The shared normalizer deliberately keeps
  // anti-parallel collinear steps (crossing detection needs them), so the
  // stretch family cancels them here — except across protected legs, whose
  // geometry must survive byte-for-byte.
  if (!normalized.segmentModes.some(protectedMode)) {
    normalized = cancelDoubledBackLegs(
      normalized.points,
      normalized.segmentModes,
    );
  }
  // Any heading is legal geometry (ADR 0039); only a degenerate segment is
  // not, and normalizeRouteGeometry already removes zero-length steps.
  if (!isSegmentGeometryUsable(normalized.points)) {
    if (
      normalized.points.length === 1 &&
      points.length >= 2 &&
      points[0]!.x === points.at(-1)!.x &&
      points[0]!.y === points.at(-1)!.y
    ) {
      return {
        routeId,
        waypoints: [],
        segmentModes: [],
        collapsedToContact: true,
      };
    }
    throw new Error(
      `Wire segment drag would leave route ${routeId} degenerate`,
    );
  }
  return {
    routeId,
    waypoints: normalized.points.slice(1, -1),
    segmentModes: normalized.segmentModes,
  };
}

/** Apply the same endpoint cleanup to every public stretch planner. */
export function tidyTerminalProposal(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: SchematicDocument["routes"][number],
  proposal: RouteStretchProposal,
  originalDocument: SchematicDocument = document,
): RouteStretchProposal {
  if (proposal.collapsedToContact || route.presentation === "power-rail")
    return proposal;
  const from = resolveEndpointConnection(document, resolver, route.start);
  const to = resolveEndpointConnection(document, resolver, routeEnd(route));
  if (!from || !to) return proposal;
  const tidy = tidyRouteTerminalApproaches(
    document,
    resolver,
    route,
    [from.contactPoint, ...proposal.waypoints, to.contactPoint],
    proposal.segmentModes,
    originalDocument,
  );
  return normalizeProposal(route.id, tidy.points, tidy.segmentModes);
}

export function tidyDragProposal(
  document: SchematicDocument,
  resolver: SymbolResolver,
  proposal: WireSegmentDragProposal,
): WireSegmentDragProposal {
  const moved = new Map(
    proposal.junctions.map((junction) => [
      junction.junctionId,
      junction.position,
    ]),
  );
  const projected = {
    ...document,
    junctions: document.junctions.map((junction) =>
      moved.has(junction.id)
        ? { ...junction, position: moved.get(junction.id)! }
        : junction,
    ),
  };
  return {
    ...proposal,
    routes: proposal.routes.map((item) => {
      const route = document.routes.find(
        (candidate) => candidate.id === item.routeId,
      )!;
      return tidyTerminalProposal(projected, resolver, route, item, document);
    }),
  };
}

/** A rail must stay straight; fail at plan time rather than during commit. */
export function assertPowerRailStaysStraight(
  route: SchematicDocument["routes"][number],
  first: Point,
  last: Point,
  waypoints: readonly Point[],
): void {
  if (route.presentation !== "power-rail") return;
  const straight =
    waypoints.length === 0 && (first.x === last.x || first.y === last.y);
  if (!straight) {
    throw new Error(
      `Power rail ${route.id} would bend; move the whole rail or detach the tap first`,
    );
  }
}
