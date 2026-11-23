import {
  resolveEndpointConnection,
  type RoutingSelectionSeed,
} from "@icm/derived";
import {
  freezeSnapshot,
  isFrozenSnapshot,
  routeEndpoints,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  createPlacementContactContext,
  placementWireSources,
  proposePlacementContact,
} from "./instance-contact-planner.js";
import { prepareRoutingTransform } from "./routing-transform-planner.js";
import { physicalContactPointKey } from "./transaction-connectivity.js";
import {
  createRoutingOperationPlan,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import type { WireSource } from "./wire-commit-planner.js";
import {
  projectRoutingEditGeometry,
  projectRoutingGeometryRead,
} from "./routing-geometry-projection.js";

/** Transient geometry from the same typed plan, before transaction normalization.
 * This is not a committed Document and must never be persisted.
 */
export function projectRoutingTransformGeometry(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
): SchematicDocument {
  return projectRoutingEditGeometry(document, plan.edits);
}

/** A gesture may share data owned by the editor's immutable source. */
export function projectRoutingGestureGeometry(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
): SchematicDocument {
  return isFrozenSnapshot(document)
    ? freezeSnapshot(projectRoutingGeometryRead(document, plan.edits))
    : projectRoutingTransformGeometry(document, plan);
}

/** One final-position plan for moving geometry and an explicit snapped pin drop.
 * Project the authored geometry BEFORE normalization so every contact edit
 * addresses exactly the legs that precede it in the final atomic transaction.
 */
export function planInstanceContactTransform(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingSelectionSeed,
  delta: Point,
  connectAtDrop: boolean,
): RoutingOperationPlan {
  return prepareInstanceContactTransform(
    document,
    resolver,
    seed,
  )(delta, connectAtDrop);
}

/** One immutable source/closure for repeated final-position proposals. */
export function prepareInstanceContactTransform(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingSelectionSeed,
): (delta: Point, connectAtDrop: boolean) => RoutingOperationPlan {
  const planTransform = prepareRoutingTransform(document, resolver, seed);
  return (delta, connectAtDrop) =>
    planContactAtDrop(
      document,
      resolver,
      seed,
      delta,
      connectAtDrop,
      planTransform({ kind: "translate", delta }),
    );
}

function planContactAtDrop(
  document: SchematicDocument,
  resolver: SymbolResolver,
  seed: RoutingSelectionSeed,
  delta: Point,
  connectAtDrop: boolean,
  transform: RoutingOperationPlan,
): RoutingOperationPlan {
  if (
    !connectAtDrop ||
    (delta.x === 0 && delta.y === 0) ||
    transform.diagnostics.some((d) => d.severity === "error")
  )
    return transform;
  const projected = projectRoutingTransformGeometry(document, transform);
  const movingIds = new Set(seed.instanceIds);
  const instances = projected.instances.filter((i) => movingIds.has(i.id));
  if (!instances.length) return transform;
  const context = createPlacementContactContext(projected, resolver);
  function targetsAtDrop(sources: readonly WireSource[]): WireSource[] {
    const dropPoints = new Set(
      sources.map((source) =>
        physicalContactPointKey(source.connection.contactPoint),
      ),
    );
    if (!dropPoints.size) return [];
    const atDropPoint = (point: Point) =>
      dropPoints.has(physicalContactPointKey(point));
    // Duplicate IDs on unvalidated inputs retain the original find-first lookup.
    const targetContext =
      context.lookup.instancesById.size === projected.instances.length &&
      context.lookup.junctionsById.size === projected.junctions.length
        ? context
        : undefined;
    const targets: WireSource[] = projected.instances
      .filter((i) => !movingIds.has(i.id))
      .flatMap((i) =>
        placementWireSources(
          projected,
          resolver,
          i,
          targetContext,
          atDropPoint,
        ),
      );
    const carriedJunctions = new Set(transform.affected.internalJunctions);
    for (const junction of projected.junctions) {
      // A carried anchor belongs to the move, not to the stationary conductors
      // an explicitly snapped pin may join at drop.
      if (carriedJunctions.has(junction.id)) continue;
      const endpoint = { kind: "junction" as const, junctionId: junction.id };
      const connection = resolveEndpointConnection(
        projected,
        resolver,
        endpoint,
        targetContext?.lookup,
      );
      if (connection && atDropPoint(connection.contactPoint))
        targets.push({
          endpoint,
          connection,
          netId: junction.netId,
          preludeEdits: [],
        });
    }
    return targets;
  }
  // The moved parts' own wires follow them, and so do the wires moved with
  // them: their new geometry is the move's, not a conductor the parts were
  // dropped on. A comparator typed a grid step higher stretched its IN− wire
  // through the place IN+ came to, and the move joined IN+ to it, putting the
  // input on a ladder tap.
  const followers = new Set(seed.routeIds);
  for (const route of projected.routes)
    if (
      routeEndpoints(route).some(
        (end) => end.kind === "terminal" && movingIds.has(end.instanceId),
      )
    )
      followers.add(route.id);
  const contact = proposePlacementContact(
    projected,
    resolver,
    instances[0]!,
    targetsAtDrop,
    {
      mode: "move",
      instances,
      context,
      routeIds: new Set(
        projected.routes
          .map((route) => route.id)
          .filter((id) => !followers.has(id)),
      ),
    },
  );
  if (contact.rejected || contact.ambiguous) {
    return {
      ...transform,
      diagnostics: [
        ...transform.diagnostics,
        {
          code: "MOVE_CONTACT_NOT_CONNECTED",
          severity: "warning",
          message:
            contact.rejected ??
            "Several disconnected conductors share the drop point; moved without connecting",
        },
      ],
    };
  }
  if (!contact.edits.length) return transform;
  return createRoutingOperationPlan(document, {
    intent: contact.edits.some((e) => e.kind === "attach_endpoint_to_route")
      ? "attach-to-route"
      : "connect",
    affected: transform.affected,
    diagnostics: [],
    edits: [...transform.edits, ...contact.edits],
    ...(contact.expectedElectricalEffect
      ? { expectedElectricalEffect: contact.expectedElectricalEffect }
      : {}),
  });
}
