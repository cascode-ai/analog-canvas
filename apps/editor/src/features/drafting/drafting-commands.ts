import type { SchematicEdit } from "@icm/edit-engine";
import { resolveDraftingObjectGeometry } from "@icm/derived";
import {
  defaultDraftTextDocument,
  semanticTextDocument,
  snapGridPoint,
  type DraftingObject,
  type GridRect,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { VisualSelection } from "../selection/visual-selection";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import {
  applyDraftingGeometryPatch,
  applyDraftingStylePatch,
  deleteConstructionVertex as deleteConstructionVertexObject,
  insertArrowWaypoint as insertArrowWaypointObject,
  insertConstructionVertex as insertConstructionVertexObject,
  setDraftingBearing as setDraftingObjectBearing,
  setDraftingTangentAngle as setDraftingObjectTangentAngle,
  type DraftingGeometryPatch,
  type DraftingStylePatch,
} from "./drafting-manipulation";

type Route = SchematicDocument["routes"][number];
type DraftingText = Extract<DraftingObject, { kind: "text" }>;
type TransactionResult = { ok: boolean };

export function createDraftingCommands({
  document,
  annotationGrid,
  resolver,
  viewBox,
  selection,
  selectedDrafting,
  inspectorSegment,
  selectedRoute,
  selectedRouteSegmentIndex,
  routeGeometryRecords,
  transact,
  setStatus,
  nextId,
  beginTextEditing,
  selectAnnotation,
}: {
  document: SchematicDocument;
  /** Rounding pitch for drafting geometry edits and new plain text. */
  annotationGrid: number;
  resolver: SymbolResolver;
  viewBox: GridRect;
  selection: VisualSelection;
  selectedDrafting: DraftingObject | undefined;
  inspectorSegment: { objectId: string; index: number } | null;
  selectedRoute: Route | undefined;
  selectedRouteSegmentIndex: number | null;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
  nextId: (prefix: string) => string;
  beginTextEditing: (object: DraftingText) => void;
  selectAnnotation: (id: string) => void;
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
    const id = nextId("note");
    const position = snapGridPoint(
      {
        x: Math.round(viewBox.x + viewBox.width / 2),
        y: Math.round(viewBox.y + viewBox.height - 20),
      },
      annotationGrid,
    );
    const object: DraftingText = {
      id,
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position },
      content: defaultDraftTextDocument("Design note"),
      alignment: "middle",
      rotation: 0,
      typographyToken: "label",
    };
    if (transact([{ kind: "upsert_drafting_object", object }]).ok) {
      beginTextEditing(object);
      setStatus(`Added drafting text ${id}`);
    }
  };

  const addCurrentArrow = (): void => {
    if (!selectedRoute) {
      setStatus("Select a wire segment before adding a current arrow");
      return;
    }
    const segmentIndex = Math.min(
      selectedRouteSegmentIndex ?? 0,
      selectedRoute.legs.length - 1,
    );
    const record = routeGeometryRecords.find(
      ({ route }) => route.id === selectedRoute.id,
    );
    const from = record?.geometry.centerline[segmentIndex];
    const to = record?.geometry.centerline[segmentIndex + 1];
    if (!from || !to) {
      setStatus("Selected wire segment cannot accept a current arrow");
      return;
    }
    const id = nextId("current");
    const fallbackPosition = snapGridPoint(
      { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      document.presentation.grid,
    );
    if (
      transact([
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id,
            kind: "route-marker",
            markerKind: "current",
            content: semanticTextDocument("I_x", "route-marker"),
            anchor: {
              kind: "route",
              routeId: selectedRoute.id,
              legId: selectedRoute.legs[segmentIndex]!.id,
              t: 0.5,
              normalOffset: -14,
              direction: "forward",
              orientation: "follow",
              fallbackPosition,
            },
            alignment: "middle",
            rotation: 0,
            locked: false,
          },
        },
      ]).ok
    ) {
      selectAnnotation(id);
      setStatus(`Added current arrow on ${selectedRoute.id}`);
    }
  };

  const reverseSelectedDrafting = (): void => {
    if (selectedDrafting?.kind !== "arrow") return;
    transact([
      {
        kind: "upsert_drafting_object",
        object: {
          ...selectedDrafting,
          from: selectedDrafting.to,
          to: selectedDrafting.from,
          waypoints: [...(selectedDrafting.waypoints ?? [])].reverse(),
          curveControls: [...(selectedDrafting.curveControls ?? [])].reverse(),
        },
      },
    ]);
  };

  return {
    insertConstructionVertex,
    insertArrowWaypoint,
    deleteConstructionVertex,
    setDraftingStyle,
    setDraftingGeometry,
    setDraftingTangentAngle,
    setDraftingBearing,
    toggleDraftingLock,
    addPlainText,
    addCurrentArrow,
    reverseSelectedDrafting,
  };
}
