// One Wire intent, as the GUI and Agents state it, expanded into the edits
// a drawn wire commits, or the reason it is refused.
import {
  hasExplicitMosBulkRoute,
  isMosBulkTerminal,
  pointOnSegment,
  resolveEndpointConnection,
} from "@icm/derived";
import { subcircuitDescriptor } from "@icm/devices";
import type {
  Instance,
  Point,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { electricalConnectionGrid } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { splitRoutePieceIds } from "./split-route-ids.js";
import {
  resolveWireIntentTarget,
  wireTargetReference,
} from "./wire-intent-target.js";
import {
  compileWireDraft,
  type WireCornerOrder,
  type WireDraftOptions,
  type WireRoutingMode,
} from "./wire-draft.js";
import {
  createFreeWireAnchor,
  createRouteWireAnchor,
  proposeWireCommit,
  type WireCommitProposal,
  type WireSource,
} from "./wire-commit-planner.js";

export type WireIntentAnchor =
  | {
      kind: "wire-at";
      point: Point;
      net?: string | undefined;
      member?: { instanceId: string; pinName: string } | undefined;
    }
  | { kind: "net"; net: string }
  | { kind: "endpoint"; endpoint: RouteEndpoint }
  | {
      kind: "route-segment";
      routeId: string;
      legId: string;
      point: Point;
    }
  | { kind: "free"; point: Point };

export interface WireIntent {
  id: string;
  from: WireIntentAnchor;
  to: WireIntentAnchor;
  waypoints?: readonly Point[] | undefined;
  routingMode?: WireRoutingMode | undefined;
  cornerOrder?: WireCornerOrder | undefined;
}

function endpointNetId(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): string | null {
  switch (endpoint.kind) {
    case "terminal":
      return (
        document.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === endpoint.instanceId &&
              terminal.pinName === endpoint.pinName,
          ),
        )?.id ?? null
      );
    case "junction":
      return (
        document.junctions.find(
          (junction) => junction.id === endpoint.junctionId,
        )?.netId ?? null
      );
  }
}

/**
 * The MOS whose body `endpoint` is, while that body still follows its Cell's
 * default: it sits on the default's Net by policy, not by a wire anybody
 * drew.
 */
export function defaultBoundMosBody(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
): Instance | undefined {
  if (endpoint.kind !== "terminal" || !isMosBulkTerminal(document, endpoint))
    return undefined;
  const instance = document.instances.find(
    (candidate) => candidate.id === endpoint.instanceId,
  );
  return instance?.mosBulkBinding &&
    !hasExplicitMosBulkRoute(document, instance.id)
    ? instance
    : undefined;
}

function endpointWireSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
): WireSource | string {
  const connection = resolveEndpointConnection(document, resolver, endpoint);
  if (!connection) {
    const reason = endpointConnectionFailure(document, resolver, endpoint);
    return (
      reason ??
      `Wire endpoint is unresolved or has no grid landing: ${JSON.stringify(endpoint)}`
    );
  }
  // A wire from a MOS body is the GUI's Draw bulk connection: dashed, and a
  // body still on its Cell's default leaves the default first. An Agent's
  // wire from such a body joined the default's Net to whatever it reached:
  // a body wired to its own source put that source on VDD.
  const body = defaultBoundMosBody(document, endpoint);
  return {
    endpoint,
    connection,
    netId: body ? null : endpointNetId(document, endpoint),
    preludeEdits: body
      ? [{ kind: "clear_mos_bulk_default", instanceId: body.id }]
      : [],
    ...(isMosBulkTerminal(document, endpoint)
      ? { routePresentation: "bulk-dashed" as const }
      : {}),
  };
}

