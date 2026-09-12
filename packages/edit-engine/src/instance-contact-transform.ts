import {
  resolveEndpointConnection,
  type RoutingSelectionSeed,
} from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import {
  placementWireSources,
  proposePlacementContact,
} from "./instance-contact-planner.js";
import { planRoutingTransform } from "./routing-transform-planner.js";
import {
  createRoutingOperationPlan,
  type RoutingOperationPlan,
} from "./routing-operation-plan.js";
import type { WireSource } from "./routing-planner.js";
import { projectRoutingEditGeometry } from "./routing-geometry-projection.js";

/** Transient geometry from the same typed plan, before transaction normalization.
 * This is not a committed Document and must never be persisted.
 */
export function projectRoutingTransformGeometry(
  document: SchematicDocument,
  plan: RoutingOperationPlan,
): SchematicDocument {
  return projectRoutingEditGeometry(document, plan.edits);
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
  const transform = planRoutingTransform(document, resolver, seed, {
    kind: "translate",
    delta,
  });
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
  const targets: WireSource[] = projected.instances
    .filter((i) => !movingIds.has(i.id))
    .flatMap((i) => placementWireSources(projected, resolver, i));
  for (const junction of projected.junctions) {
    const endpoint = { kind: "junction" as const, junctionId: junction.id };
    const connection = resolveEndpointConnection(projected, resolver, endpoint);
    if (connection)
      targets.push({
        endpoint,
        connection,
        netId: junction.netId,
        preludeEdits: [],
      });
  }
  const contact = proposePlacementContact(
    projected,
    resolver,
    instances[0]!,
    targets,
    { mode: "move", instances },
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
