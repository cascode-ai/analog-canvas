import type { ProjectStructureEdit } from "@icm/edit-engine";

import type {
  GroupPropertyCodeContext,
  GroupPropertyCodeValue,
} from "./group-property-code";

export interface GroupRename {
  instanceId: string;
  key: string;
  name: string;
}

export type GroupRenamePlan =
  { ok: true; renames: GroupRename[] } | { ok: false; message: string };

/**
 * The components a batch renames: each entry of `name` that differs from the
 * component's current name. Names stay distinct — a new name that another
 * selected component holds now, or that two entries share, would swap or
 * merge them, so such a batch is refused and renamed one at a time.
 */
export function groupRenames(
  value: GroupPropertyCodeValue,
  context: Pick<GroupPropertyCodeContext, "items">,
): GroupRenamePlan {
  const items = context.items ?? [];
  const renames = items.flatMap((item): GroupRename[] => {
    const name = value.names?.[item.key];
    return name !== undefined && name !== item.name
      ? [{ instanceId: item.instanceId, key: item.key, name }]
      : [];
  });
  const current = new Set(
    items
      .filter((item) => !renames.some((rename) => rename.key === item.key))
      .map((item) => item.name),
  );
  const renamedFrom = new Set(
    items
      .filter((item) => renames.some((rename) => rename.key === item.key))
      .map((item) => item.name),
  );
  const seen = new Set<string>();
  for (const rename of renames) {
    if (current.has(rename.name) || renamedFrom.has(rename.name))
      return {
        ok: false,
        message: `${rename.name} is another selected component's name; rename these one at a time`,
      };
    if (seen.has(rename.name))
      return {
        ok: false,
        message: `Two components cannot both be named ${rename.name}`,
      };
    seen.add(rename.name);
  }
  return { ok: true, renames };
}

/**
 * Several Cell Pin renames as one structural edit: each plan edits the Pin's
 * own document and the documents that call its Cell, so their edits are
 * gathered per document under the first expected revision. Null when a plan
 * holds any other structural change, which cannot be combined safely.
 */
export function mergeRenamePlans(
  plans: readonly (readonly ProjectStructureEdit[])[],
): ProjectStructureEdit[] | null {
  const merged: Extract<ProjectStructureEdit, { kind: "transact_document" }>[] =
    [];
  for (const plan of plans)
    for (const edit of plan) {
      if (edit.kind !== "transact_document") return null;
      const existing = merged.find(
        (candidate) => candidate.documentId === edit.documentId,
      );
      if (existing) existing.edits.push(...edit.edits);
      else merged.push({ ...edit, edits: [...edit.edits] });
    }
  return merged;
}
