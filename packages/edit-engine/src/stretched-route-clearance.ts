import {
  deriveNetConnectivityContext,
  endpointKey,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import { createRoutePath, routeEnd } from "@icm/model";
import type { Point, RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { createRouteClearance } from "./route-clearance.js";
import { compileWireDraft } from "./routing-planner.js";
import { projectRoutingEditGeometry } from "./routing-geometry-projection.js";
import { executeTransaction } from "./transaction.js";

/** Why a wire, as drawn in `document`, reads as a connection it is not. */
function routeConflict(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: RouteBranch,
  blockedPoints: readonly Point[] = [],
) {
  const points = resolveRouteGeometry(document, resolver, route)?.centerline;
  if (!points) return null;
  const context = deriveNetConnectivityContext(document, resolver);
  const ends = [route.start, routeEnd(route)] as const;
  const clearance = createRouteClearance(document, resolver, context, {
    logicalIds: new Set([
      context.logicalNetResolution.byBaseNetId.get(route.netId)?.id ??
        route.netId,
    ]),
    endpointKeys: new Set(ends.map(endpointKey)),
    blockedPoints,
  });
  return { clearance, context, ends, reason: clearance.conflict(points, ends) };
}

/** Who belongs to which Net: the electrical fact a redraw must not touch. */
function membership(document: SchematicDocument): string {
  return JSON.stringify([
    document.nets
      .map((net) => [
        net.id,
        net.terminals
          .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
          .sort(),
      ])
      .sort(),
    document.routes.map((route) => [route.id, route.netId]).sort(),
    document.junctions.map((junction) => [junction.id, junction.netId]).sort(),
  ]);
}

/** Which pins are joined, whatever the Nets and wires are called. */
function pinGroups(document: SchematicDocument): string {
  return JSON.stringify(
    document.nets
      .map((net) =>
        net.terminals
          .map((terminal) => `${terminal.instanceId}.${terminal.pinName}`)
          .sort(),
      )
      .filter((pins) => pins.length)
      .sort(),
  );
}

/**
 * set_route_path edits that redraw each of `routeIds` along the cheapest
 * clear path when a change left it meeting what it must not (another Net's
 * pin or wire, or a part) while it met none of that `before` the change. The
 * path is the one the Agent's connect takes; the wire keeps its ends, Net and
 * style. A wire with no clear path keeps the change's geometry. `preview`
 * applies the change with the given extra edits and returns the Document, or
 * null when it is rejected; each wire is redrawn on the previous result.
 *
 * `drawn`, when given, returns the Document whose wires are judged and
 * redrawn instead: a move's stretched wires before normalization, which
 * merges a wire laid along another of its Net with it and so changes which
 * wires there are. A redraw then has to keep only which pins are joined.
 */
export function redrawStretchedRoutesClear(
  before: { document: SchematicDocument; resolver: SymbolResolver },
  resolver: SymbolResolver,
  routeIds: readonly string[],
  preview: (extra: readonly SchematicEdit[]) => SchematicDocument | null,
  drawn?: (extra: readonly SchematicEdit[]) => SchematicDocument | null,
): SchematicEdit[] {
  const judged = drawn ?? preview;
  const joins = drawn ? pinGroups : membership;
  let working = judged([]);
  if (!working) return [];
  // What the change alone leaves, previewed only once a redraw has to be
  // compared with it: most moves stretch no wire onto anything.
  let result: SchematicDocument | null | undefined = drawn
    ? undefined
    : working;
  const extra: SchematicEdit[] = [];
  // Wires still to be looked at are no obstacles yet: two pins that traded
  // places each sit on the other's stretched wire, and neither could leave.
  const pending = new Set(routeIds);
  for (const routeId of [...routeIds].sort((left, right) =>
    left.localeCompare(right, "en"),
  )) {
    const route = working.routes.find((candidate) => candidate.id === routeId);
    const earlier = before.document.routes.find(
      (candidate) => candidate.id === routeId,
    );
    const unchanged =
      !route ||
      (earlier &&
        routeConflict(before.document, before.resolver, earlier)?.reason) ||
      !routeConflict(working, resolver, route)?.reason;
    if (unchanged) {
      pending.delete(routeId);
      continue;
    }
    // Their open ends stay where they are, so those still block a path.
    const ownNet = route.netId;
    const blockedPoints = working.routes.flatMap((candidate) =>
      candidate.id !== routeId &&
      pending.has(candidate.id) &&
      candidate.netId !== ownNet
        ? [candidate.start, routeEnd(candidate)].flatMap((endpoint) =>
            endpoint.kind === "junction"
              ? working!.junctions
                  .filter((junction) => junction.id === endpoint.junctionId)
                  .map((junction) => junction.position)
              : [],
          )
        : [],
    );
    const found = routeConflict(
      {
        ...working,
        routes: working.routes.filter(
          (candidate) => candidate.id === routeId || !pending.has(candidate.id),
        ),
      },
      resolver,
      route,
      blockedPoints,
    );
    pending.delete(routeId);
    if (!found) continue;
    const clear = found.clearance.path(found.ends[0], found.ends[1]);
    if (typeof clear === "string") continue;
    const from = resolveEndpointConnection(
      working,
      resolver,
      found.ends[0],
      found.context,
    );
    const to = resolveEndpointConnection(
      working,
      resolver,
      found.ends[1],
      found.context,
    );
    if (!from || !to) continue;
    const compiled = compileWireDraft(
      { connection: from },
      { connection: to },
      clear.waypoints.map((point) => ({
        point,
        routingMode: "orthogonal" as const,
        cornerOrder: clear.cornerOrder,
      })),
      "orthogonal",
      clear.cornerOrder,
    );
    const edit: SchematicEdit = {
      kind: "set_route_path",
      route: {
        ...route,
        legs: createRoutePath({
          id: route.id,
          netId: route.netId,
          start: route.start,
          end: routeEnd(route),
          bends: compiled.waypoints,
          modes: compiled.segmentModes,
        }).legs,
      },
    };
    const next = preview([...extra, edit]);
    // A redraw changes where a wire runs, never what it joins: one that
    // brought a wire onto another Net's open end would merge the two.
    if (result === undefined) result = preview([]);
    if (!next || !result || joins(next) !== joins(result)) continue;
    const nextDrawn = judged([...extra, edit]);
    if (!nextDrawn) continue;
    extra.push(edit);
    result = next;
    working = nextDrawn;
  }
  return extra;
}

/**
 * Where a change's own geometry edits put parts, Junctions and wires, before
 * the transaction normalizes them. Other edits, such as a moved pin's joins,
 * are left out.
 */
function projectDrawnGeometry(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
): SchematicDocument {
  return projectRoutingEditGeometry(
    document,
    edits.filter(
      (edit) =>
        edit.kind === "move_instance" ||
        edit.kind === "move_junction" ||
        edit.kind === "set_route_path" ||
        edit.kind === "remove_route_geometry",
    ),
  );
}

/** The Document `edits` and then `extra` leave, or null when it is refused. */
function previewEdits(
  document: SchematicDocument,
  resolver: SymbolResolver,
  edits: readonly SchematicEdit[],
  transactionId: string,
): (extra: readonly SchematicEdit[]) => SchematicDocument | null {
  return (extra) => {
    const result = executeTransaction(
      document,
      {
        transactionId,
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: transactionId },
        edits: [...edits, ...extra],
      },
      { symbolResolver: resolver },
    );
    return result.ok ? result.document : null;
  };
}

/**
 * Wires a typed move stretches onto what they must not touch are drawn clear
 * of it instead (#1344). A flash ADC's comparator typed two grid steps lower
 * slid the bend of its IN− wire down along the ladder resistor under its
 * tap, so the wire seemed to leave from the resistor's middle; another typed
 * higher came to lie with its IN+ pin on its own stretched IN− wire. Each
 * wire at a moved part is redrawn by redrawStretchedRoutesClear. A drag is
 * left as it stretches, since the person dragging sees it happen; Properties
 * and an Agent's move do not show it. Returns the edits to send in the same
 * transaction as `edits`.
 */
export function planMoveRouteClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: readonly string[],
  edits: readonly SchematicEdit[],
): SchematicEdit[] {
  const moved = new Set(instanceIds);
  const routeIds = document.routes
    .filter((route) =>
      [route.start, routeEnd(route)].some(
        (endpoint) =>
          endpoint.kind === "terminal" && moved.has(endpoint.instanceId),
      ),
    )
    .map((route) => route.id);
  if (routeIds.length === 0) return [];
  return redrawStretchedRoutesClear(
    { document, resolver },
    resolver,
    routeIds,
    previewEdits(document, resolver, edits, "move-route-clearance"),
    // Judged as stretched: the comparator's IN− wire, slid down along the
    // resistor under its tap, merged there with the resistor's own wire, and
    // what was left ran from the resistor's lower pin. An alignment stretches
    // its wires inside the transaction, with no edit to project, so it is
    // judged as the transaction leaves it.
    edits.some((edit) => edit.kind === "align_instances")
      ? undefined
      : (extra) => projectDrawnGeometry(document, [...edits, ...extra]),
  );
}

