import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

test("keeps editor chrome typography from suppressing SVG italics", async ({
  page,
}) => {
  await page.goto("/editor");

  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 220 } });

  const italicRun = page
    .getByTestId("schematic-canvas")
    .locator('[data-text-run="span"][style*="font-style:italic"]')
    .first();
  await expect(italicRun).toBeVisible();
  await expect(italicRun).toHaveCSS("font-style", "italic");
  expect(
    await italicRun.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("font-synthesis"),
    ),
  ).not.toBe("none");
});

test("dismisses Help with Escape or a backdrop pointer", async ({ page }) => {
  await page.goto("/editor");
  const help = page.getByRole("dialog", { name: "Help" });

  await page.getByRole("button", { name: "Help" }).click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  await expect(help).toBeVisible();
  await page.locator(".help-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(help).toHaveCount(0);
});

test("carries the version and project resource links inside Help", async ({
  page,
}) => {
  await page.goto("/editor");
  // About and Help said the same thing from two entries; About now lives as a
  // section of Help.
  await expect(page.getByRole("button", { name: "About" })).toHaveCount(0);
  await page.getByRole("button", { name: "Help" }).click();

  const about = page.getByRole("dialog");
  await expect(about).toContainText("About Analog Canvas");
  await expect(about).toContainText("Version 0.1.0");
  const repositoryLink = about.getByRole("link", { name: "Repository" });
  await expect(repositoryLink).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas",
  );
  await expect(repositoryLink).toHaveAttribute("target", "_blank");
  await expect(about.getByRole("link", { name: "Change Log" })).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas/commits/main",
  );
  await expect(about.getByRole("link", { name: "Owner" })).toHaveAttribute(
    "href",
    "https://www.tokenzhang.com",
  );
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
});
