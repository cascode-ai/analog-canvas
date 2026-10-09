import type { SchematicEdit } from "@icm/edit-engine";
import {
  mosBulkKind,
  pdkSubstrateDefaultNet,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import { resolveReviewedExternalBinding } from "@icm/devices";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";

/** The Project's external definitions, where a part's PDK wrapper is read. */
type Definitions = Pick<CircuitProject, "externalSubcircuitDefinitions">;

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
 * default. Explicit B wiring and No Connect remain untouched. The NMOS
 * default is also the p-substrate (#1530): the hidden substrate terminals on
 * the old one move with it, and one set to another Net stays.
 */
export function planMosBulkDefaultUpdate(
  project: Definitions,
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
    ...(kind === "nmos" ? planSubstrateMoves(project, document, netId) : []),
    ...(netId ? [{ kind: "reconcile_mos_bulk" } as const] : []),
  ];
}

/** The pins a part's reviewed PDK wrapper ties to the p-substrate. */
function hiddenSubstratePins(
  project: Definitions,
  instance: Instance,
): string[] {
  const binding = instance.netlist?.binding;
  if (binding?.kind !== "external-subcircuit") return [];
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.id === binding.definitionId,
  );
  const reviewed =
    definition && !definition.presentation
      ? resolveReviewedExternalBinding(
          definition.name,
          definition.terminals.map((terminal) => terminal.name),
          instance.symbolId,
        )
      : undefined;
  return (reviewed?.terminals ?? []).flatMap((terminal) =>
    terminal.interaction === "property" && terminal.role === "substrate"
      ? [terminal.pinName]
      : [],
  );
}

/**
 * The hidden substrate terminals on the Cell's substrate default move to the
 * one the new NMOS default makes, where the Process would bind them now.
 * Reading that default before and after, rather than the stored field, holds
 * a Cell with no NMOS default, its substrate on the negative rail or ground,
 * to the same rule.
 */
function planSubstrateMoves(
  project: Definitions,
  document: SchematicDocument,
  netId: string | null,
): SchematicEdit[] {
  const logical = resolveDocumentLogicalNets(document);
  const logicalId = (id: string) => logical.byBaseNetId.get(id)?.id ?? id;
  const from = pdkSubstrateDefaultNet(document, logical);
  const to = pdkSubstrateDefaultNet(document, logical, netId);
  if (!from || !to || logicalId(from.id) === logicalId(to.id)) return [];
  return document.instances.flatMap((instance) =>
    hiddenSubstratePins(project, instance).flatMap(
      (pinName): SchematicEdit[] => {
        const net = document.nets.find((item) =>
          item.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id &&
              terminal.pinName === pinName,
          ),
        );
        return net && logicalId(net.id) === logicalId(from.id)
          ? [
              {
                kind: "set_property_terminal_net",
                instanceId: instance.id,
                pinName,
                netId: to.id,
              },
            ]
          : [];
      },
    ),
  );
}
