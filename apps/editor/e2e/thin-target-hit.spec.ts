import { expect, test } from "@playwright/test";

import { chooseComponent, clickDrawTool } from "./editor-fixtures";

/**
 * A deliberate click on visible wire must select the wire even where the
 * symbol's blank hit rectangle overlaps it; the symbol body itself stays
 * selectable, and a second click cycles between overlapped candidates.
 */
test("clicking wire beside a symbol body selects the wire, not the box", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 300, y: 220 } });
  await page.keyboard.press("Escape");

  // Wire from the resistor's bottom pin outward; its first stretch runs
  // through the symbol's hit rectangle.
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page
    .getByTestId("schematic-canvas")
    .dblclick({ position: { x: 300, y: 360 } });
  await page.keyboard.press("Escape");

  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const routeBox = (await route.boundingBox())!;
  const instanceBox = (await page.getByTestId("hit-R1").boundingBox())!;
  // A point on the wire inside the symbol's hit rectangle.
  const x = routeBox.x + routeBox.width / 2;
  const y = Math.min(
    instanceBox.y + instanceBox.height - 4,
    routeBox.y + routeBox.height - 4,
  );
  expect(y).toBeGreaterThan(instanceBox.y);

  await page.mouse.click(x, y);
  await expect(page.getByTestId("status")).toContainText("Selected route");

  // The body away from the wire still selects the symbol.
  await page.keyboard.press("Escape");
  await page.mouse.click(
    instanceBox.x + instanceBox.width - 6,
    instanceBox.y + instanceBox.height / 2,
  );
  await expect(page.getByTestId("hit-R1")).toHaveClass(/selected/);
});
