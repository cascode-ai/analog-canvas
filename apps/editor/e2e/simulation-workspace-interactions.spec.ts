import { test, expect, type Page } from "@playwright/test";
import { createSimulationFolder } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { ota, profile } from "./simulation-e2e-fixtures.js";

async function openWorkspace(page: Page) {
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = ["Alpha", "Beta"].map((name) =>
    createSimulationFolder({
      id: name,
      name,
      documentId: project.topDocumentId,
      profileId: profile.id,
    }),
  );
  await page.goto("/editor");
  await page
    .getByTestId("project-file")
    .setInputFiles({
      name: "interactions.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
  await page.getByTestId("open-analog-simulation").click();
  return page.getByRole("region", { name: "Simulation Code workspace" });
}

test("workspace menus, selection, empty editors and resizing share non-destructive semantics", async ({
  page,
}) => {
  const workspace = await openWorkspace(page);
  const files = workspace.getByRole("complementary", {
    name: "Simulation files",
  });
  const alpha = files.getByRole("button", {
    name: "Folder Alpha",
    exact: true,
  });
  const beta = files.getByRole("button", { name: "Folder Beta", exact: true });
  await expect(
    workspace.getByRole("tab", { name: "run.cir", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const before = await files.boundingBox();
  await files
    .getByRole("button", { name: "◇ circuit.spice", exact: true })
    .first()
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Actions for circuit.spice" }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("tab", { name: "run.cir", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect((await files.boundingBox())!.width).toBe(before!.width);
  // One outside click both dismisses the menu and activates its intended target.
  await beta.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(beta).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("title", "Run Alpha");
  await files
    .getByRole("button", { name: "Toggle Alpha", exact: true })
    .click();
  await expect(alpha).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("title", "Run Alpha");
  await workspace
    .getByRole("button", { name: "Close run.cir", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Close circuit.spice", exact: true })
    .click();
  await expect(
    workspace
      .getByRole("tablist", { name: "Open simulation files" })
      .getByRole("tab"),
  ).toHaveCount(0);
  await expect(
    workspace.getByText("Select a file to edit.", { exact: false }),
  ).toBeVisible();
  await files
    .getByRole("button", { name: "Toggle Alpha", exact: true })
    .click();
  await files
    .getByRole("button", { name: "· run.cir", exact: true })
    .first()
    .click();
  await expect(
    workspace.getByRole("textbox", { name: "Simulation source editor" }),
  ).toBeVisible();
  const handle = workspace.getByRole("separator", {
    name: "Resize simulation files",
  });
  const original = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(original + 10));
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "170");
  await alpha.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(workspace).toBeVisible();
});

test("inline naming commits once on blur, cancels on Escape, and deletion uses a local dialog", async ({
  page,
}) => {
  const workspace = await openWorkspace(page);
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.type());
    void dialog.dismiss();
  });
  await workspace
    .getByRole("button", { name: "+ New folder…", exact: true })
    .click();
  const input = workspace.getByRole("textbox", {
    name: "New simulation folder name",
  });
  await input.fill("Gamma");
  await workspace.getByLabel("Folder template").selectOption("AC");
  // The destination click is not eaten by the naming transaction.
  await workspace
    .getByRole("button", { name: "Folder Beta", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Folder Gamma", exact: true }),
  ).toHaveCount(1);
  await expect(
    workspace.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText("ac ");
  await workspace
    .getByRole("button", { name: "+ New folder…", exact: true })
    .click();
  await workspace
    .getByRole("textbox", { name: "New simulation folder name" })
    .fill("Cancelled");
  await page.keyboard.press("Escape");
  await expect(
    workspace.getByRole("button", { name: "Folder Cancelled", exact: true }),
  ).toHaveCount(0);
  const gamma = workspace.getByRole("button", {
    name: "Folder Gamma",
    exact: true,
  });
  await gamma.focus();
  await gamma.press("F2");
  await workspace
    .getByRole("textbox", { name: "Folder name", exact: true })
    .fill("Renamed");
  await page.keyboard.press("Enter");
  const renamed = workspace.getByRole("button", {
    name: "Folder Renamed",
    exact: true,
  });
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New file…", exact: true }).click();
  const fileName = workspace.getByRole("textbox", {
    name: "Relative file path",
  });
  await fileName.fill("run.cir");
  await fileName.press("Enter");
  await expect(fileName).toHaveAttribute("aria-invalid", "true");
  await fileName.fill("stimulus.cir");
  await fileName.press("Enter");
  await expect(
    workspace.getByRole("tab", { name: "stimulus.cir", exact: true }),
  ).toBeVisible();
  await renamed.focus();
  await renamed.press("Delete");
  const dialog = page.getByRole("dialog", { name: "Delete folder Renamed?" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(renamed).toBeVisible();
  await renamed.focus();
  await renamed.press("Delete");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(renamed).toHaveCount(0);
  expect(nativeDialogs).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "The editor hit an unexpected problem" }),
  ).toHaveCount(0);
});
