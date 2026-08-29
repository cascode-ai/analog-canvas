import type { SchematicEdit } from "@icm/edit-engine";
import {
  resolveAnnotationPresentation,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import { snapGridPoint } from "@icm/model";
import type {
  DraftingObject,
  Point,
  Rect,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { translateDraftingObject } from "../drafting/drafting-manipulation";
import { draggedAnnotationAtPosition } from "../text-editing/annotation-drag-model";
import type { RouteGeometryRecord } from "../wiring/route-interaction-geometry";
import { instanceHitBox } from "../wiring/route-interaction-geometry";
import type { VisualSelection } from "./visual-selection";

export type EdgeAlignmentMode =
  "left" | "h-center" | "right" | "top" | "v-center" | "bottom";

export const EDGE_ALIGNMENT_MODES: readonly {
  mode: EdgeAlignmentMode;
  label: string;
}[] = [
  { mode: "left", label: "Align left" },
  { mode: "h-center", label: "Align horizontal center" },
  { mode: "right", label: "Align right" },
  { mode: "top", label: "Align top" },
  { mode: "v-center", label: "Align vertical center" },
  { mode: "bottom", label: "Align bottom" },
];

export interface SelectionAlignmentContext {
  document: SchematicDocument;
  resolver: SymbolResolver;
  styleProfile: SchematicStyleProfile;
  routeGeometryRecords: readonly RouteGeometryRecord[];
  annotationGrid: number;
  selection: VisualSelection;
}

export interface SelectionAlignmentPlan {
  participantCount: number;
  edits: SchematicEdit[];
  blockingMessage?: string;
}

interface AlignmentParticipant {
  id: string;
  bounds: Rect;
  locked: boolean;
  pitch: number;
  editForDelta(delta: Point): SchematicEdit | null;
}

function translatePoint(point: Point, delta: Point): Point {
  return snapGridPoint({ x: point.x + delta.x, y: point.y + delta.y }, 1);
}

function translateDraftText(
  object: Extract<DraftingObject, { kind: "text" }>,
  delta: Point,
  pitch: number,
): Extract<DraftingObject, { kind: "text" }> | null {
  if (object.anchor.kind === "route") return null;
  if (object.anchor.kind === "free") {
    return translateDraftingObject(object, delta, pitch) as Extract<
      DraftingObject,
      { kind: "text" }
    >;
  }
  return {
    ...object,
    anchor: {
      ...object.anchor,
      localOffset: translatePoint(object.anchor.localOffset, delta),
      fallbackPosition: translatePoint(object.anchor.fallbackPosition, delta),
    },
  };
}

function alignmentParticipants({
  document,
  resolver,
  styleProfile,
  routeGeometryRecords,
  annotationGrid,
  selection,
}: SelectionAlignmentContext): AlignmentParticipant[] {
  const selectedInstanceIds = new Set(selection.instanceIds);
  const instances = selection.instanceIds.flatMap(
    (instanceId): AlignmentParticipant[] => {
      const instance = document.instances.find(
        (candidate) => candidate.id === instanceId,
      );
      if (!instance?.placement) return [];
      const bounds = instanceHitBox(instance, resolver);
      if (!bounds) return [];
      return [
        {
          id: instance.id,
          bounds,
          locked: false,
          pitch: document.presentation.grid,
          editForDelta: (delta) => ({
            kind: "move_instance",
            instanceId: instance.id,
            position: {
              x: instance.placement!.position.x + delta.x,
              y: instance.placement!.position.y + delta.y,
            },
          }),
        },
      ];
    },
  );
  const annotations = selection.annotationIds.flatMap(
    (annotationId): AlignmentParticipant[] => {
      const annotation = document.annotations.find(
        (candidate) => candidate.id === annotationId,
      );
      if (!annotation) return [];
      // A label selected together with its host is a follower. Making it a
      // second participant would apply the host delta twice.
      if (
        annotation.anchor.kind === "object" &&
        selectedInstanceIds.has(annotation.anchor.objectId)
      ) {
        return [];
      }
      const presentation = resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        styleProfile,
      );
      return [
        {
          id: annotation.id,
          bounds: presentation.bounds,
          locked: annotation.locked,
          pitch: annotationGrid,
          editForDelta: (delta) => ({
            kind: "upsert_schematic_annotation",
            annotation: draggedAnnotationAtPosition(
              {
                document,
                annotationGrid,
                resolver,
                routeGeometryRecords,
              },
              annotation,
              {
                x: presentation.position.x + delta.x,
                y: presentation.position.y + delta.y,
              },
            ),
          }),
        },
      ];
    },
  );
  const draftingTexts = selection.draftingIds.flatMap(
    (objectId): AlignmentParticipant[] => {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === objectId,
      );
      if (!object || object.kind !== "text" || object.anchor.kind === "route") {
        return [];
      }
      if (
        object.anchor.kind === "object" &&
        selectedInstanceIds.has(object.anchor.objectId)
      ) {
        return [];
      }
      const geometry = resolveDraftingObjectGeometry(
        document,
        resolver,
        object,
      );
      return [
        {
          id: object.id,
          bounds: geometry.bounds,
          locked: object.locked,
          pitch: annotationGrid,
          editForDelta: (delta) => {
            const next = translateDraftText(object, delta, annotationGrid);
            return next
              ? { kind: "upsert_drafting_object", object: next }
              : null;
          },
        },
      ];
    },
  );
  return [...instances, ...annotations, ...draftingTexts];
}

