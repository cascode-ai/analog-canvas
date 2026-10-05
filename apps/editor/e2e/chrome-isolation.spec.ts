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
      ).toBeLessThanOrEqual(8);
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

test("compacts the editor header at half width and keeps the account role in its menu", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "owner-1",
          displayName: "A Very Long Display Name",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/editor");

  await expect(
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeHidden();
  await expect(page.getByTestId("header-gallery-link")).toBeVisible();
  await expect(page.getByTestId("account-name")).toBeVisible();
  await expect(page.getByTestId("account-owner")).toBeHidden();

  for (const width of [320, 360, 390, 480, 720, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const leftControls = page.locator(
      ".app-brand > :is(.gallery-home-link, .header-gallery-link, .project-menu, .command-menu)",
    );
    const leftBounds = await leftControls.evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top };
        })
        .filter(({ right, left }) => right > left),
    );
    expect(leftBounds.length).toBeGreaterThanOrEqual(4);
    expect(leftBounds[0]!.left).toBeLessThan(24);
    for (let index = 1; index < leftBounds.length; index++) {
      expect(leftBounds[index]!.left).toBeGreaterThanOrEqual(
        leftBounds[index - 1]!.right,
      );
      expect(
        Math.abs(leftBounds[index]!.top - leftBounds[0]!.top),
      ).toBeLessThanOrEqual(8);
    }

    const actions = page.locator(".app-chrome-actions");
    await expect(actions).toBeVisible();
    const chromeMain = await page.locator(".app-chrome-main").boundingBox();
    expect(chromeMain?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      48,
    );
    const actionBounds = await actions
      .locator(
        '[data-testid="open-analog-simulation"], [data-testid="open-agent"], [data-testid="publish-gallery-button"]',
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top };
        }),
      );
    expect(actionBounds).toHaveLength(3);
    for (let index = 1; index < actionBounds.length; index++) {
      expect(actionBounds[index]!.left).toBeGreaterThanOrEqual(
        actionBounds[index - 1]!.right,
      );
      expect(
        Math.abs(actionBounds[index]!.top - actionBounds[0]!.top),
      ).toBeLessThanOrEqual(4);
    }
    expect(actionBounds.at(-1)!.right).toBeLessThanOrEqual(width);
    await expect(actions.getByTestId("publish-gallery-button")).toBeVisible();
    await expect(actions.getByTestId("open-agent")).toBeVisible();
    await expect(actions.locator(".tokenzhang-link-icon")).toBeVisible();
    // The name, or at phone widths its round mark alone, opens the account.
    await expect(actions.getByTestId("account-name")).toBeVisible();
    if (width <= 760) {
      await expect(
        actions.getByTestId("open-agent").locator(".app-action-label"),
      ).toBeHidden();
      await expect(
        actions
          .getByTestId("open-analog-simulation")
          .locator(".app-action-label"),
      ).toBeHidden();
    }
  }

  // Beside the drawing, the name opens the account page in its own tab.
  const name = page.getByTestId("account-name");
  await expect(name).toHaveAttribute("href", "/account");
  await expect(name).toHaveAttribute("target", "_blank");
  await page.goto("/account");
  await expect(page.getByTestId("account-menu-name")).toHaveText(
    "A Very Long Display Name",
  );
  await expect(page.getByTestId("account-owner")).toHaveText("Owner");
});

test("keeps the account affordance when auth providers are unavailable", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/editor");

  const fallback = page.locator(".account-menu-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback.locator("summary")).toContainText("⋯");
  await fallback.locator("summary").click();
  await expect(fallback.locator(".account-popover")).toContainText("Account");
});
