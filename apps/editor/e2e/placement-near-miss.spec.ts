import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

async function placeAt(
  page: import("@playwright/test").Page,
  x: number,
  y: number,
): Promise<string> {
  await chooseComponent(page, "resistor");
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  // Read before Escape: cancelling the still-armed tool overwrites the line.
  const status = await page.getByTestId("status").innerText();
  await page.keyboard.press("Escape");
  return status;
}

test("the status line warns about a near miss and stays quiet otherwise", async ({
  page,
}) => {
  await page.goto("/editor");
  // Two resistors joined by a wire: that wire is what a later part can miss.
  await placeAt(page, 260, 200);
  await placeAt(page, 260, 420);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-object-id^="R"]')].map((node) =>
      node.getAttribute("data-object-id"),
    ),
  );
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  const canvas = (await page.getByTestId("schematic-canvas").boundingBox())!;
  // The wire runs vertically at this x. Place to its side at three distances.
  const wireX = Math.round(box.x + box.width / 2 - canvas.x);
  const midY = Math.round(box.y + box.height / 2 - canvas.y);

  const onWire = await placeAt(page, wireX, midY);
  const nearby = await placeAt(page, wireX + 10, midY);
  const faraway = await placeAt(page, wireX + 180, midY);

  // On the wire: the placement connects, so there is nothing to warn about.
  expect(onWire).toContain("connected its contacted pin");
  expect(onWire).not.toContain("not connected");
  // One grid out: it looks joined and is not, so the line says so.
  expect(nearby).toContain("is 1 grid from");
  expect(nearby).toContain("not connected");
  // Somewhere else entirely: silence, or the hint becomes noise.
  expect(faraway).not.toContain("not connected");
});
