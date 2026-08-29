import type { PointerEvent as ReactPointerEvent } from "react";

import type { WireSource } from "@icm/edit-engine";
import type { Annotation, DraftingObject, SchematicDocument } from "@icm/model";

import type { EditorTool } from "../interaction/interaction-state";
import { planSelectionMove } from "../features/selection/selection-move-plan";
import type { VisualSelection } from "../features/selection/visual-selection";
import { resolveCanvasHitAtPoint } from "./canvas-hit-resolver";

export interface CanvasHitControllerDependencies {
  model: {
    document: SchematicDocument;
    visibleEndpoints: readonly WireSource[];
    selection: VisualSelection;
    selectedInternalRouteIds: ReadonlySet<string>;
    selectedInternalJunctionIds: ReadonlySet<string>;
    selectedInternalObjectIds: ReadonlySet<string>;
  };
  session: {
    getInteractionKind: () => string;
    placementOwnsCanvas: boolean;
    tool: EditorTool;
    cellSymbolLayoutEnabled: boolean;
  };
  actions: {
    beginInstanceMove: (
      event: ReactPointerEvent<SVGElement>,
      instanceId: string,
      hitTarget: SVGElement,
    ) => void;
    beginVisualSelectionMove: (
      event: ReactPointerEvent<SVGElement>,
      selection: VisualSelection,
      hitTarget: SVGElement,
    ) => void;
    beginAnnotationDrag: (
      event: ReactPointerEvent<SVGElement>,
      annotation: Annotation,
      hitTarget: SVGElement,
    ) => void;
    handleRoutePointerDown: (
      event: ReactPointerEvent<SVGElement>,
      routeId: string,
      hitTarget: SVGElement,
    ) => void;
    beginDraftingDrag: (
      event: ReactPointerEvent<SVGElement>,
      object: DraftingObject,
      hitTarget: SVGElement,
    ) => void;
    beginDraftingGroupMove: (
      event: ReactPointerEvent<SVGElement>,
      object: DraftingObject,
      hitTarget: SVGElement,
    ) => boolean;
    selectEndpoint: (endpoint: WireSource) => void;
    endpointStatusLabel: (endpoint: WireSource) => string;
    setStatus: (status: string) => void;
    /**
     * Offer the press to an armed verb (rotate/copy/move/delete pressed
     * before a target). Returns true when the verb consumed the hit.
     */
    consumeArmedVerb?: (kind: string, id: string) => boolean;
  };
}

