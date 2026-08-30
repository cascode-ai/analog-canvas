import {
  routeEnd,
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

import type { SchematicEdit } from "./edit-schema.js";
import { resolveRouteEditPath } from "./route-operations.js";
import { proposeEndpointRouteAttachment } from "./routing-planner.js";
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
  const route = documentWithInstance.routes.find(
    (candidate) => candidate.id === routeId,
  );
  if (!route) return { ok: false, message: `Route not found: ${routeId}` };
  if (route.presentation === "power-rail") {
    return {
      ok: false,
      message: "A component cannot be inserted into a power rail",
    };
  }
  if (route.presentation === "bulk-dashed") {
    return {
      ok: false,
      message: "A component cannot be inserted into a MOS bulk lead",
    };
  }
  if (route.legs.some((leg) => leg.mode === "locked")) {
    return {
      ok: false,
      message: `Route ${route.id} contains a locked segment`,
    };
  }
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

  const firstKey = endpointKey(firstContact.endpoint);
  const secondKey = endpointKey(secondContact.endpoint);
  const removedSpan = afterSecond.routes.find((candidate) => {
    const keys = new Set([
      endpointKey(candidate.start),
      endpointKey(routeEnd(candidate)),
    ]);
    return keys.has(firstKey) && keys.has(secondKey);
  });
  if (!removedSpan) {
    return {
      ok: false,
      message:
        "Series insertion could not isolate the conductor span between pins",
    };
  }
  const blockingAnnotation = afterSecond.annotations.find(
    (annotation) =>
      annotation.anchor.kind === "route" &&
      annotation.anchor.routeId === removedSpan.id,
  );
  if (blockingAnnotation) {
    return {
      ok: false,
      message: `Move or remove Route annotation ${blockingAnnotation.id} before inserting the component`,
    };
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
