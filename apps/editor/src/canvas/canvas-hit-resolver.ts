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

const KIND_PRIORITY: Record<CanvasHitKind, number> = {
  handle: 70,
  instance: 60,
  route: 55,
  junction: 50,
  annotation: 45,
  "instance-label": 44,
  drafting: 40,
};
const SELECTED_BONUS = 25;

function readHit(element: Element): CanvasHit | null {
  const kind = element.getAttribute(
    "data-canvas-hit-kind",
  ) as CanvasHitKind | null;
  const id = element.getAttribute("data-canvas-hit-id");
  if (!kind || !id || !(kind in KIND_PRIORITY)) return null;
  return {
    kind,
    id,
    selected: element.classList.contains("selected"),
    element,
  };
}

/**
 * Resolve once at pointer-down. `elements` must be in paint order (topmost
 * first), as returned by `document.elementsFromPoint()`.
 */
export function rankCanvasHits(elements: readonly Element[]): CanvasHit[] {
  const hits = elements
    .map(readHit)
    .filter((hit): hit is CanvasHit => hit !== null);
  const unique = hits.filter(
    (hit, index) =>
      hits.findIndex(
        (candidate) => candidate.kind === hit.kind && candidate.id === hit.id,
      ) === index,
  );
  return unique
    .map((hit, paintIndex) => ({
      hit,
      paintIndex,
      score: KIND_PRIORITY[hit.kind] + (hit.selected ? SELECTED_BONUS : 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.paintIndex - right.paintIndex,
    )
    .map(({ hit }) => hit);
}

export function resolveCanvasHit(
  elements: readonly Element[],
  cycle = 0,
): CanvasHit | null {
  const hits = rankCanvasHits(elements);
  if (hits.length === 0) return null;
  return hits[Math.min(Math.max(0, cycle), hits.length - 1)]!;
}

export function resolveCanvasHitAtPoint(
  owner: { elementsFromPoint?(x: number, y: number): Element[] },
  client: { x: number; y: number },
  cycle = 0,
): CanvasHit | null {
  return resolveCanvasHit(
    owner.elementsFromPoint?.(client.x, client.y) ?? [],
    cycle,
  );
}
