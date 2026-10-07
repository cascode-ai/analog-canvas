import {
  freePowerRailLabel,
  junctionInUse,
  planCreateCellPin,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import {
  resolveDocumentStyleProfile,
  type SchematicStyleProfile,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { defaultInstanceDisplayAnnotations } from "../instance-display/default-instance-display";
import { planInitialMosBulkDefault } from "./mos-bulk-defaults";
import { vddPowerLabelAnnotation } from "./vdd-power-label";

/** Shared electrical/display proposal; callers retain their own contact policy. */
export function planPlacedCellPin(
  project: CircuitProject,
  documentId: string,
  resolver: SymbolResolver,
  input: {
    instance: Instance;
    terminalId: string;
    name?: string | undefined;
    netId: string;
    direction: "input" | "output" | "inout" | "passive";
    connectionEdits: readonly SchematicEdit[];
    precedingEdits?: readonly SchematicEdit[];
    styleProfile?: SchematicStyleProfile;
  },
) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("Cell not found");
  const supply = input.instance.symbolId === "vdd-port";
  const name = input.name?.trim() ?? (supply ? "VDD" : undefined);
  if (!name) throw new Error("A Cell interface marker requires a name");
  const resolved = supply
    ? resolver.resolve(input.instance.symbolId)
    : undefined;
  const annotation =
    supply && resolved
      ? {
          ...vddPowerLabelAnnotation({
            instance: input.instance,
            resolved,
            netId: input.netId,
            grid: document.presentation.grid,
            name,
          }),
          binding: {
            kind: "cell-terminal-name" as const,
            terminalId: input.terminalId,
          },
        }
      : defaultInstanceDisplayAnnotations(
          withPrecedingDisplay(document, input.precedingEdits),
          input.instance,
          resolver,
          input.styleProfile ??
            resolveDocumentStyleProfile(document.presentation),
          { formalTerminalId: input.terminalId, formalName: name },
        )[0];
  const plan = planCreateCellPin(project, documentId, {
    instance: input.instance,
    connectionEdits: [
      ...input.connectionEdits,
      ...(supply
        ? planInitialMosBulkDefault(
            document,
            "vdd",
            input.netId,
            input.precedingEdits,
          )
        : []),
    ],
    terminal: {
      id: input.terminalId,
      name,
      netId: input.netId,
      direction: input.direction,
      interfaceInstanceIds: [input.instance.id],
    },
    ...(annotation ? { annotation } : {}),
  });
  const retired = supply
    ? retireKeptSupplyPin(document, name, input.netId)
    : [];
  return retired.length
    ? plan.map((entry) =>
        entry.kind === "transact_document" && entry.documentId === documentId
          ? { ...entry, edits: [...entry.edits, ...retired] }
          : entry,
      )
    : plan;
}

/**
 * A body reset or clear-drawing keeps a rail's VDD label and its Pin for the
 * Cell's callers. A VDD marker placed for that supply takes their place, as a
 * redrawn rail takes the label over (#1410): the supply's Net becomes the
 * marker's, keeping whatever stands on it, and the kept label, its Pin and
 * the Junction it stood on go. The Pin's name stays, so the Cell's symbol and
 * its callers keep the Pin they know.
 */
function retireKeptSupplyPin(
  document: SchematicDocument,
  name: string,
  markerNetId: string,
): SchematicEdit[] {
  const label = freePowerRailLabel(document, { netName: name, scope: "local" });
  const pin = document.netlist?.terminals.find(
    (terminal) => terminal.interfaceAnnotationId === label?.id,
  );
  if (!label || !pin) return [];
  // The label stood on a Junction no rail reaches; it goes with the label
  // unless something else still uses it.
  const junctionId =
    label.anchor.kind === "object" ? label.anchor.objectId : undefined;
  const unlabelled = {
    ...document,
    annotations: document.annotations.filter((item) => item.id !== label.id),
  };
  return [
    { kind: "merge_nets", targetNetId: pin.netId, sourceNetId: markerNetId },
    { kind: "remove_schematic_annotation", annotationId: label.id },
    { kind: "remove_cell_terminal", terminalId: pin.id },
    ...(junctionId !== undefined &&
    document.junctions.some((junction) => junction.id === junctionId) &&
    !junctionInUse(unlabelled, junctionId)
      ? [{ kind: "remove_junction" as const, junctionId }]
      : []),
  ];
}

/**
 * The Cell with the parts and labels earlier edits of the same batch add, so
 * a Pin placed beside another in one call sees that Pin's name and keeps its
 * own clear of it (#1105).
 */
function withPrecedingDisplay(
  document: SchematicDocument,
  edits: readonly SchematicEdit[] | undefined,
): SchematicDocument {
  if (!edits?.length) return document;
  const instances = [...document.instances];
  const annotations = [...document.annotations];
  for (const edit of edits)
    if (edit.kind === "add_instance") instances.push(edit.instance);
    else if (edit.kind === "upsert_schematic_annotation") {
      const index = annotations.findIndex(
        (annotation) => annotation.id === edit.annotation.id,
      );
      if (index >= 0) annotations[index] = edit.annotation;
      else annotations.push(edit.annotation);
    }
  return { ...document, instances, annotations };
}
