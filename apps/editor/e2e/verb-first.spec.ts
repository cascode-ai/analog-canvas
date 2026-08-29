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

function instances(page: Page) {
  return page.locator('[data-canvas-hit-kind="instance"]');
}

test("C pressed first arms copy; the next click picks up a copy", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 250 });
  await expect(instances(page)).toHaveCount(1);

  // Nothing selected: C arms the verb instead of complaining.
  // Click empty canvas so nothing is selected before pressing the verb key.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 150, y: 420 },
  });
  await page.keyboard.press("c");
  await expect(page.getByTestId("status")).toContainText("Copy: click");

  // Clicking the part starts copy placement with its ghost on the cursor.
  const part = instances(page).first();
  const box = (await part.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("status")).toContainText("Place copy");

  // Clicking empty canvas commits the copy.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 520, y: 250 },
  });
  await expect(instances(page)).toHaveCount(2);
  await page.keyboard.press("Escape");
});

test("Delete pressed first enters a repeating delete mode until Escape", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 220 });
  await placeComponent(page, "resistor", { x: 460, y: 220 });
  await expect(instances(page)).toHaveCount(2);

  // Click empty canvas so nothing is selected before pressing the verb key.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 150, y: 420 },
  });
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("status")).toContainText("Delete: click");

  const first = (await instances(page).first().boundingBox())!;
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await expect(instances(page)).toHaveCount(1);
  await expect(page.getByTestId("status")).toContainText("click another");

  const second = (await instances(page).first().boundingBox())!;
  await page.mouse.click(
    second.x + second.width / 2,
    second.y + second.height / 2,
  );
  await expect(instances(page)).toHaveCount(0);

  // Escape leaves the mode; later clicks stop deleting.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("status")).toContainText("Cancelled");
  await placeComponent(page, "resistor", { x: 360, y: 320 });
  const third = (await instances(page).first().boundingBox())!;
  await page.mouse.click(third.x + third.width / 2, third.y + third.height / 2);
  await expect(instances(page)).toHaveCount(1);
});

test("M pressed first arms move; the next click picks the part up", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 250 });

  // Click empty canvas so nothing is selected before pressing the verb key.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 150, y: 420 },
  });
  await page.keyboard.press("m");
  await expect(page.getByTestId("status")).toContainText("Move: click");

  const part = instances(page).first();
  const before = (await part.boundingBox())!;
  await page.mouse.click(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await expect(page.getByTestId("status")).toContainText("Move: move the");

  // The part follows the pointer; a click places it.
  await page.mouse.move(before.x + 160, before.y + before.height / 2);
  await page.mouse.click(before.x + 160, before.y + before.height / 2);
  const after = (await instances(page).first().boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 80);
});

test("Escape disarms rotate so later clicks stop turning parts", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 250 });

  // Click empty canvas so nothing is selected before pressing the verb key.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 150, y: 420 },
  });
  await page.keyboard.press("r");
  await expect(page.getByTestId("status")).toContainText("Rotate: click");

  const part = instances(page).first();
  const upright = (await part.boundingBox())!;
  await page.mouse.click(
    upright.x + upright.width / 2,
    upright.y + upright.height / 2,
  );
  await expect(page.getByTestId("status")).toContainText("Rotated");
  const turned = (await instances(page).first().boundingBox())!;
  expect(turned.width).toBeGreaterThan(upright.width);

  // Escape must actually stop the armed rotate (the historical gap).
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("status")).toContainText("Cancelled");
  await page.mouse.click(
    turned.x + turned.width / 2,
    turned.y + turned.height / 2,
  );
  const settled = (await instances(page).first().boundingBox())!;
  expect(Math.abs(settled.width - turned.width)).toBeLessThan(2);
});
