import {
  gateRoutingOperationPlan,
  planPinChangeRouteClearance,
  planRenameCellTerminal,
  planSetDeviceModelTarget,
  planSetVddConnectionMode,
  type ExpectedElectricalEffect,
  type ProjectStructureEdit,
  type RoutingOperationIntent,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  displayableInstanceValue,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import {
  canonicalParameterValues,
  instanceParameterContract,
} from "@icm/devices";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { snapCoordinate } from "../../snap/engine";
import { instanceLabelAnnotationFor } from "../instance-display/default-instance-display";
import { instanceDisplayEdits } from "../instance-display/instance-display-edits";
import { instanceParameterVisibilityEdits } from "../instance-display/instance-parameter-display";
import { instanceValueAnnotation } from "../wiring/route-interaction-geometry";
import type { ComponentPropertyCodeValue } from "./component-property-code";
import { planComponentPropertyCodeEdits } from "./component-property-code-edits";
import { planElectricalMarkerName } from "./electrical-marker-name";
import { planPropertyContactMove } from "./property-contact-move";

export interface PropertyApplyContext {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  instance: Instance;
  /**
   * The model or external subcircuit Properties shows for the part. Only a
   * changed `netlistTarget` reads it; left out, it is the model binding.
   */
  currentTarget?: string;
}

/** How one Properties apply commits, decided before anything is written. */
export type PropertyApplyPlan =
  | { kind: "unchanged" }
  | { kind: "rejected"; message: string }
  | { kind: "structure"; structureEdits: ProjectStructureEdit[] }
  | {
      kind: "connectivity";
      intent: RoutingOperationIntent;
      edits: SchematicEdit[];
      expectedElectricalEffect: ExpectedElectricalEffect;
    }
  | { kind: "edits"; edits: SchematicEdit[] };

/**
 * Everything Apply in Properties does to one part, as a plan: the Agent's
 * property actions call it too, so a part changed either way comes out the
 * same. Throws when the value contradicts itself (the planner's own errors).
 */
export function planPropertyApply(
  context: PropertyApplyContext,
  input: ComponentPropertyCodeValue,
): PropertyApplyPlan {
  const { project, document, resolver, instance } = context;
  // A choice typed in another spelling it accepts, such as the Unicode minus
  // for an adder's `-`, is stored as the choice.
  const contract = input.parameters
    ? instanceParameterContract(project, instance)
    : undefined;
  const value: ComponentPropertyCodeValue =
    contract && input.parameters
      ? {
          ...input,
          parameters: canonicalParameterValues(
            { parameters: contract.definitions },
            input.parameters,
          ),
        }
      : input;
  // Formal Pin names own a Cell interface, never a display alias.
  const formalTerminal = document.netlist?.terminals.find((terminal) =>
    terminal.interfaceInstanceIds.includes(instance.id),
  );
  const { displayName, ...nonNameValues } = value;
  const terminalEdits =
    formalTerminal &&
    displayName !== undefined &&
    displayName !== formalTerminal.name
      ? planRenameCellTerminal(
          project,
          document.id,
          formalTerminal.id,
          displayName,
          { mergeExistingPort: true },
        )
      : [];
  const edits: SchematicEdit[] = planComponentPropertyCodeEdits(
    document,
    instance,
    formalTerminal ? nonNameValues : value,
  );
  // Swapped inputs and other pin changes draw the wires they stretch clear
  // of other Nets (#1309).
  edits.push(...planPinChangeRouteClearance(document, resolver, edits));
  if (!instance.placement && value.placement) {
    edits.push({
      kind: "place_instance",
      instanceId: instance.id,
      placement: {
        position: {
          x: snapCoordinate(
            value.placement.coordinate[0],
            document.presentation.grid,
          ),
          y: snapCoordinate(
            value.placement.coordinate[1],
            document.presentation.grid,
          ),
        },
        rotation: value.placement.rotation,
        mirror: value.placement.mirror,
      },
    });
  }
  const candidateInstance = {
    ...instance,
    ...(value.parameters && instance.netlist
      ? {
          netlist: {
            ...instance.netlist,
            parameters: Object.fromEntries(
              Object.entries(value.parameters).filter(
                ([, raw]) => raw.trim() !== "",
              ),
            ),
          },
        }
      : {}),
  };
  const candidateDocument = {
    ...document,
    instances: document.instances.map((item) =>
      item.id === instance.id ? candidateInstance : item,
    ),
  };
  if (value.display?.parameters) {
    // Apply visibility before movement so the transaction transforms new and
    // retained parameter anchors exactly once.
    edits.unshift(
      ...instanceParameterVisibilityEdits(
        candidateDocument,
        candidateInstance,
        resolver,
        value.display.parameters,
      ),
    );
  }
  const desiredReference = value.display?.visualAnnotation;
  const label = instanceLabelAnnotationFor(document, instance.id);
  const currentReference = label !== undefined && label.visible !== false;
  if (
    typeof desiredReference === "boolean" &&
    desiredReference !== currentReference
  ) {
    edits.push(
      ...instanceDisplayEdits(document, resolver, [instance.id], {
        showReference: desiredReference,
      }),
    );
  }
  const desiredValue = value.display?.value;
  const valueLabel = instanceValueAnnotation(document, instance.id);
  const currentValue = valueLabel !== null && valueLabel.visible !== false;
  if (typeof desiredValue === "boolean" && desiredValue !== currentValue) {
    if (
      desiredValue &&
      displayableInstanceValue(candidateInstance).kind !== "displayable"
    ) {
      return {
        kind: "rejected",
        message: "Set a valid component value before enabling its display",
      };
    }
    edits.push(
      ...instanceDisplayEdits(candidateDocument, resolver, [instance.id], {
        showValue: desiredValue,
      }),
    );
  }
  const supplyMarker = instance.symbolId === "vdd-port" ? instance : undefined;
  if (value.netName !== undefined) {
    const portNet = supplyMarker
      ? document.nets.find((net) =>
          net.terminals.some((terminal) => terminal.instanceId === instance.id),
        )
      : undefined;
    const portLogicalName = portNet
      ? resolveDocumentLogicalNets(document).byBaseNetId.get(portNet.id)?.name
      : undefined;
    if (value.netName !== portLogicalName) {
      const markerPlan = planElectricalMarkerName(
        document,
        instance.id,
        value.netName,
      );
      if (markerPlan.status === "rejected") {
        return { kind: "rejected", message: markerPlan.message };
      }
      if (markerPlan.status === "ready") {
        const gate = gateRoutingOperationPlan(
          document,
          markerPlan.operationPlan,
          { symbolResolver: resolver },
        );
        if (!gate.ok) return { kind: "rejected", message: gate.message };
        edits.push(...gate.edits);
      }
    }
  }
  const currentTarget =
    context.currentTarget ??
    (instance.netlist?.binding?.kind === "model"
      ? instance.netlist.binding.name
      : "");
  const targetEdits: ProjectStructureEdit[] =
    value.netlistTarget !== undefined && value.netlistTarget !== currentTarget
      ? planSetDeviceModelTarget(
          project,
          document.id,
          instance.id,
          value.netlistTarget,
        )
      : [];
  const currentConnection = supplyMarker
    ? formalTerminal
      ? "cell-pin"
      : "global"
    : undefined;
  const connectionEdits: ProjectStructureEdit[] =
    supplyMarker &&
    value.connection !== undefined &&
    value.connection !== currentConnection
      ? planSetVddConnectionMode(
          project,
          document.id,
          supplyMarker.id,
          value.connection,
        )
      : [];
  const structureEdits = [...terminalEdits, ...targetEdits, ...connectionEdits];
  if (edits.length === 0 && structureEdits.length === 0)
    return { kind: "unchanged" };
  if (structureEdits.length > 0) {
    // Merge structural document edits with the draft into one project
    // transaction and one undo boundary.
    const documentEdit = structureEdits.find(
      (edit) =>
        edit.kind === "transact_document" && edit.documentId === document.id,
    );
    if (documentEdit?.kind === "transact_document")
      documentEdit.edits.push(...edits);
    else if (edits.length)
      structureEdits.push({
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits,
      });
    return { kind: "structure", structureEdits };
  }
  // A typed coordinate lands the part as a drag would, joining a pin it now
  // lies on.
  const contactMove = planPropertyContactMove(
    document,
    resolver,
    instance,
    edits,
  );
  if (contactMove && !contactMove.ok)
    return { kind: "rejected", message: contactMove.message };
  return contactMove
    ? {
        kind: "connectivity",
        intent: contactMove.intent,
        edits: contactMove.edits,
        expectedElectricalEffect: contactMove.expectedElectricalEffect,
      }
    : { kind: "edits", edits };
}