function endpointConnectionFailure(
  document: SchematicDocument,
  resolver: SymbolResolver,
  endpoint: RouteEndpoint,
): string | null {
  if (endpoint.kind === "junction") {
    return document.junctions.some(
      (junction) => junction.id === endpoint.junctionId,
    )
      ? null
      : `Junction ${endpoint.junctionId} does not exist`;
  }

  const instance = document.instances.find(
    (candidate) => candidate.id === endpoint.instanceId,
  );
  if (!instance) return `Instance ${endpoint.instanceId} does not exist`;
  const symbol = resolver.resolve(instance.symbolId, instance.symbolVariantId);
  if (!symbol) {
    return `Instance ${instance.reference ?? instance.id} uses unknown symbol ${instance.symbolId}`;
  }

  const pinNames = [
    ...symbol.definition.pins.map((pin) => pin.name),
    ...(symbol.variant?.auxiliaryPins?.map((pin) => pin.name) ?? []),
  ].filter((pinName, index, pins) => pins.indexOf(pinName) === index);
  if (!pinNames.includes(endpoint.pinName)) {
    const descriptor = subcircuitDescriptor(instance.symbolId);
    const exportedPort = descriptor?.ports.find(
      (port) => "pinName" in port && port.name === endpoint.pinName,
    );
    const alias =
      exportedPort && "pinName" in exportedPort
        ? ` (exported as ${exportedPort.name}; use ${exportedPort.pinName})`
        : "";
    const label = instance.reference
      ? `${instance.reference} (${symbol.definition.name})`
      : `${instance.id} (${symbol.definition.name})`;
    return `${label} has no pin "${endpoint.pinName}"; pins: ${pinNames.join(", ")}${alias}`;
  }

  const label = instance.reference ?? instance.id;
  return `${label}.${endpoint.pinName} has no grid landing`;
}

/**
 * Expand one ordinary Wire gesture into the same primitive edit sequence used
 * by the GUI. Agent transports call this planner instead of rebuilding Net,
 * route-split, and Junction choreography.
 */
export function proposeWireIntent(
  document: SchematicDocument,
  resolver: SymbolResolver,
  intent: WireIntent,
): WireCommitProposal | string {
  if (
    [intent.from, intent.to].some(
      (anchor) => anchor.kind === "wire-at" || anchor.kind === "net",
    )
  ) {
    const from = resolveWireIntentTarget(
      document,
      resolver,
      intent.from,
      wireTargetReference(intent.waypoints, "from", intent.to),
    );
    if (typeof from === "string") return from;
    const to = resolveWireIntentTarget(
      document,
      resolver,
      intent.to,
      wireTargetReference(intent.waypoints, "to", from),
    );
    if (typeof to === "string") return to;
    return proposeWireIntent(document, resolver, { ...intent, from, to });
  }
  const routeFor = (
    anchor: Extract<WireIntentAnchor, { kind: "route-segment" }>,
  ) => document.routes.find((route) => route.id === anchor.routeId);
  const existingNetId = [intent.from, intent.to]
    .flatMap((anchor) => {
      if (anchor.kind === "route-segment")
        return [routeFor(anchor)?.netId ?? null];
      if (anchor.kind === "endpoint")
        return [endpointNetId(document, anchor.endpoint)];
      return [null];
    })
    .find((netId): netId is string => netId !== null);
  const newNetId = `${intent.id}-net`;
  let freeAnchorCreatedNet = false;
  const source = (
    anchor: WireIntentAnchor,
    side: "from" | "to",
  ): WireSource | string => {
    if (anchor.kind === "net") return "Unresolved Net target";
    if (anchor.kind === "endpoint") {
      return endpointWireSource(document, resolver, anchor.endpoint);
    }
    if (anchor.kind === "route-segment") {
      const route = routeFor(anchor);
      if (!route) return `Wire route does not exist: ${anchor.routeId}`;
      const segmentIndex = route.legs.findIndex(
        (leg) => leg.id === anchor.legId,
      );
      if (segmentIndex < 0)
        return `Wire route leg does not exist: ${anchor.legId}`;
      // A named tap lands exactly where it is asked, on the pin grid as a via
      // point does, and is refused off it; it is never moved (#1438).
      const pitch = electricalConnectionGrid(document.presentation.grid);
      if (anchor.point.x % pitch !== 0 || anchor.point.y % pitch !== 0)
        return `Tap (${anchor.point.x}, ${anchor.point.y}) is off grid ${pitch}; a tap on a wire, like a via point, must align to it`;
      return createRouteWireAnchor(
        document,
        route,
        anchor.point,
        segmentIndex,
        pitch,
        {
          junctionId: `${intent.id}-${side}-junction`,
          ...splitRoutePieceIds(route.id, `${intent.id}-${side}`),
        },
        resolver,
      );
    }
    const netId = existingNetId ?? newNetId;
    const createNet = existingNetId === undefined && !freeAnchorCreatedNet;
    if (createNet) freeAnchorCreatedNet = true;
    return createFreeWireAnchor(
      anchor.point,
      netId,
      createNet,
      `${intent.id}-${side}-junction`,
    );
  };
  const from = source(intent.from, "from");
  if (typeof from === "string") return from;
  const to = source(intent.to, "to");
  if (typeof to === "string") return to;
  const diagonal =
    intent.routingMode || !intent.waypoints?.length
      ? undefined
      : diagonalViaStep([
          from.connection.gridLanding,
          ...intent.waypoints,
          to.connection.gridLanding,
        ]);
  if (diagonal) return diagonal;
  const draft: WireDraftOptions = {
    ...(intent.routingMode ? { routingMode: intent.routingMode } : {}),
    ...(intent.cornerOrder ? { cornerOrder: intent.cornerOrder } : {}),
  };
  const waypoints = followedWaypointOrder(
    from,
    to,
    intent.waypoints ?? [],
    draft,
  );
  if (typeof waypoints === "string") return waypoints;
  return proposeWireCommit(
    from,
    to,
    waypoints,
    {
      routeId: `${intent.id}-route`,
      newNetId,
    },
    draft,
  );
}

