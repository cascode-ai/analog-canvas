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

test("links GitHub from the upper chrome and Change Log from the statusbar", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: "Help" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "About" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Help" })).toHaveCount(0);

  const repositoryLink = page.getByTestId("editor-repository-link");
  await expect(repositoryLink).toBeVisible();
  await expect(repositoryLink).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas",
  );
  await expect(repositoryLink).toHaveAttribute("target", "_blank");
  await expect(
    page.locator(".app-chrome-actions").getByTestId("editor-repository-link"),
  ).toBeVisible();

  const changeLog = page.getByTestId("statusbar-change-log");
  await expect(changeLog).toBeVisible();
  await expect(changeLog).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas/commits/main",
  );
  await expect(
    page.locator(".app-statusbar").getByTestId("statusbar-change-log"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "TokenZhang" })).toHaveAttribute(
    "href",
    "https://tokenzhang.com",
  );
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
    await expect(palette.getByRole("button")).toHaveCount(9);
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
