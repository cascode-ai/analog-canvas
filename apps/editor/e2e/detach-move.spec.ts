import { expect, test, type Page } from "@playwright/test";

import { chooseComponent, downloadBytes } from "./editor-fixtures";

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

function routePoints(page: Page) {
  return page
    .locator('[data-canvas-hit-kind="route"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("points")),
    );
}

async function exportedTerminals(
  page: Page,
): Promise<Array<{ instanceId: string; pinName: string }>> {
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      nets: Array<{
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
    }>;
  };
  return saved.documents[0]!.nets.flatMap((net) => net.terminals);
}

const META = 4; // CDP Input modifier bitmask (Cmd; macOS turns Ctrl+left into a right press)

/**
 * Playwright's high-level mouse API cannot attach keyboard modifiers to
 * pointer events, so the detach drag goes through the raw CDP input
 * pipeline. Cmd stands in for Ctrl because macOS converts Ctrl+left-press
 * into a right-button press before the page sees it.
 */
async function ctrlDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from.x,
    y: from.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: META,
  });
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
      button: "left",
      buttons: 1,
      modifiers: META,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to.x,
    y: to.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers: META,
  });
  await cdp.detach();
}

test("Ctrl+drag moves only the part; its wire stays exactly in place", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 180 });
  await placeComponent(page, "resistor", { x: 300, y: 400 });
  const ids = await instanceIds(page);

  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  // Deselect so the drag targets exactly the pointed-at part.
  await page.getByTestId("schematic-canvas").click({
    position: { x: 620, y: 420 },
  });

  const wireBefore = await routePoints(page);
  const top = page.getByTestId(`hit-${ids[0]}`);
  const before = (await top.boundingBox())!;
  const center = {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  };

  await ctrlDrag(page, center, { x: center.x + 180, y: center.y });

  // The part moved; the now-open wire kept its exact authored geometry.
  const after = (await top.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 100);
  const wireAfter = await routePoints(page);
  expect(wireAfter).toEqual(wireBefore);
  await expect(page.getByTestId("status")).toContainText("without its wires");
});

test("Ctrl+click without a drag still toggles selection", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 250 });
  const ids = await instanceIds(page);
  await page.getByTestId("schematic-canvas").click({
    position: { x: 600, y: 420 },
  });

  const hit = page.getByTestId(`hit-${ids[0]}`);
  const box = (await hit.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // A ctrl press-release without movement is the toggle-selection click.
  await ctrlDrag(page, center, center);
  await expect(hit).toHaveClass(/selected/);

  // The part did not move.
  const settled = (await hit.boundingBox())!;
  expect(Math.abs(settled.x - box.x)).toBeLessThan(2);
});

/**
 * Build two resistors joined by one wire, with nothing selected. Returns the
 * instance ids and the wire's geometry before anything moves.
 */
async function wiredPair(page: Page): Promise<{
  ids: string[];
  wireBefore: (string | null)[];
}> {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 180 });
  await placeComponent(page, "resistor", { x: 300, y: 400 });
  const ids = await instanceIds(page);

  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  await page.getByTestId("schematic-canvas").click({
    position: { x: 620, y: 420 },
  });
  return { ids, wireBefore: await routePoints(page) };
}

// Issue #485: Virtuoso's Shift+M. The same detachment Ctrl+drag performs,
// reached through the verb-first path so it works from the keyboard on a
// selection rather than only under the pointer.
test("Shift+M moves the selection and leaves its wires where they were", async ({
  page,
}) => {
  const { ids, wireBefore } = await wiredPair(page);

  const top = page.getByTestId(`hit-${ids[0]}`);
  await top.click();
  await expect(top).toHaveClass(/selected/);
  const before = (await top.boundingBox())!;

  await page.keyboard.press("Shift+M");
  await expect(page.getByTestId("status")).toContainText("without wires");

  const target = { x: before.x + 200, y: before.y + before.height / 2 };
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);

  // The part moved and the wire kept its exact geometry.
  const after = (await page.getByTestId(`hit-${ids[0]}`).boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(await routePoints(page)).toEqual(wireBefore);

  // Geometry alone is insufficient: Shift+M is a real electrical disconnect,
  // not a same-Net flightline disguised as a detached wire.
  const terminals = await exportedTerminals(page);
  expect(terminals).not.toContainEqual(
    expect.objectContaining({ instanceId: ids[0] }),
  );
  expect(terminals).toContainEqual(
    expect.objectContaining({ instanceId: ids[1] }),
  );
});

// The brake: plain M must still drag the wire along, or Shift+M would have
// silently replaced the behaviour it is supposed to sit beside.
test("M still stretches the wire along with the part", async ({ page }) => {
  const { ids, wireBefore } = await wiredPair(page);

  const top = page.getByTestId(`hit-${ids[0]}`);
  await top.click();
  const before = (await top.boundingBox())!;

  await page.keyboard.press("m");
  await expect(page.getByTestId("status")).toContainText("Move: move the");

  const target = { x: before.x + 200, y: before.y + before.height / 2 };
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);

  const after = (await page.getByTestId(`hit-${ids[0]}`).boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(await routePoints(page)).not.toEqual(wireBefore);
  const terminals = await exportedTerminals(page);
  expect(terminals).toContainEqual(
    expect.objectContaining({ instanceId: ids[0] }),
  );
  expect(terminals).toContainEqual(
    expect.objectContaining({ instanceId: ids[1] }),
  );
});

// Shift+M is verb-first the same way M is: pressed with nothing selected it
// arms, and the next click picks up whatever it points at.
test("Shift+M with nothing selected arms the detached move for the next click", async ({
  page,
}) => {
  const { ids, wireBefore } = await wiredPair(page);

  await page.keyboard.press("Shift+M");
  await expect(page.getByTestId("status")).toContainText(
    "Move without wires: click",
  );

  const top = page.getByTestId(`hit-${ids[0]}`);
  const before = (await top.boundingBox())!;
  await page.mouse.click(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );

  const target = { x: before.x + 200, y: before.y + before.height / 2 };
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);

  const after = (await page.getByTestId(`hit-${ids[0]}`).boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(await routePoints(page)).toEqual(wireBefore);
});
