// Moving wire ends: a loose Route as a whole, or one end of a Route, and
// the contacts an end makes where it lands.
import {
  endpointKey,
  isMosBulkTerminal,
  isVisibleEndpoint,
  pointOnSegment,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import { proposeJunctionGroupTranslation } from "./route-operations.js";
import type {
  Point,
  RouteBranch,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeBends, routeEnd, routeEndpoints, routeModes } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { SchematicEdit } from "./transaction.js";
import { endpointOwnerNetId } from "./transaction-routing.js";
import { createContactPlanningDraft } from "./contact-planning-draft.js";
import { projectRoutingEditGeometry } from "./routing-geometry-projection.js";
import { rebuildRoutePath } from "./route-leg-mutation.js";
import { routeEdits } from "./route-proposal-edits.js";
import type { RouteEditPlan } from "./routing-planner.js";
import {
  proposeEndpointsRouteAttachment,
  type EndpointRouteAttachmentRequest,
} from "./wire-commit-planner.js";

function looseRouteAnchorIds(
  document: SchematicDocument,
  route: SchematicDocument["routes"][number],
): [string, string] | null {
  const end = routeEnd(route);
  if (
    route.start.kind !== "junction" ||
    end.kind !== "junction" ||
    route.start.junctionId === end.junctionId
  ) {
    return null;
  }
  const isLoose = (junctionId: string) => {
    const junction = document.junctions.find(
      (candidate) => candidate.id === junctionId,
    );
    if (!junction) return false;
    const degree = document.routes.filter((candidate) =>
      routeEndpoints(candidate).some(
        (endpoint) =>
          endpoint.kind === "junction" && endpoint.junctionId === junctionId,
      ),
    ).length;
    return (
      junction.role === "route-anchor" ||
      ((junction.role ?? "branch") === "branch" && degree === 1)
    );
  };
  return isLoose(route.start.junctionId) && isLoose(end.junctionId)
    ? [route.start.junctionId, end.junctionId]
    : null;
}

/**
 * A landing that rests on another Net's conductor, in one of the two shapes
 * the model can express: against a bare END of that conductor — or against a
 * pin, which is an end too — or part-way along its SPAN. They are the same
 * gesture electrically and different structurally: splicing a wire in two at
 * a point that is already its end would ask for a zero-length conductor, so
 * an end meeting an end is stated as the direct contact it is.
 */
type EndpointLanding =
  | { kind: "span"; routeId: string; segmentIndex: number }
  | { kind: "contact"; targetEndpoint: RouteEndpoint };

/**
 * Collect all contacts at a deliberately moved endpoint, not the first object
 * in document order. Endpoint identity wins over a split for THAT route; a
 * different conductor passing through the same point is still a real target.
 * Geometric crossings away from the moved endpoint are never considered.
 */
function endpointLandingsAt(
  document: SchematicDocument,
  resolver: SymbolResolver,
  point: Point,
  movedEndpoint: RouteEndpoint,
  travellingRouteIds: ReadonlySet<string>,
): EndpointLanding[] {
  const movedNetId = endpointOwnerNetId(document, movedEndpoint);
  const contacts = new Map<string, EndpointLanding>();
  const spans: EndpointLanding[] = [];
  const consider = (endpoint: RouteEndpoint): boolean => {
    const connection = resolveEndpointConnection(document, resolver, endpoint);
    if (
      !connection ||
      connection.contactPoint.x !== point.x ||
      connection.contactPoint.y !== point.y
    )
      return false;
    if (
      endpointKey(endpoint) !== endpointKey(movedEndpoint) &&
      endpointOwnerNetId(document, endpoint) !== movedNetId
    ) {
      contacts.set(endpointKey(endpoint), {
        kind: "contact",
        targetEndpoint: endpoint,
      });
    }
    return true;
  };
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    for (const pin of resolved?.definition.pins ?? []) {
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      if (isVisibleEndpoint(document, resolver, endpoint)) consider(endpoint);
    }
  }
  for (const junction of document.junctions) {
    consider({ kind: "junction", junctionId: junction.id });
  }
  for (const candidate of document.routes) {
    if (travellingRouteIds.has(candidate.id)) continue;
    // Check BOTH endpoint kinds even when the terminal has no visible handle.
    // An existing route end is never an interior point that can be split.
    const atEndpoint = routeEndpoints(candidate).map(consider).some(Boolean);
    if (atEndpoint || candidate.netId === movedNetId) continue;
    const geometry = resolveRouteGeometry(document, resolver, candidate);
    const segmentIndex = geometry?.segments.findIndex((segment) =>
      pointOnSegment(point, segment.from, segment.to),
    );
    if (segmentIndex === undefined || segmentIndex < 0) continue;
    spans.push({ kind: "span", routeId: candidate.id, segmentIndex });
  }
  return [
    ...[...contacts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([, value]) => value),
    ...spans.sort((a, b) =>
      a.kind === "span" && b.kind === "span"
        ? a.routeId.localeCompare(b.routeId, "en")
        : 0,
    ),
  ];
}

