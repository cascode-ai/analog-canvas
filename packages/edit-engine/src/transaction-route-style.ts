import { RouteStyleOverrideSchema } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type RouteStyleOverrideEdit = Extract<
  EditTransaction["edits"][number],
  { kind: "set_route_style_override" }
>;

export interface RouteStyleOverrideEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

/** Apply replacement-style presentation metadata without changing topology. */
export function applyRouteStyleOverrideEdit(
  edit: RouteStyleOverrideEdit,
  context: RouteStyleOverrideEditContext,
): EditMutationOutcome {
  const { draft, changedObjectIds, reject } = context;
  const route = draft.routes.find((candidate) => candidate.id === edit.routeId);
  if (!route) {
    return {
      ok: false,
      rejection: reject(
        "OBJECT_NOT_FOUND",
        `Route does not exist: ${edit.routeId}`,
        [],
        [edit.routeId],
      ),
    };
  }

  const parsed =
    edit.styleOverride === null
      ? undefined
      : RouteStyleOverrideSchema.parse(edit.styleOverride);
  const next = parsed?.color ? structuredClone(parsed) : undefined;
  if (
    JSON.stringify(route.styleOverride ?? null) === JSON.stringify(next ?? null)
  ) {
    return {
      ok: false,
      rejection: reject(
        "EDIT_PRECONDITION",
        "Route style override edit does not change the route",
        [],
        [edit.routeId],
      ),
    };
  }

  if (next) route.styleOverride = next;
  else delete route.styleOverride;
  changedObjectIds.add(edit.routeId);
  return { ok: true, connectivityChanged: false };
}
