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
  await expect(page.getByTestId("status")).toContainText("Fit Document");
  const canvas = page.getByTestId("schematic-canvas");
  const afterOpen = await canvas.getAttribute("viewBox");
  // The default camera never survives an open with content.
  expect(afterOpen).not.toBe("0 0 960 640");
  await page.keyboard.press("f");
  await expect.poll(async () => canvas.getAttribute("viewBox")).toBe(afterOpen);
});
