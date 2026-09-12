import type { SchematicDocument } from "@icm/model";
import type { SchematicEdit } from "./edit-schema.js";

/** Project only authored geometry. No normalization, Net pruning or persistence. */
export function projectRoutingEditGeometry(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
): SchematicDocument {
  const projected = structuredClone(document);
  for (const edit of edits) {
    if (edit.kind === "move_instance") {
      const instance = projected.instances.find(
        (i) => i.id === edit.instanceId,
      );
      if (instance?.placement)
        instance.placement.position = { ...edit.position };
    } else if (edit.kind === "move_junction") {
      const junction = projected.junctions.find(
        (j) => j.id === edit.junctionId,
      );
      if (junction) junction.position = { ...edit.position };
    } else if (edit.kind === "set_route_path") {
      projected.routes = projected.routes.map((r) =>
        r.id === edit.route.id ? structuredClone(edit.route) : r,
      );
    } else if (edit.kind === "remove_route_geometry") {
      projected.routes = projected.routes.filter((r) => r.id !== edit.routeId);
    } else {
      throw new Error(`Not a transform geometry edit: ${edit.kind}`);
    }
  }
  return projected;
}