/**
 * One membership draft for ALL ends and ALL conductors in a drop. Geometry is
 * already projected to the final position; only after every compatible Net
 * has been folded do we compile far-to-near splits against the stable legs.
 */
function endpointLandingEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoints: readonly RouteEndpoint[],
  travellingRouteIds: ReadonlySet<string>,
  suffix: string,
): SchematicEdit[] {
  const draft = createContactPlanningDraft(document, resolver);
  const spanRequests = new Map<string, EndpointRouteAttachmentRequest[]>();
  for (const endpoint of endpoints) {
    const point = resolveEndpointConnection(
      document,
      resolver,
      endpoint,
    )?.contactPoint;
    if (!point) continue;
    for (const landing of endpointLandingsAt(
      document,
      resolver,
      point,
      endpoint,
      travellingRouteIds,
    )) {
      const target =
        landing.kind === "contact"
          ? landing.targetEndpoint
          : draft.document.routes.find((route) => route.id === landing.routeId)!
              .start;
      const connection = draft.connect(endpoint, target, `net-${suffix}`);
      // Preserve the existing move-without-joining policy for incompatible
      // power domains; never weaken the transaction's electrical validation.
      if (!connection.ok) continue;
      if (landing.kind !== "span") continue;
      const requests = spanRequests.get(landing.routeId) ?? [];
      const existing = requests.find(
        (request) => request.point.x === point.x && request.point.y === point.y,
      );
      // Coincident moved endpoints have just been electrically joined by the
      // draft. One geometric split suffices; duplicate splits would be zero length.
      if (!existing)
        requests.push({
          endpoint,
          endpointNetId: connection.netId,
          point,
          segmentIndex: landing.segmentIndex,
        });
      spanRequests.set(landing.routeId, requests);
    }
  }
  const edits = [...draft.edits];
  for (const [routeId, requests] of spanRequests) {
    const netId = draft.document.routes.find(
      (route) => route.id === routeId,
    )!.netId;
    edits.push(
      ...proposeEndpointsRouteAttachment(
        draft.document,
        resolver,
        routeId,
        requests.map((request) => ({ ...request, endpointNetId: netId })),
        suffix,
      ).edits,
    );
  }
  return edits;
}

/**
 * Plan translation of an isolated loose route and its two endpoint anchors.
 *
 * Given a resolver, an end that comes to rest on another Net's conductor or on
 * a pin also joins it: dragging an end onto a wire is the same deliberate
 * gesture as dropping a pin on one, and it is not ambiguous. The join is
 * emitted as an ordinary contact or attach, which are primitives the routing
 * gate reads for itself — no declaration is written here, and none is needed.
 * With no landing contact nothing is emitted and the move stays pure geometry.
 */
