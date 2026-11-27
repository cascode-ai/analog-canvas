import { equalJsonValue, InstanceStyleOverrideSchema } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

type InstanceStyleOverrideEdit = Extract<
  EditTransaction["edits"][number],
  { kind: "set_instance_style_override" }
>;

export interface InstanceStyleOverrideEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  reject: RejectEdit;
}

export type InstanceStyleOverrideEditOutcome = EditMutationOutcome;

/**
 * Apply a per-instance style override (color) edit.
 *
 * Semantics (replacement, not merge):
 * - `styleOverride: null` → clear all overrides (remove the field).
 * - `styleOverride: { foreground: "...", background: "..." }` → **replace**
 *   the current override with this object. Fields not present in the new
 *   object are cleared.
 * - `styleOverride: {}` → clears all fields (equivalent to `null`).
 *
 * The edit is rejected if the instance does not exist or if the new style
 * override is identical to the current one (no-op rejection).
 */
export function applyInstanceStyleOverrideEdit(
  edit: InstanceStyleOverrideEdit,
  context: InstanceStyleOverrideEditContext,
): InstanceStyleOverrideEditOutcome {
  const { draft, changedObjectIds, reject } = context;

  const instance = draft.instances.find(
    (candidate) => candidate.id === edit.instanceId,
  );
  if (!instance) {
    return {
      ok: false,
      rejection: reject(
        "OBJECT_NOT_FOUND",
        `Instance does not exist: ${edit.instanceId}`,
        [],
        [edit.instanceId],
      ),
    };
  }

  // Re-parse to ensure the style override is valid.
  const override =
    edit.styleOverride === null
      ? undefined
      : InstanceStyleOverrideSchema.parse(edit.styleOverride);

  // Replacement semantics: the new object replaces the current override.
  // An empty object or null clears everything.
  let newOverride: typeof instance.styleOverride | undefined;
  if (override === undefined) {
    newOverride = undefined;
  } else if (
    override.foreground === undefined &&
    override.background === undefined
  ) {
    newOverride = undefined;
  } else {
    newOverride = structuredClone(override);
  }

  // No-op check: compare current vs new.
  if (equalJsonValue(instance.styleOverride ?? null, newOverride ?? null)) {
    return {
      ok: false,
      rejection: reject(
        "EDIT_PRECONDITION",
        "Instance style override edit does not change the instance",
        [],
        [edit.instanceId],
      ),
    };
  }

  // Apply.
  if (newOverride === undefined) {
    delete instance.styleOverride;
  } else {
    instance.styleOverride = newOverride;
  }

  changedObjectIds.add(edit.instanceId);
  return { ok: true, connectivityChanged: false };
}
