import { expect, test, type Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { hierarchyNavigationFixture as fixture } from "../../../netlists/hierarchy-navigation/fixture";
import {
  exportedProject,
  hierarchyRowCommand,
  openCellProperties,
  openHierarchyTree,
  openProject,
  revealHierarchyRow,
  revealPropertiesShelf,
} from "./editor-fixtures";

const path = (page: Page) =>
  page.getByRole("navigation", { name: "Instance path" });
/** The crumbs of the canvas path, root first. */
const crumbs = (page: Page) =>
  path(page)
    .locator(".hierarchy-breadcrumb-step")
    .locator("button, [aria-current]");
const activeDocument = (page: Page) =>
  page.getByTestId("active-document-id").first();

test("unified tree follows four levels, shared uses and detached definitions, and restores the path", async ({
  page,
}, testInfo) => {
  await openProject(page, fixture());
  // Top opens as the working root, already expanded.
  const tree = await openHierarchyTree(page);
  await tree
    .getByRole("button", { name: "Expand X2: Channel", exact: true })
    .click();
  await tree
    .getByRole("button", { name: "Expand XA: Amplifier", exact: true })
    .click();
  await tree.getByRole("button", { name: "XP: Pair", exact: true }).click();
  await expect(crumbs(page)).toHaveText([
    "Top",
    "X2: Channel",
    "XA: Amplifier",
    "XP: Pair",
  ]);
  await testInfo.attach("Four-level unified hierarchy", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await path(page)
    .getByRole("button", { name: "Up to the caller", exact: true })
    .click();
  await expect(page.getByTestId("hit-XP")).toHaveClass(/selected/u);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Shift+e");
  await expect(crumbs(page)).toHaveText(["Top", "X2: Channel"]);
  await page.getByTestId("hit-XA").click();
  await revealPropertiesShelf(page);
  const parameters = page.getByRole("region", { name: "Instance parameters" });
  const gain = parameters.getByLabel("Instance parameter gain", {
    exact: true,
  });
  const reset = parameters.getByLabel("Reset gain to default");
  const overridden = "Overrides the default 10";
  const inherited = "Inherits the default 10";
  // Both uses of Channel share the overrides of its parts.
  await expect(parameters).toContainText("Shared by all 2 uses of Channel.");
  await gain.fill("25");
  await gain.press("Enter");
  await expect(gain).toHaveAttribute("title", overridden);
  // A pointer Reset also discards the draft.
  await gain.fill("30");
  await reset.click();
  await expect(gain).toHaveAttribute("title", inherited);
  await expect(gain).toHaveValue("");
  // A literal "inherit" is an override like any other value.
  await gain.fill("inherit");
  await gain.press("Enter");
  await expect(gain).toHaveAttribute("title", overridden);
  await reset.click();
  await expect(gain).toHaveValue("");
  // Tab commits the draft and reaches Reset, which keeps it until clicked.
  await gain.fill("40");
  await gain.press("Tab");
  await expect(reset).toBeFocused();
  await expect(gain).toHaveAttribute("title", overridden);
  await reset.press("Tab");
  await expect(gain).toHaveAttribute("title", overridden);
  await reset.click();
  await expect(gain).toHaveAttribute("title", inherited);

  await tree.getByRole("button", { name: "XP: Pair", exact: true }).click();
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  // A new Project opens at its Top, where no path shows.
  await expect(path(page)).toHaveCount(0);
  await page.getByRole("tab", { name: /Unified hierarchy/u }).click();
  await expect(crumbs(page)).toHaveText([
    "Top",
    "X2: Channel",
    "XA: Amplifier",
    "XP: Pair",
  ]);
  await expect(
    tree.getByRole("button", { name: "XP: Pair", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(crumbs(page)).toHaveText([
    "Top",
    "X2: Channel",
    "XA: Amplifier",
    "XP: Pair",
  ]);
  await openHierarchyTree(page);
  await expect(
    tree.getByRole("button", { name: "XP: Pair", exact: true }),
  ).toBeVisible();
  // Pair has three uses, listed under the row on request.
  await tree
    .getByRole("button", { name: "3 uses of Pair", exact: true })
    .click();
  const uses = tree.getByRole("group", { name: "Uses of Pair" });
  await expect(uses.getByRole("button")).toHaveCount(3);
  await uses
    .getByRole("button", { name: "Unused / XP: Pair", exact: true })
    .click();
  // A path under another root names that root and offers Top.
  await expect(crumbs(page)).toHaveText(["Unused", "XP: Pair"]);
  await expect(
    path(page).getByRole("button", { name: "Top", exact: true }),
  ).toBeVisible();
  await path(page)
    .getByRole("button", { name: "Up to the caller", exact: true })
    .click();
  // At a root, Top or not, the canvas shows no path.
  await expect(activeDocument(page)).toHaveText("unused");
  await expect(path(page)).toHaveCount(0);
});

test("new child cancels without an orphan and creates Pins, definition and caller atomically", async ({
  page,
}) => {
  await openProject(page, createEmptyProject("create", "Create child", "top"));
  const tree = await openHierarchyTree(page);
  const dialog = page.getByRole("dialog", {
    name: "New child Cell in dut",
    exact: true,
  });
  const newChild = async (name: string, pins = "") => {
    await (await revealHierarchyRow(tree, "Top · dut")).hover();
    await tree
      .getByRole("button", { name: "New child Cell in dut", exact: true })
      .click();
    await dialog.getByLabel("Cell name", { exact: true }).fill(name);
    await dialog.getByLabel("Add Pins", { exact: true }).fill(pins);
    await dialog
      .getByRole("button", { name: "Create and place", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  await newChild("Cancelled");
  await page.keyboard.press("Escape");
  expect((await exportedProject(page)).documents).toHaveLength(1);
  // Directions are guessed from the names: OUT is an output.
  await newChild("Stage", "IN, OUT");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 240, y: 200 } });
  await expect(crumbs(page)).toHaveText(["Top", "X1: Stage"]);
  let project = await exportedProject(page);
  expect(project.documents).toHaveLength(2);
  expect(
    project.documents[1].netlist.terminals.map(
      (port: { name: string; direction: string }) =>
        `${port.name}:${port.direction}`,
    ),
  ).toEqual(["IN:input", "OUT:output"]);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Control+z");
  await expect(activeDocument(page)).toHaveText("top");
  await expect(path(page)).toHaveCount(0);
  project = await exportedProject(page);
  expect(project.documents).toHaveLength(1);
  expect(project.documents[0].instances).toHaveLength(0);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("Control+Shift+z");
  project = await exportedProject(page);
  expect(project.documents).toHaveLength(2);
  expect(project.documents[0].instances).toHaveLength(1);
});

test("Cell properties migrate Pins and parameters without changing the open occurrence", async ({
  page,
}) => {
  await openProject(page, fixture());
  await (
    await openHierarchyTree(page)
  )
    .getByRole("button", { name: "Expand X2: Channel", exact: true })
    .click();
  const properties = await openCellProperties(page, "XA: Amplifier");
  await expect(properties).toHaveAccessibleName("Amplifier Cell properties");
  await properties.getByLabel("Port IN name", { exact: true }).fill("SIGNAL");
  await properties.getByLabel("Port IN name", { exact: true }).press("Enter");
  // A row's actions show on the row pointed at.
  await properties
    .getByRole("row")
    .filter({ has: page.getByLabel("Port OUT name", { exact: true }) })
    .hover();
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
  await properties
    .getByRole("row")
    .filter({ has: page.getByLabel("Parameter bias name", { exact: true }) })
    .hover();
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
  // Leaving a field commits it.
  await properties.getByLabel("Cell symbol height", { exact: true }).click();
  await properties.getByLabel("Close Cell properties").click();
  await expect(activeDocument(page)).toHaveText("top");
  await expect(path(page)).toHaveCount(0);
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

test("deleting an unused definition keeps the open occurrence; cancelling a Pin merge keeps its name", async ({
  page,
}) => {
  await openProject(page, fixture());
  const tree = await openHierarchyTree(page);
  await tree.getByRole("button", { name: "X2: Channel", exact: true }).click();
  await expect(crumbs(page)).toHaveText(["Top", "X2: Channel"]);
  await hierarchyRowCommand(page, "Unused", /^Delete Cell/u);
  await expect(
    tree.getByRole("button", { name: "Unused", exact: true }),
  ).toHaveCount(0);
  await expect(crumbs(page)).toHaveText(["Top", "X2: Channel"]);
  const properties = await openCellProperties(page);
  await expect(properties).toHaveAccessibleName("Channel Cell properties");
  await properties.getByLabel("Port IN name", { exact: true }).fill("OUT");
  await properties.getByLabel("Port IN name", { exact: true }).press("Enter");
  await page
    .getByRole("dialog", { name: "Merge Cell Ports?", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    properties.getByLabel("Port IN name", { exact: true }),
  ).toHaveValue("IN");
  await properties.getByLabel("Close Cell properties").click();
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

test("Top moves as a badge, and the tree reshapes the hierarchy one Undo at a time", async ({
  page,
}) => {
  await openProject(page, fixture());
  const tree = await openHierarchyTree(page);
  const roots = tree.locator(
    '[role="treeitem"][aria-level="1"] .hierarchy-node-label',
  );
  const status = page.getByTestId("status");
  const undo = async () => {
    await page.getByTestId("schematic-canvas").focus();
    await page.keyboard.press("Control+z");
  };
  await expect(roots).toHaveText(["dut", "Unused"]);

  // Setting Top moves its badge; the roots stay where they are.
  await (await revealHierarchyRow(tree, "Unused")).hover();
  await tree
    .getByRole("button", { name: "Set Unused as Top", exact: true })
    .click();
  await expect(
    tree.getByRole("button", { name: "Top · Unused", exact: true }),
  ).toBeVisible();
  await expect(roots).toHaveText(["dut", "Unused"]);
  expect((await exportedProject(page)).topDocumentId).toBe("unused");
  await undo();
  await expect(
    tree.getByRole("button", { name: "Top · dut", exact: true }),
  ).toBeVisible();

  // One use takes its own copy of its Cell.
  await hierarchyRowCommand(page, "X1: Channel", "Make unique copy");
  await expect(status).toContainText("X1 now uses Channel_2");
  await expect(
    tree.getByRole("button", { name: "X2: Channel", exact: true }),
  ).toBeVisible();

  // Another switches to it; only Cells with the same Pins are offered.
  await hierarchyRowCommand(page, "X2: Channel", "Replace Cell…");
  const replace = page.getByRole("dialog", { name: /^Replace Channel/u });
  await expect(replace.getByRole("option", { name: /^Unused/u })).toBeEnabled();
  await expect(
    replace.getByRole("option", { name: /^Amplifier/u }),
  ).toBeEnabled();
  await replace.getByRole("option", { name: /^Channel_2/u }).click();
  await replace.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(replace).toHaveCount(0);
  await expect(
    tree.getByRole("button", { name: "X2: Channel_2", exact: true }),
  ).toBeVisible();
  // Channel, no longer used, becomes a root after the others.
  await expect(roots).toHaveText(["dut", "Unused", "Channel"]);

  // Flattening puts the Amplifier's parts into Channel_2, selected.
  await hierarchyRowCommand(page, "XA: Amplifier", "Flatten into Channel_2");
  await expect(status).toContainText(
    "Flattened Amplifier into Channel_2, in all 2 uses of Channel_2",
  );
  const selected = page.locator('[data-testid^="hit-"][class*="selected"]');
  await expect(selected).toHaveCount(1);
  await expect(
    tree.getByRole("button", { name: "XA: Amplifier", exact: true }),
  ).toHaveCount(0);

  // The selected parts become a new Cell whose Pins join the Nets they left.
  await selected.click({ button: "right" });
  await page.getByText("Create Cell from selection…", { exact: true }).click();
  const create = page.getByRole("dialog", {
    name: "New Cell from 1 selected part",
  });
  await expect(create.locator(".pin-token")).toHaveText(["IN", "OUT"]);
  await create.getByLabel("Cell name", { exact: true }).fill("Wrap");
  await create
    .getByRole("button", { name: "Create from selection", exact: true })
    .click();
  await expect(status).toContainText("Moved 1 part into Wrap");
  const wrap = tree
    .locator(".hierarchy-node-label")
    .and(tree.getByRole("button", { name: "X1: Wrap", exact: true }));
  await expect(wrap.first()).toBeVisible();

  // Each reshaping is one Undo.
  await undo();
  await expect(wrap).toHaveCount(0);
  await undo();
  await expect(
    tree.getByRole("button", { name: "XA: Amplifier", exact: true }).first(),
  ).toBeVisible();
  await undo();
  await expect(
    tree.getByRole("button", { name: "X2: Channel", exact: true }),
  ).toBeVisible();
  await undo();
  await expect(
    tree.getByRole("button", { name: "X1: Channel", exact: true }),
  ).toBeVisible();
  expect((await exportedProject(page)).documents).toHaveLength(5);
});
