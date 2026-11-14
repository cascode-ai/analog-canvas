import type { ResolvedDrawingScene } from "@icm/derived";
import type { DrawingOrderEntry, Point } from "@icm/model";

export type CanvasHitKind =
  | "handle"
  | "annotation"
  | "instance-label"
  | "instance"
  | "drafting"
  | "route"
  | "junction";

export interface CanvasHit {
  kind: CanvasHitKind;
  id: string;
  selected: boolean;
  element: Element;
}

function drawingEntryForHit(hit: CanvasHit): DrawingOrderEntry | null {
  switch (hit.kind) {
    case "handle":
      return null;
    case "route":
    case "junction":
      return { kind: "electrical" };
    case "instance":
    case "drafting":
      return { kind: hit.kind, id: hit.id };
    case "annotation":
    case "instance-label":
      return { kind: "annotation", id: hit.id };
  }
}

export interface CanvasHitPresentation {
  scene: ResolvedDrawingScene;
  point: Point;
  includeOccluded?: boolean;
}

export function isCanvasHitVisible(
  hit: CanvasHit,
  { scene, point }: CanvasHitPresentation,
): boolean {
  const entry = drawingEntryForHit(hit);
  return entry === null || scene.isVisibleAt(entry, point);
}

// Thin electrical targets outrank the symbol's blank bounding box: a route
// or junction hit means the pointer is on the wire stroke or the dot itself,
// while an instance hit only means it is somewhere inside the hit rectangle.
// A deliberate click on visible wire beside or under a body therefore selects
// the wire; the symbol stays one cycle-click away, and a selected symbol's
// stickiness bonus keeps drags over crossing wires on the symbol.
const KIND_PRIORITY: Record<CanvasHitKind, number> = {
  handle: 70,
  // Visible annotation text owns a direct press over a conductor. A Net
  // label commonly sits only 8 units off its wire, so its lower hit area and
  // the route's non-scaling hit stroke overlap. Ranking the route first made
  // a drag from the lower half of the text move the wire instead of the label.
  annotation: 64,
  route: 62,
  junction: 61,
  instance: 60,
  "instance-label": 44,
  drafting: 40,
};
const SELECTED_BONUS = 25;

export function canvasHitFromElement(element: Element): CanvasHit | null {
  const hitElement =
    element.closest?.("[data-canvas-hit-kind][data-canvas-hit-id]") ?? element;
  const kind = hitElement.getAttribute(
    "data-canvas-hit-kind",
  ) as CanvasHitKind | null;
  const id = hitElement.getAttribute("data-canvas-hit-id");
  if (!kind || !id || !(kind in KIND_PRIORITY)) return null;
  return {
    kind,
    id,
    selected: hitElement.classList.contains("selected"),
    element: hitElement,
  };
}

/**
 * Resolve once at pointer-down. `elements` must be in paint order (topmost
 * first), as returned by `document.elementsFromPoint()`.
 */
export function rankCanvasHits(
  elements: readonly Element[],
  accepts: (hit: CanvasHit) => boolean = () => true,
  presentation?: CanvasHitPresentation,
): CanvasHit[] {
  const hits = elements
    .map(canvasHitFromElement)
    .filter((hit): hit is CanvasHit => hit !== null)
    .filter(accepts);
  const unique = hits
    .filter(
      (hit, index) =>
        hits.findIndex(
          (candidate) => candidate.kind === hit.kind && candidate.id === hit.id,
        ) === index,
    )
    .map((hit, paintIndex) => ({
      hit,
      paintIndex,
      visible: !presentation || isCanvasHitVisible(hit, presentation),
    }))
    .filter(({ visible }) => visible || presentation?.includeOccluded);
  const visibleAnnotationAtPoint = unique.some(
    ({ hit, visible }) => visible && hit.kind === "annotation",
  );
  return unique
    .map(({ hit, paintIndex, visible }) => ({
      hit,
      paintIndex,
      visible,
      drawingRank:
        presentation?.scene.rank(
          drawingEntryForHit(hit) ?? { kind: "circuit-marks" },
        ) ?? 0,
      // Selection stickiness must not let a broad symbol box or wire hit
      // stroke mask visible annotation text. Handles still outrank text by
      // their base priority; Alt continues to cycle to the geometry below.
      score:
        KIND_PRIORITY[hit.kind] +
        (hit.selected &&
        !presentation?.includeOccluded &&
        (!visibleAnnotationAtPoint || hit.kind === "annotation")
          ? SELECTED_BONUS
          : 0),
    }))
    .sort(
      (left, right) =>
        Number(right.visible) - Number(left.visible) ||
        right.score - left.score ||
        right.drawingRank - left.drawingRank ||
        left.paintIndex - right.paintIndex,
    )
    .map(({ hit }) => hit);
}

/**
 * A hit radius that stays the same size on screen at any zoom.
 *
 * Endpoint and Junction circles carried a radius in document units, so
 * zooming out shrank them on screen until a Junction was barely clickable —
 * while the route hit band beside them is 14 screen pixels and never
 * changes, because CSS gives it a non-scaling stroke. A circle's radius has
 * no such CSS, so the conversion happens here: the viewBox width against the
 * width one hundred percent zoom shows is exactly the document-units-per-
 * pixel factor the zoom readout already reports.
 */
export function screenScaleHitRadius(
  viewBoxWidth: number,
  referenceWidth: number,
  pixels: number,
): number {
  if (!(viewBoxWidth > 0) || !(referenceWidth > 0)) return pixels;
  return (pixels * viewBoxWidth) / referenceWidth;
}
