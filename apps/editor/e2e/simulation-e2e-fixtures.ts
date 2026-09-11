import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export const profile = JSON.parse(
  readFileSync(
    new URL(
      "../../../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  id: string;
  displayName: string;
  simulator: { version: string };
  models: {
    id: string;
    contentSha256: string;
    library: { runtimePath: string };
  };
};

export const ota = JSON.parse(
  readFileSync(
    new URL(
      "../src/examples/five-transistor-ota-sky130.icproj.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

export async function editSimulationFile(
  page: Page,
  path: string,
  text: string,
) {
  const panel = page.getByRole("region", { name: "Analog simulation" });
  if (path === "experiment.json") {
    await panel.getByRole("button", { name: "More code actions" }).click();
    await page
      .getByRole("menuitem", { name: "Advanced configuration" })
      .click();
  } else await panel.getByRole("tab", { name: path, exact: false }).click();
  const editor = panel.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("Control+A");
  await page.keyboard.insertText(text);
}
