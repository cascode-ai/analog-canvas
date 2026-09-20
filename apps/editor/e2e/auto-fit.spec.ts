import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { parseProject, serializeProject } from "@icm/project-protocol";

// Opening any schematic lands fitted, exactly as if F were pressed once.
test("an opened Project is auto-fitted to the camera", async ({ page }) => {
  await page.goto("/editor");
  const fixturePath = resolve(
    process.cwd(),
    "fixtures/projects/port-nets/project.icproj.json",
  );
  await page.getByTestId("project-file").setInputFiles({
    name: "project.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      serializeProject(parseProject(readFileSync(fixturePath, "utf8"))),
    ),
  });
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
