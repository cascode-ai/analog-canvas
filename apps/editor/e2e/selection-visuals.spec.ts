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

test("selection traces the device and marks carried wires as would-move", async ({
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
  // Nothing is drawn around the device: the hit rectangle carries the click,
  // never the mark. Selection shows as a halo tracing the symbol's own lines.
  const box = await instances.nth(0).evaluate((element) => {
    const style = getComputedStyle(element);
    return { fill: style.fill, stroke: style.stroke };
  });
  expect(box.fill).toBe("rgba(0, 0, 0, 0)");
  expect(box.stroke).toBe("rgba(0, 0, 0, 0)");

  const halo = page.getByTestId("selection-halo-selected");
  await expect(halo).toBeAttached();
  await expect(halo.locator(`[data-object-id="${ids[0]}"]`)).toBeAttached();
  await expect(halo.locator(`[data-object-id="${ids[1]}"]`)).toHaveCount(0);

  // The attached wire would travel with a drag, so it carries the
  // would-move tint while staying unselected.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveClass(
    /would-move|selected/,
  );
});

test("an instance label is not tinted a second time beside its device", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const label = page.locator('[data-canvas-hit-kind="annotation"]').first();
  await instance.click();

  // The label rides along with the device it names, and the halo already says
  // so. A would-move box on the label repeated that next to a device wearing
  // no box at all.
  await expect(label).toHaveClass(/hit-target annotation-text-hit$/);

  // Selecting the label in its own right is a different thing to say, and it
  // still marks itself: answering a deliberate click with nothing would be
  // worse than the tint this test removes.
  await label.click({ modifiers: ["Shift"], force: true });
  await expect(label).toHaveClass(/selected/);
});
