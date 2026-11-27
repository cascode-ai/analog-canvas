import {
  planRoutingTransform,
  reflectedAnnotationPlacement,
  rotatedAnnotationPlacement,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveRoutingAffectedClosure,
  draftingLabelOwnerId,
  resolveAnnotationPresentation,
  resolveDocumentRoutingGeometry,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import type { Point, RotationDelta, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  mirrorDraftingObject,
  rotateDraftingObject,
  rotateDraftingObjectAboutPivot,
} from "../drafting/drafting-manipulation";
import { draggedAnnotationAtPosition } from "../text-editing/annotation-drag-model";
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

  const collectTransformParticipants = (pivotStep: number) => {
    const placedSelection = placedInstanceIds();
    const seed = {
      instanceIds: placedSelection,
      routeIds: selection.routeIds,
      junctionIds: selection.junctionIds,
      annotationIds: selection.annotationIds,
    };
    const closure = deriveRoutingAffectedClosure(document, seed, { resolver });
    const draftingObjects = selection.draftingIds.flatMap((id) => {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === id,
      );
      return object && !object.locked ? [object] : [];
    });
    const labels = selection.annotationIds.flatMap((id) => {
      const annotation = document.annotations.find(
        (candidate) => candidate.id === id,
      );
      return annotation && !annotation.locked ? [annotation] : [];
    });
    const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
    const pivot = groupPivot(
      pivotStep,
      placedSelection.flatMap((id) => {
        const position = document.instances.find(
          (candidate) => candidate.id === id,
        )?.placement?.position;
        return position ? [position] : [];
      }),
      closure.internalJunctions.flatMap((id) => {
        const junction = document.junctions.find(
          (candidate) => candidate.id === id,
        );
        return junction ? [junction.position] : [];
      }),
      [
        ...draftingObjects.map(
          (object) =>
            resolveDraftingObjectGeometry(document, resolver, object).bounds,
        ),
        ...labels.map(
          (annotation) =>
            resolveAnnotationPresentation(
              document,
              resolver,
              annotation,
              styleProfile,
              routingGeometry,
            ).bounds,
        ),
      ],
    );
    const hostIds = new Set([
      ...placedSelection,
      ...closure.internalJunctions,
      ...closure.internalRoutes,
      ...draftingObjects.map((object) => object.id),
    ]);
    const selectedDraftingIds = new Set(
      draftingObjects.map((object) => object.id),
    );
    const attachedDraftingLabels = (document.drafting?.objects ?? []).filter(
      (object) => {
        const ownerId = draftingLabelOwnerId(object);
        return (
          !object.locked &&
          ownerId !== undefined &&
          !selectedDraftingIds.has(object.id) &&
          hostIds.has(ownerId)
        );
      },
    );
    return {
      placedSelection,
      seed,
      closure,
      draftingObjects,
      attachedDraftingLabels,
      labels,
      routingGeometry,
      pivot,
      hostIds,
    };
  };

  const uncarriedLabelEdits = (
    labels: readonly SchematicDocument["annotations"][number][],
    planEdits: readonly SchematicEdit[],
    placedSelection: readonly string[],
    placeLabel: (annotation: SchematicDocument["annotations"][number]) => {
      position: Point;
      alignment: SchematicDocument["annotations"][number]["alignment"];
    },
  ): SchematicEdit[] => {
    const carried = new Set(
      planEdits.flatMap((edit) =>
        edit.kind === "upsert_schematic_annotation" ? [edit.annotation.id] : [],
      ),
    );
    const partIds = new Set(placedSelection);
    const labelContext = {
      document,
      // Transforms keep every label's fine offset; a coarser annotation grid
      // would pull members of the group apart.
      annotationGrid: 1,
      resolver,
      routeGeometryRecords,
    };
    return labels.flatMap((annotation): SchematicEdit[] => {
      if (carried.has(annotation.id)) return [];
      if (
        annotation.anchor.kind === "object" &&
        partIds.has(annotation.anchor.objectId)
      ) {
        return [];
      }
      const placement = placeLabel(annotation);
      return [
        {
          kind: "upsert_schematic_annotation",
          annotation: draggedAnnotationAtPosition(
            labelContext,
            { ...annotation, alignment: placement.alignment },
            placement.position,
          ),
        },
      ];
    });
  };

  const rotate = (deltaDegrees: RotationDelta = 90): void => {
    const {
      placedSelection,
      seed,
      closure,
      draftingObjects,
      attachedDraftingLabels,
      labels,
      routingGeometry,
      pivot,
      hostIds,
    } = collectTransformParticipants(document.presentation.grid);
    const routingPlan = planRoutingTransform(document, resolver, seed, {
      kind: "rotate",
      ...(pivot ? { center: pivot } : {}),
      degrees:
        deltaDegrees === -45
          ? 315
          : deltaDegrees === -90
            ? 270
            : deltaDegrees === -135
              ? 225
              : deltaDegrees,
    });
    const blocking = routingPlan.diagnostics.find(
      (item) => item.severity === "error",
    );
    if (blocking) {
      setStatus(blocking.message);
      return;
    }
    const labelEdits = pivot
      ? uncarriedLabelEdits(
          labels,
          routingPlan.edits,
          placedSelection,
          (annotation) =>
            rotatedAnnotationPlacement(
              document,
              resolver,
              annotation,
              pivot,
              deltaDegrees,
              routingGeometry,
            ),
        )
      : [];
    const standaloneDrafting =
      placedSelection.length === 0 &&
      closure.internalJunctions.length === 0 &&
      labels.length === 0 &&
      draftingObjects.length === 1 &&
      attachedDraftingLabels.length === 0
        ? draftingObjects[0]
        : undefined;
    const draftingEdits = standaloneDrafting
      ? (() => {
          const next = rotateDraftingObject(
            standaloneDrafting,
            resolveDraftingObjectGeometry(
              document,
              resolver,
              standaloneDrafting,
            ),
            deltaDegrees,
            document.presentation.grid,
          );
          return next
            ? [{ kind: "upsert_drafting_object" as const, object: next }]
            : [];
        })()
      : pivot
        ? [...draftingObjects, ...attachedDraftingLabels].flatMap(
            (object): SchematicEdit[] => {
              const next = rotateDraftingObjectAboutPivot(
                object,
                pivot,
                deltaDegrees,
                hostIds,
                (candidate) =>
                  resolveDraftingObjectGeometry(document, resolver, candidate),
              );
              return next
                ? [{ kind: "upsert_drafting_object", object: next }]
                : [];
            },
          )
        : [];
    const edits = [...routingPlan.edits, ...labelEdits, ...draftingEdits];
    if (edits.length === 0 || !transact(edits).ok) return;
    setStatus(
      placedSelection.length > 1
        ? `Turned ${placedSelection.length} parts as one group`
        : "Turned the selection in place",
    );
  };

  /**
   * Mirror the whole selection as one drawing: parts, the wires and
   * Junctions between them, their labels, and drawing objects all reflect
   * about one axis, and every connection stays exactly as it was. Wires
   * alone mirror too. A wire that leaves the selection keeps its far end and
   * stretches, as it does when the selection moves.
   */
  const mirror = (direction: ScreenFlip = "left-right"): void => {
    const {
      placedSelection,
      seed,
      draftingObjects,
      attachedDraftingLabels,
      labels,
      routingGeometry,
      pivot,
      hostIds,
    } = collectTransformParticipants(document.presentation.grid / 2);
    // Say why rather than doing nothing: a wire on a part that is not
    // selected cannot move without leaving that part's pin.
    const nothingToMirror = () =>
      setStatus(
        "Nothing here can mirror: a wire stays with the parts it reaches unless they are selected too, and locked objects stay put",
      );
    if (!pivot) {
      nothingToMirror();
      return;
    }
    const plan = planRoutingTransform(document, resolver, seed, {
      kind: "mirror",
      axis: direction === "left-right" ? "y" : "x",
      center: pivot,
    });
    const blocking = plan.diagnostics.find((item) => item.severity === "error");
    if (blocking) {
      setStatus(blocking.message);
      return;
    }
    const labelEdits = uncarriedLabelEdits(
      labels,
      plan.edits,
      placedSelection,
      (annotation) =>
        reflectedAnnotationPlacement(
          document,
          resolver,
          annotation,
          pivot,
          direction,
          routingGeometry,
        ),
    );
    const draftingEdits = [
      ...draftingObjects,
      ...attachedDraftingLabels,
    ].flatMap((object): SchematicEdit[] => {
      const next = mirrorDraftingObject(
        object,
        pivot,
        direction,
        hostIds,
        (candidate) =>
          resolveDraftingObjectGeometry(document, resolver, candidate),
      );
      return next ? [{ kind: "upsert_drafting_object", object: next }] : [];
    });
    const edits = [...plan.edits, ...labelEdits, ...draftingEdits];
    if (edits.length === 0) {
      nothingToMirror();
      return;
    }
    if (transact(edits).ok)
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

function groupPivot(
  step: number,
  partPositions: readonly Point[],
  junctionPositions: readonly Point[],
  boxes: readonly { x: number; y: number; width: number; height: number }[],
): Point | null {
  const points =
    partPositions.length > 0
      ? partPositions
      : junctionPositions.length > 0
        ? junctionPositions
        : boxes.flatMap((box) => [
            { x: box.x, y: box.y },
            { x: box.x + box.width, y: box.y + box.height },
          ]);
  if (points.length === 0) return null;
  const snap = (value: number): number =>
    step > 0 ? Math.round(value / step) * step : value;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: snap((Math.min(...xs) + Math.max(...xs)) / 2),
    y: snap((Math.min(...ys) + Math.max(...ys)) / 2),
  };
}
