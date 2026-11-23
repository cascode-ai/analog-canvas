import type { WireContacts } from "./wire-contact-index";
import { endpointKey, resolveDocumentLogicalNets } from "@icm/derived";
import {
  evaluateWireMembers,
  wireMemberChoice,
  compileWireDraft,
  createFreeWireAnchor,
  createRouteWireAnchor,
  normalizeRouteGeometry,
  proposeWireCommitThroughContacts,
  splitRoutePieceIds,
  type SchematicEdit,
  type WireCornerOrder,
  type WireDraftStep,
  type WireRoutingMode,
  type WireSource,
} from "@icm/edit-engine";
import { routeEnd, type Point, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  freeWireDraftTarget,
  type WireDraftTarget,
} from "../../interaction/interaction-state";
import type { WireCanvasSnapResult } from "./wire-canvas-snap";
import { resolveWireDraftShape } from "./wire-draft-shape";

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
    ...splitRoutePieceIds(routeId, suffix),
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
 *
 * `nextIds` is a thunk because an endpoint target needs no identity at all —
 * the pin is already on the sheet. Taking the ids eagerly would spend a
 * routing suffix on every press that lands on a pin, and those suffixes name
 * objects an author can see.
 */
export function wireSourceForTarget(
  document: SchematicDocument,
  target: WireDraftTarget,
  activeNetId: string | null,
  nextIds: () => WireDraftTargetIds,
  resolver?: SymbolResolver,
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
        nextIds(),
        resolver,
      );
    }
    case "free": {
      const ids = nextIds();
      return createFreeWireAnchor(
        target.point,
        activeNetId ?? ids.newNetId,
        !document.nets.some((net) => net.id === activeNetId),
        ids.junctionId,
      );
    }
  }
}

/** The two ends and the authored corners one wire gesture is made of. */
export interface WireDraftShape {
  from: WireSource;
  to: WireSource;
  steps: readonly WireDraftStep[];
}

/**
 * The visible pins a wire gesture may pass straight through and connect to.
 *
 * Junctions are excluded because they are already wire ends, not something a
 * run passes over. Pins outside the gesture's bounding box are excluded
 * because the planner would drop them anyway: a contact joins the wire only
 * when it lies ON the drawn path, and every vertex `compileWireDraft`
 * produces lies inside the box spanned by the two ends and the authored
 * steps — an inserted elbow is a corner BETWEEN two of those points, and both
 * the doubled-back cancellation and the normalizer only ever remove vertices.
 *
 * Both preview and commit use the same order-preserving source. The editor
 * indexes visible terminal positions for short gestures across the whole sheet.
 */
export function wirePassThroughContacts(
  endpoints: WireContacts,
  { from, to, steps }: WireDraftShape,
): WireSource[] {
  const spanned = [
    from.connection.contactPoint,
    from.connection.gridLanding,
    ...steps.map((step) => step.point),
    to.connection.contactPoint,
    to.connection.gridLanding,
  ];
  const minX = Math.min(...spanned.map((point) => point.x));
  const maxX = Math.max(...spanned.map((point) => point.x));
  const minY = Math.min(...spanned.map((point) => point.y));
  const maxY = Math.max(...spanned.map((point) => point.y));
  // Round the broad query outwards. Fractional contacts at the far edge
  // must survive conversion from two endpoints to origin plus width.
  const candidates =
    "inBounds" in endpoints
      ? endpoints.inBounds({
          x: Math.floor(minX),
          y: Math.floor(minY),
          width: Math.ceil(maxX) - Math.floor(minX),
          height: Math.ceil(maxY) - Math.floor(minY),
        })
      : endpoints;
  return candidates.filter((endpoint) => {
    if (endpoint.endpoint.kind !== "terminal") return false;
    const { x, y } = endpoint.connection.contactPoint;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  });
}

export interface WireDraftPreview {
  /** The centreline the commit will persist, joined across its Routes. */
  readonly points: readonly Point[];
  /** Interior pin contacts the commit will make, in path order. */
  readonly contacts: readonly Point[];
  readonly message?: string;
  readonly width?: number;
  readonly blocked?: boolean;
}

