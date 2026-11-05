import { expect, test } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { hierarchyNavigationFixture as fixture } from "../../../netlists/hierarchy-navigation/fixture";
import {
  openProject,
  exportedProject,
  revealPropertiesShelf,
} from "./editor-fixtures";

const toolbar = (page: import("@playwright/test").Page) =>
  page.getByLabel("Cell navigation", { exact: true });

test("unified tree follows four levels, shared uses and detached definitions, and restores the path", async ({
  page,
}, testInfo) => {
  await openProject(page, fixture());
  await toolbar(page)
    .getByRole("button", { name: "Hierarchy", exact: true })
    .click();
  const tree = page.getByRole("complementary", { name: "Circuit hierarchy" });
  await tree
    .getByRole("button", { name: "Expand Top · dut", exact: true })
    .click();
  await tree
    .getByRole("button", { name: "Expand X2: Channel", exact: true })
    .click();
  await tree
    .getByRole("button", { name: "Expand XA: Amplifier", exact: true })
    .click();
  await tree.getByRole("button", { name: "XP: Pair", exact: true }).click();
  const path = page.getByRole("navigation", { name: "Instance path" });
  await expect(path).toContainText(
    "Top / X2: Channel / XA: Amplifier / XP: Pair",
  );
  await testInfo.attach("Four-level unified hierarchy", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await toolbar(page).getByRole("button", { name: "Up", exact: true }).click();
  await expect(page.getByTestId("hit-XP")).toHaveClass(/selected/u);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Shift+e");
  await expect(path).toContainText("Top / X2: Channel");
  await page.getByTestId("hit-XA").click();
  await revealPropertiesShelf(page);
  const parameters = page.getByRole("region", { name: "Instance parameters" });
  await expect(parameters).toContainText(
    "All 2 occurrences of Channel share these overrides",
  );
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .fill("25");
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .press("Enter");
  await expect(parameters).toContainText("Override · default: 10");
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .fill("30");
  await parameters.getByLabel("Reset gain to default").click();
  await expect(parameters).toContainText("Inherited default: 10");
  await expect(
    parameters.getByLabel("Instance parameter gain", { exact: true }),
  ).toHaveValue("");
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .fill("inherit");
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .press("Enter");
  await expect(parameters).toContainText("Override · default: 10");
  await parameters.getByLabel("Reset gain to default").click();
  await expect(
    parameters.getByLabel("Instance parameter gain", { exact: true }),
  ).toHaveValue("");
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .fill("40");
  await parameters
    .getByLabel("Instance parameter gain", { exact: true })
    .press("Tab");
  await expect(parameters.getByLabel("Reset gain to default")).toBeFocused();
  await expect(parameters).toContainText("Override · default: 10");
  await parameters.getByLabel("Reset gain to default").press("Tab");
  await expect(parameters).toContainText("Override · default: 10");
  await parameters.getByLabel("Reset gain to default").click();
  await expect(parameters).toContainText("Inherited default: 10");
  await tree.getByRole("button", { name: "XP: Pair", exact: true }).click();
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(path).toHaveText("Top");
  await page.getByRole("tab", { name: /Unified hierarchy/u }).click();
  await expect(path).toContainText(
    "Top / X2: Channel / XA: Amplifier / XP: Pair",
  );
  await expect(
    tree.getByRole("button", { name: "XP: Pair", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(path).toContainText(
    "Top / X2: Channel / XA: Amplifier / XP: Pair",
  );
  await toolbar(page)
    .getByRole("button", { name: "Hierarchy", exact: true })
    .click();
  await expect(
    tree.getByRole("button", { name: "XP: Pair", exact: true }),
  ).toBeVisible();
  await tree.getByLabel("Actions for XP: Pair", { exact: true }).click();
  await tree.getByRole("button", { name: "Show uses", exact: true }).click();
  const uses = tree.getByRole("list", { name: "Cell uses" });
  await expect(uses.getByRole("button")).toHaveCount(3);
  await uses
    .getByRole("button", { name: "Unused / XP: Pair", exact: true })
    .click();
  await expect(path).toContainText("Unused (definition) / XP: Pair");
  await toolbar(page).getByRole("button", { name: "Up", exact: true }).click();
  await expect(path).toHaveText("Unused (definition)");
});

test("new child cancels without an orphan and creates ports, definition and caller atomically", async ({
  page,
}) => {
  await openProject(page, createEmptyProject("create", "Create child", "top"));
  await toolbar(page)
    .getByRole("button", { name: "New child", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "New child Cell",
    exact: true,
  });
  await dialog.getByLabel("Child Cell name").fill("Cancelled");
  await dialog.getByRole("button", { name: "Place and enter" }).click();
  await page.keyboard.press("Escape");
  expect((await exportedProject(page)).documents).toHaveLength(1);
  await toolbar(page)
    .getByRole("button", { name: "New child", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "New child Cell", exact: true });
  await dialog.getByLabel("Child Cell name").fill("Stage");
  await dialog.getByRole("button", { name: "Add Port" }).click();
  await dialog.getByLabel("Port 1 name").fill("IN");
  await dialog.getByRole("button", { name: "Add Port" }).click();
  await dialog.getByLabel("Port 2 name").fill("OUT");
  await dialog.getByLabel("Port 2 direction").selectOption("output");
  await dialog.getByRole("button", { name: "Place and enter" }).click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 240, y: 200 } });
  await expect(
    page.getByRole("navigation", { name: "Instance path" }),
  ).toContainText("X1: Stage");
  let project = await exportedProject(page);
  expect(project.documents).toHaveLength(2);
  expect(
    project.documents[1].netlist.terminals.map(
      (port: { name: string }) => port.name,
    ),
  ).toEqual(["IN", "OUT"]);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("navigation", { name: "Instance path" }),
  ).toHaveText("Top");
  project = await exportedProject(page);
  expect(project.documents).toHaveLength(1);
  expect(project.documents[0].instances).toHaveLength(0);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Control+Shift+z");
  project = await exportedProject(page);
  expect(project.documents).toHaveLength(2);
  expect(project.documents[0].instances).toHaveLength(1);
});