/** Rank the visible hit stack and hand one press to its owning domain. */
export function createCanvasHitController({
  model: {
    document,
    visibleEndpoints,
    selection,
    selectedInternalRouteIds,
    selectedInternalJunctionIds,
    selectedInternalObjectIds,
  },
  session: {
    getInteractionKind,
    placementOwnsCanvas,
    tool,
    cellSymbolLayoutEnabled,
  },
  actions: {
    beginInstanceMove,
    beginVisualSelectionMove,
    beginAnnotationDrag,
    handleRoutePointerDown,
    beginDraftingDrag,
    beginDraftingGroupMove,
    selectEndpoint,
    endpointStatusLabel,
    setStatus,
    consumeArmedVerb,
  },
}: CanvasHitControllerDependencies) {
  const compositeSelectionOwnsHit = (
    kind: "instance" | "instance-label" | "annotation" | "route" | "junction",
    id: string,
  ): boolean => {
    const hasCompositeSelection =
      selection.instanceIds.length +
        selection.routeIds.length +
        selection.junctionIds.length +
        selection.annotationIds.length +
        selection.draftingIds.length >
      1;
    if (!hasCompositeSelection) return false;
    if (kind === "instance" || kind === "instance-label") {
      return selection.instanceIds.includes(id);
    }
    if (kind === "route") {
      return (
        selection.routeIds.includes(id) || selectedInternalRouteIds.has(id)
      );
    }
    if (kind === "junction") {
      return (
        selection.junctionIds.includes(id) ||
        selectedInternalJunctionIds.has(id)
      );
    }
    const annotation = document.annotations.find(
      (candidate) => candidate.id === id,
    );
    return Boolean(
      selection.annotationIds.includes(id) ||
      (annotation?.anchor.kind === "object" &&
        (selection.instanceIds.includes(annotation.anchor.objectId) ||
          selectedInternalObjectIds.has(annotation.anchor.objectId))),
    );
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (placementOwnsCanvas) return;
    if (getInteractionKind() === "moving-selection") {
      const primaryInstanceId = selection.instanceIds.at(-1);
      if (primaryInstanceId) {
        beginInstanceMove(event, primaryInstanceId, event.currentTarget);
      } else {
        beginVisualSelectionMove(event, selection, event.currentTarget);
      }
      return;
    }
    if (tool !== "pointer" || event.button !== 0) return;
    if (
      cellSymbolLayoutEnabled &&
      (event.target as Element).closest(
        '[data-testid="cell-symbol-layout-overlay"]',
      )
    ) {
      return;
    }
    // Handles outrank the scene even when another hit surface is above their
    // SVG element, such as a power-rail endpoint under its Junction circle.
    // The buried-wire warning span joins them: it exists precisely because
    // the symbol's hit box sits over the wire, so the span must win the
    // point or the wire underneath could never be picked.
    const handleAtPoint = event.currentTarget.ownerDocument
      .elementsFromPoint(event.clientX, event.clientY)
      .some((element) =>
        element.closest(".draft-handle, .route-handle, .wire-under-symbol-hit"),
      );
    if (handleAtPoint) return;
    const hit = resolveCanvasHitAtPoint(
      event.currentTarget.ownerDocument,
      { x: event.clientX, y: event.clientY },
      event.altKey ? 1 : 0,
    );
    if (!hit || hit.kind === "handle") return;
    const hitTarget = hit.element as SVGElement;
    event.preventDefault();
    event.stopPropagation();

    // An armed verb (rotate/copy/move/delete pressed first) owns the click:
    // the pointed-at object is acted on instead of picked up or selected.
    if (consumeArmedVerb?.(hit.kind, hit.id)) return;

    if (
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (hit.kind === "instance" ||
        hit.kind === "instance-label" ||
        hit.kind === "annotation" ||
        hit.kind === "route" ||
        hit.kind === "junction") &&
      compositeSelectionOwnsHit(hit.kind, hit.id)
    ) {
      const primaryInstanceId = selection.instanceIds.at(-1);
      if (primaryInstanceId) {
        beginInstanceMove(event, primaryInstanceId, hitTarget);
        return;
      }
      // Route/Junction/Annotation-only marquees still move as one body.
      const movePlan = planSelectionMove(document, selection);
      if (movePlan.previewObjectIds.length > 0) {
        beginVisualSelectionMove(event, selection, hitTarget);
        return;
      }
    }

    if (hit.kind === "instance") {
      beginInstanceMove(event, hit.id, hitTarget);
      return;
    }
    if (hit.kind === "annotation") {
      const annotation = document.annotations.find(
        (candidate) => candidate.id === hit.id,
      );
      if (annotation) beginAnnotationDrag(event, annotation, hitTarget);
      return;
    }
    if (hit.kind === "route") {
      handleRoutePointerDown(event, hit.id, hitTarget);
      return;
    }
    if (hit.kind === "drafting") {
      const object = document.drafting?.objects.find(
        (candidate) => candidate.id === hit.id,
      );
      if (object && !beginDraftingGroupMove(event, object, hitTarget)) {
        beginDraftingDrag(event, object, hitTarget);
      }
      return;
    }
    const endpoint = visibleEndpoints.find(
      (candidate) =>
        candidate.endpoint.kind === "junction" &&
        candidate.endpoint.junctionId === hit.id,
    );
    if (endpoint) {
      selectEndpoint(endpoint);
      setStatus(`Selected ${endpointStatusLabel(endpoint)}`);
    }
  };

  return { compositeSelectionOwnsHit, handlePointerDown };
}
