import {
  routeEndpoints,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  endpointKey,
  findRouteSegmentsAtPoint,
  pointOnSegment,
  resolveDocumentRoutingGeometry,
  segmentLength,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import { planDirectEndpointConnection } from "./direct-contact-planner.js";
import type { SchematicEdit } from "./edit-schema.js";
import { resolveRouteEditPath } from "./route-operations.js";
import { proposeEndpointRouteAttachment } from "./wire-commit-planner.js";
import type { ExpectedElectricalEffect } from "./routing-operation-plan.js";
import { executeTransaction } from "./transaction.js";

export interface SeriesSpliceContact {
  endpoint: RouteEndpoint;
  point: Point;
  segmentIndex: number;
}

/**
 * Whether exactly-two same-conductor pin contacts form the series-insertion
 * gesture. A device whose whole visible interface is two pins qualifies
 * outright; a multi-pin device qualifies only through its descriptor's
 * declared series-insertion pin pair (D–S, C–E), matched by pin name. One
 * definition serves every gesture that can drop a device onto a wire —
 * placing and moving must agree on what "insertable" means.
 */
export function isEligibleSeriesInsertionPinPair(
  contactedPinNames: readonly string[],
  visiblePinCount: number,
  seriesInsertionPinPair: readonly string[] | undefined,
): boolean {
  if (contactedPinNames.length !== 2) return false;
  if (visiblePinCount === 2) return true;
  if (!seriesInsertionPinPair) return false;
  const contactedKeys = new Set(contactedPinNames);
  return (
    contactedKeys.size === 2 &&
    seriesInsertionPinPair.every((pinName) => contactedKeys.has(pinName))
  );
}

export type SeriesSplicePlan =
  | {
      ok: true;
      routeId: string;
      removedSpanRouteId: string;
      expectedElectricalEffect: ExpectedElectricalEffect;
      edits: readonly SchematicEdit[];
    }
  | { ok: false; message: string };

function pathOffsetAtPoint(
  points: readonly Point[],
  point: Point,
): number | null {
  let offset = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (pointOnSegment(point, from, to)) {
      return offset + segmentLength(from, point);
    }
    offset += segmentLength(from, to);
  }
  return null;
}

function applyPlanningStep(
  document: SchematicDocument,
  resolver: SymbolResolver,
  transactionId: string,
  edits: readonly SchematicEdit[],
): SchematicDocument | string {
  const result = executeTransaction(
    document,
    {
      transactionId,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "series-splice-planner" },
      dryRun: true,
      edits,
    },
    { symbolResolver: resolver },
  );
  return result.ok ? result.document : result.error.message;
}

/**
 * Replace one conductor span with a two-terminal component.
 *
 * This composes the existing endpoint-to-Route primitive twice, then cuts the
 * Route between the terminals. The cut is essential: attaching both pins to
 * an unbroken conductor would short the component. Planning simulations keep
 * every second split address revision-correct while the returned edits still
 * commit atomically with the Instance creation.
 */
