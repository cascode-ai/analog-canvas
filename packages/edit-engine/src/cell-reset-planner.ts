import type { CircuitProject } from "@icm/model";

import type { SchematicEdit } from "./edit-schema.js";
import { orphanedCellResetJunctionIds } from "./cell-reset-junctions.js";
import { routeAnchoredAnnotationIds } from "./transaction-cell-reset.js";
import type { EditDiagnostic } from "./transaction-result.js";

export type CellResetIntent =
  "clear-drawing" | "reset-placement" | "reset-body";

export interface CellResetPlan {
  readonly scope: { kind: "cell"; documentId: string };
  readonly intent: CellResetIntent;
  readonly preconditionToken: string;
  readonly summary: string;
  readonly affectedObjectIds: readonly string[];
  readonly diagnostics: readonly EditDiagnostic[];
  readonly destructive: true;
  readonly rollback: { kind: "document-undo" };
  readonly edits: readonly SchematicEdit[];
}

function requireDocument(project: CircuitProject, documentId: string) {
  const document = project.documents.find((item) => item.id === documentId);
  if (!document) throw new Error(`Document does not exist: ${documentId}`);
  return document;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function routeOwnedEvidenceIds(
  document: ReturnType<typeof requireDocument>,
): readonly string[] {
  const routeIds = new Set(document.routes.map((route) => route.id));
  return document.connectivityEvidence.flatMap((evidence) =>
    evidence.kind === "name-claim" &&
    evidence.owner.kind === "power-marker" &&
    routeIds.has(evidence.owner.objectId)
      ? [evidence.id]
      : [],
  );
}

/** Labels drawn on a wire outlive it; markers drawn on it do not. */
function wireLabelNote(document: ReturnType<typeof requireDocument>): string {
  const onWires = document.annotations.filter(
    (annotation) => annotation.anchor.kind === "route",
  );
  const markers = onWires.filter(
    (annotation) => annotation.kind === "route-marker",
  ).length;
  const labels = onWires.length - markers;
  return [
    labels
      ? `; keep ${labels} wire ${labels === 1 ? "label" : "labels"} where drawn, now free`
      : "",
    markers
      ? `; remove ${markers} wire ${markers === 1 ? "marker" : "markers"}`
      : "",
  ].join("");
}

/**
 * Build the reviewable impact for one Cell-local reset. Execution remains in
 * the ordinary typed edit transaction, so revision checks and Document Undo
 * are shared with every other editor mutation.
 */
export function planCellReset(
  project: CircuitProject,
  documentId: string,
  intent: CellResetIntent,
): CellResetPlan {
  const document = requireDocument(project, documentId);
  const callers = project.documents.flatMap((parent) =>
    parent.instances.flatMap((instance) => {
      const binding = instance.netlist?.binding;
      return binding?.kind === "subcircuit" &&
        binding.childDocumentId === documentId
        ? [`${parent.id}.${instance.id}`]
        : [];
    }),
  );
  let affectedObjectIds: string[];
  let edit: SchematicEdit;
  let summary: string;

  if (intent === "clear-drawing") {
    const orphanedJunctions = orphanedCellResetJunctionIds(document, intent);
    affectedObjectIds = uniqueIds([
      ...orphanedJunctions,
      ...document.routes.map((route) => route.id),
      ...routeOwnedEvidenceIds(document),
      ...routeAnchoredAnnotationIds(document),
      ...(document.drafting?.objects.map((object) => object.id) ?? []),
    ]);
    edit = { kind: "clear_cell_drawing" };
    summary = `Remove ${document.routes.length} Route geometries, ${orphanedJunctions.size} unreferenced Junctions and ${document.drafting?.objects.length ?? 0} drafting objects; retain Instances, Nets, ports, and semantic annotations${wireLabelNote(document)}`;
  } else if (intent === "reset-placement") {
    const orphanedJunctions = orphanedCellResetJunctionIds(document, intent);
    const placedInstances = document.instances.filter(
      (instance) => instance.placement !== null,
    );
    affectedObjectIds = uniqueIds([
      ...orphanedJunctions,
      ...placedInstances.map((instance) => instance.id),
      ...document.routes.map((route) => route.id),
      ...routeOwnedEvidenceIds(document),
      ...routeAnchoredAnnotationIds(document),
      ...document.layoutGroups.map((group) => group.id),
      ...document.constraints.map((constraint) => constraint.id),
    ]);
    edit = { kind: "reset_cell_placement" };
    summary = `Return ${placedInstances.length} Instances to the tray and remove ${document.routes.length} Route geometries and ${orphanedJunctions.size} unreferenced Junctions; retain devices, Nets, and formal interface${wireLabelNote(document)}`;
  } else {
    const cellPinInstanceIds = new Set(
      document.netlist?.terminals.flatMap(
        (terminal) => terminal.interfaceInstanceIds,
      ) ?? [],
    );
    const interfaceNetIds = new Set(
      document.netlist?.terminals.map((terminal) => terminal.netId) ?? [],
    );
    const retainedAnnotationIds = new Set(
      document.annotations.flatMap((annotation) =>
        (annotation.anchor.kind === "object" &&
          cellPinInstanceIds.has(annotation.anchor.objectId)) ||
        document.netlist?.terminals.some(
          (terminal) => terminal.interfaceAnnotationId === annotation.id,
        )
          ? [annotation.id]
          : [],
      ),
    );
    const retainedEvidenceIds = new Set(
      document.connectivityEvidence.flatMap((evidence) => {
        if (!interfaceNetIds.has(evidence.netId)) return [];
        if (evidence.kind !== "name-claim") return [evidence.id];
        switch (evidence.owner.kind) {
          case "global-declaration":
            return [evidence.id];
          case "net-label":
            return retainedAnnotationIds.has(evidence.owner.annotationId)
              ? [evidence.id]
              : [];
          case "power-marker":
            return cellPinInstanceIds.has(evidence.owner.objectId) ||
              retainedAnnotationIds.has(evidence.owner.objectId)
              ? [evidence.id]
              : [];
        }
      }),
    );
    const retainedJunctionIds = new Set(
      document.annotations.flatMap((annotation) =>
        retainedAnnotationIds.has(annotation.id) &&
        annotation.anchor.kind === "object"
          ? [annotation.anchor.objectId]
          : [],
      ),
    );
    const allObjects = [
      ...document.instances,
      ...document.nets,
      ...document.routes,
      ...document.junctions,
      ...document.noConnects,
      ...document.annotations,
      ...document.connectivityEvidence,
      ...document.layoutGroups,
      ...document.constraints,
      ...(document.drafting?.objects ?? []),
    ];
    affectedObjectIds = uniqueIds([
      ...allObjects.flatMap((object) => {
        const retained =
          ("symbolId" in object && cellPinInstanceIds.has(object.id)) ||
          ("terminals" in object &&
            interfaceNetIds.has(object.id) &&
            object.terminals.every((terminal) =>
              cellPinInstanceIds.has(terminal.instanceId),
            )) ||
          retainedAnnotationIds.has(object.id);
        const retainedWithEvidence =
          retained ||
          retainedEvidenceIds.has(object.id) ||
          retainedJunctionIds.has(object.id);
        return retainedWithEvidence ? [] : [object.id];
      }),
      ...(document.mosBulkDefaults ? [document.id] : []),
    ]);
    edit = { kind: "reset_cell_body" };
    summary = `Remove ${affectedObjectIds.length} body objects; retain ${document.netlist?.terminals.length ?? 0} formal terminals and their interface markers`;
  }

  return {
    scope: { kind: "cell", documentId },
    intent,
    preconditionToken: `${document.id}:${document.revision}`,
    summary,
    affectedObjectIds,
    diagnostics:
      intent === "reset-body" && callers.length > 0
        ? [
            {
              code: "CELL_CALLERS_PRESERVED",
              severity: "info",
              message: `Formal interface retained for ${callers.length} caller${callers.length === 1 ? "" : "s"}`,
              objectIds: callers,
            },
          ]
        : [],
    destructive: true,
    rollback: { kind: "document-undo" },
    edits: affectedObjectIds.length > 0 ? [edit] : [],
  };
}
