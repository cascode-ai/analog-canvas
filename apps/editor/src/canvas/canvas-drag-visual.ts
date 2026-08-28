import type { Point } from "@icm/model";

export interface CanvasDragVisual {
  translate(delta: Point): void;
  scale(pivot: Point, factor: number): void;
  setPolyline(points: readonly Point[]): void;
  setObjectPolyline(objectId: string, points: readonly Point[]): void;
  restore(): void;
}

interface SavedElement {
  element: Element;
  objectId: string;
  transform: string | null;
  points: string | null;
}

function pointList(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * Lightweight live feedback for a drag. Formal and overlay objects expose the
 * same drag id, so one imperative update moves the paint without rebuilding
 * the formal scene or committing document state.
 */
export function startCanvasDragVisual(
  root: ParentNode,
  objectIds: readonly string[],
): CanvasDragVisual {
  const ids = new Set(objectIds);
  const elements = Array.from(
    root.querySelectorAll("[data-object-id], [data-drag-object-id]"),
  ).filter((element) => {
    const id =
      element.getAttribute("data-drag-object-id") ??
      element.getAttribute("data-object-id");
    return id !== null && ids.has(id);
  });
  const saved: SavedElement[] = elements.map((element) => ({
    element,
    objectId:
      element.getAttribute("data-drag-object-id") ??
      element.getAttribute("data-object-id")!,
    transform: element.getAttribute("transform"),
    points: element.getAttribute("points"),
  }));

  return {
    translate(delta) {
      for (const item of saved) {
        const prefix = `translate(${delta.x} ${delta.y})`;
        item.element.setAttribute(
          "transform",
          item.transform ? `${prefix} ${item.transform}` : prefix,
        );
      }
    },
    scale(pivot, factor) {
      for (const item of saved) {
        const prefix = `translate(${pivot.x} ${pivot.y}) scale(${factor}) translate(${-pivot.x} ${-pivot.y})`;
        item.element.setAttribute(
          "transform",
          item.transform ? `${prefix} ${item.transform}` : prefix,
        );
      }
    },
    setPolyline(points) {
      const value = pointList(points);
      for (const item of saved) {
        if (item.points !== null) item.element.setAttribute("points", value);
      }
    },
    setObjectPolyline(objectId, points) {
      const value = pointList(points);
      for (const item of saved) {
        if (item.objectId === objectId && item.points !== null) {
          item.element.setAttribute("points", value);
        }
      }
    },
    restore() {
      for (const item of saved) {
        if (item.transform === null) item.element.removeAttribute("transform");
        else item.element.setAttribute("transform", item.transform);
        if (item.points === null) item.element.removeAttribute("points");
        else item.element.setAttribute("points", item.points);
      }
    },
  };
}
