import type { PointerEvent as ReactPointerEvent } from "react";

import type { WireSource } from "@icm/edit-engine";
import type { Annotation, DraftingObject, SchematicDocument } from "@icm/model";

import type { EditorTool } from "../interaction/interaction-state";
import { planSelectionMove } from "../features/selection/selection-move-plan";
import type { VisualSelection } from "../features/selection/visual-selection";
import { resolveCanvasHitAtPoint } from "./canvas-hit-resolver";
import { resolvePointerDownAction } from "./pointer-down-router";

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
    /** Swallow the click that follows a press an armed verb consumed. */
    suppressNextClick?: () => void;
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
    suppressNextClick,
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
    // The facts must describe the press as it arrived. Offering the hit to an
    // armed verb runs the verb, and a verb such as Move puts an interaction
    // in flight — so the interaction kind is read BEFORE the offer. Reading
    // it afterwards makes the router answer the press with the state its own
    // fact gathering created, which is how the armed Move first broke.
    const interactionKind = getInteractionKind();
    // Resolving the hit is free of side effects; offering it is not. The hit
    // is therefore only looked up, and only offered, on the presses this
    // dispatcher would actually claim.
    const dispatching =
      !placementOwnsCanvas &&
      interactionKind !== "moving-selection" &&
      tool === "pointer" &&
      event.button === 0 &&
      !handleAtPoint;
    const hit = dispatching
      ? resolveCanvasHitAtPoint(
          event.currentTarget.ownerDocument,
          { x: event.clientX, y: event.clientY },
          event.altKey ? 1 : 0,
        )
      : null;
    const armedVerbConsumesHit =
      hit !== null &&
      hit.kind !== "handle" &&
      Boolean(consumeArmedVerb?.(hit.kind, hit.id));
    const compositeOwnsHit = Boolean(
      hit &&
      hit.kind !== "handle" &&
      hit.kind !== "drafting" &&
      compositeSelectionOwnsHit(hit.kind, hit.id),
    );
    const primaryInstanceId = selection.instanceIds.at(-1) ?? null;
    const action = resolvePointerDownAction({
      button: event.button,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      tool,
      interactionKind,
      placementOwnsCanvas,
      cellSymbolLayoutTarget:
        cellSymbolLayoutEnabled &&
        (event.target as Element).closest(
          '[data-testid="cell-symbol-layout-overlay"]',
        ) !== null,
      handleAtPoint,
      hit,
      compositeSelectionOwnsHit: compositeOwnsHit,
      // Planning a move is not free, so it is asked for only where the
      // answer can change the outcome.
      compositeMovePlanHasPreview:
        compositeOwnsHit &&
        planSelectionMove(document, selection).previewObjectIds.length > 0,
      primaryInstanceId,
      armedVerbConsumesHit,
    });

    // Only an action this dispatcher owns claims the press; everything else
    // is left for the gesture controller or the target's own handler.
    if (
      action.kind === "ignore" ||
      action.kind === "handle-passthrough" ||
      action.kind === "gesture-passthrough"
    ) {
      return;
    }

    // A claimed hit stops here: the target-phase handlers and the browser's
    // own default must not act on the press as well.
    const hitTarget = (hit?.element ?? event.currentTarget) as SVGElement;
    if (hit) {
      event.preventDefault();
      event.stopPropagation();
    }

    switch (action.kind) {
      case "consume-armed-verb":
        // The offer already ran the verb. The click that follows this press
        // must not also land: it would re-select the object and undo it.
        suppressNextClick?.();
        return;
      case "begin-instance-move":
        beginInstanceMove(event, action.instanceId, hitTarget);
        return;
      case "begin-visual-selection-move":
        beginVisualSelectionMove(event, selection, hitTarget);
        return;
      case "begin-annotation-drag": {
        const annotation = document.annotations.find(
          (candidate) => candidate.id === action.annotationId,
        );
        if (annotation) beginAnnotationDrag(event, annotation, hitTarget);
        return;
      }
      case "route-pointer-down":
        handleRoutePointerDown(event, action.routeId, hitTarget);
        return;
      case "begin-drafting-drag": {
        const object = document.drafting?.objects.find(
          (candidate) => candidate.id === action.draftingId,
        );
        if (object && !beginDraftingGroupMove(event, object, hitTarget)) {
          beginDraftingDrag(event, object, hitTarget);
        }
        return;
      }
      case "select-junction": {
        const endpoint = visibleEndpoints.find(
          (candidate) =>
            candidate.endpoint.kind === "junction" &&
            candidate.endpoint.junctionId === action.junctionId,
        );
        if (endpoint) {
          selectEndpoint(endpoint);
          setStatus(`Selected ${endpointStatusLabel(endpoint)}`);
        }
        return;
      }
    }
  };

  return { compositeSelectionOwnsHit, handlePointerDown };
}
