import {
  AnnotationSchema,
  ConnectivityEvidenceSchema,
  JunctionSchema,
  createRoutePath,
  deriveStableId,
  renamedLabelFormat,
  routeEndpoints,
  supplyLabelFormat,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";

import type { EditTransaction } from "./edit-schema.js";
import {
  type EditMutationOutcome,
  type RejectEdit,
  rejectedEditMutation,
} from "./transaction-domain.js";
import { isFreePowerRailLabel } from "./power-rail-label.js";
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
      // A label of this supply that no rail carries any more is taken over
      // rather than doubled: its Cell Pin, name claim and look stay as they
      // were, so the Cell's callers keep the Pin they know.
      const adopted = draft.annotations.find(
        (annotation) => annotation.id === edit.labelId,
      );
      if (
        adopted &&
        !isFreePowerRailLabel(draft, adopted, {
          netName: edit.netName,
          scope: edit.scope,
          netId: edit.netId,
        })
      ) {
        return rejectAt(
          "EDIT_PRECONDITION",
          `Power rail label ${edit.labelId} is not a free label of ${edit.netName}`,
          [],
          [edit.labelId],
        );
      }
      const terminalId =
        adopted?.binding?.kind === "cell-terminal-name"
          ? adopted.binding.terminalId
          : deriveStableId(
              "cell-terminal",
              draft.id,
              "power-rail",
              edit.labelId,
            );
      const ids = [
        edit.netId,
        edit.routeId,
        edit.startJunctionId,
        edit.endJunctionId,
        ...(adopted
          ? []
          : [edit.labelId, ...(edit.scope === "local" ? [terminalId] : [])]),
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
        ...(draft.netlist?.terminals.map((terminal) => terminal.id) ?? []),
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
      if (edit.scope === "local" && !draft.netlist) {
        return rejectAt(
          "EDIT_PRECONDITION",
          "A local power rail requires a formal Cell interface",
        );
      }
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
      const labelAnchor = {
        kind: "object" as const,
        objectId: labelJunctionId,
        localOffset: { x: 10, y: 10 },
        fallbackPosition: {
          x: labelEndpoint.x + 10,
          y: labelEndpoint.y + 10,
        },
      };
      if (adopted) {
        const previous = adopted.anchor;
        adopted.anchor = labelAnchor;
        adopted.alignment = "start";
        adopted.rotation = 0;
        changedObjectIds.add(adopted.id);
        // The point the label waited on is no longer anything's anchor.
        if (
          previous.kind === "object" &&
          !junctionInUse(draft, previous.objectId)
        ) {
          const index = draft.junctions.findIndex(
            (junction) => junction.id === previous.objectId,
          );
          if (index >= 0) {
            draft.junctions.splice(index, 1);
            changedObjectIds.add(previous.objectId);
          }
        }
      } else {
        const supplyFormat = supplyLabelFormat(edit.netName);
        draft.annotations.push(
          AnnotationSchema.parse({
            id: edit.labelId,
            kind: "power-label",
            binding:
              edit.scope === "local"
                ? { kind: "cell-terminal-name", terminalId }
                : { kind: "net-name", netId: edit.netId },
            ...(supplyFormat ? { formatOverride: supplyFormat } : {}),
            netId: edit.netId,
            anchor: labelAnchor,
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
      }
      if (edit.scope === "local" && !adopted) {
        draft.netlist!.terminals.push({
          id: terminalId,
          name: edit.netName,
          netId: edit.netId,
          direction: "inout",
          interfaceInstanceIds: [],
          interfaceAnnotationId: edit.labelId,
        });
        changedObjectIds.add(terminalId);
      }
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
      if (evidence.kind === "name-claim") {
        const owner = evidence.owner;
        const previousName =
          previous?.kind === "name-claim" ? previous.name : evidence.name;
        // A rail claim is owned by its label; a supply marker's claim by the
        // marker, whose label is anchored to it. Both labels show this name.
        for (const annotation of draft.annotations) {
          const showsClaim =
            owner.kind === "net-label"
              ? annotation.id === owner.annotationId
              : owner.kind === "power-marker" &&
                (annotation.id === owner.objectId ||
                  (annotation.kind === "power-label" &&
                    annotation.binding?.kind === "net-name" &&
                    annotation.anchor.kind === "object" &&
                    annotation.anchor.objectId === owner.objectId));
          if (!showsClaim || !annotation.formatOverride) continue;
          const format = renamedLabelFormat(
            annotation,
            previousName,
            evidence.name,
            draft.presentation,
          );
          if (format) annotation.formatOverride = format;
          else delete annotation.formatOverride;
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

/** Whether anything still stands on, starts at or groups this Junction. */
function junctionInUse(draft: SchematicDocument, junctionId: string): boolean {
  const anchored = (anchor: { kind: string; objectId?: string }) =>
    anchor.kind === "object" && anchor.objectId === junctionId;
  return (
    draft.routes.some((route) =>
      routeEndpoints(route).some(
        (end) => end.kind === "junction" && end.junctionId === junctionId,
      ),
    ) ||
    draft.annotations.some((annotation) => anchored(annotation.anchor)) ||
    (draft.drafting?.objects ?? []).some((object) =>
      [
        object.anchor,
        ...(object.kind === "arrow" ? [object.from, object.to] : []),
        ...(object.kind === "leader" || object.kind === "callout"
          ? [object.target]
          : []),
      ].some(anchored),
    ) ||
    [...draft.layoutGroups, ...draft.constraints].some((object) =>
      object.objectIds.includes(junctionId),
    ) ||
    draft.connectivityEvidence.some(
      (evidence) =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "power-marker" &&
        evidence.owner.objectId === junctionId,
    )
  );
}
