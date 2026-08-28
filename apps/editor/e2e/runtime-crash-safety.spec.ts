import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

test("a render crash shows the recovery screen instead of a blank page", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();

  // Arm the DEV-only render crash probe and force one more App render.
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.evaluate(() => {
    window.__ICM_TEST_RENDER_CRASH__ = true;
  });
  await page.keyboard.press("i");

  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  await expect(crashScreen).toContainText(
    "The editor hit an unexpected problem",
  );
  await expect(crashScreen).toContainText("render crashed (test hook)");
  const bugReportLink = crashScreen.getByTestId("crash-report-bug");
  await expect(bugReportLink).toBeVisible();
  await expect(bugReportLink).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/cascode-ai\/analog-canvas\/issues\/new\?/u,
  );
  const bugReportHref = await bugReportLink.getAttribute("href");
  expect(bugReportHref).not.toBeNull();
  const bugReportBody = new URL(bugReportHref ?? "").searchParams.get("body");
  expect(bugReportBody).not.toContain("render crashed");
  expect(bugReportBody).not.toContain("test hook");

  // Reloading brings the editor back without the transient crash flag.
  await crashScreen.getByRole("button", { name: "Reload editor" }).click();
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
});

test("a scene build failure degrades to the last good view and recovers", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");

  // Break formal scene building: further commits must not crash the page,
  // the canvas keeps showing the last good scene, and the model still edits.
  await page.evaluate(() => {
    window.__ICM_TEST_SCENE_CRASH__ = true;
  });
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 520, y: 230 } });
  await expect(page.getByTestId("revision")).toHaveText("2");
  // The degraded status fires on the commit itself; assert it before the
  // closing Escape overwrites the status line.
  await expect(page.getByTestId("status")).toContainText(
    "Scene rendering failed",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // Hit targets are React-rendered, but the formal scene stays at the last
  // good view, so R2's painted symbol must be absent from it.
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R2"]'),
  ).toHaveCount(0);

  // Once scene building works again, the next commit renders fresh content.
  await page.evaluate(() => {
    window.__ICM_TEST_SCENE_CRASH__ = false;
  });
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 640, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("hit-R3")).toBeVisible();
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R2"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R3"]'),
  ).toBeVisible();
});
