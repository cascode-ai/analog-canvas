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
  planCreateCellPin,
  createHierarchyInstance,
  planPlaceCellInstance,
  planRenameCell,
  planDeleteCell,
  planBindCellParameter,
  planRenameCellParameter,
  planSetCellParameterDefault,
  planRemoveCellParameter,
  planRenameCellTerminal,
  planRemoveCellTerminal,
  planEnsureNamedNet,
  planElectricalMarkerRename,
  proposedStandalonePowerConnection,
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
  magneticDisplayParameters,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { planDetachedMove } from "../features/selection/detached-move";
import {
  planSelectionAlignment,
  type EdgeAlignmentMode,
} from "../features/selection/align-selection";
import { createSelectionTransformController } from "../features/selection/selection-transform-controller";
import {
  defaultInstanceDisplayAnnotations,
  missingDefaultInstanceDisplayAnnotations,
} from "../features/instance-display/default-instance-display";
import { instanceDisplayEdits } from "../features/instance-display/instance-display-edits";
import { instanceParameterVisibilityEdits } from "../features/instance-display/instance-parameter-display";
import { dragNetLabelAttachmentAtPoint } from "../features/wiring/route-interaction-geometry";

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
    case "place-components": {
      const edits: SchematicEdit[] = [];
      let changesInterface = false;
      for (const instance of command.instances) {
        if (!instance.placement)
          throw new Error("New component requires placement");
        if (
          instance.symbolId === "port" ||
          instance.symbolId === "port-filled"
        ) {
          // The compact action's reference names a Cell terminal, not a
          // device. Use the GUI's interface planner and bound name display.
          const { reference, netlist: _netlist, ...port } = instance;
          if (!reference?.trim())
            throw new Error("A Cell interface marker requires a name");
          const terminalId = deriveStableId("terminal", instance.id);
          const netId = deriveStableId("net-cell-pin", instance.id);
          const endpoint = {
            kind: "terminal" as const,
            instanceId: instance.id,
            pinName: "P",
          };
          const annotation = defaultInstanceDisplayAnnotations(
            document,
            port,
            resolver,
            resolveDocumentStyleProfile(document.presentation),
            { formalTerminalId: terminalId },
          )[0];
          const plan = planCreateCellPin(project, documentId, {
            instance: port,
            terminal: {
              id: terminalId,
              name: reference.trim(),
              netId,
              direction: "passive",
              interfaceInstanceIds: [instance.id],
            },
            connectionEdits: [
              {
                kind: "connect_endpoints",
                from: endpoint,
                to: endpoint,
                newNetId: netId,
              },
            ],
            ...(annotation ? { annotation } : {}),
          });
          for (const entry of plan) {
            if (
              entry.kind !== "transact_document" ||
              entry.documentId !== documentId
            )
              throw new Error(
                "Cell interface marker placement must target its owning Document",
              );
            edits.push(...entry.edits);
          }
          changesInterface = true;
          continue;
        }
        const power = proposedStandalonePowerConnection(document, instance);
        if (power.rejected) throw new Error(power.rejected);
        edits.push({ kind: "add_instance", instance }, ...power.edits);
        edits.push(
          ...defaultInstanceDisplayAnnotations(
            document,
            instance,
            resolver,
            resolveDocumentStyleProfile(document.presentation),
            { showValue: true },
          ).map((annotation): SchematicEdit => ({
            kind: "upsert_schematic_annotation",
            annotation,
          })),
        );
      }
      // Keep mixed device/Port batches atomic, including the interface facts.
      return changesInterface
        ? {
            structureEdits: [
              {
                kind: "transact_document",
                documentId,
                expectedRevision: document.revision,
                edits,
              },
            ],
          }
        : { edits };
    }
    case "set-instance-display": {
      const edits = instanceDisplayEdits(
        document,
        resolver,
        command.instanceIds,
        command,
      );
      if (command.showParameters) {
        const desired = Object.fromEntries(
          Object.entries(command.showParameters).filter(
            (entry): entry is [string, boolean] => entry[1] !== undefined,
          ),
        );
        for (const id of new Set(command.instanceIds)) {
          const instance = document.instances.find((item) => item.id === id);
          if (!instance) throw new Error(`Instance not found: ${id}`);
          const supported = magneticDisplayParameters(instance.symbolId);
          for (const parameter of Object.keys(desired)) {
            if (!supported.some((item) => item.name === parameter))
              throw new Error(
                `Parameter display ${parameter} is not supported by ${instance.symbolId}`,
              );
          }
          edits.push(
            ...instanceParameterVisibilityEdits(
              document,
              instance,
              resolver,
              desired,
            ),
          );
        }
      }
      return { edits };
    }
    case "place-cell": {
      const child = project.documents.find(
        (item) => item.id === command.childDocumentId,
      );
      if (!child?.netlist)
        throw new Error("Cell needs a formal interface before placement");
      const instance = createHierarchyInstance(
        command.instanceId,
        child,
        command.placement,
        command.reference,
      );
      const annotations = defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        resolveDocumentStyleProfile(document.presentation),
        { showDesignator: false, masterName: child.netlist.name },
      );
      return {
        structureEdits: planPlaceCellInstance(
          project,
          documentId,
          instance,
          annotations,
        ),
      };
    }
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
      const position =
        command.position ??
        (existing?.anchor.kind === "free"
          ? existing.anchor.position
          : undefined);
      const records = document.routes
        .filter((route) => net.baseNetIds.includes(route.netId))
        .flatMap((route) => {
          const geometry = resolveRouteGeometry(document, resolver, route);
          return geometry ? [{ route, geometry }] : [];
        });
      const attached = position
        ? records
            .flatMap((record) => {
              const attachment = dragNetLabelAttachmentAtPoint(
                [record],
                position,
                record.route.id,
              );
              return attachment
                ? [{ ...attachment, routeId: record.route.id }]
                : [];
            })
            .sort(
              (a, b) =>
                Math.hypot(
                  a.labelPosition.x - position.x,
                  a.labelPosition.y - position.y,
                ) -
                Math.hypot(
                  b.labelPosition.x - position.x,
                  b.labelPosition.y - position.y,
                ),
            )[0]
        : undefined;
      const anchor = attached
        ? {
            kind: "route" as const,
            routeId: attached.routeId,
            legId: attached.legId,
            t: attached.t,
            normalOffset: attached.normalOffset,
            direction: "forward" as const,
            orientation: "horizontal" as const,
            fallbackPosition: attached.labelPosition,
          }
        : position
          ? { kind: "free" as const, position }
          : existing!.anchor;
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
              anchor,
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
    case "bind-cell-parameter":
      return {
        structureEdits: planBindCellParameter(
          project,
          documentId,
          command.instanceId,
          command.field,
          command.name,
          command.defaultValue,
        ),
      };
    case "rename-cell-parameter":
      return {
        structureEdits: planRenameCellParameter(
          project,
          documentId,
          command.oldName,
          command.newName,
        ),
      };
    case "set-cell-parameter-default":
      return {
        structureEdits: planSetCellParameterDefault(
          project,
          documentId,
          command.name,
          command.defaultValue,
        ),
      };
    case "remove-cell-parameter":
      return {
        structureEdits: planRemoveCellParameter(
          project,
          documentId,
          command.name,
        ),
      };
    case "rename-cell-terminal":
      return {
        structureEdits: planRenameCellTerminal(
          project,
          documentId,
          command.terminalId,
          command.name,
          { mergeExistingPort: command.mergeExistingPort ?? false },
        ),
      };
    case "remove-cell-terminal":
      return {
        structureEdits: planRemoveCellTerminal(
          project,
          documentId,
          command.terminalId,
        ),
      };
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
      const clipboard = captureProjectCopy(
        project,
        document,
        command.selection,
      );
      if (!clipboard) throw new Error("The copy selection is empty");
      const plan = planProjectCopyPlacement(
        project,
        document,
        clipboard,
        command.offset,
        sequence,
      );
      return { structureEdits: plan.edits };
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
        !(input.kind === "rotate" && !input.center)
      ) {
        throw new Error(
          "Drafting objects support in-place 45-degree rotation here. For other drafting transforms, submit upsert_drafting_object with the desired geometry.",
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
        else
          controller.rotate(
            (transform.degrees > 180
              ? transform.degrees - 360
              : transform.degrees) as 45 | -45 | 90 | -90 | 135 | -135 | 180,
          );
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
