import type { SchematicEdit } from "@icm/edit-engine";
import { mosBulkKind } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";

/**
 * An explicit supply placement chooses a cell default only once.  The caller
 * supplies the just-authored Net ID; this helper never discovers a supply by
 * name or power role, so AVDD-first and VDD-first remain equally deliberate.
 */
export function planInitialMosBulkDefault(
  document: SchematicDocument,
  domain: "ground" | "vdd",
  netId: string,
  precedingEdits: readonly SchematicEdit[] = [],
): readonly SchematicEdit[] {
  // A placement batch has not committed yet. Project only this small authored
  // setting from its preceding edits; do not re-run a transaction per device.
  const field = domain === "ground" ? "nmosNetId" : "pmosNetId";
  let current = document.mosBulkDefaults?.[field];
  for (const edit of precedingEdits) {
    if (edit.kind === "set_mos_bulk_defaults" && edit[field] !== undefined)
      current = edit[field] ?? undefined;
  }
  if (domain === "ground") {
    return current
      ? []
      : [
          { kind: "set_mos_bulk_defaults", nmosNetId: netId },
          { kind: "reconcile_mos_bulk" },
        ];
  }
  return current
    ? []
    : [
        { kind: "set_mos_bulk_defaults", pmosNetId: netId },
        { kind: "reconcile_mos_bulk" },
      ];
}

/**
 * Reconfigure only bodies that were materialized from the previous cell
 * default. Explicit B wiring and No Connect remain untouched.
 */
export function planMosBulkDefaultUpdate(
  document: SchematicDocument,
  kind: "nmos" | "pmos",
  netId: string | null,
): readonly SchematicEdit[] {
  const clearEdits: SchematicEdit[] = document.instances.flatMap((instance) =>
    mosBulkKind(instance) === kind &&
    instance.mosBulkBinding?.origin === "cell-default"
      ? [{ kind: "clear_mos_bulk_default", instanceId: instance.id }]
      : [],
  );
  const setDefault: SchematicEdit =
    kind === "nmos"
      ? { kind: "set_mos_bulk_defaults", nmosNetId: netId }
      : { kind: "set_mos_bulk_defaults", pmosNetId: netId };
  return [
    ...clearEdits,
    setDefault,
    ...(netId ? [{ kind: "reconcile_mos_bulk" } as const] : []),
  ];
}
