import {
  isFrozenSnapshot,
  routeEndpoints,
  SchematicDocumentSchema,
  type Point,
  type Rect,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import {
  buildEndpointObjectLookup,
  deriveDocumentContactEvidence,
  deriveElectricalTopologyProjection,
  isVisibleEndpoint,
  resolveDocumentRoutingGeometry,
  resolveEndpointPoint,
  resolveVisualAnchor,
  SEGMENT_EPSILON,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import type { RoutingOperationPlan } from "./routing-operation-plan.js";
import { normalizeSameNetConductorTopology } from "./conductor-topology.js";
import { executeTransaction } from "./transaction.js";
import { gridAlignmentDiagnostics } from "./transaction-preflight.js";
import { validateRoute } from "./transaction-routing.js";
import { resolveRouteEditPath } from "./route-operations.js";
import { canProjectRoutingEditGeometry } from "./routing-geometry-projection.js";

function addBounds(bounds: Rect | undefined, point: Point, padding = 0): Rect {
  const x = Math.min(bounds?.x ?? Infinity, point.x - padding);
  const y = Math.min(bounds?.y ?? Infinity, point.y - padding);
  const right = Math.max(
    bounds ? bounds.x + bounds.width : -Infinity,
    point.x + padding,
  );
  const bottom = Math.max(
    bounds ? bounds.y + bounds.height : -Infinity,
    point.y + padding,
  );
  return { x, y, width: right - x, height: bottom - y };
}

/** A bounded, conservative proof for an isolated, closed rigid translation.
 * Source qualification runs once; uncertain or intersecting positions retain
 * the evaluated transaction path. Nothing is certified, committed or cached
 * outside the gesture that owns this function. */
export function prepareClosedTranslationPreview(
  document: SchematicDocument,
  resolver: SymbolResolver,
  initial: RoutingOperationPlan,
): (plan: RoutingOperationPlan, delta: Point) => boolean {
  const refuse = () => false;
  if (
    !isFrozenSnapshot(document) ||
    initial.affected.boundaryRoutes.length > 0 ||
    initial.affected.protectedObjectIds.length > 0
  )
    return refuse;
  const membership = deriveElectricalTopologyProjection(
    document,
    resolver,
  ).endpointToBaseNet;
  // set_route_path describes a merge effect even when both ends already share
  // a Base Net. Prove that effect is idempotent; never rewrite it to preserve.
  const preservesMembership = (plan: RoutingOperationPlan) => {
    const effect = plan.expectedElectricalEffect;
    return (
      effect.kind === "preserve" ||
      (effect.kind === "merge" &&
        effect.endpointGroups.every((group) => {
          const netId = group[0] && membership.get(group[0]);
          return (
            netId !== undefined &&
            group.every((key) => membership.get(key) === netId)
          );
        }))
    );
  };
  if (!preservesMembership(initial)) return refuse;
  const instances = new Set(initial.affected.instances);
  const junctions = new Set(initial.affected.internalJunctions);
  const routes = new Set(initial.affected.internalRoutes);
  const movesEndpoint = (e: RouteEndpoint) =>
    e.kind === "terminal"
      ? instances.has(e.instanceId)
      : junctions.has(e.junctionId);
  for (const route of document.routes) {
    const ends = routeEndpoints(route);
    if (
      routes.has(route.id)
        ? !ends.every(movesEndpoint)
        : ends.some(movesEndpoint)
    )
      return refuse;
    if (
      routes.has(route.id) &&
      (route.presentation === "power-rail" ||
        route.presentation === "bulk-dashed" ||
        validateRoute(
          document,
          route,
          resolver,
          resolveRouteEditPath(document, resolver, route),
        ))
    )
      return refuse;
  }
  // A normalizing repair or model/default refresh must remain visible through
  // the strict path. Reuse the actual writer once, not a second repair policy.
  const parsed = SchematicDocumentSchema.safeParse(document);
  if (!parsed.success) return refuse;
  const baseline = executeTransaction(
    document,
    {
      transactionId: "qualify-closed-translation",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "preview-qualification" },
      dryRun: true,
      edits: [{ kind: "noop" }],
    },
    { symbolResolver: resolver },
  );
  if (
    !baseline.ok ||
    JSON.stringify({ ...baseline.document, revision: document.revision }) !==
      JSON.stringify(parsed.data)
  )
    return refuse;
  const affectedNets = new Set(
    document.nets
      .filter(
        (n) =>
          n.terminals.some((t) => instances.has(t.instanceId)) ||
          document.junctions.some(
            (j) => j.netId === n.id && junctions.has(j.id),
          ),
      )
      .map((n) => n.id),
  );
  if (
    normalizeSameNetConductorTopology(
      structuredClone(document),
      resolver,
      affectedNets,
    ).changed
  )
    return refuse;
  for (const contact of deriveDocumentContactEvidence(document, resolver)
    .contacts) {
    if (!contact.endpoints.some(movesEndpoint)) continue;
    if (
      !contact.endpoints.every(movesEndpoint) ||
      contact.incidents.some(
        (i) => i.kind === "route" && !routes.has(i.objectId),
      )
    )
      return refuse;
  }
  // These drawings deform independently; their existing evaluated preview is
  // retained rather than proving a separate text/arrow transform here.
  if (
    document.inductorCouplings?.length ||
    document.drafting?.objects.some(
      (o) => o.kind !== "text" && o.kind !== "rectangle" && o.kind !== "circle",
    )
  )
    return refuse;
  const lookup = buildEndpointObjectLookup(document);
  // Integer contact/centerline coordinates in this range keep differences and
  // cross/dot products exact in IEEE doubles. Fractional or extreme imported
  // geometry stays on the exact transaction path, rather than assuming a
  // mathematically rigid translation is also numerically invariant.
  const safePoint = (p: Point) =>
    [p.x, p.y].every((v) => Number.isInteger(v) && Math.abs(v) <= 2 ** 24);
  const movingPoints: Point[] = [];
  const definitions: {
    id: string;
    variantId: string | undefined;
    resolved: NonNullable<ReturnType<SymbolResolver["resolve"]>>;
  }[] = [];
  let moving: Rect | undefined, stationary: Rect | undefined;
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved || !isFrozenSnapshot(resolved.definition)) return refuse;
    definitions.push({
      id: instance.symbolId,
      variantId: instance.symbolVariantId,
      resolved,
    });
    for (const pin of resolved.definition.pins) {
      const e: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      if (!isVisibleEndpoint(document, resolver, e, lookup)) continue;
      const p = resolveEndpointPoint(document, resolver, e, lookup);
      if (!p || !safePoint(p)) return refuse;
      if (instances.has(instance.id)) {
        movingPoints.push(p);
        moving = addBounds(moving, p, SEGMENT_EPSILON * 2);
      } else stationary = addBounds(stationary, p, SEGMENT_EPSILON * 2);
    }
  }
  for (const j of document.junctions) {
    if (!safePoint(j.position)) return refuse;
    if (junctions.has(j.id)) {
      movingPoints.push(j.position);
      moving = addBounds(moving, j.position, SEGMENT_EPSILON * 2);
    } else stationary = addBounds(stationary, j.position, SEGMENT_EPSILON * 2);
  }
  const geometry = resolveDocumentRoutingGeometry(document, resolver);
  // A no-op cannot expose changed-route follow repairs. A missing leg may
  // legitimately be repaired on movement; keep that visible in strict preview.
  const routeAnchors = [
    ...document.annotations.map((a) => a.anchor),
    ...(document.drafting?.objects.flatMap((o) =>
      o.kind === "text" ? [o.anchor] : [],
    ) ?? []),
  ];
  if (
    routeAnchors.some(
      (anchor) =>
        anchor.kind === "route" &&
        routes.has(anchor.routeId) &&
        !resolveVisualAnchor(document, resolver, anchor, geometry).resolved,
    )
  )
    return refuse;
  for (const route of document.routes) {
    const resolved = geometry.routes.get(route.id);
    if (!resolved) return refuse;
    for (const s of resolved.segments) {
      if (!safePoint(s.from) || !safePoint(s.to)) return refuse;
      const length = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
      // Match the segment kernel's cross/dot epsilon even for tiny segments.
      const padding = length
        ? Math.max(SEGMENT_EPSILON * 2, (2 * SEGMENT_EPSILON) / length)
        : SEGMENT_EPSILON * 2;
      if (routes.has(route.id)) {
        movingPoints.push(s.from, s.to);
        moving = addBounds(addBounds(moving, s.from, padding), s.to, padding);
      } else
        stationary = addBounds(
          addBounds(stationary, s.from, padding),
          s.to,
          padding,
        );
    }
  }
  const byInstance = new Map(document.instances.map((i) => [i.id, i]));
  const byJunction = new Map(document.junctions.map((j) => [j.id, j]));
  const byRoute = new Map(document.routes.map((r) => [r.id, r]));
  return (plan, delta) => {
    if (
      plan.intent !== "transform" ||
      plan.source.documentId !== document.id ||
      plan.source.revision !== document.revision ||
      plan.affected !== initial.affected ||
      !preservesMembership(plan) ||
      !Number.isSafeInteger(delta.x) ||
      !Number.isSafeInteger(delta.y) ||
      delta.x % document.presentation.grid !== 0 ||
      delta.y % document.presentation.grid !== 0
    )
      return false;
    if (
      !movingPoints.every((p) =>
        safePoint({ x: p.x + delta.x, y: p.y + delta.y }),
      )
    )
      return false;
    for (const d of definitions) {
      const now = resolver.resolve(d.id, d.variantId);
      if (
        now?.definition !== d.resolved.definition ||
        now?.variant !== d.resolved.variant
      )
        return false;
    }
    const seenInstances = new Set<string>(),
      seenJunctions = new Set<string>(),
      seenRoutes = new Set<string>();
    for (const edit of plan.edits) {
      if (
        !canProjectRoutingEditGeometry(document, edit) ||
        gridAlignmentDiagnostics(edit, document.presentation.grid).length
      )
        return false;
      if (edit.kind === "move_instance") {
        const original = byInstance.get(edit.instanceId)?.placement;
        if (
          !original ||
          !instances.has(edit.instanceId) ||
          seenInstances.has(edit.instanceId) ||
          edit.position.x !== original.position.x + delta.x ||
          edit.position.y !== original.position.y + delta.y
        )
          return false;
        seenInstances.add(edit.instanceId);
      } else if (edit.kind === "move_junction") {
        const original = byJunction.get(edit.junctionId);
        if (
          !original ||
          !junctions.has(edit.junctionId) ||
          seenJunctions.has(edit.junctionId) ||
          edit.position.x !== original.position.x + delta.x ||
          edit.position.y !== original.position.y + delta.y
        )
          return false;
        seenJunctions.add(edit.junctionId);
      } else if (edit.kind === "set_route_path") {
        const original = byRoute.get(edit.route.id);
        if (
          !original ||
          !routes.has(original.id) ||
          seenRoutes.has(original.id)
        )
          return false;
        const translated = {
          ...original,
          legs: original.legs.map((leg) => ({
            ...leg,
            to:
              leg.to.kind === "bend"
                ? {
                    ...leg.to,
                    position: {
                      x: leg.to.position.x + delta.x,
                      y: leg.to.position.y + delta.y,
                    },
                  }
                : leg.to,
          })),
        };
        if (JSON.stringify(translated) !== JSON.stringify(edit.route))
          return false;
        seenRoutes.add(original.id);
      } else if (
        edit.kind !== "upsert_schematic_annotation" &&
        edit.kind !== "upsert_drafting_object"
      )
        return false;
    }
    if (
      seenInstances.size !== instances.size ||
      seenJunctions.size !== junctions.size ||
      seenRoutes.size !== routes.size
    )
      return false;
    if (!moving) return false;
    if (!stationary) return true;
    // Overlap does not mean connection. It means this narrow proof is
    // insufficient, so retain the exact original transaction preview.
    return (
      moving.x + delta.x + moving.width < stationary.x ||
      stationary.x + stationary.width < moving.x + delta.x ||
      moving.y + delta.y + moving.height < stationary.y ||
      stationary.y + stationary.height < moving.y + delta.y
    );
  };
}
