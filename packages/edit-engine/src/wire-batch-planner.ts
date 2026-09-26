import { pointOnSegment, resolveRouteGeometry } from "@icm/derived";
import { routeEnd, type SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { executeTransaction, type SchematicEdit } from "./transaction.js";
import { proposeWireIntent } from "./routing-planner.js";
import { createContactPlanningDraft } from "./contact-planning-draft.js";
import { resolveWireIntentTarget } from "./wire-intent-target.js";

/** Plan on private evolving state, then dispatch the combined edits once. */
export function planWireBatch(
  document: SchematicDocument,
  resolver: SymbolResolver,
  input:
    | Parameters<typeof proposeWireIntent>[2]
    | Parameters<typeof proposeWireIntent>[2][],
  limit: number,
): { edits: SchematicEdit[] } | string {
  if (!Array.isArray(input))
    return proposeWireIntent(document, resolver, input);
  const draft = createContactPlanningDraft(document, resolver);
  const working = draft.document;
  const edits = draft.edits;
  const descendants = new Map(
    document.routes.map((route) => [route.id, new Set([route.id])]),
  );
  const resolveAnchor = (
    anchor: Parameters<typeof proposeWireIntent>[2]["from"],
    other: Parameters<typeof proposeWireIntent>[2]["from"],
  ) => {
    const resolved = resolveWireIntentTarget(working, resolver, anchor, other);
    if (
      typeof resolved !== "string" ||
      anchor.kind !== "wire-at" ||
      !(
        resolved.startsWith("Multiple wire interiors") ||
        resolved.startsWith("Ambiguous wire crossing") ||
        resolved.startsWith("Tap at")
      ) ||
      !edits.length
    )
      return resolved;
    // A preceding gesture may create overlapping portions of one conductor,
    // still bearing different Net hints until endpoint topology is finalized.
    // Ask the ordinary finalizer whether the tap is unambiguous, but never
    // copy its rewritten IDs into the replay draft. Foreign crossings remain
    // subject to the same selector contract.
    const preview = executeTransaction(
      document,
      {
        transactionId: "wire-batch-selector",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "wire-planner" },
        dryRun: true,
        edits,
      },
      { symbolResolver: resolver },
    );
    if (!preview.ok) return resolved;
    const selected = resolveWireIntentTarget(
      preview.document,
      resolver,
      anchor,
      other,
    );
    if (typeof selected === "string") return selected;
    for (const route of working.routes) {
      const segment = resolveRouteGeometry(
        working,
        resolver,
        route,
      )?.segments.find((s) => pointOnSegment(anchor.point, s.from, s.to));
      if (segment)
        return {
          kind: "route-segment" as const,
          routeId: route.id,
          legId: segment.address.legId,
          point: anchor.point,
        };
    }
    return resolved;
  };
  const rebaseAnchor = (
    anchor: Parameters<typeof proposeWireIntent>[2]["from"],
  ): typeof anchor | string => {
    if (
      anchor.kind !== "route-segment" ||
      working.routes.some((route) => route.id === anchor.routeId)
    )
      return anchor;
    const original = document.routes.find(
      (route) => route.id === anchor.routeId,
    );
    if (!original || !original.legs.some((leg) => leg.id === anchor.legId))
      return `Wire route or leg does not exist: ${anchor.routeId}/${anchor.legId}`;
    const originalSegment = resolveRouteGeometry(
      document,
      resolver,
      original,
    )?.segments.find((segment) => segment.address.legId === anchor.legId);
    if (
      !originalSegment ||
      !pointOnSegment(anchor.point, originalSegment.from, originalSegment.to)
    )
      return `Wire route point is not on the original leg: ${anchor.routeId}/${anchor.legId}`;
    const candidates = [...(descendants.get(anchor.routeId) ?? [])].flatMap(
      (routeId) => {
        const route = working.routes.find((entry) => entry.id === routeId);
        if (!route) return [];
        const geometry = resolveRouteGeometry(working, resolver, route);
        if (!geometry) return [];
        return geometry.segments
          .filter((segment) =>
            pointOnSegment(anchor.point, segment.from, segment.to),
          )
          .map((segment) => ({ route, segment, geometry }));
      },
    );
    const junction = candidates.flatMap(({ route, geometry }) => {
      const endpoints = [
        { endpoint: route.start, point: geometry.centerline[0] },
        { endpoint: routeEnd(route), point: geometry.centerline.at(-1) },
      ];
      return endpoints
        .filter(
          ({ endpoint, point }) =>
            endpoint.kind === "junction" &&
            point?.x === anchor.point.x &&
            point.y === anchor.point.y,
        )
        .map(({ endpoint }) => endpoint);
    })[0];
    if (junction) return { kind: "endpoint", endpoint: junction };
    if (candidates.length !== 1)
      return `Wire route segment has ${candidates.length} descendants at the requested point: ${anchor.routeId}/${anchor.legId}`;
    const match = candidates[0]!;
    return {
      ...anchor,
      routeId: match.route.id,
      legId: match.segment.address.legId,
    };
  };
  for (const [index, intent] of input.entries()) {
    const from = rebaseAnchor(intent.from);
    if (typeof from === "string") return `Wire ${index + 1}: ${from}`;
    const to = rebaseAnchor(intent.to);
    if (typeof to === "string") return `Wire ${index + 1}: ${to}`;
    const selectedFrom = resolveAnchor(from, to);
    if (typeof selectedFrom === "string")
      return `Wire ${index + 1}: ${selectedFrom}`;
    const selectedTo = resolveAnchor(to, selectedFrom);
    if (typeof selectedTo === "string")
      return `Wire ${index + 1}: ${selectedTo}`;
    const planned = proposeWireIntent(working, resolver, {
      ...intent,
      from: selectedFrom,
      to: selectedTo,
    });
    if (typeof planned === "string") return `Wire ${index + 1}: ${planned}`;
    // Match the final transaction's pre-finalization state. Normalizing each
    // private step would invent Net/Route identities absent during replay.
    // A new route's Net remains a hint until finalization; a tap can materialize
    // that hint using the existing createNet contract.
    const materialized = planned.edits.map((edit): SchematicEdit =>
      edit.kind === "add_junction" &&
      !document.nets.some((net) => net.id === edit.netId)
        ? { ...edit, createNet: true }
        : edit,
    );
    if (edits.length + materialized.length > limit)
      return `Wire ${index + 1}: batch requires ${edits.length + materialized.length} edits, exceeding the ${limit}-edit transaction limit`;
    try {
      for (const edit of materialized) draft.apply(edit);
    } catch (error) {
      return `Wire ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
    }
    for (const edit of planned.edits) {
      if (edit.kind !== "add_junction" || !edit.split) continue;
      for (const lineage of descendants.values()) {
        if (!lineage.delete(edit.split.routeId)) continue;
        lineage.add(edit.split.firstRouteId);
        lineage.add(edit.split.secondRouteId);
      }
    }
  }
  return { edits };
}
