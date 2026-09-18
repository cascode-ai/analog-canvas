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
  await expect(about).toContainText("Version 0.9.2");
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

test("keeps Gallery Library Netlist and Project Code together on the left at full and half width", async ({
  page,
}) => {
  await page.goto("/editor");
  const toolbar = page.getByTestId("draw-toolbar");
  const panels = toolbar.getByRole("group", { name: "Panels", exact: true });
  await expect(panels).toBeVisible();
  expect(
    await panels
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-testid")),
      ),
  ).toEqual([
    "examples-toggle",
    "library-toggle",
    "netlist-panel-toggle",
    "project-code-toggle",
  ]);
  for (const width of [1440, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await panels.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top };
      }),
    );
    expect(bounds[0]!.left).toBeLessThan(24);
    for (let index = 1; index < bounds.length; index++) {
      expect(bounds[index]!.top).toBe(bounds[0]!.top);
      expect(
        bounds[index]!.left - bounds[index - 1]!.right,
      ).toBeLessThanOrEqual(4);
      expect(bounds[index]!.left).toBeGreaterThanOrEqual(
        bounds[index - 1]!.right,
      );
    }
    expect(bounds.at(-1)!.right).toBeLessThan(width);
    const summary = page.getByTestId("annotation-menu").locator("summary");
    const textBox = await page.getByTestId("draw-tool-text").boundingBox();
    const annotationBox = await summary.boundingBox();
    expect(
      annotationBox!.x - (textBox!.x + textBox!.width),
    ).toBeLessThanOrEqual(4);
    await summary.click();
    const palette = page.getByRole("group", { name: "Annotation tools" });
    await expect(palette.getByRole("button")).toHaveCount(8);
    const paletteBox = await palette.boundingBox();
    expect(paletteBox!.x).toBeGreaterThanOrEqual(0);
    expect(paletteBox!.x + paletteBox!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await summary.click();
    await page.getByTestId("draw-tool-wire").click();
    await expect(palette).toBeHidden();
  }
});
