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

/**
 * Three resistors; the first two joined by one vertical wire. Returns the
 * instance ids and the wire's bounding box, with the third resistor left
 * unwired at (500, 330) as the drag subject.
 */
async function wiredPairWithSpare(page: Page): Promise<{
  ids: string[];
  wire: { x: number; y: number; width: number; height: number };
}> {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 200, y: 200 });
  await placeComponent(page, "resistor", { x: 200, y: 460 });
  await placeComponent(page, "resistor", { x: 500, y: 330 });
  const instances = page.locator('[data-canvas-hit-kind="instance"]');
  const ids = await instances.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-canvas-hit-id")!),
  );
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  await expect(page.getByTestId("wire-under-symbol-overlay")).toHaveCount(0);
  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const wire = (await route.boundingBox())!;
  return { ids, wire };
}

test("a component dragged over a wire paints a red warning on the covered span", async ({
  page,
}) => {
  const { ids, wire } = await wiredPairWithSpare(page);

  // Turn the third resistor sideways first: its body then lies across the
  // vertical wire while both pins sit far off the conductor, so the drop
  // buries the wire without acquiring contacts. (A pin-exact drop is the
  // series-insertion gesture and no longer leaves a buried span.)
  const third = page.getByTestId(`hit-${ids[2]}`);
  await third.click();
  await page.keyboard.press("r");
  const from = (await third.boundingBox())!;
  const targetX = wire.x + wire.width / 2;
  const targetY = wire.y + wire.height / 2;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();

  const overlay = page.getByTestId("wire-under-symbol-overlay");
  await expect(overlay).toBeAttached();
  const lines = overlay.locator(".wire-under-symbol-paint");
  await expect(lines).not.toHaveCount(0);
  expect(await lines.first().boundingBox()).not.toBeNull();

  // Clicking the warned span still selects a wire (the warning itself is
  // pointer-transparent; the route hit band lies underneath).
  const hitLine = overlay.locator(".wire-under-symbol-hit").first();
  const lineBox = (await hitLine.boundingBox())!;
  await page.mouse.click(
    lineBox.x + lineBox.width / 2,
    lineBox.y + lineBox.height / 2,
  );
  await expect(page.getByTestId("status")).toContainText(
    "Selected a wire buried under a symbol",
  );
  await expect(
    page.locator('[data-canvas-hit-kind="route"].selected'),
  ).not.toHaveCount(0);
});

test("a pin-exact drop onto the wire splices in series instead of warning", async ({
  page,
}) => {
  const { ids, wire } = await wiredPairWithSpare(page);

  // Same drag, but the resistor stays vertical: both pins land on the
  // conductor at distinct points, which is the series-insertion gesture.
  // The covered span is cut away, so there is nothing to warn about.
  const third = page.getByTestId(`hit-${ids[2]}`);
  const from = (await third.boundingBox())!;
  const targetX = wire.x + wire.width / 2;
  const targetY = wire.y + wire.height / 2;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("status")).toContainText(
    "Inserted the moved component in series",
  );
  // One wire became two conductors, one per side of the device.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);
  await expect(page.getByTestId("wire-under-symbol-overlay")).toHaveCount(0);
});
