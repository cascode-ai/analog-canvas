import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import {
  planSetDeviceModelTarget,
  planRoutingTransform,
  planInstanceUnplacement,
  planCellReset,
  planCreateCell,
  planRenameCell,
  planDeleteCell,
  planEnsureNamedNet,
  planElectricalMarkerRename,
  type SchematicEdit,
  type TransformOperation,
} from "@icm/edit-engine";
import {
  createEmptyDocument,
  deriveStableId,
  flattenRichText,
  type CircuitProject,
} from "@icm/model";
import {
  resolveDocumentStyleProfile,
  resolveRouteGeometry,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { copySelection, proposePaste } from "../features/clipboard/clipboard";
import { planDetachedMove } from "../features/selection/detached-move";
import {
  planSelectionAlignment,
  type EdgeAlignmentMode,
} from "../features/selection/align-selection";
import { createSelectionTransformController } from "../features/selection/selection-transform-controller";
import { missingDefaultInstanceDisplayAnnotations } from "../features/instance-display/default-instance-display";

/** No second geometry/model/clipboard implementation: plan exactly as the GUI does. */
export function planBrowserAgentCommand(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  command: AgentAuthoringCommand,
): AgentCommandPlan {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Document not found");
  const sequence = document.revision + 1;
  switch (command.kind) {
    case "place-existing": {
      const instance = document.instances.find(
        (item) => item.id === command.instanceId,
      );
      if (!instance || instance.placement)
        throw new Error("place-existing requires an unplaced Instance");
      const annotations = missingDefaultInstanceDisplayAnnotations(
        document,
        { ...instance, placement: command.placement },
        resolver,
        resolveDocumentStyleProfile(document.presentation),
      );
      return {
        edits: [
          {
            kind: "place_instance",
            instanceId: instance.id,
            placement: command.placement,
          },
          ...annotations.map((annotation): SchematicEdit => ({
            kind: "upsert_schematic_annotation",
            annotation,
          })),
        ],
      };
    }
    case "set-net-label": {
      const existing = document.annotations.find(
        (item) => item.id === command.annotationId,
      );
      if (
        existing &&
        existing.kind !== "net-label" &&
        existing.kind !== "power-label"
      )
        throw new Error("The annotation is not a Net Label");
      const logical = resolveDocumentLogicalNets(document);
      const net =
        logical.byId.get(command.netId) ??
        logical.byBaseNetId.get(command.netId);
      if (!net) throw new Error("Net not found");
      const netId = existing?.netId ?? net.baseNetIds[0]!;
      if (!net.baseNetIds.includes(netId))
        throw new Error("Label belongs to another Net");
      if (
        existing?.kind === "power-label" &&
        existing.anchor.kind === "object"
      ) {
        const rename = planElectricalMarkerRename(
          document,
          existing.anchor.objectId,
          flattenRichText(command.text),
        );
        if (rename.status === "rejected") throw new Error(rename.message);
        const edits = rename.status === "ready" ? [...rename.plan.edits] : [];
        const rebound = edits.find(
          (edit) =>
            edit.kind === "upsert_schematic_annotation" &&
            edit.annotation.id === existing.id,
        );
        return {
          edits: [
            ...edits,
            {
              kind: "upsert_schematic_annotation",
              annotation: {
                ...(rebound?.kind === "upsert_schematic_annotation"
                  ? rebound.annotation
                  : existing),
                formatOverride: command.text,
              },
            },
          ],
        };
      }
      const existingClaim = document.connectivityEvidence.find(
        (item) =>
          item.kind === "name-claim" &&
          item.owner.kind === "net-label" &&
          item.owner.annotationId === command.annotationId,
      );
      const name = flattenRichText(command.text).trim();
      const plan = planEnsureNamedNet(document, {
        candidateNetId: netId,
        name,
        evidenceId:
          existingClaim?.id ??
          deriveStableId(
            "connectivity-evidence",
            document.id,
            "net-label",
            netId,
            command.annotationId,
          ),
        owner: { kind: "net-label", annotationId: command.annotationId },
        scope:
          existingClaim?.kind === "name-claim"
            ? existingClaim.scope
            : (net.scope ?? "local"),
        ...(net.powerDomain === "vdd" || net.powerDomain === "ground"
          ? { powerDomain: net.powerDomain }
          : {}),
      });
      if (!plan.ok) throw new Error(plan.message);
      if (!existing && !command.position)
        throw new Error("New Net Label requires position");
      return {
        edits: [
          ...plan.edits,
          {
            kind: "upsert_schematic_annotation",
            annotation: {
              ...(existing ?? {
                id: command.annotationId,
                kind:
                  net.powerDomain === "none"
                    ? ("net-label" as const)
                    : ("power-label" as const),
                anchor: { kind: "free" as const, position: command.position! },
                alignment: "middle" as const,
                rotation: 0 as const,
                locked: false,
              }),
              content: undefined,
              netId,
              binding: { kind: "net-name", netId },
              formatOverride: command.text,
              ...(command.position
                ? {
                    anchor: {
                      kind: "free",
                      position: command.position,
                    } as const,
                  }
                : {}),
            },
          },
        ],
      };
    }
    case "set-model":
      return {
        structureEdits: planSetDeviceModelTarget(
          project,
          documentId,
          command.instanceId,
          command.model,
        ),
      };
    case "create-cell": {
      const child = createEmptyDocument(command.id, command.name);
      child.netlist!.name = command.name;
      child.presentation = structuredClone(document.presentation);
      return { structureEdits: planCreateCell(child) };
    }
    case "rename-cell":
      return {
        structureEdits: planRenameCell(project, command.id, command.name),
      };
    case "delete-cell":
      return { structureEdits: planDeleteCell(project, command.id) };
    case "unplace":
      return {
        edits: planInstanceUnplacement(
          document,
          resolver,
          command.instanceIds,
          sequence,
        ),
      };
    case "reset-cell": {
      const plan = planCellReset(project, documentId, command.mode);
      const error = plan.diagnostics.find((item) => item.severity === "error");
      if (error) throw new Error(error.message);
      return { edits: plan.edits };
    }
    case "copy": {
      const clipboard = copySelection(
        document,
        command.selection.instanceIds,
        command.selection.draftingIds,
        command.selection,
      );
      if (!clipboard) throw new Error("The copy selection is empty");
      const plan = proposePaste(document, clipboard, command.offset, sequence);
      if (plan.errors.length) throw new Error(plan.errors.join("; "));
      if (clipboard.cellTerminals.length || clipboard.formalParameters.length)
        return {
          structureEdits: [
            {
              kind: "transact_document",
              documentId,
              expectedRevision: document.revision,
              edits: plan.edits,
            },
          ],
        };
      return { edits: plan.edits };
    }
    case "detach-move": {
      const plan = planDetachedMove(
        document,
        resolver,
        new Set(command.instanceIds),
        sequence,
      );
      const moves: SchematicEdit[] = command.instanceIds.map((instanceId) => {
        const instance = document.instances.find(
          (item) => item.id === instanceId,
        );
        if (!instance?.placement)
          throw new Error("Move requires a placed instance");
        return {
          kind: "move_instance",
          instanceId,
          position: {
            x: instance.placement.position.x + command.delta.x,
            y: instance.placement.position.y + command.delta.y,
          },
        };
      });
      return { edits: [...plan.edits, ...moves] };
    }
    case "align":
    case "transform": {
      const styleProfile = resolveDocumentStyleProfile(document.presentation);
      const routeGeometryRecords = document.routes.flatMap((route) => {
        const geometry = resolveRouteGeometry(document, resolver, route);
        return geometry ? [{ route, geometry }] : [];
      });
      const context = {
        document,
        resolver,
        styleProfile,
        routeGeometryRecords,
        annotationGrid: document.presentation.grid,
        selection: command.selection,
      };
      if (command.kind === "align") {
        const modes = {
          "center-x": "h-center",
          "center-y": "v-center",
        } as const;
        const mode =
          command.mode in modes
            ? modes[command.mode as keyof typeof modes]
            : command.mode;
        const plan = planSelectionAlignment(context, mode as EdgeAlignmentMode);
        if (plan.blockingMessage) throw new Error(plan.blockingMessage);
        return { edits: plan.edits };
      }
      const input = command.transform;
      if (
        command.selection.draftingIds.length &&
        !(input.kind === "rotate" && !input.center && input.degrees !== 180)
      ) {
        throw new Error(
          "Drafting objects support in-place quarter turns here. For other drafting transforms, submit upsert_drafting_object with the desired geometry.",
        );
      }
      const transform: TransformOperation =
        input.kind === "translate"
          ? input
          : input.kind === "rotate"
            ? {
                kind: input.kind,
                degrees: input.degrees,
                ...(input.center ? { center: input.center } : {}),
              }
            : {
                kind: input.kind,
                axis: input.axis,
                ...(input.center ? { center: input.center } : {}),
              };
      if (transform.kind !== "translate" && !transform.center) {
        let edits: SchematicEdit[] = [];
        let message = "";
        const controller = createSelectionTransformController({
          ...context,
          selectedInstanceIds: command.selection.instanceIds,
          transact: (next) => {
            edits.push(...next);
            return { ok: true };
          },
          setStatus: (next) => {
            message = next;
          },
        });
        if (transform.kind === "mirror")
          controller.mirror(
            transform.axis === "y" ? "left-right" : "top-bottom",
          );
        else if (transform.degrees === 180) {
          // A 180-degree group turn is one shared planner operation.
          const plan = planRoutingTransform(
            document,
            resolver,
            command.selection,
            transform,
          );
          const error = plan.diagnostics.find(
            (item) => item.severity === "error",
          );
          if (error) throw new Error(error.message);
          edits = [...plan.edits];
        } else controller.rotate(transform.degrees === 270 ? -90 : 90);
        if (!edits.length && message) throw new Error(message);
        return { edits };
      }
      const plan = planRoutingTransform(
        document,
        resolver,
        command.selection,
        transform,
      );
      const error = plan.diagnostics.find((item) => item.severity === "error");
      if (error) throw new Error(error.message);
      return { edits: plan.edits };
    }
  }
}
