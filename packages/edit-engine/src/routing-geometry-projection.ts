import type { SchematicDocument } from "@icm/model";
import type { SchematicEdit } from "./edit-schema.js";

const ANNOTATION_PLACEMENT = new Set(["anchor", "alignment"]);
const DRAFTING_PLACEMENT = new Set([
  "anchor",
  "center",
  "points",
  "curveControls",
  "from",
  "to",
  "waypoints",
]);

/** Generated placement edits retain all other source fields. A rename/rebind,
 * new object or changed content must take the authoritative transaction path. */
function placementOnly<T extends { id: string }>(
  before: T | undefined,
  after: T,
  placement: ReadonlySet<string>,
): boolean {
  return (
    before !== undefined &&
    [...new Set([...Object.keys(before), ...Object.keys(after)])].every(
      (key) =>
        placement.has(key) ||
        Object.is(Reflect.get(before, key), Reflect.get(after, key)),
    )
  );
}

export function canProjectRoutingEditGeometry(
  document: SchematicDocument,
  edit: SchematicEdit,
): boolean {
  switch (edit.kind) {
    case "move_instance":
    case "move_junction":
    case "set_route_path":
    case "remove_route_geometry":
      return true;
    case "upsert_schematic_annotation":
      return placementOnly(
        document.annotations.find((item) => item.id === edit.annotation.id),
        edit.annotation,
        ANNOTATION_PLACEMENT,
      );
    case "upsert_drafting_object":
      return placementOnly(
        document.drafting?.objects.find((item) => item.id === edit.object.id),
        edit.object,
        DRAFTING_PLACEMENT,
      );
    default:
      return false;
  }
}

/** Project only authored geometry. No normalization, Net pruning or persistence. */
export function projectRoutingEditGeometry(
  document: SchematicDocument,
  edits: readonly SchematicEdit[],
): SchematicDocument {
  const projected = structuredClone(document);
  for (const edit of edits) {
    if (!canProjectRoutingEditGeometry(document, edit))
      throw new Error(`Not a transform geometry edit: ${edit.kind}`);
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
    } else if (edit.kind === "upsert_schematic_annotation") {
      projected.annotations = projected.annotations.map((item) =>
        item.id === edit.annotation.id
          ? structuredClone(edit.annotation)
          : item,
      );
    } else if (edit.kind === "upsert_drafting_object" && projected.drafting) {
      projected.drafting.objects = projected.drafting.objects.map((item) =>
        item.id === edit.object.id ? structuredClone(edit.object) : item,
      );
    } else {
      throw new Error(`Not a transform geometry edit: ${edit.kind}`);
    }
  }
  return projected;
}
