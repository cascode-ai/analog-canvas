import { endpointKey } from "@icm/derived";
import {
  createFreeWireAnchor,
  createRouteWireAnchor,
  normalizeRouteGeometry,
  proposeWireCommitThroughContacts,
  type SchematicEdit,
  type WireCornerOrder,
  type WireDraftStep,
  type WireRoutingMode,
  type WireSource,
} from "@icm/edit-engine";
import { routeEnd, type Point, type SchematicDocument } from "@icm/model";

import {
  freeWireDraftTarget,
  type WireDraftTarget,
} from "../../interaction/interaction-state";
import type { WireCanvasSnapResult } from "./wire-canvas-snap";

/** Identity for the anchors a target may have to create. */
export interface WireDraftTargetIds {
  junctionId: string;
  firstRouteId: string;
  secondRouteId: string;
  newNetId: string;
}

export function wireDraftTargetIdsForSuffix(
  target: WireDraftTarget,
  suffix: number,
): WireDraftTargetIds {
  const routeId = target.kind === "route" ? target.routeId : "route-ui";
  return {
    junctionId: `junction-ui-${suffix}`,
    firstRouteId: `${routeId}-a-${suffix}`,
    secondRouteId: `${routeId}-b-${suffix}`,
    newNetId: `net-ui-${suffix}`,
  };
}

/** The one reading of a resolved canvas snap, shared by hover and by press. */
export function wireDraftTargetFromSnap(
  resolved: WireCanvasSnapResult,
): WireDraftTarget {
  if (!resolved.ambiguous && resolved.endpoint) {
    return {
      kind: "endpoint",
      point: resolved.endpoint.connection.contactPoint,
      source: resolved.endpoint,
    };
  }
  if (!resolved.ambiguous && resolved.route) {
    return {
      kind: "route",
      point: resolved.route.point,
      routeId: resolved.route.routeId,
      segmentIndex: resolved.route.segmentIndex,
    };
  }
  return freeWireDraftTarget(resolved.point);
}

/**
 * The `WireSource` a target commits as. The preview passes preview identity
 * and the press passes the session's next routing suffix; nothing else about
 * the two calls differs, which is the whole point of having one function.
 */
export function wireSourceForTarget(
  document: SchematicDocument,
  target: WireDraftTarget,
  activeNetId: string | null,
  ids: WireDraftTargetIds,
): WireSource | null {
  switch (target.kind) {
    case "endpoint":
      return target.source;
    case "route": {
      const route = document.routes.find(
        (candidate) => candidate.id === target.routeId,
      );
      if (!route?.legs[target.segmentIndex]) return null;
      return createRouteWireAnchor(
        document,
        route,
        target.point,
        target.segmentIndex,
        document.presentation.grid,
        ids,
      );
    }
    case "free":
      return createFreeWireAnchor(
        target.point,
        activeNetId ?? ids.newNetId,
        activeNetId === null,
        ids.junctionId,
      );
  }
}

/** The visible pins a wire gesture may pass straight through and connect to. */
export function wirePassThroughContacts(
  endpoints: readonly WireSource[],
): WireSource[] {
  return endpoints.filter((endpoint) => endpoint.endpoint.kind === "terminal");
}

export interface WireDraftPreview {
  /** The centreline the commit will persist, joined across its Routes. */
  readonly points: readonly Point[];
  /** Interior pin contacts the commit will make, in path order. */
  readonly contacts: readonly Point[];
}

export const EMPTY_WIRE_DRAFT_PREVIEW: WireDraftPreview = {
  points: [],
  contacts: [],
};

export interface WireDraftPreviewInput {
  document: SchematicDocument;
  source: WireSource;
  target: WireDraftTarget;
  steps: readonly WireDraftStep[];
  routingMode: WireRoutingMode;
  cornerOrder: WireCornerOrder;
  /** The same endpoint list the commit passes; filtered here, once. */
  visibleEndpoints: readonly WireSource[];
}

const PREVIEW_IDS = {
  routeId: "wire-draft-preview-route",
  newNetId: "wire-draft-preview-net",
} as const;

const PREVIEW_TARGET_IDS: WireDraftTargetIds = {
  junctionId: "wire-draft-preview-junction",
  firstRouteId: "wire-draft-preview-route-a",
  secondRouteId: "wire-draft-preview-route-b",
  newNetId: PREVIEW_IDS.newNetId,
};

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * Read the drawn geometry back out of a commit proposal.
 *
 * Every Route the proposal authors begins and ends at one of the `WireSource`s
 * it was built from, so their already-resolved contact points answer every
 * endpoint without touching the Document again. Each Route is then put through
 * `normalizeRouteGeometry`, which is the pass `set_route_path` itself applies
 * before storing a Route — so what comes out is what will be stored, not a
 * second opinion about it.
 *
 * One limit is worth naming: a transaction finishes by canonicalizing the
 * conductor topology of every Net it touched, which can further tidy a new
 * wire that runs along conductors the same Net already owns. That pass needs a
 * whole Document and is far too expensive to run on every pointer move, so a
 * draft laid over existing same-Net conductors may still be tidied on release.
 * It changes which Routes carry the shape, not where the shape goes.
 */
function proposedWireGeometry(
  edits: readonly SchematicEdit[],
  sources: readonly WireSource[],
): WireDraftPreview {
  const contactPoints = new Map(
    sources.map((source) => [
      endpointKey(source.endpoint),
      source.connection.contactPoint,
    ]),
  );
  const points: Point[] = [];
  const contacts: Point[] = [];
  for (const edit of edits) {
    if (edit.kind !== "set_route_path") continue;
    const from = contactPoints.get(endpointKey(edit.route.start));
    const to = contactPoints.get(endpointKey(routeEnd(edit.route)));
    if (!from || !to) return EMPTY_WIRE_DRAFT_PREVIEW;
    const centerline = normalizeRouteGeometry(
      [
        from,
        ...edit.route.legs.flatMap((leg) =>
          leg.to.kind === "bend" ? [leg.to.position] : [],
        ),
        to,
      ],
      edit.route.legs.map((leg) => leg.mode),
    ).points;
    const joint = points.at(-1);
    if (joint && samePoint(joint, centerline[0]!)) {
      contacts.push(centerline[0]!);
      points.push(...centerline.slice(1));
    } else {
      points.push(...centerline);
    }
  }
  return { points, contacts };
}

/**
 * The wire a release would commit, drawn before the release happens.
 *
 * This calls the commit planner. It does not reproduce it: the polyline is
 * read back out of the very `set_route_path` edits the transaction would
 * carry, so a change to how wires are planned reaches the preview with no
 * second edit anywhere.
 */
export function resolveWireDraftPreview({
  document,
  source,
  target,
  steps,
  routingMode,
  cornerOrder,
  visibleEndpoints,
}: WireDraftPreviewInput): WireDraftPreview {
  const to = wireSourceForTarget(
    document,
    target,
    source.netId,
    PREVIEW_TARGET_IDS,
  );
  if (!to) return EMPTY_WIRE_DRAFT_PREVIEW;
  const contacts = wirePassThroughContacts(visibleEndpoints);
  const proposal = proposeWireCommitThroughContacts(
    source,
    to,
    steps.map((step) => step.point),
    contacts,
    PREVIEW_IDS,
    { steps, routingMode, cornerOrder },
  );
  return proposedWireGeometry(proposal.edits, [source, to, ...contacts]);
}
