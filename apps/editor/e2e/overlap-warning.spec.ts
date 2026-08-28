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

test("a component dragged over a wire paints a red warning on the covered span", async ({
  page,
}) => {
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

  // Drag the third resistor so its body sits on the vertical wire.
  const third = page.getByTestId(`hit-${ids[2]}`);
  const from = (await third.boundingBox())!;
  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const wire = (await route.boundingBox())!;
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
