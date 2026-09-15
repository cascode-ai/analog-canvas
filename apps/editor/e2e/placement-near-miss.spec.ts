import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

async function placeAtScreen(
  page: import("@playwright/test").Page,
  x: number,
  y: number,
): Promise<string> {
  await chooseComponent(page, "resistor");
  await page.mouse.click(x, y);
  const status = await page.getByTestId("status").innerText();
  await page.keyboard.press("Escape");
  return status;
}

test("the status line warns about a near miss and stays quiet otherwise", async ({
  page,
}) => {
  await page.goto("/editor");
  // This contract only needs one straight conductor. Author it explicitly so
  // automatic component avoidance is not part of the test fixture.
  const canvasNode = page.getByTestId("schematic-canvas");
  await chooseComponent(page, "resistor");
  await canvasNode.click({ position: { x: 800, y: 100 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("w");
  await canvasNode.click({ position: { x: 260, y: 180 } });
  await canvasNode.dblclick({ position: { x: 260, y: 480 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  const gridScale = await page
    .getByTestId("schematic-canvas")
    .evaluate((svg) => {
      const matrix = (svg as SVGSVGElement).getScreenCTM();
      if (!matrix) throw new Error("Canvas transform is unavailable");
      return Math.hypot(matrix.a, matrix.b);
    });
  // The wire runs vertically at this x. Use screen coordinates directly so
  // viewBox letterboxing cannot shift a supposedly exact placement by a grid.
  const wireX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;

  const onWire = await placeAtScreen(page, wireX, midY);
  const nearby = await placeAtScreen(page, wireX + 10 * gridScale, midY);
  const faraway = await placeAtScreen(page, wireX + 180 * gridScale, midY);

  // On the wire: the placement connects, so there is nothing to warn about.
  expect(onWire).toContain("connected its contacted pin");
  expect(onWire).not.toContain("not connected");
  // One grid out: it looks joined and is not, so the line says so.
  expect(nearby).toContain("is 1 grid from");
  expect(nearby).toContain("not connected");
  // Somewhere else entirely: silence, or the hint becomes noise.
  expect(faraway).not.toContain("not connected");
});
