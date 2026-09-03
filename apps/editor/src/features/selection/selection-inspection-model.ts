import { deviceDescriptor, resolveReviewedExternalBinding } from "@icm/devices";
import {
  endpointKey,
  hasDifferentialInputs,
  resolveDocumentLogicalNets,
  resolveNetLabelBinding,
} from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import {
  routeEndpoints,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { referencedDocumentId } from "../../document/editor-session";
import { capacitorPlatePropertyRows } from "../properties/capacitor-plate-properties";
import { endpointNetId } from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";

export type SupplementalSelection = Omit<VisualSelection, "instanceIds">;

export interface SelectionInspectionModelInput {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  selection: VisualSelection;
  selectedEndpoint: WireSource | null;
}

/**
 * Resolves the read-only selection projection consumed by the editor shell and
 * Properties panel. It deliberately owns no React state and emits no edits.
 */
export function deriveSelectionInspectionModel({
  project,
  document,
  resolver,
  selection,
  selectedEndpoint,
}: SelectionInspectionModelInput) {
  const selectedIds = selection.instanceIds;
  const supplementalSelection: SupplementalSelection = {
    routeIds: selection.routeIds,
    junctionIds: selection.junctionIds,
    annotationIds: selection.annotationIds,
    draftingIds: selection.draftingIds,
  };
  const selectedRouteId = selection.routeIds.at(-1) ?? null;
  const selectedAnnotationId = selection.annotationIds.at(-1) ?? null;
  const selectedDraftingId = selection.draftingIds.at(-1) ?? null;
  const selectedId = selectedIds.at(-1) ?? null;
  const selectedInstance =
    selectedIds.length === 1
      ? document.instances.find((instance) => instance.id === selectedId)
      : undefined;
  const selectedInstanceHasDifferentialInputs = (() => {
    if (!selectedInstance) return false;
    const resolved = resolver.resolve(selectedInstance.symbolId);
    return resolved ? hasDifferentialInputs(resolved) : false;
  })();
  const selectedHierarchyCell = selectedInstance
    ? project.documents.find(
        (candidate) =>
          candidate.id === referencedDocumentId(project, selectedInstance),
      )
    : undefined;
  const selectedDevice = selectedInstance
    ? deviceDescriptor(selectedInstance.symbolId)
    : undefined;
  const selectedCapacitorPlateRows = selectedInstance
    ? capacitorPlatePropertyRows(document, selectedInstance)
    : null;
  const selectedBinding = selectedInstance?.netlist?.binding;
  const selectedExternalSubcircuit =
    selectedBinding?.kind === "external-subcircuit"
      ? project.externalSubcircuitDefinitions.find(
          (definition) => definition.id === selectedBinding.definitionId,
        )
      : undefined;
  const selectedReviewedExternalBinding = selectedExternalSubcircuit
    ? selectedExternalSubcircuit.presentation
      ? undefined
      : resolveReviewedExternalBinding(
          selectedExternalSubcircuit.name,
          selectedExternalSubcircuit.terminals.map((terminal) => terminal.name),
        )
    : undefined;
  const selectedPropertyDevice =
    selectedDevice ??
    (selectedReviewedExternalBinding
      ? deviceDescriptor(selectedReviewedExternalBinding.symbolId)
      : undefined);
  const selectedRoute = selectedRouteId
    ? document.routes.find((route) => route.id === selectedRouteId)
    : undefined;
  const selectedRouteNetLabels = selectedRoute
    ? document.annotations.filter(
        (annotation) =>
          annotation.kind === "net-label" &&
          annotation.netId === selectedRoute.netId,
      )
    : [];
  const selectedRouteNetLabel = selectedRoute
    ? (selectedRouteNetLabels.find(
        (annotation) => annotation.id === `net-label-${selectedRoute.id}`,
      ) ??
      selectedRouteNetLabels.find(
        (annotation) =>
          resolveNetLabelBinding(document, resolver, annotation)?.routeId ===
          selectedRoute.id,
      ))
    : undefined;
  const selectedAnnotation = selectedAnnotationId
    ? document.annotations.find(
        (annotation) => annotation.id === selectedAnnotationId,
      )
    : undefined;
  const selectedNetLabelBinding = selectedAnnotation
    ? resolveNetLabelBinding(document, resolver, selectedAnnotation)
    : null;
  const selectedDrafting = selectedDraftingId
    ? document.drafting?.objects.find(
        (object) => object.id === selectedDraftingId,
      )
    : undefined;
  const hasHierarchyEnterSelection = Boolean(
    selectedInstance && referencedDocumentId(project, selectedInstance),
  );
  const hasRotatableSelection =
    selectedIds.some((id) =>
      document.instances.some(
        (instance) => instance.id === id && instance.placement !== null,
      ),
    ) ||
    selection.draftingIds.some((id) => {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === id,
      );
      return (
        object?.kind === "arrow" ||
        object?.kind === "construction-line" ||
        object?.kind === "rectangle"
      );
    });
  const hasMirrorableSelection = selectedIds.some((id) =>
    document.instances.some(
      (instance) => instance.id === id && instance.placement !== null,
    ),
  );
  const hasInspectableSelection = Boolean(
    selectedIds.length > 0 ||
    selectedRoute ||
    selectedAnnotation ||
    selectedDrafting ||
    selectedEndpoint,
  );
  const selectionShelfSummary = selectedInstance
    ? `${selectedInstance.id} · ${selectedInstance.symbolId}`
    : selectedIds.length > 1
      ? `${selectedIds.length} components`
      : selectedRoute
        ? `Route · ${
            resolveDocumentLogicalNets(document).byBaseNetId.get(
              selectedRoute.netId,
            )?.name ?? selectedRoute.netId
          }`
        : selectedAnnotation
          ? `Annotation · ${selectedAnnotation.kind}`
          : selectedDrafting
            ? `Drawing · ${selectedDrafting.kind}`
            : selectedEndpoint?.endpoint.kind === "junction"
              ? "Junction"
              : selectedEndpoint
                ? "Endpoint"
                : "None";
  const selectedNoConnect =
    selectedEndpoint && selectedEndpoint.endpoint.kind !== "junction"
      ? document.noConnects.find(
          (noConnect) =>
            endpointKey(noConnect.endpoint) ===
            endpointKey(selectedEndpoint.endpoint),
        )
      : undefined;
  const selectedEndpointNetId = selectedEndpoint
    ? endpointNetId(document, selectedEndpoint.endpoint)
    : null;
  const selectedHighlightNetId =
    selectedRoute?.netId ??
    selectedEndpointNetId ??
    selectedNetLabelBinding?.netId ??
    null;
  const selectedHighlightEndpoint =
    (selectedRoute ? routeEndpoints(selectedRoute)[0] : undefined) ??
    selectedEndpoint?.endpoint ??
    selectedNetLabelBinding?.endpoint;

  return {
    selectedIds,
    supplementalSelection,
    selectedRouteId,
    selectedAnnotationId,
    selectedDraftingId,
    selectedInstance,
    selectedInstanceHasDifferentialInputs,
    selectedHierarchyCell,
    selectedDevice,
    selectedCapacitorPlateRows,
    selectedExternalSubcircuit,
    selectedReviewedExternalBinding,
    selectedPropertyDevice,
    selectedRoute,
    selectedRouteNetLabels,
    selectedRouteNetLabel,
    selectedAnnotation,
    selectedNetLabelBinding,
    selectedDrafting,
    hasHierarchyEnterSelection,
    hasRotatableSelection,
    hasMirrorableSelection,
    hasInspectableSelection,
    selectionShelfSummary,
    selectedNoConnect,
    selectedEndpointNetId,
    selectedHighlightNetId,
    selectedHighlightEndpoint,
  };
}
