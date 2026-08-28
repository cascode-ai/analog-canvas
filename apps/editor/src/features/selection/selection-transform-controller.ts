import { planRoutingTransform, type SchematicEdit } from "@icm/edit-engine";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { rotateDraftingObject } from "../drafting/drafting-manipulation";
import {
  proposeEdgeAlignmentEdits,
  type EdgeAlignmentMode,
} from "./align-instances";
import type { ScreenFlip } from "../../interaction/shortcut-orientation";
import type { VisualSelection } from "./visual-selection";

type TransactionResult = { ok: boolean };

export function createSelectionTransformController({
  document,
  resolver,
  selectedInstanceIds,
  selection,
  transact,
  setStatus,
}: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  selectedInstanceIds: readonly string[];
  selection: VisualSelection;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
}) {
  const placedInstanceIds = (): string[] =>
    selectedInstanceIds.filter((id) =>
      document.instances.some(
        (candidate) => candidate.id === id && candidate.placement,
      ),
    );

  const rotate = (deltaDegrees: 90 | -90 = 90): void => {
    const placedSelection = placedInstanceIds();
    const routingPlan = planRoutingTransform(
      document,
      resolver,
      {
        instanceIds: placedSelection,
        routeIds: selection.routeIds,
        junctionIds: selection.junctionIds,
        annotationIds: selection.annotationIds,
      },
      { kind: "rotate", degrees: deltaDegrees === -90 ? 270 : 90 },
    );
    const blocking = routingPlan.diagnostics.find(
      (item) => item.severity === "error",
    );
    if (blocking) {
      setStatus(blocking.message);
      return;
    }
    const draftingEdits = selection.draftingIds.flatMap(
      (id): SchematicEdit[] => {
        const object = document.drafting?.objects.find(
          (candidate) => candidate.id === id,
        );
        if (!object) return [];
        const next = rotateDraftingObject(
          object,
          resolveDraftingObjectGeometry(document, resolver, object),
          deltaDegrees,
          document.presentation.grid,
        );
        return next ? [{ kind: "upsert_drafting_object", object: next }] : [];
      },
    );
    const edits = [...routingPlan.edits, ...draftingEdits];
    if (edits.length === 0 || !transact(edits).ok) return;
    setStatus(
      placedSelection.length > 1
        ? `Turned ${placedSelection.length} parts as one group`
        : "Turned the selection in place",
    );
  };

  const mirror = (direction: ScreenFlip = "left-right"): void => {
    const placedSelection = placedInstanceIds();
    const plan = planRoutingTransform(
      document,
      resolver,
      {
        instanceIds: placedSelection,
        routeIds: selection.routeIds,
        junctionIds: selection.junctionIds,
        annotationIds: selection.annotationIds,
      },
      {
        kind: "mirror",
        axis: direction === "left-right" ? "y" : "x",
      },
    );
    const blocking = plan.diagnostics.find((item) => item.severity === "error");
    if (blocking) {
      setStatus(blocking.message);
      return;
    }
    const edits = [...plan.edits];
    if (edits.length > 0 && transact(edits).ok)
      setStatus(
        placedSelection.length > 1
          ? `Flipped ${placedSelection.length} parts as one group, ${direction === "left-right" ? "left to right" : "top to bottom"}`
          : `Flipped the selection ${direction === "left-right" ? "left to right" : "top to bottom"}`,
      );
  };

  const alignEdge = (mode: EdgeAlignmentMode): void => {
    if (selectedInstanceIds.length < 2) {
      setStatus("Select at least two instances to align");
      return;
    }
    const edits = proposeEdgeAlignmentEdits(
      document,
      resolver,
      selectedInstanceIds,
      mode,
    );
    if (edits.length === 0) {
      setStatus("Selection is already aligned");
      return;
    }
    if (transact(edits).ok)
      setStatus(`Aligned ${selectedInstanceIds.length} selected instances`);
  };

  const align = (): void => {
    if (selectedInstanceIds.length < 2) {
      setStatus("Select at least two instances to align");
      return;
    }
    if (
      transact([
        {
          kind: "align_instances",
          instanceIds: [...selectedInstanceIds],
          axis: "y",
        },
      ]).ok
    )
      setStatus(`Aligned ${selectedInstanceIds.length} selected instances`);
  };

  return { rotate, mirror, align, alignEdge };
}
