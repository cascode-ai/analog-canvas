import { applyArrowPreset, type ArrowPreset } from "./arrow-presets";
import type { SchematicEdit } from "@icm/edit-engine";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import type { DraftingObject, Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { VisualSelection } from "../selection/visual-selection";
import {
  applyDraftingGeometryPatch,
  applyDraftingStylePatch,
  deleteConstructionVertex as deleteConstructionVertexObject,
  insertArrowWaypoint as insertArrowWaypointObject,
  insertConstructionVertex as insertConstructionVertexObject,
  planDraftingStacking,
  setDraftingBearing as setDraftingObjectBearing,
  setDraftingTangentAngle as setDraftingObjectTangentAngle,
  type DraftingGeometryPatch,
  type DraftingStackingTarget,
  type DraftingStylePatch,
} from "./drafting-manipulation";

type TransactionResult = { ok: boolean };

export function createDraftingCommands({
  document,
  annotationGrid,
  resolver,
  selection,
  selectedDrafting,
  inspectorSegment,
  transact,
  setStatus,
  beginTextPlacement,
}: {
  document: SchematicDocument;
  /** Rounding pitch for drafting geometry edits. */
  annotationGrid: number;
  resolver: SymbolResolver;
  selection: VisualSelection;
  selectedDrafting: DraftingObject | undefined;
  inspectorSegment: { objectId: string; index: number } | null;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
  beginTextPlacement: () => void;
}) {
  const insertConstructionVertex = (
    object: Extract<DraftingObject, { kind: "construction-line" }>,
    point: Point,
  ): void => {
    const next = insertConstructionVertexObject(object, point);
    if (!next) return;
    transact([{ kind: "upsert_drafting_object", object: next.object }]);
    setStatus(`Inserted vertex ${next.index}`);
  };

  const insertArrowWaypoint = (
    object: Extract<DraftingObject, { kind: "arrow" }>,
    point: Point,
  ): void => {
    const geometry = resolveDraftingObjectGeometry(document, resolver, object);
    if (geometry.kind !== "arrow") return;
    const next = insertArrowWaypointObject(object, geometry, point);
    if (!next) return;
    transact([{ kind: "upsert_drafting_object", object: next.object }]);
    setStatus(`Inserted arrow bend ${next.index + 1}`);
  };

  const deleteConstructionVertex = (
    object: Extract<DraftingObject, { kind: "construction-line" }>,
    index: number,
  ): void => {
    const next = deleteConstructionVertexObject(object, index);
    if (next.kind === "minimum") {
      setStatus("A construction line needs at least two vertices");
      return;
    }
    if (next.kind !== "updated") return;
    transact([{ kind: "upsert_drafting_object", object: next.object }]);
    setStatus(`Deleted vertex ${index}`);
  };

  const setDraftingStyle = (patch: DraftingStylePatch): void => {
    const ids = selection.draftingIds;
    if (ids.length === 0) return;
    const edits: SchematicEdit[] = [];
    for (const id of ids) {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === id,
      );
      if (!object) continue;
      const nextObject = applyDraftingStylePatch(object, patch);
      if (nextObject) {
        edits.push({ kind: "upsert_drafting_object", object: nextObject });
      }
    }
    if (edits.length > 0) {
      if (transact(edits).ok) setStatus("Updated drawing style");
    } else {
      setStatus("Drawing is locked; unlock it before editing its style");
    }
  };

  const setDraftingGeometry = (patch: DraftingGeometryPatch): void => {
    const ids = selection.draftingIds;
    if (ids.length === 0) return;
    const edits: SchematicEdit[] = [];
    for (const id of ids) {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === id,
      );
      if (!object) continue;
      const nextObject = applyDraftingGeometryPatch(object, patch);
      if (nextObject) {
        edits.push({ kind: "upsert_drafting_object", object: nextObject });
      }
    }
    if (edits.length > 0) {
      if (transact(edits).ok) setStatus("Updated drawing geometry");
    } else {
      setStatus("Drawing is locked; unlock it before editing its geometry");
    }
  };

  const setDraftingStacking = (target: DraftingStackingTarget): void => {
    if (!selectedDrafting) return;
    const nextObjects = planDraftingStacking(
      document.drafting?.objects ?? [],
      selectedDrafting.id,
      target,
    );
    if (!nextObjects) {
      setStatus("Only unlocked rectangles and circles can change layer");
      return;
    }
    if (
      transact(
        nextObjects.map((object) => ({
          kind: "upsert_drafting_object" as const,
          object,
        })),
      ).ok
    ) {
      setStatus(
        target === "front" ? "Brought shape to front" : "Sent shape to back",
      );
    }
  };

  const setArrowPreset = (preset: ArrowPreset): void => {
    const arrows = (document.drafting?.objects ?? []).filter(
      (object): object is Extract<DraftingObject, { kind: "arrow" }> =>
        object.kind === "arrow" &&
        !object.locked &&
        selection.draftingIds.includes(object.id),
    );
    const objects = arrows.map((object) => applyArrowPreset(object, preset));
    if (objects.some((object) => object === null)) {
      setStatus(
        "Keep this arrow's existing bends; outline arrows require a straight path",
      );
      return;
    }
    if (
      objects.length &&
      transact(
        objects.map((object) => ({
          kind: "upsert_drafting_object",
          object: object!,
        })),
      ).ok
    )
      setStatus(`Arrow style: ${preset.label}`);
  };

  const setDraftingTangentAngle = (angleDegrees: number): void => {
    if (
      !selectedDrafting ||
      selectedDrafting.locked ||
      (selectedDrafting.kind !== "arrow" &&
        selectedDrafting.kind !== "construction-line") ||
      !Number.isFinite(angleDegrees)
    ) {
      return;
    }
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      selectedDrafting,
    );
    if (geometry.kind !== selectedDrafting.kind) return;
    const index =
      inspectorSegment?.objectId === selectedDrafting.id
        ? inspectorSegment.index
        : Math.max(0, geometry.curveControls.findIndex(Boolean));
    if (index >= geometry.points.length - 1) return;
    const next = setDraftingObjectTangentAngle(
      selectedDrafting,
      geometry,
      index,
      angleDegrees,
      annotationGrid,
    );
    if (next) {
      transact([{ kind: "upsert_drafting_object", object: next }]);
    }
  };

  const setDraftingBearing = (bearingDegrees: number): void => {
    if (
      !selectedDrafting ||
      selectedDrafting.locked ||
      (selectedDrafting.kind !== "arrow" &&
        selectedDrafting.kind !== "construction-line" &&
        selectedDrafting.kind !== "rectangle") ||
      !Number.isFinite(bearingDegrees)
    ) {
      return;
    }
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      selectedDrafting,
    );
    const next = setDraftingObjectBearing(
      selectedDrafting,
      geometry,
      bearingDegrees,
      annotationGrid,
    );
    if (next.kind === "attached-arrow") {
      setStatus(
        "An attached arrow cannot rotate without detaching its endpoints",
      );
    } else if (next.kind === "updated") {
      transact([{ kind: "upsert_drafting_object", object: next.object }]);
    }
  };

  const toggleDraftingLock = (object: DraftingObject): void => {
    const result = transact([
      {
        kind: "upsert_drafting_object",
        object: { ...object, locked: !object.locked },
      },
    ]);
    if (result.ok) {
      setStatus(
        object.locked
          ? "Drawing unlocked; it can now be edited or deleted"
          : "Drawing locked; unlock it before editing or deleting",
      );
    }
  };

  const addPlainText = (): void => {
    beginTextPlacement();
  };

  return {
    insertConstructionVertex,
    insertArrowWaypoint,
    deleteConstructionVertex,
    setDraftingStyle,
    setDraftingGeometry,
    setDraftingStacking,
    setArrowPreset,
    setDraftingTangentAngle,
    setDraftingBearing,
    toggleDraftingLock,
    addPlainText,
  };
}
