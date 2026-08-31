import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import { removeConnectivityEvidenceOwnedBy } from "./transaction-connectivity.js";
import type { AppliedEditMutation } from "./transaction-domain.js";

type CellResetEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind: "clear_cell_drawing" | "reset_cell_placement" | "reset_cell_body";
  }
>;

export interface CellResetEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
}

export type CellResetEditOutcome = AppliedEditMutation & {
  readonly geometryChanged: true;
};

export function applyCellResetEdit(
  edit: CellResetEdit,
  context: CellResetEditContext,
): CellResetEditOutcome {
  const { draft, changedObjectIds, deferNetPrune } = context;

  switch (edit.kind) {
    case "clear_cell_drawing": {
      const routeIds = new Set(draft.routes.map((route) => route.id));
      const ownerNetIds = removeConnectivityEvidenceOwnedBy(
        draft,
        routeIds,
        changedObjectIds,
      );
      for (const object of [
        ...draft.routes,
        ...(draft.drafting?.objects ?? []),
      ]) {
        changedObjectIds.add(object.id);
      }
      draft.routes = [];
      draft.drafting = { objects: [] };
      for (const netId of ownerNetIds) deferNetPrune(netId);
      return {
        ok: true,
        connectivityChanged: ownerNetIds.length > 0,
        geometryChanged: true,
      };
    }
    case "reset_cell_placement": {
      const routeIds = new Set(draft.routes.map((route) => route.id));
      const ownerNetIds = removeConnectivityEvidenceOwnedBy(
        draft,
        routeIds,
        changedObjectIds,
      );
      for (const object of [
        ...draft.instances.filter((instance) => instance.placement !== null),
        ...draft.routes,
        ...draft.layoutGroups,
        ...draft.constraints,
      ]) {
        changedObjectIds.add(object.id);
      }
      for (const instance of draft.instances) instance.placement = null;
      draft.routes = [];
      draft.layoutGroups = [];
      draft.constraints = [];
      for (const netId of ownerNetIds) deferNetPrune(netId);
      return {
        ok: true,
        connectivityChanged: ownerNetIds.length > 0,
        geometryChanged: true,
      };
    }
    case "reset_cell_body": {
      const cellPinInstanceIds = new Set(
        draft.netlist?.terminals.flatMap(
          (terminal) => terminal.interfaceInstanceIds,
        ) ?? [],
      );
      const interfaceNetIds = new Set(
        draft.netlist?.terminals.map((terminal) => terminal.netId) ?? [],
      );
      const retainedInstances = draft.instances.filter((instance) =>
        cellPinInstanceIds.has(instance.id),
      );
      const retainedNets = draft.nets
        .filter((net) => interfaceNetIds.has(net.id))
        .map((net) => ({
          ...net,
          terminals: net.terminals.filter((terminal) =>
            cellPinInstanceIds.has(terminal.instanceId),
          ),
        }));
      const retainedAnnotations = draft.annotations.filter(
        (annotation) =>
          annotation.anchor.kind === "object" &&
          cellPinInstanceIds.has(annotation.anchor.objectId),
      );
      const retainedAnnotationIds = new Set(
        retainedAnnotations.map((annotation) => annotation.id),
      );
      const retainedEvidence = draft.connectivityEvidence.filter((evidence) => {
        if (!interfaceNetIds.has(evidence.netId)) return false;
        if (evidence.kind !== "name-claim") return true;
        switch (evidence.owner.kind) {
          case "explicit-net-property":
            return true;
          case "net-label":
            return retainedAnnotationIds.has(evidence.owner.annotationId);
          case "power-marker":
            return (
              cellPinInstanceIds.has(evidence.owner.objectId) ||
              retainedAnnotationIds.has(evidence.owner.objectId)
            );
        }
      });
      const retainedIds = new Set([
        ...retainedInstances.map((instance) => instance.id),
        ...retainedNets.map((net) => net.id),
        ...retainedAnnotations.map((annotation) => annotation.id),
        ...retainedEvidence.map((evidence) => evidence.id),
      ]);
      for (const object of [
        ...draft.instances,
        ...draft.nets,
        ...draft.routes,
        ...draft.junctions,
        ...draft.noConnects,
        ...draft.annotations,
        ...draft.connectivityEvidence,
        ...draft.layoutGroups,
        ...draft.constraints,
        ...(draft.drafting?.objects ?? []),
      ]) {
        if (!retainedIds.has(object.id)) changedObjectIds.add(object.id);
      }
      for (const retainedNet of retainedNets) {
        const sourceNet = draft.nets.find((net) => net.id === retainedNet.id);
        if (sourceNet?.terminals.length !== retainedNet.terminals.length) {
          changedObjectIds.add(retainedNet.id);
        }
      }
      draft.instances = retainedInstances;
      draft.nets = retainedNets;
      draft.routes = [];
      draft.junctions = [];
      draft.noConnects = [];
      draft.annotations = retainedAnnotations;
      draft.connectivityEvidence = retainedEvidence;
      draft.layoutGroups = [];
      draft.constraints = [];
      draft.drafting = { objects: [] };
      if (draft.mosBulkDefaults) changedObjectIds.add(draft.id);
      delete draft.mosBulkDefaults;
      return {
        ok: true,
        connectivityChanged: true,
        geometryChanged: true,
      };
    }
  }
}
