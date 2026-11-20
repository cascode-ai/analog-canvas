// Canvas gestures and reads the manual editing specs share: Route clicks,
// points and ink, drags, C copies, the selection shelf and rich-text selection,
// and the small document pieces their Projects are built from.

import {
  createEmptyProject,
  createRoutePath,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { clickDrawTool, revealPropertiesShelf } from "./editor-fixtures.js";

type Junction = SchematicDocument["junctions"][number];

/** An unrotated, unmirrored Instance of `symbolId` placed at (x, y). */
export function placedInstance(
  id: string,
  symbolId: string,
  x: number,
  y: number,
): SchematicDocument["instances"][number] {
  return {
    id,
    symbolId,
    placement: { position: { x, y }, rotation: 0, mirror: "none" },
  };
}

/** A searchable, widely spaced cell large enough to exercise a local camera. */
export function largeCameraProject() {
  const project = createEmptyProject("large-cell-camera", "Large Cell");
  project.documents[0]!.instances = Array.from({ length: 640 }, (_, i) => ({
    ...placedInstance(
      `R${i + 1}`,
      "resistor",
      (i % 32) * 200,
      Math.floor(i / 32) * 220,
    ),
    reference: `R${i + 1}`,
  }));
  return project;
}

export async function findCanvasInstance(page: Page, id: string) {
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Control+f");
  await page.getByTestId("project-search-input").fill(id);
  await page.getByTestId("project-search-result-" + id).click();
  await expect(page.getByTestId("hit-" + id)).toHaveClass(/selected/);
}

/** A Junction anchoring a Route end at (x, y). */
export function routeAnchor(
  id: string,
  netId: string,
  x: number,
  y: number,
): Junction {
  return { id, netId, position: { x, y }, role: "route-anchor" };
}

/** A straight manual Route between two Junctions. */
export function junctionRoute(
  id: string,
  netId: string,
  startJunctionId: string,
  endJunctionId: string,
) {
  return createRoutePath({
    id,
    netId,
    start: { kind: "junction", junctionId: startJunctionId },
    end: { kind: "junction", junctionId: endJunctionId },
    bends: [],
    modes: ["manual"],
  });
}

/** Adds the start Junction's Net, both Junctions and a straight Wire between. */
export function addStraightWire(
  document: SchematicDocument,
  routeId: string,
  start: Junction,
  end: Junction,
): void {
  document.nets.push({ id: start.netId, terminals: [] });
  document.junctions.push(start, end);
  document.routes.push(junctionRoute(routeId, start.netId, start.id, end.id));
}

/**
 * Where document points are on screen, through the canvas's own screen CTM:
 * the transform the editor inverts to read every pointer. A rendered bounding
 * box would count the hit polylines' 14px non-scaling stroke.
 */
export async function onScreen<const T extends readonly Point[]>(
  canvas: Locator,
  points: T,
): Promise<{ [K in keyof T]: Point }> {
  const screen = await canvas.evaluate(
    (element, logical) => {
      const matrix = (element as SVGSVGElement).getScreenCTM();
      if (!matrix) return null;
      return logical.map((point) => {
        const mapped = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        return { x: mapped.x, y: mapped.y };
      });
    },
    points as readonly Point[],
  );
  if (!screen) throw new Error("Canvas geometry is not measurable");
  return screen as { [K in keyof T]: Point };
}

/** The middle of a measured box. */
export function centre(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The Route id a route hit carries in its test id. */
export async function routeIdOf(hit: Locator): Promise<string> {
  const testId = await hit.getAttribute("data-testid");
  if (!testId) throw new Error("Route has no test id");
  return testId.replace(/^route-hit-/u, "");
}

/** With the wire tool active, wires pin `from` to pin `to`, then Escape. */
export async function wirePins(
  page: Page,
  from: string,
  to: string,
): Promise<void> {
  await page.getByTestId(`terminal-${from}`).click();
  await page.getByTestId(`terminal-${to}`).click();
  await page.keyboard.press("Escape");
}

/** Arms the wire tool and wires pin `from` to pin `to`, then Escape. */
export async function drawWire(
  page: Page,
  from: string,
  to: string,
): Promise<void> {
  await clickDrawTool(page, "wire");
  await wirePins(page, from, to);
}

/** The points of a drawn polyline, such as a Route or the wire preview. */
export async function polylinePoints(polyline: Locator): Promise<Point[]> {
  return polyline.evaluate((element) =>
    Array.from((element as SVGPolylineElement).points).map(({ x, y }) => ({
      x,
      y,
    })),
  );
}

/** The points of a drawn polyline or polygon, through its own screen CTM. */
export async function screenPoints(shape: Locator): Promise<Point[]> {
  const points = await shape.evaluate((element) => {
    const matrix = (element as SVGGraphicsElement).getScreenCTM();
    if (!matrix) return null;
    return Array.from((element as SVGPolylineElement).points, (point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  });
  if (!points) throw new Error("Shape is not measurable");
  return points;
}

/** The on-screen point `position` of the way along one segment of a shape. */
export async function segmentPoint(
  shape: Locator,
  position = 0.5,
  segmentIndex = 0,
): Promise<Point> {
  const points = await screenPoints(shape);
  const first = points[segmentIndex];
  const second = points[segmentIndex + 1];
  if (!first || !second) throw new Error("Segment is not measurable");
  return {
    x: first.x + (second.x - first.x) * position,
    y: first.y + (second.y - first.y) * position,
  };
}

/**
 * Hold until the canvas has stopped moving under the pointer.
 *
 * Panel toggles animate the workspace grid, and the canvas keeps growing into
 * the freed column for the whole transition: the drawing slides sideways and
 * the document-to-pixel scale climbs as it goes. The aria attribute a toggle
 * flips is set on the click, not at the end of that animation, so a pixel-
 * exact gesture measured straight afterwards aims at where the drawing WAS.
 */
export async function awaitCanvasSettled(canvas: Locator): Promise<void> {
  await canvas.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const svg = element as SVGSVGElement;
        const read = () => {
          const matrix = svg.getScreenCTM();
          return matrix
            ? `${matrix.a} ${matrix.d} ${matrix.e} ${matrix.f}`
            : "";
        };
        let previous = read();
        let stillFrames = 0;
        const step = () => {
          const current = read();
          stillFrames = current === previous ? stillFrames + 1 : 0;
          previous = current;
          if (stillFrames >= 3) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
}

/** The ids of the component instances drawn on the canvas, in paint order. */
export async function instanceIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-canvas-hit-kind="instance"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-canvas-hit-id")!),
    );
}

export async function clickRoute(
  page: Page,
  routeId: string,
  position = 0.5,
  segmentIndex = 0,
  screenOffset = { x: 0, y: 0 },
): Promise<void> {
  const point = await segmentPoint(
    page.getByTestId(`route-hit-${routeId}`),
    position,
    segmentIndex,
  );
  await page.mouse.click(point.x + screenOffset.x, point.y + screenOffset.y);
}

/**
 * The paint a Route's run is drawn with.
 *
 * A conductor run is one shape however many Routes it is stored as, so a
 * Route's colour and dash live on the shape carrying its subpath rather than
 * on the element that carries its identity.
 */
export async function routeInk(
  page: Page,
  routeId: string,
  attribute: "stroke" | "stroke-dasharray",
): Promise<string | null> {
  return page.evaluate(
    ([id, name]) => {
      const identity = window.document.querySelector(
        `[data-layer="routes"] [data-object-id="${id}"]`,
      ) as SVGPolylineElement | null;
      if (!identity) return null;
      const subpath = `M ${Array.from(identity.points)
        .map((point) => `${point.x} ${point.y}`)
        .join(" L ")}`;
      const ink = [
        ...window.document.querySelectorAll(
          '[data-layer="routes"] [data-role="conductor-ink"]',
        ),
      ].find((path) => (path.getAttribute("d") ?? "").includes(subpath));
      return ink?.getAttribute(name!) ?? null;
    },
    [routeId, attribute] as const,
  );
}

export async function readRoutePoints(page: Page, routeId: string) {
  return polylinePoints(
    page.locator(`[data-layer="routes"] [data-object-id="${routeId}"]`),
  );
}

export async function dragBy(
  locator: Locator,
  delta: { x: number; y: number },
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Drag target is not measurable");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await locator.page().mouse.move(start.x, start.y);
  await locator.page().mouse.down();
  await locator.page().mouse.move(start.x + delta.x, start.y + delta.y, {
    steps: 4,
  });
  await locator.page().mouse.up();
}

/**
 * Copies the selection with C, or with `keys` such as Ctrl/Cmd+C then V (the
 * clipboard path, which keeps authored label text), and places one copy.
 */
export async function copySelectionAt(
  page: Page,
  position: { x: number; y: number },
  keys = ["c"],
): Promise<void> {
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  for (const key of keys) await page.keyboard.press(key);
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
}

export async function closeSelectionShelf(page: Page): Promise<void> {
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "true") {
    await shelf.click();
  }
}

export async function selectRichTextOffsets(
  editable: Locator,
  start: number,
  end: number,
): Promise<void> {
  await editable.evaluate(
    (root, offsets) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) nodes.push(node as Text);

      const boundary = (offset: number, isEnd: boolean): [Text, number] => {
        let consumed = 0;
        for (const text of nodes) {
          const next = consumed + text.data.length;
          if (
            (isEnd && offset <= next) ||
            (!isEnd && (offset < next || text === nodes.at(-1)))
          ) {
            return [
              text,
              Math.max(0, Math.min(text.data.length, offset - consumed)),
            ];
          }
          consumed = next;
        }
        throw new Error("Rich-text selection offset is outside the editor");
      };

      const [startNode, startOffset] = boundary(offsets.start, false);
      const [endNode, endOffset] = boundary(offsets.end, true);
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      root.dispatchEvent(new Event("select", { bubbles: true }));
    },
    { start, end },
  );
}