test("tree definition forms migrate ports and parameters without changing the active occurrence", async ({
  page,
}) => {
  await openProject(page, fixture());
  await toolbar(page)
    .getByRole("button", { name: "Hierarchy", exact: true })
    .click();
  const tree = page.getByRole("complementary", { name: "Circuit hierarchy" });
  await tree
    .getByRole("button", { name: "Expand Top · dut", exact: true })
    .click();
  await tree
    .getByRole("button", { name: "Expand X2: Channel", exact: true })
    .click();
  await tree.getByLabel("Actions for XA: Amplifier", { exact: true }).click();
  await tree
    .getByRole("button", { name: "Cell properties…", exact: true })
    .click();
  const properties = page.getByRole("dialog", {
    name: "Cell properties",
    exact: true,
  });
  await expect(
    properties.getByRole("complementary", { name: "Cells" }),
  ).toHaveCount(0);
  await properties.getByLabel("Port IN name", { exact: true }).fill("SIGNAL");
  await properties.getByLabel("Port IN name", { exact: true }).press("Enter");
  await properties
    .getByRole("button", { name: "Move OUT up", exact: true })
    .click();
  await properties.getByLabel("New parameter name").fill("bias");
  await properties.getByLabel("New parameter default").fill("2");
  await properties
    .getByRole("button", { name: "Add parameter", exact: true })
    .click();
  await properties
    .getByLabel("Parameter bias default", { exact: true })
    .fill("3");
  await properties
    .getByLabel("Parameter bias default", { exact: true })
    .press("Enter");
  await properties.getByLabel("Remove parameter bias", { exact: true }).click();
  await properties
    .getByLabel("Parameter gain name", { exact: true })
    .fill("stageGain");
  await properties
    .getByLabel("Parameter gain name", { exact: true })
    .press("Enter");
  await expect(
    properties.getByLabel("Remove parameter stageGain", { exact: true }),
  ).toBeDisabled();
  await properties.getByLabel("Cell symbol width", { exact: true }).fill("180");
  await properties.getByLabel("Cell symbol height", { exact: true }).click();
  await properties.getByLabel("Close Cell Manager").click();
  await expect(
    page.getByRole("navigation", { name: "Instance path" }),
  ).toHaveText("Top");
  const saved = await exportedProject(page);
  const amplifier = saved.documents.find(
    (cell: { id: string }) => cell.id === "amplifier",
  );
  const channel = saved.documents.find(
    (cell: { id: string }) => cell.id === "channel",
  );
  expect(
    amplifier.netlist.terminals.map((port: { name: string }) => port.name),
  ).toEqual(["OUT", "SIGNAL"]);
  expect(amplifier.netlist.formalParameters).toEqual([
    { name: "stageGain", defaultValue: "10" },
  ]);
  expect(
    channel.instances.find((instance: { id: string }) => instance.id === "XA")
      .netlist.parameters,
  ).toEqual({ stageGain: "{gain}" });
  expect(channel.nets[0].terminals).toContainEqual({
    instanceId: "XA",
    pinName: "SIGNAL",
  });
  expect(amplifier.presentation.cellSymbol.minimumBodySize.width).toBe(180);
});

test("deleting an unused definition preserves the active occurrence; cancelling a Port merge preserves its name", async ({
  page,
}) => {
  await openProject(page, fixture());
  await toolbar(page)
    .getByRole("button", { name: "Hierarchy", exact: true })
    .click();
  const tree = page.getByRole("complementary", { name: "Circuit hierarchy" });
  await tree
    .getByRole("button", { name: "Expand Top · dut", exact: true })
    .click();
  await tree.getByRole("button", { name: "X2: Channel", exact: true }).click();
  await tree.getByLabel("Actions for Unused", { exact: true }).click();
  await tree
    .getByRole("button", { name: "Cell properties…", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Cell properties", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete Cell", exact: true })
    .getByRole("button", { name: "Delete Cell", exact: true })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Instance path" }),
  ).toHaveText("Top / X2: Channel");
  await toolbar(page)
    .getByRole("button", { name: "Cell properties", exact: true })
    .click();
  const properties = page.getByRole("dialog", {
    name: "Cell properties",
    exact: true,
  });
  await properties.getByLabel("Port IN name", { exact: true }).fill("OUT");
  await properties.getByLabel("Port IN name", { exact: true }).press("Enter");
  const confirmation = page.getByRole("dialog", {
    name: "Merge Cell Ports?",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    properties.getByLabel("Port IN name", { exact: true }),
  ).toHaveValue("IN");
  await properties.getByLabel("Close Cell Manager").click();
  const saved = await exportedProject(page);
  expect(
    saved.documents.some((cell: { id: string }) => cell.id === "unused"),
  ).toBe(false);
  expect(
    saved.documents
      .find((cell: { id: string }) => cell.id === "channel")
      .netlist.terminals.map((port: { name: string }) => port.name),
  ).toEqual(["IN", "OUT"]);
});
