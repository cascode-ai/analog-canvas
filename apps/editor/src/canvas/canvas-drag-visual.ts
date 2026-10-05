import type { Point } from "@icm/model";

export interface CanvasDragVisual {
  translate(delta: Point): void;
  translateObject(objectId: string, delta: Point): void;
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

/** The paint a Route's own polyline borrows from its ink while it is dragged. */
const INK_PAINT = [
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-miterlimit",
] as const;

/** A polyline's points as the ink spells the same run: `M x y L x y …`. */
function inkRun(points: string): string {
  return `M ${points
    .trim()
    .split(/\s+/)
    .map((point) => point.replace(",", " "))
    .join(" L ")}`;
}

/** The vertices of one `M … L …` subpath, as `x y` pairs. */
function inkVertices(subpath: string): string[] {
  const numbers = subpath.replace(/[ML]/g, " ").trim().split(/\s+/);
  const vertices: string[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2)
    vertices.push(`${numbers[index]} ${numbers[index + 1]}`);
  return vertices;
}

/**
 * Conductors of one paint are stroked as a single shape, and each Route keeps
 * an unpainted polyline carrying its id and points (#926). A drag moves only
 * that polyline, which left the visible wire behind until the drop. For the
 * length of the drag, each dragged Route's run leaves the shared ink, with
 * the small miters that join its two ends, and its own polyline is painted
 * with the ink's paint instead. `restore` puts both back.
 */
function takeOverRouteInk(root: ParentNode, saved: readonly SavedElement[]) {
  const routes = saved.filter(
    (item) =>
      item.points !== null &&
      item.element.getAttribute("data-net-id") !== null &&
      item.element.getAttribute("stroke") === "none",
  );
  const inks = routes.length
    ? Array.from(root.querySelectorAll('[data-role="conductor-ink"]')).filter(
        (element) => element.getAttribute("data-role") === "conductor-ink",
      )
    : [];
  const originalInk = new Map<Element, string>();
  const painted = new Map<Element, Map<string, string | null>>();
  if (inks.length > 0) {
    const runs = new Set(
      Array.from(root.querySelectorAll("[data-net-id][points]")).flatMap(
        (element) => {
          const points = element.getAttribute("points");
          return points ? [inkRun(points)] : [];
        },
      ),
    );
    for (const item of routes) {
      const run = inkRun(item.points!);
      const ends = [inkVertices(run)[0], inkVertices(run).at(-1)];
      const ink = inks.find((candidate) =>
        (candidate.getAttribute("d") ?? "").split(/ (?=M )/).includes(run),
      );
      if (!ink) continue;
      const d = ink.getAttribute("d") ?? "";
      if (!originalInk.has(ink)) originalInk.set(ink, d);
      ink.setAttribute(
        "d",
        d
          .split(/ (?=M )/)
          .filter(
            (subpath) =>
              subpath !== run &&
              // A miter joining this Route's end: any ink there that is not
              // itself another Route's run.
              !(
                !runs.has(subpath) &&
                inkVertices(subpath).some((vertex) => ends.includes(vertex))
              ),
          )
          .join(" "),
      );
      const before = new Map<string, string | null>();
      for (const name of INK_PAINT) {
        before.set(name, item.element.getAttribute(name));
        const value = ink.getAttribute(name);
        if (value === null) item.element.removeAttribute(name);
        else item.element.setAttribute(name, value);
      }
      painted.set(item.element, before);
    }
  }
  return {
    restore() {
      for (const [ink, d] of originalInk) ink.setAttribute("d", d);
      for (const [element, saved] of painted)
        for (const [name, value] of saved) {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        }
    },
  };
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
  const routeInk = takeOverRouteInk(root, saved);
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
      routeInk.restore();
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
