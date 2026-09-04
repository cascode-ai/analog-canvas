import { expect, test } from "@playwright/test";

import { chooseComponent, clickCommand } from "./editor-fixtures.js";

test("edits compatible selected instances through the explicit Instance Table", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "nmos");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 220, y: 180 } });
  await page.keyboard.press("Escape");
  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 380, y: 180 } });
  await page.keyboard.press("Escape");

  await clickCommand(page, "Netlist", "Instance Table…");
  const table = page.getByRole("dialog", { name: "Instance Table" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("button", { name: "M1" })).toBeVisible();
  await expect(table.getByRole("button", { name: "M2" })).toBeVisible();
  await table.getByRole("button", { name: "Select visible" }).click();
  await table.getByLabel("Parameter name").fill("l");
  await table.getByLabel("Batch value").fill("120n");
  await expect(table.getByText("2 ready", { exact: false })).toBeVisible();
  await table.getByRole("button", { name: "Apply to 2" }).click();
  await expect(table.getByText("l=120n", { exact: false })).toHaveCount(2);
});

test("hides one device's Reference prefix from the Instance Table", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 260, y: 180 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();
  const reference = page.getByLabel("Component reference");
  await reference.fill("RG1");
  await reference.press("Tab");

  const drawnLabel = page.locator('[data-object-id="instance-label-R1"]');
  await expect(drawnLabel).toHaveText("RG1");

  await clickCommand(page, "Netlist", "Instance Table…");
  const table = page.getByRole("dialog", { name: "Instance Table" });
  const prefix = table.getByLabel("Show the R prefix on RG1");
  await expect(prefix).toBeChecked();
  await prefix.uncheck();
  await expect(prefix).not.toBeChecked();
  // The row still reports the whole Reference; only the sheet is shortened.
  await expect(table.getByText("RG1", { exact: true })).toBeVisible();
  await table.getByRole("button", { name: "Close instance table" }).click();

  await expect(drawnLabel).toHaveText("G1");
});