export function planSeriesInstanceSplice(
  documentWithInstance: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  contacts: readonly [SeriesSpliceContact, SeriesSpliceContact],
  suffix: string,
): SeriesSplicePlan {
  const route = spliceableRoute(documentWithInstance, routeId);
  if (typeof route === "string") return { ok: false, message: route };
  const path = resolveRouteEditPath(documentWithInstance, resolver, route);
  if (!path) {
    return { ok: false, message: `Route ${route.id} has unresolved geometry` };
  }
  const ordered = contacts
    .map((contact) => ({
      contact,
      offset: pathOffsetAtPoint(path.points, contact.point),
    }))
    .sort((left, right) => (left.offset ?? 0) - (right.offset ?? 0));
  if (ordered.some(({ offset }) => offset === null)) {
    return { ok: false, message: "Both component pins must lie on the Route" };
  }
  if (ordered[0]!.offset === ordered[1]!.offset) {
    return {
      ok: false,
      message: "Series insertion requires two distinct pin contacts",
    };
  }
  const firstContact = ordered[0]!.contact;
  const secondContact = ordered[1]!.contact;
  const first = proposeEndpointRouteAttachment(
    documentWithInstance,
    firstContact.endpoint,
    null,
    route.id,
    firstContact.point,
    firstContact.segmentIndex,
    `${suffix}-first`,
  );
  const afterFirst = applyPlanningStep(
    documentWithInstance,
    resolver,
    `plan-${suffix}-first`,
    first.edits,
  );
  if (typeof afterFirst === "string") {
    return { ok: false, message: afterFirst };
  }

  const secondHits = findRouteSegmentsAtPoint(
    resolveDocumentRoutingGeometry(afterFirst, resolver),
    secondContact.point,
  ).filter((address) =>
    afterFirst.routes.some(
      (candidate) =>
        candidate.id === address.routeId && candidate.netId === route.netId,
    ),
  );
  if (secondHits.length !== 1) {
    return {
      ok: false,
      message: "The second pin does not identify one canonical Route segment",
    };
  }
  const secondHit = secondHits[0]!;
  const second = proposeEndpointRouteAttachment(
    afterFirst,
    secondContact.endpoint,
    null,
    secondHit.routeId,
    secondContact.point,
    secondHit.segmentIndex,
    `${suffix}-second`,
  );
  const afterSecond = applyPlanningStep(
    afterFirst,
    resolver,
    `plan-${suffix}-second`,
    second.edits,
  );
  if (typeof afterSecond === "string") {
    return { ok: false, message: afterSecond };
  }

  const removedSpan = spanBetween(
    afterSecond,
    firstContact.endpoint,
    secondContact.endpoint,
  );
  if (typeof removedSpan === "string") {
    return { ok: false, message: removedSpan };
  }

  return {
    ok: true,
    routeId,
    removedSpanRouteId: removedSpan.id,
    expectedElectricalEffect: {
      kind: "partition",
      sourceBaseNetIds: [route.netId],
      cutRouteIds: [removedSpan.id],
    },
    edits: [
      ...first.edits,
      ...second.edits,
      { kind: "cut_connection", routeId: removedSpan.id },
    ],
  };
}

/**
 * Replace the end of a conductor with a two-terminal component: one pin lands
 * inside the Route, the other on the Junction or pin that ends it.
 *
 * The inner pin splits the Route as in a two-contact splice. The outer pin
 * joins the end it sits on directly, and the span between the pins is cut.
 * Joining both pins without that cut would short the component with a Wire
 * hidden under its body, while the drawing still showed it in series.
 *
 * A T-Junction left with two Wires is no longer a branch, and the conductor
 * normalizer would fold it into one straight Wire, leaving the pin on that
 * Wire's interior and visibly unconnected. The pin takes the Junction's place
 * instead: both Wires end on it, as they would after a drop onto a Wire.
 */
export function planSeriesInstanceSpliceAtRouteEnd(
  documentWithInstance: SchematicDocument,
  resolver: SymbolResolver,
  routeId: string,
  inner: SeriesSpliceContact,
  outer: { endpoint: RouteEndpoint; routeEnd: RouteEndpoint },
  suffix: string,
): SeriesSplicePlan {
  const route = spliceableRoute(documentWithInstance, routeId);
  if (typeof route === "string") return { ok: false, message: route };
  const endKey = endpointKey(outer.routeEnd);
  if (!routeEndpoints(route).some((end) => endpointKey(end) === endKey)) {
    return {
      ok: false,
      message: `The second pin is not on an end of Route ${route.id}`,
    };
  }
  const first = proposeEndpointRouteAttachment(
    documentWithInstance,
    inner.endpoint,
    null,
    route.id,
    inner.point,
    inner.segmentIndex,
    `${suffix}-first`,
  );
  const afterFirst = applyPlanningStep(
    documentWithInstance,
    resolver,
    `plan-${suffix}-first`,
    first.edits,
  );
  if (typeof afterFirst === "string") {
    return { ok: false, message: afterFirst };
  }
  const removedSpan = spanBetween(afterFirst, inner.endpoint, outer.routeEnd);
  if (typeof removedSpan === "string") {
    return { ok: false, message: removedSpan };
  }
  const join = planDirectEndpointConnection(afterFirst, {
    from: outer.endpoint,
    to: outer.routeEnd,
    newNetId: `net-${suffix}-second`,
  });
  if (!join.ok) return { ok: false, message: join.message };
  const arms = afterFirst.routes.filter(
    (candidate) =>
      candidate.id !== removedSpan.id &&
      routeEndpoints(candidate).some(
        (endpoint) => endpointKey(endpoint) === endKey,
      ),
  );
  const pinReplacesJunction =
    outer.routeEnd.kind === "junction" &&
    junctionFoldsAway(afterFirst, outer.routeEnd.junctionId, arms);
  const rest: SchematicEdit[] = [
    ...join.edits,
    ...(pinReplacesJunction
      ? arms.map((arm): SchematicEdit => ({
          kind: "set_route_path",
          route: withEndReplaced(arm, endKey, outer.endpoint),
        }))
      : []),
    // The cut also removes the Junction once nothing ends on it.
    { kind: "cut_connection", routeId: removedSpan.id },
  ];
  const afterRest = applyPlanningStep(
    afterFirst,
    resolver,
    `plan-${suffix}-second`,
    rest,
  );
  if (typeof afterRest === "string") {
    return { ok: false, message: afterRest };
  }

  return {
    ok: true,
    routeId,
    removedSpanRouteId: removedSpan.id,
    expectedElectricalEffect: {
      kind: "partition",
      sourceBaseNetIds: [route.netId],
      cutRouteIds: [removedSpan.id],
    },
    edits: [...first.edits, ...rest],
  };
}

