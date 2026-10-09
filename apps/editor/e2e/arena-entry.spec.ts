// The two ways into AnalogArena: the editor's top bar, through the same
// guard for unsaved work as its Gallery link, and the Gallery header. Arena
// is another Worker (Arcadia-1/analog-arena) that the site forwards /arena
// to, so its page is answered here at the network.

import { expect, test, type Page } from "@playwright/test";

import { awaitEditorReady, chooseComponent } from "./editor-fixtures.js";
import { ENTRY, mockGallery } from "./gallery-fixtures.js";

async function answerArena(page: Page): Promise<void> {
  await page.route("**/arena", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>AnalogArena</title><h1>AnalogArena</h1>",
    }),
  );
}

test("the editor's Arena button leaves through the guard for unsaved work", async ({
  page,
}) => {
  await answerArena(page);
  await page.goto("/editor");
  const arena = page.getByTestId("header-arena-link");
  // A modified click opens Arena in another tab, as any link would.
  await expect(arena).toHaveAttribute("href", "/arena");
  // The guard protects meaningful drawings: three authored objects.
  const canvas = page.getByTestId("schematic-canvas");
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await canvas.click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  const guard = page.getByRole("dialog", { name: "Unsaved changes" });

  await arena.click();
  await expect(guard).toContainText("Go to Arena");
  await guard.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/\/editor$/u);
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");

  await arena.click();
  await guard.getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/arena$/u);
  await expect(
    page.getByRole("heading", { name: "AnalogArena" }),
  ).toBeVisible();
});

test("with nothing unsaved, the editor's Arena button goes straight to Arena", async ({
  page,
}) => {
  await answerArena(page);
  await page.goto("/editor");
  await awaitEditorReady(page);

  await page.getByTestId("header-arena-link").click();

  await expect(page).toHaveURL(/\/arena$/u);
  await expect(
    page.getByRole("heading", { name: "AnalogArena" }),
  ).toBeVisible();
});

test("the Gallery header's Arena button opens Arena", async ({ page }) => {
  await answerArena(page);
  await mockGallery(page, [ENTRY]);
  await page.goto("/");
  const arena = page.getByTestId("gallery-arena-link");
  await expect(arena).toHaveText("Arena");

  await arena.click();

  await expect(page).toHaveURL(/\/arena$/u);
  await expect(
    page.getByRole("heading", { name: "AnalogArena" }),
  ).toBeVisible();
});
