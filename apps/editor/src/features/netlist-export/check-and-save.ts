import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";

/**
 * Bind the bodies nobody wired.
 *
 * An NMOS body belongs on ground and a PMOS body on the supply; leaving both
 * unstated is the commonest reason a finished-looking schematic will not
 * netlist. A check is the right moment to settle them, because it is the
 * moment someone asks whether the circuit is complete.
 *
 * The cell defaults come first when they are already set. When they are not,
 * a supply is adopted only if there is exactly one of that domain — one
 * ground, or one supply rail. Two supplies is the case the bulk planners have
 * always refused to guess at, and a check is no better placed to guess than
 * anything else: AVDD and VDD are a decision, not a default.
 */
export interface BulkDefaultPlan {
  edits: readonly SchematicEdit[];
  /** Instances left unbound, and why, for the status line to report. */
  ambiguous: { nmos: boolean; pmos: boolean };
}

function soleNetOfDomain(
  document: SchematicDocument,
  domain: "vdd" | "ground",
): string | null {
  const matches = document.nets.filter((net) => net.powerDomain === domain);
  return matches.length === 1 ? matches[0]!.id : null;
}

function unboundCount(
  document: SchematicDocument,
  symbolId: "nmos" | "pmos",
): number {
  return document.instances.filter(
    (instance) =>
      instance.symbolId === symbolId &&
      instance.placement !== null &&
      !instance.mosBulkBinding,
  ).length;
}

export function planCheckBulkDefaults(
  document: SchematicDocument,
): BulkDefaultPlan {
  const edits: SchematicEdit[] = [];
  const ambiguous = { nmos: false, pmos: false };

  for (const [symbolId, domain, current] of [
    ["nmos", "ground", document.mosBulkDefaults?.nmosNetId ?? null],
    ["pmos", "vdd", document.mosBulkDefaults?.pmosNetId ?? null],
  ] as const) {
    if (unboundCount(document, symbolId) === 0) continue;
    if (current) continue;
    const netId = soleNetOfDomain(document, domain);
    if (!netId) {
      ambiguous[symbolId] = true;
      continue;
    }
    edits.push(
      symbolId === "nmos"
        ? { kind: "set_mos_bulk_defaults", nmosNetId: netId }
        : { kind: "set_mos_bulk_defaults", pmosNetId: netId },
    );
  }

  // One reconcile settles every body the defaults now cover, including those
  // a default already named before this check ran.
  const reconcilable =
    edits.length > 0 ||
    (document.mosBulkDefaults?.nmosNetId != null &&
      unboundCount(document, "nmos") > 0) ||
    (document.mosBulkDefaults?.pmosNetId != null &&
      unboundCount(document, "pmos") > 0);
  if (reconcilable) edits.push({ kind: "reconcile_mos_bulk" });
  return { edits, ambiguous };
}
