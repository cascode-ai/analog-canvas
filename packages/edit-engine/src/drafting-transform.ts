import { snapGridPoint } from "@icm/model";
import type { DraftingObject, GridPoint, VisualAnchor } from "@icm/model";

/**
 * Move a drafting object by a delta.
 *
 * Drafting objects carry no connectivity, so moving one is a pure coordinate
 * transform on the model. It lives in the engine because both the editor's
 * drag and the paste planner need it, and a planner may not reach into an
 * editor feature for it.
 */
function translatePoint(
  point: GridPoint,
  delta: GridPoint,
  _grid: number,
): GridPoint {
  // Translation preserves an object's relative fine placement: annotation
  // pitch can be finer than the Document grid, so only integer precision is
  // restored here — the delta itself carries the grid discipline.
  return snapGridPoint({ x: point.x + delta.x, y: point.y + delta.y }, 1);
}

function translateFreeAnchor<T extends VisualAnchor>(
  anchor: T,
  delta: GridPoint,
  grid: number,
): T {
  return anchor.kind === "free"
    ? ({
        ...anchor,
        position: translatePoint(anchor.position, delta, grid),
      } as T)
    : anchor;
}

export function translateDraftingObject(
  object: DraftingObject,
  delta: GridPoint,
  grid: number,
): DraftingObject {
  if (object.kind === "construction-line") {
    return {
      ...object,
      anchor: translateFreeAnchor(object.anchor, delta, grid),
      points: object.points.map((point) => translatePoint(point, delta, grid)),
      curveControls: object.curveControls?.map((point) =>
        point ? translatePoint(point, delta, grid) : null,
      ),
    };
  }
  if (object.kind === "arrow") {
    return {
      ...object,
      anchor: translateFreeAnchor(object.anchor, delta, grid),
      from: translateFreeAnchor(object.from, delta, grid),
      to: translateFreeAnchor(object.to, delta, grid),
      waypoints: object.waypoints?.map((point) =>
        translatePoint(point, delta, grid),
      ),
      curveControls: object.curveControls?.map((point) =>
        point ? translatePoint(point, delta, grid) : null,
      ),
    };
  }
  if (object.kind === "rectangle") {
    const center = translatePoint(object.center, delta, grid);
    return { ...object, center, anchor: { kind: "free", position: center } };
  }
  if (object.kind === "circle") {
    const center = translatePoint(object.center, delta, grid);
    return { ...object, center, anchor: { kind: "free", position: center } };
  }
  return {
    ...object,
    anchor: translateFreeAnchor(object.anchor, delta, grid),
  };
}
