// Planned Route proposals as typed edits: a rebuilt path, or the removal of
// geometry that collapsed to a direct contact.
import type { SegmentMode } from "./route-geometry-edit.js";
import type { Point, SchematicDocument } from "@icm/model";
import { routeEnd } from "@icm/model";
import type { SchematicEdit } from "./transaction.js";
import { routeHasExternalOwner } from "./direct-contact-route-normalization.js";
import { rebuildRoutePath } from "./route-leg-mutation.js";

export function routeEdits(
  document: SchematicDocument,
  routes: readonly {
    routeId: string;
    waypoints: Point[];
    segmentModes: SegmentMode[];
    collapsedToContact?: true;
  }[],
): SchematicEdit[] {
  return routes.map((proposal) => {
    const route = document.routes.find(
      (candidate) => candidate.id === proposal.routeId,
    );
    if (!route) throw new Error(`Route not found: ${proposal.routeId}`);
    if (proposal.collapsedToContact) {
      if (
        route.presentation === "power-rail" ||
        routeHasExternalOwner(document, route.id)
      ) {
        throw new Error(
          `Route ${route.id} cannot collapse while external presentation owns its geometry`,
        );
      }
      return { kind: "remove_route_geometry" as const, routeId: route.id };
    }
    return {
      kind: "set_route_path" as const,
      route: rebuildRoutePath(
        route,
        route.start,
        routeEnd(route),
        proposal.waypoints,
        proposal.segmentModes,
        "route-edit",
      ),
    };
  });
}
