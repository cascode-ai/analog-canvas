import { expect, test, type Page } from "@playwright/test";

import { chooseComponent, clickCommand } from "./editor-fixtures";

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

test("a Net highlight set from the Check Report can always be cleared", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 260, y: 420 });
  const ids = await instanceIds(page);

  // An unnamed wire between two pins exports with a generated name, which the
  // Check Report lists as a clickable GENERATED_NET_NAME finding.
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");

  await clickCommand(page, "Netlist", "Check Report…");
  const preflight = page.getByRole("dialog", { name: "Check Report" });
  await preflight
    .getByRole("button", { name: /GENERATED_NET_NAME/ })
    .first()
    .click();
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();

  // Close the report via its backdrop; the highlight persists on the canvas.
  await page
    .locator(".insert-dialog-backdrop")
    .click({ position: { x: 5, y: 5 } });
  await expect(preflight).toHaveCount(0);
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();

  // The finding navigation selected the net's route, so H toggles the
  // highlight off, back on, and off again.
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
  await expect(page.getByTestId("status")).toHaveText(/Cleared Net highlight/);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();

  // Escape clears it too, selection or not.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);

  // Even with the selection gone entirely, a lingering highlight stays
  // clearable from the keyboard.
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
});