/**
 * Wires a part's pin change stretches onto what they must not touch are drawn
 * clear of it instead (#1309). Swapping an op-amp's inputs exchanges where its
 * two input pins sit, and the follow stretches each wire straight to its
 * pin's new place: two wires coming down one column then lie on one line, and
 * the drawing shows the inputs shorted. Each wire at a part whose symbol or
 * Signal Flow changes is redrawn by redrawStretchedRoutesClear unless `edits`
 * draws it itself; ERC_OVERLAPPING_NETS still reports a wire that has no
 * clear path. Returns the edits to send in the same transaction as `edits`.
 */
export function planPinChangeRouteClearance(
  document: SchematicDocument,
  resolver: SymbolResolver,
  edits: readonly SchematicEdit[],
): SchematicEdit[] {
  const changed = new Set(
    edits.flatMap((edit) =>
      edit.kind === "set_instance_symbol" ||
      edit.kind === "set_instance_signal_flow_parameters"
        ? [edit.instanceId]
        : [],
    ),
  );
  if (changed.size === 0) return [];
  const authored = new Set(
    edits.flatMap((edit) =>
      edit.kind === "set_route_path" ? [edit.route.id] : [],
    ),
  );
  const routeIds = document.routes
    .filter(
      (route) =>
        !authored.has(route.id) &&
        [route.start, routeEnd(route)].some(
          (endpoint) =>
            endpoint.kind === "terminal" && changed.has(endpoint.instanceId),
        ),
    )
    .map((route) => route.id);
  if (routeIds.length === 0) return [];
  return redrawStretchedRoutesClear(
    { document, resolver },
    resolver,
    routeIds,
    previewEdits(document, resolver, edits, "pin-change-route-clearance"),
  );
}