/**
 * Whether the normalizer folds this Junction once only `arms` meet at it: two
 * plain, unlocked Wires at an ordinary Junction nothing else refers to.
 */
function junctionFoldsAway(
  document: SchematicDocument,
  junctionId: string,
  arms: readonly SchematicDocument["routes"][number][],
): boolean {
  const junction = document.junctions.find(
    (candidate) => candidate.id === junctionId,
  );
  if (!junction) return false;
  const role = junction.role ?? "branch";
  if (role !== "branch" && role !== "route-anchor") return false;
  if (
    arms.length !== 2 ||
    arms.some(
      (arm) =>
        (arm.presentation ?? "wire") !== "wire" ||
        arm.legs.some((leg) => leg.mode === "locked"),
    )
  )
    return false;
  return !(
    document.annotations.some(
      (annotation) =>
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === junctionId,
    ) ||
    document.layoutGroups.some((group) =>
      group.objectIds.includes(junctionId),
    ) ||
    document.constraints.some((constraint) =>
      constraint.objectIds.includes(junctionId),
    )
  );
}

/** `route` with its end at `endKey` moved onto `endpoint`, in place. */
function withEndReplaced(
  route: SchematicDocument["routes"][number],
  endKey: string,
  endpoint: RouteEndpoint,
): SchematicDocument["routes"][number] {
  const replaced = structuredClone(route);
  if (endpointKey(replaced.start) === endKey) {
    replaced.start = structuredClone(endpoint);
    return replaced;
  }
  const last = replaced.legs.at(-1);
  if (last?.to.kind === "endpoint")
    last.to.endpoint = structuredClone(endpoint);
  return replaced;
}

/** A Route a component may be spliced into, or why it may not. */
function spliceableRoute(
  document: SchematicDocument,
  routeId: string,
): SchematicDocument["routes"][number] | string {
  const route = document.routes.find((candidate) => candidate.id === routeId);
  if (!route) return `Route not found: ${routeId}`;
  if (route.presentation === "power-rail") {
    return "A component cannot be inserted into a power rail";
  }
  if (route.presentation === "bulk-dashed") {
    return "A component cannot be inserted into a MOS bulk lead";
  }
  if (route.legs.some((leg) => leg.mode === "locked")) {
    return `Route ${route.id} contains a locked segment`;
  }
  return route;
}

/** The one Route running between two endpoints, which the splice removes. */
function spanBetween(
  document: SchematicDocument,
  first: RouteEndpoint,
  second: RouteEndpoint,
): SchematicDocument["routes"][number] | string {
  const firstKey = endpointKey(first);
  const secondKey = endpointKey(second);
  const spans = document.routes.filter((candidate) => {
    const keys = new Set(routeEndpoints(candidate).map(endpointKey));
    return keys.has(firstKey) && keys.has(secondKey);
  });
  if (spans.length !== 1) {
    return "Series insertion could not isolate the conductor span between pins";
  }
  const span = spans[0]!;
  const blockingAnnotation = document.annotations.find(
    (annotation) =>
      annotation.anchor.kind === "route" &&
      annotation.anchor.routeId === span.id,
  );
  if (blockingAnnotation) {
    return `Move or remove Route annotation ${blockingAnnotation.id} before inserting the component`;
  }
  return span;
}