export function proposeLooseRouteTranslation(
  document: SchematicDocument,
  routeId: string,
  delta: Point,
  landing?: { resolver: SymbolResolver; suffix: string },
): RouteEditPlan {
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Route not found: ${routeId}`);
  const anchors = looseRouteAnchorIds(document, route);
  if (!anchors) {
    throw new Error("Only a route with two loose ends can move as a whole");
  }
  if (delta.x === 0 && delta.y === 0) return { routeId, edits: [] };
  const anchorEdits = anchors.map((junctionId): SchematicEdit => {
    const junction = document.junctions.find(
      (candidate) => candidate.id === junctionId,
    )!;
    return {
      kind: "move_junction",
      junctionId,
      position: {
        x: junction.position.x + delta.x,
        y: junction.position.y + delta.y,
      },
    };
  });
  const edits: SchematicEdit[] = [
    ...anchorEdits,
    {
      kind: "set_route_path",
      route: rebuildRoutePath(
        route,
        route.start,
        routeEnd(route),
        routeBends(route).map((point) => ({
          x: point.x + delta.x,
          y: point.y + delta.y,
        })),
        routeModes(route),
        "loose-route-translation",
      ),
    },
  ];
  if (!landing) return { routeId, edits };

  const projected = projectRoutingEditGeometry(document, edits);
  edits.push(
    ...endpointLandingEdits(
      projected,
      landing.resolver,
      anchors.map((junctionId) => ({ kind: "junction", junctionId })),
      new Set([route.id]),
      landing.suffix,
    ),
  );
  return { routeId, edits };
}

/** One end of a Route, and the document that stands once it is free geometry. */
interface FreedRouteEnd {
  /** The document as it will be once `edits` have run. */
  document: SchematicDocument;
  /** The Junction the freed end has become. */
  junctionId: string;
  edits: SchematicEdit[];
}

/**
 * Make a terminal-anchored Route end into ordinary free geometry.
 *
 * The end becomes a Junction resting exactly where the pin's contact point
 * was, so the drawing does not shift and every downstream step — the stretch,
 * the landing, the previews — is the same computation an already-loose end
 * gets. The pin then leaves the Net, unless some other Route still holds it.
 *
 * The result is returned as edits AND as the document those edits produce,
 * because the planning that follows has to read a document in which this end
 * is already a Junction. Projecting it here is what lets one implementation
 * serve both kinds of end instead of a second one that reasons about pins.
 */
function freeRouteTerminalEnd(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: RouteBranch,
  side: "start" | "end",
  terminal: Extract<RouteEndpoint, { kind: "terminal" }>,
  suffix: string,
): FreedRouteEnd {
  const connection = resolveEndpointConnection(document, resolver, terminal);
  if (!connection) {
    throw new Error(
      `Wire end has no resolvable pin geometry: ${endpointKey(terminal)}`,
    );
  }
  const junctionId = `junction-${suffix}`;
  const junction = {
    id: junctionId,
    netId: route.netId,
    position: {
      x: connection.contactPoint.x,
      y: connection.contactPoint.y,
    },
    role: "route-anchor" as const,
  };
  const anchor: RouteEndpoint = { kind: "junction", junctionId };
  const repointed = rebuildRoutePath(
    route,
    side === "start" ? anchor : route.start,
    side === "end" ? anchor : routeEnd(route),
    routeBends(route),
    routeModes(route),
    `endpoint-repoint-${suffix}`,
  );
  const heldElsewhere = document.routes.some(
    (candidate) =>
      candidate.id !== route.id &&
      routeEndpoints(candidate).some(
        (endpoint) => endpointKey(endpoint) === endpointKey(terminal),
      ),
  );
  const edits: SchematicEdit[] = [
    {
      kind: "add_junction",
      junctionId,
      netId: route.netId,
      position: junction.position,
      role: "route-anchor",
    },
    { kind: "set_route_path", route: repointed },
  ];
  if (!heldElsewhere) {
    // Order matters: the pin is still a Route endpoint until the path above
    // is replaced, and disconnecting one is refused for as long as it is.
    edits.push({ kind: "disconnect_endpoint", endpoint: terminal });
    if (isMosBulkTerminal(document, terminal)) {
      // The same pairing the deletion planner uses when a B lead loses its
      // wire: the binding is cleared, then reconciled against the defaults.
      edits.push({
        kind: "reconcile_mos_bulk",
        instanceIds: [terminal.instanceId],
      });
    }
  }
  return {
    junctionId,
    edits,
    document: {
      ...document,
      junctions: [...document.junctions, junction],
      routes: document.routes.map((candidate) =>
        candidate.id === route.id ? repointed : candidate,
      ),
      nets: heldElsewhere
        ? document.nets
        : document.nets.map((net) => ({
            ...net,
            terminals: net.terminals.filter(
              (member) =>
                member.instanceId !== terminal.instanceId ||
                member.pinName !== terminal.pinName,
            ),
          })),
    },
  };
}

/**
 * Move one Route endpoint through the same Junction translation contract used
 * by segment, group, and rail edits.
 *
 * With a `suffix` the move is a complete authoring gesture rather than pure
 * geometry, and two things follow from it. A terminal-anchored end may be
 * dragged: it is detached from its pin first, because rewiring an existing
 * wire is an ordinary edit and deleting it to draw it again is not an answer.
 * And wherever the end is released — on a pin, on another wire's end, or
 * part-way along a conductor — the contact it makes is stated electrically,
 * so the picture and the Netlist say the same thing. Released over nothing it
 * is simply a loose end, which is a legitimate state and not an error.
 *
 * Without a `suffix` nothing new can be named, so the move stays geometry and
 * a terminal-anchored end stays anchored. That is the preview-only contract.
 * A caller that does pass one owes ids its own generator will not reissue:
 * the detached end's Junction is named by the suffix alone.
 */
export function proposeRouteEndpointMove(
  document: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  side: "start" | "end",
  point: Point,
  suffix?: string,
): RouteEditPlan {
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Route not found: ${routeId}`);
  const endpoint = side === "start" ? route.start : routeEnd(route);
  // One check for both kinds of end: a Junction resolves at its position and
  // a pin at its contact point, and an end released where it already was has
  // nothing to plan either way.
  const resting = resolveEndpointConnection(
    document,
    resolver,
    endpoint,
  )?.contactPoint;
  if (resting && resting.x === point.x && resting.y === point.y) {
    return { routeId, edits: [] };
  }
  const detachEdits: SchematicEdit[] = [];
  let base = document;
  let junctionId: string;
  if (endpoint.kind === "terminal") {
    if (!suffix) {
      throw new Error("A terminal-connected wire end is electrically anchored");
    }
    const freed = freeRouteTerminalEnd(
      document,
      resolver,
      route,
      side,
      endpoint,
      suffix,
    );
    base = freed.document;
    junctionId = freed.junctionId;
    detachEdits.push(...freed.edits);
  } else {
    junctionId = endpoint.junctionId;
  }
  const proposal = proposeJunctionGroupTranslation(base, resolver, [
    { junctionId, position: point },
  ]);
  const edits: SchematicEdit[] = [
    ...detachEdits,
    ...proposal.junctions.map((move): SchematicEdit => ({
      kind: "move_junction",
      ...move,
    })),
    // Read from the detached document, not the original: rebuilding this
    // Route against its persisted endpoint would put the end back on the pin.
    ...routeEdits(base, proposal.routes),
  ];
  if (suffix) {
    // Detachment is already represented in base; project only the stretch.
    const projected = projectRoutingEditGeometry(
      base,
      edits.slice(detachEdits.length),
    );
    edits.push(
      ...endpointLandingEdits(
        projected,
        resolver,
        [{ kind: "junction", junctionId }],
        new Set(proposal.routes.map((moved) => moved.routeId)),
        suffix,
      ),
    );
  }
  return { routeId, preview: proposal, edits };
}
