import { expect, test, type Page } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures";

async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
}

async function instanceIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-canvas-hit-kind="instance"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-canvas-hit-id")!),
    );
}

function routePoints(page: Page) {
  return page
    .locator('[data-canvas-hit-kind="route"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("points")),
    );
}

const META = 4; // CDP Input modifier bitmask (Cmd; macOS turns Ctrl+left into a right press)

/**
 * Playwright's high-level mouse API cannot attach keyboard modifiers to
 * pointer events, so the detach drag goes through the raw CDP input
 * pipeline. Cmd stands in for Ctrl because macOS converts Ctrl+left-press
 * into a right-button press before the page sees it.
 */
async function ctrlDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from.x,
    y: from.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: META,
  });
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
      button: "left",
      buttons: 1,
      modifiers: META,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to.x,
    y: to.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers: META,
  });
  await cdp.detach();
}

test("Ctrl+drag moves only the part; its wire stays exactly in place", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 180 });
  await placeComponent(page, "resistor", { x: 300, y: 400 });
  const ids = await instanceIds(page);

  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  // Deselect so the drag targets exactly the pointed-at part.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 620, y: 420 },
  });

  const wireBefore = await routePoints(page);
  const top = page.getByTestId(`hit-${ids[0]}`);
  const before = (await top.boundingBox())!;
  const center = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  };

  await ctrlDrag(page, center, { x: center.x + 180, y: center.y });

  // The part moved; the wire kept its exact geometry on the same net.
  const after = (await top.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 100);
  const wireAfter = await routePoints(page);
  expect(wireAfter).toEqual(wireBefore);
  await expect(page.getByTestId("status")).toContainText("without its wires");
});

test("Ctrl+click without a drag still toggles selection", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 250 });
  const ids = await instanceIds(page);
  await page.getByTestId("schematic-canvas").click({
    position: { x: 600, y: 420 },
  });

  const hit = page.getByTestId(`hit-${ids[0]}`);
  const box = (await hit.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A ctrl press-release without movement is the toggle-selection click.
  await ctrlDrag(page, center, center);
  await expect(hit).toHaveClass(/selected/);

  // The part did not move.
  const settled = (await hit.boundingBox())!;
  expect(Math.abs(settled.x - box.x)).toBeLessThan(2);
});
