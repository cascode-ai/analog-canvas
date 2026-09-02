import {
  planSetDeviceModelTarget,
  type ProjectStructureEdit,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  reviewedExternalBindingForMaster,
  reviewedExternalModelSuggestions,
} from "@icm/devices";
import { resolveDocumentStyleProfile } from "@icm/derived";
import {
  type Annotation,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { instanceLabelAnnotationFor } from "../instance-display/default-instance-display";
import { bindingForEditedModel } from "../netlist-export/netlist-authoring";
import {
  defaultInstanceLabel,
  defaultInstanceValue,
  effectiveRouteAttachment,
  instanceValueAnnotation,
  isRoutedMarker,
} from "../wiring/route-interaction-geometry";

type Instance = SchematicDocument["instances"][number];
type TransactionResult = { ok: boolean };

export interface SelectionPropertyCommandDependencies {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  selectedInstance: Instance | null | undefined;
  selectedInstanceIsMos: boolean;
  selectedAnnotation: Annotation | null | undefined;
  commitStructure: (
    transactionId: string,
    edits: ProjectStructureEdit[],
  ) => boolean;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  replaceAnnotationSelection: (ids: readonly string[]) => void;
  setStatus: (status: string) => void;
}

/** Property-panel write commands and their annotation projection policy. */
export function createSelectionPropertyCommands({
  project,
  document,
  resolver,
  selectedInstance,
  selectedInstanceIsMos,
  selectedAnnotation,
  commitStructure,
  transact,
  replaceAnnotationSelection,
  setStatus,
}: SelectionPropertyCommandDependencies) {
  const styleProfile = resolveDocumentStyleProfile(document.presentation);

  const referenceLabelVisibilityEdits = (
    instanceIds: readonly string[],
    visible: boolean,
  ): SchematicEdit[] => {
    const edits: SchematicEdit[] = [];
    for (const instanceId of instanceIds) {
      const instance = document.instances.find(
        (item) => item.id === instanceId,
      );
      if (!instance) continue;
      const label = instanceLabelAnnotationFor(document, instanceId);
      if (label) {
        const { visible: _currentVisibility, ...rest } = label;
        edits.push({
          kind: "upsert_schematic_annotation",
          annotation: visible ? rest : { ...rest, visible: false },
        });
      } else if (visible) {
        const created = defaultInstanceLabel(
          document,
          instance,
          resolver,
          styleProfile,
        );
        if (created) {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: created,
          });
        }
      }
    }
    return edits;
  };

  const valueVisibilityEdits = (
    source: SchematicDocument,
    instanceIds: readonly string[],
    visible: boolean,
  ): SchematicEdit[] => {
    const edits: SchematicEdit[] = [];
    for (const instanceId of instanceIds) {
      const instance = source.instances.find((item) => item.id === instanceId);
      if (!instance) continue;
      const value = instanceValueAnnotation(source, instanceId);
      if (value) {
        const { visible: _currentVisibility, ...rest } = value;
        edits.push({
          kind: "upsert_schematic_annotation",
          annotation: visible ? rest : { ...rest, visible: false },
        });
      } else if (visible) {
        const created = defaultInstanceValue(
          source,
          instance,
          resolver,
          styleProfile,
        );
        if (created) {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: created,
          });
        }
      }
    }
    return edits;
  };

  const updateSelectedModelTarget = (value: string): void => {
    if (!selectedInstance?.netlist) return;
    if (
      selectedInstanceIsMos ||
      reviewedExternalModelSuggestions(selectedInstance.symbolId).length > 0 ||
      selectedInstance.netlist.binding?.kind === "external-subcircuit"
    ) {
      try {
        const edits = planSetDeviceModelTarget(
          project,
          document.id,
          selectedInstance.id,
          value,
        );
        if (edits.length === 0) return;
        if (commitStructure("set-mos-model-target", edits)) {
          const target = value.trim();
          const reviewed = target
            ? reviewedExternalBindingForMaster(target)
            : undefined;
          setStatus(
            reviewed
              ? `Set reviewed external target ${target}; authored Reference is unchanged`
              : target
                ? `Set model target ${target}`
                : `Cleared model target for ${selectedInstance.id}`,
          );
        }
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : "Could not set component model target",
        );
      }
      return;
    }
    const nextBinding =
      bindingForEditedModel(selectedInstance.symbolId, value) ?? null;
    const currentBinding = selectedInstance.netlist.binding ?? null;
    if (JSON.stringify(nextBinding) === JSON.stringify(currentBinding)) return;
    if (
      transact([
        {
          kind: "set_instance_binding",
          instanceId: selectedInstance.id,
          binding: nextBinding,
        },
      ]).ok
    ) {
      setStatus(
        nextBinding?.kind === "model"
          ? `Set model target ${nextBinding.name}`
          : `Cleared model target for ${selectedInstance.id}`,
      );
    }
  };

  const updateSelectedReference = (value: string): boolean => {
    if (!selectedInstance?.reference) return false;
    const reference = value.trim();
    if (!reference) {
      setStatus("Reference cannot be empty");
      return false;
    }
    if (reference === selectedInstance.reference) return true;
    if (
      transact([
        {
          kind: "set_instance_reference",
          instanceId: selectedInstance.id,
          reference,
        },
      ]).ok
    ) {
      setStatus(`Set Reference to ${reference}`);
      return true;
    }
    return false;
  };

  const deleteSelectedAnnotation = (): void => {
    if (!selectedAnnotation) return;
    const result = transact([
      {
        kind: "remove_schematic_annotation",
        annotationId: selectedAnnotation.id,
      },
    ]);
    if (result.ok) replaceAnnotationSelection([]);
  };

  const reverseSelectedCurrentArrow = (): void => {
    if (!selectedAnnotation || !isRoutedMarker(selectedAnnotation)) return;
    const attachment = effectiveRouteAttachment(selectedAnnotation);
    if (!attachment) return;
    const direction: "forward" | "reverse" =
      attachment.direction === "forward" ? "reverse" : "forward";
    const anchor =
      selectedAnnotation.kind === "route-marker" &&
      selectedAnnotation.anchor.kind === "route"
        ? { ...selectedAnnotation.anchor, direction }
        : selectedAnnotation.anchor;
    const result = transact([
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...selectedAnnotation, anchor },
      },
    ]);
    if (result.ok) setStatus(`Current arrow points ${direction}`);
  };

  return {
    referenceLabelVisibilityEdits,
    valueVisibilityEdits,
    updateSelectedModelTarget,
    updateSelectedReference,
    deleteSelectedAnnotation,
    reverseSelectedCurrentArrow,
  };
}
