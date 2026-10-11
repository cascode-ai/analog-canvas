import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";

export async function acceptGraphics({ page, output, stem, chooseExport }) {
  for (const format of ["svg", "png", "pdf"]) {
    const path = join(output, `${stem}.${format}`);
    await chooseExport(path);
    const menu = page
      .locator("details.command-menu")
      .filter({ has: page.getByTestId("project-menu-toggle") });
    if (!(await menu.evaluate((element) => element.open)))
      await menu.locator("summary").click();
    const exports = menu.getByRole("button", { name: "Export", exact: true });
    if ((await exports.getAttribute("aria-expanded")) !== "true")
      await exports.click();
    await menu
      .getByRole("button", {
        name: `Export ${format.toUpperCase()}`,
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () => {
          try {
            return (await readFile(path)).length;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    const bytes = await readFile(path);
    if (format === "svg") assert.match(bytes.toString("utf8"), /<svg/u);
    if (format === "png") assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    if (format === "pdf")
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  }
}