export const EMPTY_WIRE_DRAFT_PREVIEW: WireDraftPreview = {
  points: [],
  contacts: [],
};

export interface WireDraftPreviewInput {
  document: SchematicDocument;
  resolver: SymbolResolver;
  source: WireSource;
  target: WireDraftTarget;
  steps: readonly WireDraftStep[];
  routingMode: WireRoutingMode;
  cornerOrder: WireCornerOrder;
  /** The same endpoint list the commit passes; filtered here, once. */
  visibleEndpoints: WireContacts;
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
  resolver,
  source,
  target,
  steps,
  routingMode,
  cornerOrder,
  visibleEndpoints,
}: WireDraftPreviewInput): WireDraftPreview {
  let to = wireSourceForTarget(
    document,
    target,
    source.netId,
    () => PREVIEW_TARGET_IDS,
    resolver,
  );
  if (!to) return EMPTY_WIRE_DRAFT_PREVIEW;
  const evaluation = evaluateWireMembers(document, source, to, resolver);
  if (evaluation.kind === "ready") {
    source = evaluation.from;
    to = evaluation.to;
  }
  const shape = resolveWireDraftShape(
    document,
    resolver,
    source,
    to,
    steps,
    routingMode,
    cornerOrder,
    visibleEndpoints,
  );
  if (evaluation.kind !== "ready")
    return {
      points: compileWireDraft(
        source,
        to,
        shape.steps,
        routingMode,
        shape.cornerOrder,
      ).points,
      contacts: [],
      blocked: true,
      message:
        evaluation.kind === "invalid"
          ? evaluation.message
          : (evaluation.choice.sharedPinLabel ??
            `Choose ${evaluation.choice.expectedWidth ?? 1} bus member(s)`),
    };
  const contacts = wirePassThroughContacts(visibleEndpoints, {
    from: source,
    to,
    steps: shape.steps,
  });
  try {
    const proposal = proposeWireCommitThroughContacts(
      source,
      to,
      shape.steps.map((item) => item.point),
      contacts,
      PREVIEW_IDS,
      { steps: shape.steps, routingMode, cornerOrder: shape.cornerOrder },
    );
    const width = source.members?.length ?? to.members?.length ?? 1;
    const aggregate = source.members ? source : to.members ? to : undefined;
    const ordered = aggregate
      ? wireMemberChoice(document, aggregate, false).options
      : undefined;
    const array = source.arrayPinNames
      ? source
      : to.arrayPinNames
        ? to
        : undefined;
    const other = array === source ? to : source;
    const targets =
      array && other.members
        ? wireMemberChoice(document, other, false).options
        : undefined;
    const pairing =
      array?.arrayPinNames && targets
        ? [0, width - 1]
            .map((i) => array.arrayPinNames![i] + " → " + targets[i]!.label)
            .join(" … ")
        : undefined;
    const selected = source.endpoint.memberId
      ? source
      : to.endpoint.memberId
        ? to
        : undefined;
    const memberName = selected?.netId
      ? resolveDocumentLogicalNets(document).byBaseNetId.get(selected.netId)
          ?.name
      : undefined;
    return {
      ...proposedWireGeometry(proposal.edits, [source, to, ...contacts]),
      width,
      ...(ordered
        ? {
            message: pairing
              ? `${width} members · ${pairing}`
              : `${width} members · ${ordered
                  .slice(0, 4)
                  .map((member) => member.label)
                  .join(" → ")}${width > 4 ? " …" : ""}`,
          }
        : selected
          ? { message: memberName ? `1 member · ${memberName}` : "1 member" }
          : {}),
    };
  } catch (error) {
    return {
      points: compileWireDraft(
        source,
        to,
        shape.steps,
        routingMode,
        shape.cornerOrder,
      ).points,
      contacts: [],
      blocked: true,
      message: error instanceof Error ? error.message : "Cannot connect here",
    };
  }
}
