// Canvas gestures and reads the manual editing specs share: Route clicks,
// points and ink, drags, C copies, the selection shelf and rich-text selection.

import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { revealPropertiesShelf } from "./editor-fixtures.js";

export async function clickRoute(
  page: Page,
  routeId: string,
  position = 0.5,
  segmentIndex = 0,
): Promise<void> {
  const route = page.getByTestId(`route-hit-${routeId}`);
  const point = await route.evaluate(
    (element, options) => {
      const polyline = element as SVGPolylineElement;
      const first = polyline.points.getItem(options.segmentIndex);
      const second = polyline.points.getItem(options.segmentIndex + 1);
      const matrix = polyline.getScreenCTM();
      if (!first || !second || !matrix) return null;
      const local = new DOMPoint(
        first.x + (second.x - first.x) * options.position,
        first.y + (second.y - first.y) * options.position,
      );
      const screen = local.matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    },
    { position, segmentIndex },
  );
  if (!point) throw new Error(`Route ${routeId} is not measurable`);
  await page.mouse.click(point.x, point.y);
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
  return page
    .locator(`[data-layer="routes"] [data-object-id="${routeId}"]`)
    .evaluate((element) => {
      const polyline = element as SVGPolylineElement;
      return Array.from(polyline.points).map((point) => ({
        x: point.x,
        y: point.y,
      }));
    });
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

export async function copySelectionAt(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.keyboard.press("c");
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
