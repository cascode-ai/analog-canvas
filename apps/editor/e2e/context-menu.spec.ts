import { expect, test, type Page } from "@playwright/test";

import { chooseComponent, clickDrawTool } from "./editor-fixtures";

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
    "Aligned 2 selected objects",
  );
  const boxes = await instances.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("x")),
  );
  expect(boxes[0]).toBe(boxes[1]);
});

test("drafting text shares device additive selection and context alignment", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await clickDrawTool(page, "text");
  const input = page.getByRole("textbox", { name: "Canvas text editor" });
  await input.fill("BIAS");
  await page.getByRole("button", { name: "Apply text changes" }).click();

  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const text = page.locator('[data-canvas-hit-kind="drafting"]').first();

  await page.keyboard.press("ControlOrMeta+A");
  await expect(instance).toHaveClass(/selected/);
  await expect(text).toHaveClass(/selected/);
  await page.keyboard.press("ControlOrMeta+D");

  // The same objects can then be composed explicitly through the shared
  // additive click behavior.
  await instance.click();
  await expect(instance).toHaveClass(/selected/);
  await text.click({ modifiers: ["Shift"] });
  await expect(instance).toHaveClass(/selected/);
  await expect(text).toHaveClass(/selected/);

  // Right-clicking an already-selected text keeps the mixed selection and
  // opens the same command surface as a device, without device-only variants.
  await text.click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toContainText("Align");
  await expect(menu).not.toContainText("Swap device");
  await page.getByTestId("context-align-left").click();
  await expect(page.getByTestId("status")).toContainText(
    "Aligned 2 selected objects",
  );
});

test("drafting shapes join device selection from either order", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await clickDrawTool(page, "rectangle");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 420, y: 180 } });
  await canvas.click({ position: { x: 540, y: 280 } });
  await page.keyboard.press("Escape");

  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const rectangle = page.getByTestId(/^drafting-hit-rectangle-/);

  // Shape first, then Shift+device — the order that used to drop the shape:
  // the outside-press deselect ran before the additive click could compose.
  await canvas.click({ position: { x: 480, y: 180 } });
  await expect(rectangle).toHaveClass(/selected/);
  await instance.click({ modifiers: ["Shift"] });
  await expect(instance).toHaveClass(/selected/);
  await expect(rectangle).toHaveClass(/selected/);

  // Right-clicking the DEVICE member must not shed the shape either: the
  // press acts on the pair, so the shared command surface opens over both.
  // (Shapes do not participate in edge alignment — that boundary is #384's,
  // not this test's — so the mixed menu is asserted, not an Align action.)
  await instance.click({ button: "right" });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText("Swap device");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
  await expect(rectangle).toHaveClass(/selected/);
  await expect(instance).toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // A plain press on empty canvas keeps its meaning: the shape deselects.
  await canvas.click({ position: { x: 640, y: 400 } });
  await expect(rectangle).not.toHaveClass(/selected/);

  // The reverse order composes too. A shape is a stroke-only hit, so the
  // additive click aims at its edge, not the locator's center.
  await instance.click();
  await expect(instance).toHaveClass(/selected/);
  await canvas.click({ position: { x: 480, y: 180 }, modifiers: ["Shift"] });
  await expect(instance).toHaveClass(/selected/);
  await expect(rectangle).toHaveClass(/selected/);
});

test("device annotation shares device additive selection and context menu", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const annotation = page
    .locator('[data-canvas-hit-kind="annotation"]')
    .first();

  await instance.click();
  await annotation.click({ modifiers: ["Shift"], force: true });
  await expect(instance).toHaveClass(/selected/);
  await expect(annotation).toHaveClass(/selected/);

  await annotation.click({ button: "right", force: true });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText("Swap device");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
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