/**
 * A 45° step along the requested path (the ends' landings and the via points
 * between them) reads as a diagonal, which the default orthogonal routing
 * would bend into a corner: refused unless a routing mode is named, never
 * silently drawn as an L (#1437).
 */
function diagonalViaStep(path: readonly Point[]): string | undefined {
  const index = path.findIndex((point, at) => {
    const next = path[at + 1];
    if (!next) return false;
    const dx = Math.abs(next.x - point.x);
    return dx > 0 && dx === Math.abs(next.y - point.y);
  });
  if (index < 0) return undefined;
  const at = (point: Point) => `(${point.x}, ${point.y})`;
  return `The step ${at(path[index]!)} → ${at(path[index + 1]!)} is 45°, which orthogonal routing would bend into a corner. Pass routingMode "octilinear" to keep the diagonal, or "orthogonal" for the corner.`;
}

/**
 * The order of the requested via points the routed wire passes through
 * (#1265). Drafting cancels a leg that doubles back, which is right for a
 * hand-drawn wire, but via points listed against the direction from→to make
 * every leg double back, and the requested detour silently became a straight
 * line between the pins. Points listed in reverse are the same detour, so they
 * are followed in that order; points no order can follow are refused with a
 * reason, never committed as some other path.
 */
function followedWaypointOrder(
  from: WireSource,
  to: WireSource,
  waypoints: readonly Point[],
  draft: WireDraftOptions,
): readonly Point[] | string {
  if (!waypoints.length) return waypoints;
  const mode = draft.routingMode ?? "orthogonal";
  const follows = (order: readonly Point[]) => {
    const { points } = compileWireDraft(
      from,
      to,
      order.map((point) => ({
        point,
        routingMode: mode,
        ...(draft.cornerOrder ? { cornerOrder: draft.cornerOrder } : {}),
      })),
      mode,
      draft.cornerOrder ?? "auto",
    );
    return waypoints.every((point) =>
      points.some(
        (end, index) =>
          index > 0 && pointOnSegment(point, points[index - 1]!, end),
      ),
    );
  };
  if (follows(waypoints)) return waypoints;
  const reversed = [...waypoints].reverse();
  if (follows(reversed)) return reversed;
  const at = (point: Point) => `(${point.x},${point.y})`;
  return `The requested path folds back on itself: via ${waypoints.map(at).join(" → ")} from ${at(from.connection.gridLanding)} to ${at(to.connection.gridLanding)} doubles back, so the wire would not pass through them. List via points in order from "from" to "to", one turn per point.`;
}
