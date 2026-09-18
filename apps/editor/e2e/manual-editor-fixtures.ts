import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { revealPropertiesShelf, chooseComponent } from "./editor-fixtures.js";

export async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await revealPropertiesShelf(page);
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
}

export async function openSelectionShelf(page: Page): Promise<void> {
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  await expect(shelf).toBeVisible();
  if ((await shelf.getAttribute("aria-expanded")) !== "true") {
    await shelf.click();
  }
}
