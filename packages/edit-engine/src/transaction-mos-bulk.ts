import { routeEndpoints } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import {
  hasExplicitMosBulkRoute,
  isMosBulkRoute,
  mosBulkKind,
  resolveDetachedMosBulkDefault,
  resolveMosBulkConnection,
  strandedMosBulkNet,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";

import type { EditTransaction } from "./edit-schema.js";
import {
  type EditMutationOutcome,
  type RejectEdit,
  rejectedEditMutation,
} from "./transaction-domain.js";
import { implicitBulkPresentation } from "./transaction-connectivity.js";

type MosBulkEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      "set_mos_bulk_defaults" | "reconcile_mos_bulk" | "clear_mos_bulk_default";
  }
>;

export interface MosBulkEditContext {
  draft: SchematicDocument;
  resolver: SymbolResolver | undefined;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
  reject: RejectEdit;
}

export type MosBulkEditOutcome = EditMutationOutcome;

export function applyMosBulkEdit(
  edit: MosBulkEdit,
  editContext: MosBulkEditContext,
): MosBulkEditOutcome {
  const { draft, resolver, changedObjectIds, deferNetPrune, reject } =
    editContext;
  const rejectAt = (...args: Parameters<RejectEdit>) =>
    rejectedEditMutation(reject, ...args);
  let connectivityChanged = false;

  switch (edit.kind) {
    case "set_mos_bulk_defaults": {
      if (edit.nmosNetId === undefined && edit.pmosNetId === undefined) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "At least one MOS bulk default must be supplied",
        );
      }
      for (const netId of [edit.nmosNetId, edit.pmosNetId]) {
        if (netId && !draft.nets.some((net) => net.id === netId)) {
          return rejectAt("OBJECT_NOT_FOUND", `Net does not exist: ${netId}`);
        }
      }
      const defaults = { ...(draft.mosBulkDefaults ?? {}) };
      if (edit.nmosNetId !== undefined) {
        if (edit.nmosNetId === null) delete defaults.nmosNetId;
        else defaults.nmosNetId = edit.nmosNetId;
      }
      if (edit.pmosNetId !== undefined) {
        if (edit.pmosNetId === null) delete defaults.pmosNetId;
        else defaults.pmosNetId = edit.pmosNetId;
      }
      draft.mosBulkDefaults =
        defaults.nmosNetId || defaults.pmosNetId ? defaults : undefined;
      connectivityChanged = true;
      break;
    }
    case "reconcile_mos_bulk": {
      const selected = edit.instanceIds ? new Set(edit.instanceIds) : null;
      // Residue is judged once, before this pass moves anything: a Net this
      // pass empties down to one body is not residue, it is the body bias
      // Net the previous default left behind.
      const strandedNetIds = new Map<string, string>();
      for (const instance of draft.instances) {
        const stranded = strandedMosBulkNet(draft, instance);
        if (stranded) strandedNetIds.set(instance.id, stranded.id);
      }
      for (const instance of draft.instances) {
        if (selected && !selected.has(instance.id)) continue;
        const kind = mosBulkKind(instance);
        if (!kind) continue;
        const configuredNetId =
          kind === "nmos"
            ? draft.mosBulkDefaults?.nmosNetId
            : draft.mosBulkDefaults?.pmosNetId;
        const configuredNet = configuredNetId
          ? draft.nets.find((net) => net.id === configuredNetId)
          : undefined;
        const connectedNet = draft.nets.find((net) =>
          net.terminals.some(
            (terminal) =>
              terminal.instanceId === instance.id && terminal.pinName === "B",
          ),
        );

        // A visible dashed body connection is user-authored and therefore
        // owns B even when it happens to land on the configured default Net.
        // Repair stale dual ownership by releasing only the policy metadata;
        // the explicit Net membership and Route geometry remain untouched.
        if (hasExplicitMosBulkRoute(draft, instance.id)) {
          if (instance.mosBulkBinding) {
            delete instance.mosBulkBinding;
            changedObjectIds.add(instance.id);
            connectivityChanged = true;
          }
          continue;
        }

        // Imported four-node MOS data already carries a real B terminal.
        // When the three-terminal presentation hides that terminal and it
        // is already on the explicitly configured default, adopt the policy
        // binding instead of leaving an order-sensitive "explicit" orphan.
        if (
          configuredNet &&
          connectedNet?.id === configuredNet.id &&
          implicitBulkPresentation(instance, resolver)
        ) {
          if (
            instance.mosBulkBinding?.origin !== "cell-default" ||
            instance.mosBulkBinding.netId !== configuredNet.id
          ) {
            instance.mosBulkBinding = {
              origin: "cell-default",
              netId: configuredNet.id,
            };
            changedObjectIds.add(instance.id);
          }
          continue;
        }

        // Older imported projects may already contain the failure this
        // invariant prevents: a hidden B-only split Net and the configured
        // default retain the same SPICE source provenance. Provenance is not
        // electrical union, but here it is unambiguous repair evidence.
        //
        // A body left alone on a Net that owns no geometry, claims no name
        // and carries no other terminal is the same failure without that
        // provenance: copy/paste wrote Cell policy into its own Net, or the
        // supply marker that named it was deleted. Such a Net is residue,
        // never authored wiring, so the configured default reclaims the body.
        if (
          configuredNet &&
          connectedNet &&
          connectedNet.id !== configuredNet.id &&
          implicitBulkPresentation(instance, resolver) &&
          (resolveDetachedMosBulkDefault(draft, instance)?.id ===
            configuredNet.id ||
            strandedNetIds.get(instance.id) === connectedNet.id)
        ) {
          connectedNet.terminals = connectedNet.terminals.filter(
            (terminal) =>
              terminal.instanceId !== instance.id || terminal.pinName !== "B",
          );
          if (
            !configuredNet.terminals.some(
              (terminal) =>
                terminal.instanceId === instance.id && terminal.pinName === "B",
            )
          ) {
            configuredNet.terminals.push({
              instanceId: instance.id,
              pinName: "B",
            });
          }
          instance.mosBulkBinding = {
            origin: "cell-default",
            netId: configuredNet.id,
          };
          changedObjectIds.add(instance.id);
          changedObjectIds.add(connectedNet.id);
          changedObjectIds.add(configuredNet.id);
          deferNetPrune(connectedNet.id);
          connectivityChanged = true;
          continue;
        }

        const resolution = resolveMosBulkConnection(draft, instance);
        if (
          !resolution ||
          resolution.materialized ||
          resolution.status === "no-connect" ||
          resolution.status === "unresolved"
        ) {
          continue;
        }
        let target = resolution.net;
        if (!target || resolution.status !== "cell-default") continue;
        target.terminals.push({ instanceId: instance.id, pinName: "B" });
        instance.mosBulkBinding = {
          origin: "cell-default",
          netId: target.id,
        };
        changedObjectIds.add(instance.id);
        changedObjectIds.add(target.id);
        connectivityChanged = true;
      }
      break;
    }
    case "clear_mos_bulk_default": {
      const instance = draft.instances.find(
        (candidate) => candidate.id === edit.instanceId,
      );
      if (!instance) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Instance does not exist: ${edit.instanceId}`,
        );
      }
      const binding = instance.mosBulkBinding;
      if (!binding) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `MOS ${instance.id} has no default bulk binding to override`,
        );
      }
      if (
        draft.routes.some(
          (route) =>
            isMosBulkRoute(draft, route) &&
            routeEndpoints(route).some(
              (endpoint) =>
                endpoint.kind === "terminal" &&
                endpoint.instanceId === instance.id &&
                endpoint.pinName === "B",
            ),
        )
      ) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `MOS ${instance.id} already has visible bulk routing`,
        );
      }
      const net = draft.nets.find(
        (candidate) => candidate.id === binding.netId,
      );
      if (net) {
        net.terminals = net.terminals.filter(
          (terminal) =>
            terminal.instanceId !== instance.id || terminal.pinName !== "B",
        );
        changedObjectIds.add(net.id);
      }
      delete instance.mosBulkBinding;
      changedObjectIds.add(instance.id);
      connectivityChanged = true;
      break;
    }
  }

  return { ok: true, connectivityChanged };
}
