import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

// Opening any schematic lands fitted, exactly as if F were pressed once.
test("an opened Project is auto-fitted to the camera", async ({ page }) => {
  await page.goto("/editor");
  await page
    .getByTestId("project-file")
    .setInputFiles(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
    );
  // The landing fit is silent: the open's own status survives.
  await expect(page.getByTestId("status")).toContainText("Opened");
  const canvas = page.getByTestId("schematic-canvas");
  // The default camera never survives an open with content.
  await expect
    .poll(async () => canvas.getAttribute("viewBox"))
    .not.toBe("0 0 960 640");
  const afterOpen = await canvas.getAttribute("viewBox");
  await page.keyboard.press("f");
  await expect.poll(async () => canvas.getAttribute("viewBox")).toBe(afterOpen);
});