function measure(bounds: Rect, mode: EdgeAlignmentMode): number {
  switch (mode) {
    case "left":
      return bounds.x;
    case "h-center":
      return bounds.x + bounds.width / 2;
    case "right":
      return bounds.x + bounds.width;
    case "top":
      return bounds.y;
    case "v-center":
      return bounds.y + bounds.height / 2;
    case "bottom":
      return bounds.y + bounds.height;
  }
}

export function selectionAlignmentParticipantCount({
  document,
  selection,
}: SelectionAlignmentContext): number {
  const selectedInstanceIds = new Set(selection.instanceIds);
  const placedInstances = selection.instanceIds.filter((id) =>
    document.instances.some(
      (instance) => instance.id === id && instance.placement !== null,
    ),
  ).length;
  const independentAnnotations = selection.annotationIds.filter((id) => {
    const annotation = document.annotations.find(
      (candidate) => candidate.id === id,
    );
    return (
      annotation !== undefined &&
      !(
        annotation.anchor.kind === "object" &&
        selectedInstanceIds.has(annotation.anchor.objectId)
      )
    );
  }).length;
  const independentDraftText = selection.draftingIds.filter((id) => {
    const object = document.drafting?.objects.find(
      (candidate) => candidate.id === id,
    );
    return (
      object?.kind === "text" &&
      object.anchor.kind !== "route" &&
      !(
        object.anchor.kind === "object" &&
        selectedInstanceIds.has(object.anchor.objectId)
      )
    );
  }).length;
  return placedInstances + independentAnnotations + independentDraftText;
}

/**
 * One editor-local visual alignment plan for parts and text. It deliberately
 * expands to ordinary movement edits, so route following, annotation
 * constraints, transaction history, and Undo stay on established paths.
 */
export function planSelectionAlignment(
  context: SelectionAlignmentContext,
  mode: EdgeAlignmentMode,
): SelectionAlignmentPlan {
  const participants = alignmentParticipants(context);
  if (participants.length < 2) {
    return { participantCount: participants.length, edits: [] };
  }
  const locked = participants.find((participant) => participant.locked);
  if (locked) {
    return {
      participantCount: participants.length,
      edits: [],
      blockingMessage: `Cannot align locked text ${locked.id}`,
    };
  }
  const measures = participants.map((participant) =>
    measure(participant.bounds, mode),
  );
  const target =
    mode === "left" || mode === "top"
      ? Math.min(...measures)
      : mode === "right" || mode === "bottom"
        ? Math.max(...measures)
        : measures.reduce((sum, value) => sum + value, 0) / measures.length;
  const horizontal = mode === "left" || mode === "h-center" || mode === "right";
  const edits = participants.flatMap((participant): SchematicEdit[] => {
    const rawDelta = target - measure(participant.bounds, mode);
    const snappedDelta =
      Math.round(rawDelta / participant.pitch) * participant.pitch;
    if (snappedDelta === 0) return [];
    const edit = participant.editForDelta(
      horizontal ? { x: snappedDelta, y: 0 } : { x: 0, y: snappedDelta },
    );
    return edit ? [edit] : [];
  });
  return { participantCount: participants.length, edits };
}
