import type { CanvasHit, CanvasHitKind } from "./canvas-hit-resolver";

/**
 * Who owns one press on the canvas.
 *
 * A press used to be settled by five places at once — the background gesture
 * classifier, this capture-phase dispatcher, three element-level React
 * handlers, and the wire controller — and correctness rested on the capture
 * phase calling `stopPropagation` before the target phase could run. Every
 * fix in this layer had to re-derive the whole order from scratch, which is
 * why #407, #436, #438 and #490 all landed here within three weeks.
 *
 * Ownership is now decided in one pure function. It reads facts and returns
 * an action; it touches no DOM, starts no drag, and knows nothing about
 * React. The caller executes the action, and every branch below is a case a
 * test can name.
 */
export interface PointerDownFacts {
  /** 0 primary, 1 middle, 2 secondary — as `PointerEvent.button` reports. */
  readonly button: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** The pointer tool; anything but "pointer" is a drawing tool. */
  readonly tool: string;
  readonly interactionKind: string;
  /** A component is being placed, so the canvas belongs to placement. */
  readonly placementOwnsCanvas: boolean;
  /** The press landed inside the Cell symbol layout overlay. */
  readonly cellSymbolLayoutTarget: boolean;
  /**
   * A drag handle, route handle, or buried-wire span lies under the point.
   * Handles outrank the scene even when another surface paints above them.
   */
  readonly handleAtPoint: boolean;
  /** The ranked, Alt-cycled hit, or null where nothing claims the point. */
  readonly hit: CanvasHit | null;
  /** The hit belongs to a selection of more than one object. */
  readonly compositeSelectionOwnsHit: boolean;
  /** That composite selection has something a move could preview. */
  readonly compositeMovePlanHasPreview: boolean;
  /** Last-selected Instance, which leads a group move. */
  readonly primaryInstanceId: string | null;
  /** A verb (rotate/copy/move/delete) was armed before a target was picked. */
  readonly armedVerbConsumesHit: boolean;
}

export type PointerDownAction =
  | { readonly kind: "ignore"; readonly reason: string }
  | { readonly kind: "handle-passthrough" }
  | { readonly kind: "gesture-passthrough" }
  | {
      readonly kind: "consume-armed-verb";
      readonly hitKind: CanvasHitKind;
      readonly id: string;
    }
  | {
      readonly kind: "simulation-pick";
      readonly hitKind: CanvasHitKind;
      readonly id: string;
    }
  | { readonly kind: "begin-instance-move"; readonly instanceId: string }
  | { readonly kind: "begin-visual-selection-move" }
  | { readonly kind: "begin-annotation-drag"; readonly annotationId: string }
  | { readonly kind: "route-pointer-down"; readonly routeId: string }
  | { readonly kind: "begin-drafting-drag"; readonly draftingId: string }
  | { readonly kind: "select-junction"; readonly junctionId: string };

/** Kinds a composite selection can carry as one body. */
const COMPOSITE_KINDS: readonly CanvasHitKind[] = [
  "instance",
  "instance-label",
  "annotation",
  "route",
  "junction",
];

export function resolvePointerDownAction(
  facts: PointerDownFacts,
): PointerDownAction {
  if (facts.placementOwnsCanvas) {
    return { kind: "ignore", reason: "placement owns the canvas" };
  }

  // A move already in flight commits on the next press wherever it lands.
  if (facts.interactionKind === "moving-selection") {
    return facts.primaryInstanceId
      ? { kind: "begin-instance-move", instanceId: facts.primaryInstanceId }
      : { kind: "begin-visual-selection-move" };
  }

  // The middle button is the gesture controller's alone: it pans, and on a
  // release without a drag it cycles the wire corner. That rule used to be
  // written twice, once here and once in the wire controller.
  if (facts.button === 1) return { kind: "gesture-passthrough" };

  if (facts.button !== 0) return { kind: "gesture-passthrough" };

  // A drawing tool owns its own presses. Pressing a conductor, an endpoint
  // circle, or empty canvas while drawing is part of drawing, and the wire
  // controller reads the whole gesture — where the press lands, whether it
  // continues or finishes a wire, which junctions that implies. Claiming any
  // of it here changes the gesture, so this router speaks for the pointer
  // tool only, and every drawing press reaches its target untouched.
  if (facts.tool !== "pointer") return { kind: "gesture-passthrough" };

  if (facts.cellSymbolLayoutTarget) {
    return { kind: "ignore", reason: "Cell symbol layout overlay" };
  }
  if (facts.handleAtPoint) return { kind: "handle-passthrough" };

  const hit = facts.hit;
  if (!hit) return { kind: "ignore", reason: "no hit under the pointer" };
  if (hit.kind === "handle") return { kind: "handle-passthrough" };

  // An armed verb owns the press: the pointed-at object is acted on rather
  // than picked up or selected.
  if (facts.armedVerbConsumesHit) {
    return { kind: "consume-armed-verb", hitKind: hit.kind, id: hit.id };
  }

  // A press inside a multi-object selection moves the whole body, unless a
  // modifier says the person is composing the selection instead.
  const plainPress = !facts.shiftKey && !facts.ctrlKey && !facts.metaKey;
  if (
    plainPress &&
    COMPOSITE_KINDS.includes(hit.kind) &&
    facts.compositeSelectionOwnsHit
  ) {
    if (facts.primaryInstanceId) {
      return {
        kind: "begin-instance-move",
        instanceId: facts.primaryInstanceId,
      };
    }
    if (facts.compositeMovePlanHasPreview) {
      return { kind: "begin-visual-selection-move" };
    }
    // Nothing to preview: fall through and let the hit answer for itself.
  }

  switch (hit.kind) {
    case "instance":
      return { kind: "begin-instance-move", instanceId: hit.id };
    case "annotation":
      return { kind: "begin-annotation-drag", annotationId: hit.id };
    case "route":
      return { kind: "route-pointer-down", routeId: hit.id };
    case "drafting":
      return { kind: "begin-drafting-drag", draftingId: hit.id };
    case "junction":
      return { kind: "select-junction", junctionId: hit.id };
    default:
      // An Instance label is drawn by its owner and has no press of its own.
      return { kind: "ignore", reason: `no owner for ${hit.kind}` };
  }
}
