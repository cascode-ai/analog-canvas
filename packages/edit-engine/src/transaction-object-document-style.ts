import { ObjectDocumentStyleSchema } from "@icm/model";
import type { SchematicDocument, StyleOverrides } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type ObjectDocumentStyleEdit = Extract<
  EditTransaction["edits"][number],
  { kind: "set_object_document_style" }
>;

export interface ObjectDocumentStyleEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

/**
 * Give objects a kept Document style, or release it (`null`) so they follow
 * their Document again. Only the look changes; no geometry or topology does.
 */
export function applyObjectDocumentStyleEdit(
  edit: ObjectDocumentStyleEdit,
  context: ObjectDocumentStyleEditContext,
): EditMutationOutcome {
  const { draft, changedObjectIds, reject } = context;
  const next =
    edit.documentStyle === null
      ? undefined
      : ObjectDocumentStyleSchema.parse(edit.documentStyle);
  const objects = new Map<
    string,
    { documentStyle?: StyleOverrides | undefined; locked?: boolean }
  >(
    [
      ...draft.instances,
      ...draft.routes,
      ...draft.junctions,
      ...draft.annotations,
      ...draft.noConnects,
      ...(draft.drafting?.objects ?? []),
    ].map((object) => [object.id, object]),
  );
  const changed: string[] = [];
  for (const id of new Set(edit.objectIds)) {
    const object = objects.get(id);
    if (!object)
      return {
        ok: false,
        rejection: reject(
          "OBJECT_NOT_FOUND",
          `Object does not exist: ${id}`,
          [],
          [id],
        ),
      };
    if (object.locked)
      return {
        ok: false,
        rejection: reject(
          "EDIT_PRECONDITION",
          `Object is locked: ${id}`,
          [],
          [id],
        ),
      };
    if (
      JSON.stringify(object.documentStyle ?? null) ===
      JSON.stringify(next ?? null)
    )
      continue;
    if (next) object.documentStyle = structuredClone(next);
    else delete object.documentStyle;
    changed.push(id);
  }
  if (!changed.length)
    return {
      ok: false,
      rejection: reject(
        "EDIT_PRECONDITION",
        "Document style edit does not change any object",
        [],
        [...edit.objectIds],
      ),
    };
  for (const id of changed) changedObjectIds.add(id);
  return { ok: true, connectivityChanged: false };
}
