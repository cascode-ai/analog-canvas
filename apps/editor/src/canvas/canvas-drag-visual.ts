import type { Point } from "@icm/model";

export interface CanvasDragVisual {
  translate(delta: Point): void;
  translateObject(objectId: string, delta: Point): void;
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

/** A label tether's line: each end moves with its own object's drag. */
interface SavedTether {
  element: Element;
  labelId: string | null;
  ownerId: string | null;
  label: Point;
  target: Point;
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
  // A tether joins a label to its owner. A drag moves one or both of them,
  // so its line stretches end by end instead of moving whole. Pressing a
  // label selects it, and its tether renders only after the drag begins, so
  // each move also takes up tethers it has not seen yet.
  const tethers = new Map<Element, SavedTether>();
  const collectTethers = (): SavedTether[] => {
    for (const element of Array.from(
      root.querySelectorAll("[data-tether-label-id], [data-tether-owner-id]"),
    )) {
      if (tethers.has(element)) continue;
      const labelId = element.getAttribute("data-tether-label-id");
      const ownerId = element.getAttribute("data-tether-owner-id");
      if (
        !(labelId !== null && ids.has(labelId)) &&
        !(ownerId !== null && ids.has(ownerId))
      )
        continue;
      tethers.set(element, {
        element,
        labelId,
        ownerId,
        label: {
          x: Number(element.getAttribute("x1")),
          y: Number(element.getAttribute("y1")),
        },
        target: {
          x: Number(element.getAttribute("x2")),
          y: Number(element.getAttribute("y2")),
        },
      });
    }
    return [...tethers.values()];
  };
  const stretch = (
    moved: (id: string | null) => Point | null,
    seen: readonly SavedTether[] = collectTethers(),
  ): void => {
    for (const tether of seen) {
      const label = moved(tether.labelId);
      const target = moved(tether.ownerId);
      tether.element.setAttribute(
        "x1",
        String(tether.label.x + (label?.x ?? 0)),
      );
      tether.element.setAttribute(
        "y1",
        String(tether.label.y + (label?.y ?? 0)),
      );
      tether.element.setAttribute(
        "x2",
        String(tether.target.x + (target?.x ?? 0)),
      );
      tether.element.setAttribute(
        "y2",
        String(tether.target.y + (target?.y ?? 0)),
      );
    }
  };

  return {
    translate(delta) {
      for (const item of saved) {
        const prefix = `translate(${delta.x} ${delta.y})`;
        item.element.setAttribute(
          "transform",
          item.transform ? `${prefix} ${item.transform}` : prefix,
        );
      }
      stretch((id) => (id !== null && ids.has(id) ? delta : null));
    },
    translateObject(objectId, delta) {
      for (const item of saved) {
        if (item.objectId !== objectId) continue;
        const prefix = `translate(${delta.x} ${delta.y})`;
        item.element.setAttribute(
          "transform",
          item.transform ? `${prefix} ${item.transform}` : prefix,
        );
      }
      for (const tether of collectTethers()) {
        if (tether.labelId === objectId) {
          tether.element.setAttribute("x1", String(tether.label.x + delta.x));
          tether.element.setAttribute("y1", String(tether.label.y + delta.y));
        }
        if (tether.ownerId === objectId) {
          tether.element.setAttribute("x2", String(tether.target.x + delta.x));
          tether.element.setAttribute("y2", String(tether.target.y + delta.y));
        }
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
      stretch(() => null, [...tethers.values()]);
      for (const item of saved) {
        if (item.transform === null) item.element.removeAttribute("transform");
        else item.element.setAttribute("transform", item.transform);
        if (item.points === null) item.element.removeAttribute("points");
        else item.element.setAttribute("points", item.points);
      }
    },
  };
}
