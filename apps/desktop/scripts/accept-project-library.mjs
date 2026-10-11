import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { parseProject } from "@icm/project-protocol";

/** Exercises the project manager through its real renderer and filesystem host. */
export async function acceptProjectLibrary({
  page,
  running,
  source,
  fileCommand,
  screenshot,
}) {
  await page.getByTestId("tab-project-file").setInputFiles(source);
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/^Saved:/)).toBeVisible();
  const path = await page
    .getByTestId("native-file-location")
    .getAttribute("title");
  const original = parseProject(await readFile(path, "utf8"));
  await fileCommand(page, "Local projects…");
  const manager = page.getByRole("dialog", {
    name: "Local projects",
    exact: true,
  });
  const entries = manager.getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await entries.getByRole("button", { name: "Favorite", exact: true }).click();
  await manager.getByLabel("Project list filter").selectOption("favorites");
  await expect(entries).toHaveCount(1);
  await entries.getByRole("button", { name: "Copy", exact: true }).click();
  await manager.getByLabel("Project list filter").selectOption("all");
  await expect(entries).toHaveCount(2);
  const copy = entries.filter({ hasText: `${original.name} (copy)` });
  await copy.getByRole("button", { name: "Rename…", exact: true }).click();
  await manager
    .getByLabel("Project name", { exact: true })
    .fill("Library renamed copy");
  await manager.getByRole("button", { name: "Save name", exact: true }).click();
  const renamed = entries.filter({ hasText: "Library renamed copy" });
  await expect(renamed).toHaveCount(1);
  await renamed.getByRole("button", { name: "History", exact: true }).click();
  const history = manager.getByRole("region", { name: "Local save history" });
  await expect(history.getByLabel("Saved version")).toBeVisible();
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  await renamed
    .getByRole("button", { name: "Move to recycle area…", exact: true })
    .click();
  await expect(entries).toHaveCount(1);
  await manager.getByLabel("Project list filter").selectOption("recycle");
  await expect(entries).toHaveCount(1);
  await entries
    .getByRole("button", { name: "Restore project", exact: true })
    .click();
  await expect(entries).toHaveCount(0);
  await manager.getByLabel("Project list filter").selectOption("all");
  await expect(entries).toHaveCount(2);
  await manager
    .getByLabel("Search local projects")
    .fill("Library renamed copy");
  await expect(entries).toHaveCount(1);
  await page.screenshot({ path: screenshot });
  await manager.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(
    await page.getByTestId("native-file-location").getAttribute("title"),
    path,
  );
  assert.equal(parseProject(await readFile(path, "utf8")).id, original.id);
}
