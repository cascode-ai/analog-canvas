import { planRoutingTransform, type SchematicEdit } from "@icm/edit-engine";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { rotateDraftingObject } from "../drafting/drafting-manipulation";
import {
  planSelectionAlignment,
  selectionAlignmentParticipantCount,
  type EdgeAlignmentMode,
} from "./align-selection";
import type { ScreenFlip } from "../../interaction/shortcut-orientation";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";

type TransactionResult = { ok: boolean };

export function createSelectionTransformController({
  document,
  resolver,
  styleProfile,
  routeGeometryRecords,
  annotationGrid,
  selectedInstanceIds,
  selection,
  transact,
  setStatus,
}: {
  document: SchematicDocument;
  resolver: SymbolResolver;
  styleProfile: SchematicStyleProfile;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  annotationGrid: number;
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

  const alignmentContext = {
    document,
    resolver,
    styleProfile,
    routeGeometryRecords,
    annotationGrid,
    selection,
  };
  const align = (mode: EdgeAlignmentMode): void => {
    const plan = planSelectionAlignment(alignmentContext, mode);
    if (plan.participantCount < 2) {
      setStatus("Select at least two parts or text objects to align");
      return;
    }
    if (plan.blockingMessage) {
      setStatus(plan.blockingMessage);
      return;
    }
    if (plan.edits.length === 0) {
      setStatus("Selection is already aligned");
      return;
    }
    if (transact(plan.edits).ok) {
      setStatus(`Aligned ${plan.participantCount} selected objects`);
    }
  };

  return {
    rotate,
    mirror,
    align,
    alignmentParticipantCount:
      selectionAlignmentParticipantCount(alignmentContext),
  };
}
