import {
  AnnotationSchema,
  ConnectivityEvidenceSchema,
  JunctionSchema,
  createRoutePath,
  deriveStableId,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import {
  type EditMutationOutcome,
  type RejectEdit,
  rejectedEditMutation,
} from "./transaction-domain.js";
import {
  connectivityEvidenceNetIds,
  mergeBaseNets,
} from "./transaction-connectivity.js";

type NetPowerEdit = Extract<
  EditTransaction["edits"][number],
  {
    kind:
      | "create_base_net"
      | "add_power_rail"
      | "merge_nets"
      | "upsert_connectivity_evidence"
      | "remove_connectivity_evidence";
  }
>;

export interface NetPowerEditContext {
  draft: SchematicDocument;
  changedObjectIds: Set<string>;
  deferNetPrune(netId: string): void;
  reject: RejectEdit;
}

export type NetPowerEditOutcome = EditMutationOutcome;

export function applyNetPowerEdit(
  edit: NetPowerEdit,
  editContext: NetPowerEditContext,
): NetPowerEditOutcome {
  const { draft, changedObjectIds, deferNetPrune, reject } = editContext;
  const rejectAt = (...args: Parameters<RejectEdit>) =>
    rejectedEditMutation(reject, ...args);
  let connectivityChanged = false;

  switch (edit.kind) {
    case "create_base_net": {
      const occupiedIds = new Set(
        [
          ...draft.instances,
          ...draft.nets,
          ...draft.routes,
          ...draft.junctions,
          ...draft.annotations,
          ...draft.connectivityEvidence,
          ...draft.layoutGroups,
          ...draft.constraints,
          ...draft.noConnects,
          ...(draft.netlist?.terminals ?? []),
          ...(draft.drafting?.objects ?? []),
        ].map((object) => object.id),
      );
      if (occupiedIds.has(edit.netId)) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Base Net ID already exists: ${edit.netId}`,
          [],
          [edit.netId],
        );
      }
      draft.nets.push({ id: edit.netId, terminals: [] });
      changedObjectIds.add(edit.netId);
      connectivityChanged = true;
      break;
    }
    case "add_power_rail": {
      const horizontal =
        edit.start.y === edit.end.y && edit.start.x !== edit.end.x;
      const vertical =
        edit.start.x === edit.end.x && edit.start.y !== edit.end.y;
      if (!horizontal && !vertical) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "A power rail must be one non-zero axis-aligned segment",
        );
      }
      const ids = [
        edit.netId,
        edit.routeId,
        edit.startJunctionId,
        edit.endJunctionId,
        edit.labelId,
      ];
      if (new Set(ids).size !== ids.length) {
        return rejectAt("EDIT_PRECONDITION", "Power rail IDs must be distinct");
      }
      const existingSupplyNet = draft.nets.find((net) => net.id === edit.netId);
      const existingIds = new Set([
        ...draft.instances.map((instance) => instance.id),
        ...draft.nets
          .filter((net) => net.id !== existingSupplyNet?.id)
          .map((net) => net.id),
        ...draft.routes.map((route) => route.id),
        ...draft.junctions.map((junction) => junction.id),
        ...draft.annotations.map((annotation) => annotation.id),
        ...(draft.drafting?.objects.map((object) => object.id) ?? []),
        ...draft.layoutGroups.map((group) => group.id),
        ...draft.constraints.map((constraint) => constraint.id),
        ...draft.noConnects.map((noConnect) => noConnect.id),
      ]);
      const duplicate = ids.find((id) => existingIds.has(id));
      if (duplicate) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Power rail object ID already exists: ${duplicate}`,
          [],
          [duplicate],
        );
      }
      const labelEndpoint = horizontal
        ? edit.start.x < edit.end.x
          ? edit.end
          : edit.start
        : edit.start.y < edit.end.y
          ? edit.start
          : edit.end;
      const labelJunctionId =
        labelEndpoint === edit.end ? edit.endJunctionId : edit.startJunctionId;
      if (!existingSupplyNet) {
        draft.nets.push({
          id: edit.netId,
          terminals: [],
        });
      }
      draft.junctions.push(
        JunctionSchema.parse({
          id: edit.startJunctionId,
          netId: edit.netId,
          position: edit.start,
          role: "route-anchor",
        }),
        JunctionSchema.parse({
          id: edit.endJunctionId,
          netId: edit.netId,
          position: edit.end,
          role: "route-anchor",
        }),
      );
      draft.routes.push(
        createRoutePath({
          id: edit.routeId,
          netId: edit.netId,
          start: { kind: "junction", junctionId: edit.startJunctionId },
          end: { kind: "junction", junctionId: edit.endJunctionId },
          bends: [],
          modes: ["manual"],
          presentation: "power-rail",
        }),
      );
      draft.annotations.push(
        AnnotationSchema.parse({
          id: edit.labelId,
          kind: "power-label",
          binding: { kind: "net-name", netId: edit.netId },
          netId: edit.netId,
          anchor: {
            kind: "object",
            objectId: labelJunctionId,
            localOffset: { x: 10, y: 10 },
            fallbackPosition: {
              x: labelEndpoint.x + 10,
              y: labelEndpoint.y + 10,
            },
          },
          alignment: "start",
          rotation: 0,
          locked: false,
        }),
      );
      draft.connectivityEvidence.push(
        ConnectivityEvidenceSchema.parse({
          id: deriveStableId(
            "connectivity-evidence",
            draft.id,
            "power-marker",
            edit.labelId,
            edit.netId,
          ),
          kind: "name-claim",
          netId: edit.netId,
          name: edit.netName,
          scope: edit.scope,
          powerDomain: edit.powerDomain,
          owner: { kind: "power-marker", objectId: edit.labelId },
        }),
      );
      for (const id of ids) changedObjectIds.add(id);
      connectivityChanged = true;
      break;
    }
    case "merge_nets": {
      if (edit.targetNetId === edit.sourceNetId) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "Net merge requires two different Nets",
        );
      }
      const merge = mergeBaseNets(
        draft,
        edit.targetNetId,
        edit.sourceNetId,
        changedObjectIds,
      );
      if (!merge.ok) {
        return rejectAt(merge.code, merge.message, [], merge.netIds);
      }
      connectivityChanged = true;
      break;
    }
    case "upsert_connectivity_evidence": {
      const existingIndex = draft.connectivityEvidence.findIndex(
        (evidence) => evidence.id === edit.evidence.id,
      );
      const collidingObject = [
        ...draft.instances,
        ...draft.nets,
        ...draft.routes,
        ...draft.junctions,
        ...draft.noConnects,
        ...draft.annotations,
        ...draft.layoutGroups,
        ...draft.constraints,
        ...(draft.drafting?.objects ?? []),
      ].find((object) => object.id === edit.evidence.id);
      if (collidingObject) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Connectivity evidence ID collides with another object: ${edit.evidence.id}`,
        );
      }
      const previous = draft.connectivityEvidence[existingIndex];
      const evidence = ConnectivityEvidenceSchema.parse(edit.evidence);
      if (existingIndex >= 0) {
        draft.connectivityEvidence[existingIndex] = evidence;
      } else {
        draft.connectivityEvidence.push(evidence);
      }
      if (
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "net-label"
      ) {
        const annotationId = evidence.owner.annotationId;
        const annotation = draft.annotations.find(
          (candidate) => candidate.id === annotationId,
        );
        if (annotation?.formatOverride) {
          delete annotation.formatOverride;
          changedObjectIds.add(annotation.id);
        }
      }
      changedObjectIds.add(evidence.id);
      for (const netId of previous
        ? connectivityEvidenceNetIds(previous)
        : []) {
        if (!connectivityEvidenceNetIds(evidence).includes(netId)) {
          deferNetPrune(netId);
        }
      }
      connectivityChanged = true;
      break;
    }
    case "remove_connectivity_evidence": {
      const evidenceIndex = draft.connectivityEvidence.findIndex(
        (evidence) => evidence.id === edit.evidenceId,
      );
      const evidence = draft.connectivityEvidence[evidenceIndex];
      if (!evidence) {
        return rejectAt(
          "OBJECT_NOT_FOUND",
          `Connectivity evidence does not exist: ${edit.evidenceId}`,
        );
      }
      const affectedNetIds = connectivityEvidenceNetIds(evidence);
      draft.connectivityEvidence.splice(evidenceIndex, 1);
      changedObjectIds.add(evidence.id);
      for (const netId of affectedNetIds) {
        deferNetPrune(netId);
      }
      connectivityChanged = true;
      break;
    }
  }

  return { ok: true, connectivityChanged };
}
