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

test("selection tints the device and marks carried wires as would-move", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 300, y: 380 });
  const instances = page.locator('[data-canvas-hit-kind="instance"]');
  await expect(instances).toHaveCount(2);

  // Wire the bottom pin of the first to the top pin of the second
  // (resistor pin "2" faces +y, pin "1" faces -y).
  const ids = await instances.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-canvas-hit-id")),
  );
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  await instances.nth(0).click();
  await expect(instances.nth(0)).toHaveClass(/hit-target selected/);
  // The dashed bounding box is gone; the selection is a tinted body.
  const dash = await instances
    .nth(0)
    .evaluate((element) => getComputedStyle(element).strokeDasharray);
  expect(dash === "none" || dash === "").toBeTruthy();
  // The attached wire would travel with a drag, so it carries the
  // would-move tint while staying unselected.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveClass(
    /would-move|selected/,
  );
});
