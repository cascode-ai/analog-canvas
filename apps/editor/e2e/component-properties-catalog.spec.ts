import { expect, test } from "@playwright/test";
import { expandedDeviceSymbols, razaviProductSymbols } from "@icm/symbols";

import { chooseComponent } from "./editor-fixtures.js";

// These are the two canonical sources of placeable Instance tiles. Editor-only
// Annotation tools and the two-click Power Rail intentionally do not appear in
// either list because they own drawing-specific Properties rather than a
// component Instance.
const componentSymbolIds = [
  ...razaviProductSymbols,
  ...expandedDeviceSymbols,
].map((symbol) => symbol.id);

for (const symbolId of componentSymbolIds) {
  test(`${symbolId} uses the one text-first component Properties surface`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await chooseComponent(page, symbolId);
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 520, y: 350 } });
    await page.keyboard.press("Escape");

    const instance = page.locator('[data-canvas-hit-kind="instance"]');
    await expect(instance).toHaveCount(1);
    await instance.click();
    const shelf = page.getByTestId("selection-shelf");
    if ((await shelf.getAttribute("aria-expanded")) === "true") {
      await shelf.click();
    }
    await page.keyboard.press("q");

    const properties = page.getByRole("region", {
      name: "Component properties",
    });
    await expect(properties).toBeVisible();
    await expect(
      properties.getByLabel("Editable Canvas property code"),
    ).toBeVisible();
    await expect(properties.locator(":scope > *")).toHaveCount(1);
    await expect(properties.locator(":scope > :only-child")).toHaveAttribute(
      "aria-label",
      "Canvas property code",
    );
  });
}
