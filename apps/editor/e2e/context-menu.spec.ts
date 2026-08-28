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

test("right-click on a device offers same-shape variant swap tiles", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "inductor", { x: 360, y: 240 });
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  await instance.click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Swap device");
  await expect(page.getByTestId("context-swap-resistor")).toBeVisible();
  await expect(page.getByTestId("context-swap-capacitor")).toBeVisible();

  await page.getByTestId("context-swap-resistor").click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText("Swapped to");
  await instance.click({ button: "right" });
  // The device is now a resistor, so the tiles offer the inductor back.
  await expect(page.getByTestId("context-swap-inductor")).toBeVisible();
  await expect(page.getByTestId("context-swap-resistor")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-context-menu")).toHaveCount(0);
});

test("right-click on a multi-selection aligns bbox edges", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 420, y: 300 });
  const instances = page.locator('[data-canvas-hit-kind="instance"]');
  await expect(instances).toHaveCount(2);
  await instances.nth(0).click();
  await instances.nth(1).click({ modifiers: ["Shift"] });

  await instances.nth(1).click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toContainText("Align");
  await page.getByTestId("context-align-left").click();
  await expect(page.getByTestId("status")).toContainText(
    "Aligned 2 selected instances",
  );
  const boxes = await instances.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("x")),
  );
  expect(boxes[0]).toBe(boxes[1]);
});

test("toolbar undo and redo buttons follow history state", async ({ page }) => {
  await page.goto("/editor");
  const undo = page.getByTestId("draw-tool-undo");
  const redo = page.getByTestId("draw-tool-redo");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await placeComponent(page, "resistor", { x: 360, y: 240 });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator('[data-canvas-hit-kind="instance"]')).toHaveCount(
    0,
  );
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(page.locator('[data-canvas-hit-kind="instance"]')).toHaveCount(
    1,
  );
});
