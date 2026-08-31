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

async function instanceIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-canvas-hit-kind="instance"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-canvas-hit-id")!),
    );
}

test("wire can start from any interior point of an existing net", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 260, y: 420 });
  await placeComponent(page, "resistor", { x: 460, y: 310 });
  const ids = await instanceIds(page);

  // Vertical wire between the first two resistors.
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  // Start the next wire from the MIDDLE of that wire, not from a pin, and
  // land it on the third resistor's pin.
  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId(`terminal-${ids[2]}-1`).click();
  await page.keyboard.press("Escape");

  // The tap split the original wire and added the branch: three routes, one
  // junction dot at the tee.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(3);
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(1);
});

test("clicking a junction dot selects it and Delete disconnects the tap", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 260, y: 420 });
  await placeComponent(page, "resistor", { x: 460, y: 310 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  const route = page.locator('[data-canvas-hit-kind="route"]').first();
  const box = (await route.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId(`terminal-${ids[2]}-1`).click();
  await page.keyboard.press("Escape");
  const dot = page.locator('g[data-layer="junctions"] circle');
  await expect(dot).toHaveCount(1);

  // Click exactly on the visible dot: the junction's hit circle sits on the
  // same contact point, so the dot is clickable.
  const dotBox = (await dot.boundingBox())!;
  await page.mouse.click(
    dotBox.x + dotBox.width / 2,
    dotBox.y + dotBox.height / 2,
  );
  await page.keyboard.press("Delete");

  // The tap is gone: the branch to the third resistor is disconnected and
  // the dot disappears.
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(0);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).not.toHaveCount(
    3,
  );
});

test("middle click cycles the wire corner and never commits the wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 460, y: 420 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();

  // Drafting toward the second pin: middle over bare canvas cycles the
  // corner shape instead of placing a point.
  await page.mouse.move(360, 320);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("status")).toContainText("Wire corner:");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  // Middle directly over the destination endpoint's snap circle is the
  // reported hazard: it must cycle again, not commit the wire.
  const destination = page.getByTestId(`terminal-${ids[1]}-1`);
  const box = (await destination.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expect(page.getByTestId("status")).toContainText("Wire corner:");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  // The primary button still commits.
  await destination.click();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
});

test("dragging a wire's end onto another wire joins them into one net", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  // A horizontal wire, then a separate vertical one clear above it. A wire
  // drawn on free grid points finishes on Enter, not on the second click.
  await canvas.click({ position: { x: 600, y: 500 } });
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 240, y: 320 } });
  await canvas.click({ position: { x: 480, y: 320 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 360, y: 160 } });
  await canvas.click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);
  await expect(page.getByTestId("statusbar-issues")).toHaveText("No issues");

  // Drag the vertical wire down so its lower end comes to rest on the
  // horizontal one. This is the gesture that used to leave two nets touching
  // at a point, with an ambiguous-junction error the author could not clear.
  // The travel is measured from what is actually rendered rather than assumed
  // from the click coordinates, so page scale cannot leave the end just shy.
  const routes = page.locator('[data-canvas-hit-kind="route"]');
  const drawn = await routes.evaluateAll((elements) =>
    elements.map((element) => {
      const points = (element.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/u)
        .map((pair) => pair.split(",").map(Number));
      const xs = points.map((point) => point[0]!);
      const ys = points.map((point) => point[1]!);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    }),
  );
  const horizontal = drawn.find((route) => route.maxX - route.minX > 0)!;
  const vertical = drawn.find((route) => route.maxY - route.minY > 0)!;
  // Drawn coordinates are document units; the drag is in screen pixels, so
  // derive the scale from a span that is known in both.
  const horizontalBox = (await routes
    .nth(drawn.indexOf(horizontal))
    .boundingBox())!;
  const verticalBox = (await routes
    .nth(drawn.indexOf(vertical))
    .boundingBox())!;
  const scale = horizontalBox.width / (horizontal.maxX - horizontal.minX);
  const travel = (horizontal.minY - vertical.maxY) * scale;
  const grabX = verticalBox.x + verticalBox.width / 2;
  const grabY = verticalBox.y + verticalBox.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX, grabY + travel / 2, { steps: 6 });
  await page.mouse.move(grabX, grabY + travel, { steps: 6 });
  await page.mouse.up();

  // The landing tapped the horizontal wire: it splits, and a junction dot
  // marks the connection — exactly what drawing the same wire would produce.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(3);
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(1);
  // Drawing and model agree, so there is nothing ambiguous left to report.
  await expect(page.getByTestId("statusbar-issues")).toHaveText("No issues");
});
