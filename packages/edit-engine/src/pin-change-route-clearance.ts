import {
  deriveNetConnectivityContext,
  endpointKey,
  resolveEndpointConnection,
  resolveRouteGeometry,
} from "@icm/derived";
import { createRoutePath, routeEnd } from "@icm/model";
import type { RouteBranch, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";
import { createRouteClearance } from "./route-clearance.js";
import { compileWireDraft } from "./routing-planner.js";
import { executeTransaction } from "./transaction.js";

/** Why a wire, as drawn in `document`, reads as a connection it is not. */
function routeConflict(
  document: SchematicDocument,
  resolver: SymbolResolver,
  route: RouteBranch,
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
  });
  return { clearance, context, ends, reason: clearance.conflict(points, ends) };
}

/**
 * set_route_path edits that redraw each of `routeIds` along the cheapest
 * clear path when a change left it meeting what it must not (another Net's
 * pin or wire, or a part) while it met none of that `before` the change. The
 * path is the one the Agent's connect takes; the wire keeps its ends, Net and
 * style. A wire with no clear path keeps the change's geometry. `preview`
 * applies the change with the given extra edits and returns the Document, or
 * null when it is rejected; each wire is redrawn on the previous result.
 */
export function redrawStretchedRoutesClear(
  before: { document: SchematicDocument; resolver: SymbolResolver },
  resolver: SymbolResolver,
  routeIds: readonly string[],
  preview: (extra: readonly SchematicEdit[]) => SchematicDocument | null,
): SchematicEdit[] {
  let working = preview([]);
  if (!working) return [];
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
    const found = routeConflict(
      {
        ...working,
        routes: working.routes.filter(
          (candidate) => candidate.id === routeId || !pending.has(candidate.id),
        ),
      },
      resolver,
      route,
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
    if (!next) continue;
    extra.push(edit);
    working = next;
  }
  return extra;
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
    (extra) => {
      const result = executeTransaction(
        document,
        {
          transactionId: "pin-change-route-clearance",
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "pin-change-route-clearance" },
          edits: [...edits, ...extra],
        },
        { symbolResolver: resolver },
      );
      return result.ok ? result.document : null;
    },
  );
}
