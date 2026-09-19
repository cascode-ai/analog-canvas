import { expect, test } from "@playwright/test";
import { analyzeDesignNetlist } from "@icm/netlist";

import {
  revealPropertiesShelf,
  clickCommand,
  downloadBytes,
} from "./editor-fixtures.js";
import { placeComponent } from "./manual-editor-fixtures.js";

async function runCellCommand(
  page: import("@playwright/test").Page,
  name: "Manage Cells…" | "Place Cell",
): Promise<void> {
  // The hierarchy row only appears once there is a hierarchy to navigate, so
  // the first Cell is created from Edit.
  if (name === "Manage Cells…") {
    const row = page.getByTestId("cell-command-menu");
    if ((await row.count()) === 0) {
      await clickCommand(page, "Edit", "Manage Cells…");
      return;
    }
  }
  await page
    .getByTestId("cell-command-menu")
    .getByRole("button", { name, exact: true })
    .click();
}

async function createCell(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: "New Cell" }).click();
  const editor = page.getByRole("dialog", { name: "New Cell" });
  await editor.getByLabel("Cell name").fill(name);
  await editor.getByRole("button", { name: "Create" }).click();
}

async function placeCellPin(
  page: import("@playwright/test").Page,
  options: {
    name: string;
    direction?: "input" | "output" | "inout" | "passive";
    position: { x: number; y: number };
  },
): Promise<void> {
  const labels = page.locator(
    '[data-testid^="annotation-hit-instance-label-"]',
  );
  const existingLabelCount = await labels.count();
  await page.getByTestId("shapes-chip-port").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: options.position });
  await page.keyboard.press("Escape");
  await labels.nth(existingLabelCount).dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill(options.name);
  await page.getByRole("button", { name: "Apply text changes" }).click();
  if (options.direction) {
    await runCellCommand(page, "Manage Cells…");
    const manager = page.getByRole("dialog", { name: "Cell Manager" });
    await manager
      .getByRole("table", { name: "Formal port order" })
      .getByRole("row")
      .last()
      .getByRole("combobox")
      .selectOption(options.direction);
    await manager.getByLabel("Close Cell Manager").click();
  }
}

async function renameCellPinOnCanvas(
  page: import("@playwright/test").Page,
  instanceId: string,
  name: string,
): Promise<void> {
  await page
    .getByTestId(`annotation-hit-instance-label-${instanceId}`)
    .dblclick();
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill(name);
  await page.getByRole("button", { name: "Apply text changes" }).click();
}

async function setCellTerminalDirection(
  page: import("@playwright/test").Page,
  name: string,
  direction: "input" | "output" | "inout" | "passive",
): Promise<void> {
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByLabel(`Formal port ${name} direction`)
    .selectOption(direction);
  await manager.getByLabel("Close Cell Manager").click();
}

test("manages external declarations independently of local Cell interfaces", async ({
  page,
}) => {
  await page.goto("/editor");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  const types = manager.getByRole("group", { name: "Definition type" });
  await expect(
    manager.getByLabel("Cell interface", { exact: true }),
  ).toBeVisible();
  await expect(manager.getByLabel("External subcircuit target")).toHaveCount(0);
  await types
    .getByRole("button", { name: "External Circuits", exact: true })
    .click();
  await expect(
    manager.getByLabel("Cell interface", { exact: true }),
  ).toHaveCount(0);
  await expect(
    manager.getByRole("button", { name: "Open", exact: true }),
  ).toHaveCount(0);
  await expect(manager.getByText("Reset Cell", { exact: true })).toHaveCount(0);
  await manager.getByLabel("External subcircuit target").fill("amplifier");
  await manager
    .getByLabel("External subcircuit terminals")
    .fill("IN, OUT, VDD, VSS");
  await manager
    .getByLabel("External subcircuit formal parameters")
    .fill("gain=10");
  await manager
    .getByRole("button", { name: "Create External Circuit", exact: true })
    .click();
  const externalList = manager.getByRole("complementary", {
    name: "External Circuits",
  });
  await externalList.getByRole("button", { name: /amplifier/ }).click();
  await expect(manager.getByLabel("External subcircuit terminals")).toHaveValue(
    "IN, OUT, VDD, VSS",
  );
  await manager
    .getByLabel("External subcircuit formal parameters")
    .fill("gain=20");
  await manager.getByRole("button", { name: "Save definition" }).click();
  await types.getByRole("button", { name: "Cells", exact: true }).click();
  await expect(
    manager.getByLabel("Cell interface", { exact: true }),
  ).toBeVisible();
  await expect(manager.getByLabel("External subcircuit target")).toHaveCount(0);
  await types
    .getByRole("button", { name: "External Circuits", exact: true })
    .click();
  await expect(
    manager.getByLabel("External subcircuit formal parameters"),
  ).toHaveValue("gain=20");
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+z");
  await runCellCommand(page, "Manage Cells…");
  await types
    .getByRole("button", { name: "External Circuits", exact: true })
    .click();
  await externalList.getByRole("button", { name: /amplifier/ }).click();
  await expect(
    manager.getByLabel("External subcircuit formal parameters"),
  ).toHaveValue("gain=10");
});

test("creates and places an external interface with connected netlist semantics", async ({
  page,
}) => {
  await page.goto("/editor");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByRole("group", { name: "Definition type" })
    .getByRole("button", { name: "External Circuits" })
    .click();
  const create = manager.getByRole("button", {
    name: "Create External Circuit",
    exact: true,
  });
  await create.click();
  await expect(manager.getByRole("alert")).toContainText("target name");
  await manager.getByLabel("External subcircuit target").fill("external_load");
  await manager.getByLabel("External subcircuit terminals").fill("IN IN");
  await create.click();
  await expect(manager.getByRole("alert")).toContainText(/duplicate/i);
  await manager.getByLabel("External subcircuit terminals").fill("IN OUT");
  await create.click();
  await expect(
    manager.getByRole("button", { name: "Save definition" }),
  ).toBeVisible();
  await manager
    .getByRole("button", { name: "New External Circuit", exact: true })
    .click();
  await expect(manager.getByLabel("External subcircuit target")).toHaveValue(
    "",
  );
  await manager.getByLabel("External subcircuit target").fill("external_load");
  await create.click();
  await expect(manager.getByRole("alert")).toContainText(/duplicate/i);
  await manager
    .getByRole("complementary", { name: "External Circuits" })
    .getByRole("button", { name: /external_load/ })
    .click();
  await manager.getByRole("button", { name: "Place", exact: true }).click();
  await expect(manager).toHaveCount(0);
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 260, y: 200 } });
  await page.keyboard.press("Escape");
  const externalId = await page
    .locator('[data-canvas-hit-kind="instance"]')
    .getAttribute("data-canvas-hit-id");
  expect(externalId).toBeTruthy();
  await expect(
    page.locator('[data-pin-name="IN"] [data-text-run="subscript"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-pin-name="OUT"] [data-text-run="subscript"]'),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await placeComponent(page, "resistor", { x: 500, y: 220 });
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${externalId}-IN`).click();
  await page.getByTestId("terminal-R1-1").click();
  await page.getByTestId(`terminal-${externalId}-OUT`).click();
  await page.getByTestId("terminal-R1-2").click();
  await page.keyboard.press("Escape");
  await page.getByTestId(`hit-${externalId}`).click();
  await revealPropertiesShelf(page);
  const layoutShelf = page.getByTestId("selection-shelf");
  if ((await layoutShelf.getAttribute("aria-expanded")) === "false")
    await layoutShelf.click();
  const layout = page.getByLabel("Cell symbol layout");
  await expect(layout).toBeVisible();
  await layout.getByLabel("Cell symbol width").fill("160");
  await layout.getByLabel("Cell symbol width").press("Tab");
  await layout.getByLabel("Cell symbol IN pin side").selectOption("north");
  await layout.getByLabel("Cell symbol IN pin offset").fill("20");
  await layout.getByLabel("Cell symbol IN pin offset").press("Tab");
  await layout
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  const inputHandle = page
    .locator('[data-testid^="cell-symbol-pin-handle-"]')
    .first();
  const pinBox = (await inputHandle.boundingBox())!;
  await page.mouse.move(
    pinBox.x + pinBox.width / 2,
    pinBox.y + pinBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    pinBox.x + pinBox.width / 2 + 20,
    pinBox.y + pinBox.height / 2,
  );
  await expect(page.getByTestId("cell-symbol-layout-preview")).toContainText(
    "IN",
  );
  await page.mouse.up();
  const movedPinOffset = Number(
    await layout.getByLabel("Cell symbol IN pin offset").inputValue(),
  );
  expect(movedPinOffset).toBeGreaterThan(20);
  const bodyHandle = page.getByTestId("cell-symbol-body-handle");
  const box = (await bodyHandle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 30,
    box.y + box.height / 2 + 20,
  );
  await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  await layout
    .getByRole("button", { name: "Done editing canvas layout" })
    .click();
  // The same history path restores the definition and following routes.
  const resizedWidth = await layout
    .getByLabel("Cell symbol width")
    .inputValue();
  expect(Number(resizedWidth)).toBeGreaterThan(160);
  await page.keyboard.press("Control+z");
  await expect(layout.getByLabel("Cell symbol width")).toHaveValue("160");
  await page.keyboard.press("Control+Shift+z");
  await expect(layout.getByLabel("Cell symbol width")).toHaveValue(
    resizedWidth,
  );
  await layoutShelf.click();
  await expect(page.getByTestId("cell-symbol-layout-overlay")).toHaveCount(0);
  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const document = project.documents.find(
    (item: { id: string }) => item.id === project.topDocumentId,
  );
  const instance = document.instances.find(
    (item: { id: string }) => item.id === externalId,
  );
  expect(instance.netlist.binding).toEqual({
    kind: "external-subcircuit",
    definitionId: project.externalSubcircuitDefinitions[0].id,
  });
  expect(
    project.externalSubcircuitDefinitions[0].presentation.pinPlacements,
  ).toEqual([
    {
      terminalId: project.externalSubcircuitDefinitions[0].terminals[0].id,
      side: "north",
      offset: movedPinOffset,
    },
  ]);
  for (const pinName of ["IN", "OUT"]) {
    expect(
      document.nets.some(
        (net: { terminals: { instanceId: string; pinName: string }[] }) =>
          net.terminals.some(
            (pin) => pin.instanceId === externalId && pin.pinName === pinName,
          ) && net.terminals.some((pin) => pin.instanceId === "R1"),
      ),
    ).toBe(true);
  }
  const analyzed = analyzeDesignNetlist(project);
  expect(
    analyzed.diagnostics.filter((item) => item.severity === "error"),
  ).toEqual([]);
  const call = analyzed.ir?.cells
    .flatMap((cell) => cell.instances)
    .find((item) => item.reference === instance.reference);
  expect(call?.target).toBe("external_load");
  expect(call?.nodes.map((node) => node.pinName)).toEqual(["IN", "OUT"]);
  expect(analyzed.ir?.externalMasters?.map((master) => master.name)).toContain(
    "external_load",
  );
  expect(analyzed.ir?.cells.map((cell) => cell.name)).not.toContain(
    "external_load",
  );
  await clickCommand(page, "Netlist", "Check Report…");
  await expect(page.getByTestId("netlist-preview")).toContainText(
    new RegExp(`${instance.reference}\\s+\\S+\\s+\\S+\\s+external_load`, "u"),
  );
});

test("inherits explicit Port subscripts without guessing from pin names", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "FormattedStage");
  await placeCellPin(page, { name: "Vout", position: { x: 300, y: 180 } });
  const internalLabel = page.locator('[data-object-id="instance-label-P1"]');
  await expect(
    internalLabel.locator('[data-text-run="subscript"]'),
  ).toHaveCount(0);
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("Vout");
  await editor.press("Home");
  await editor.press("ArrowRight");
  await editor.press("Shift+End");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(internalLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "out",
  );
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await runCellCommand(page, "Place Cell");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /FormattedStage/ })
    .click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 420, y: 180 } });
  await page.keyboard.press("Escape");
  const parentPin = page.locator('[data-pin-name="Vout"]');
  await expect(parentPin.locator('[data-text-run="subscript"]')).toHaveText(
    "out",
  );
  await page.getByTestId("hit-X1").dblclick();
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await editor.focus();
  await editor.press("Control+Home");
  await editor.press("ArrowRight");
  await editor.press("Shift+End");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await expect(editor.locator("sub")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    internalLabel.locator('[data-text-run="subscript"]'),
  ).toHaveCount(0);
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await expect(parentPin).toHaveText("Vout");
  await expect(parentPin.locator('[data-text-run="subscript"]')).toHaveCount(0);
});

test("places an unreferenced top Cell in an ordinary new Cell", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "Testbench");
  await runCellCommand(page, "Place Cell");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /dut/u })
    .click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");
  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(project.topDocumentId).toBe("document-main");
  const tb = project.documents.find(
    (d: { name: string }) => d.name === "Testbench",
  );
  expect(tb.instances[0].netlist.binding).toEqual({
    kind: "subcircuit",
    childDocumentId: "document-main",
  });
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

test("shows the hierarchy row only once there is a hierarchy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.goto("/editor");

  // A flat Project has nothing to navigate, so the row stays out of the way
  // and the first Cell is created from Edit.
  const toolbar = page.locator('.toolbar-row[aria-label="Document hierarchy"]');
  // A negative count can succeed before the code-split editor route mounts.
  // Use the always-present Edit command as the positive startup anchor first.
  await expect(page.getByTestId("edit-manage-cells")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(toolbar).toHaveCount(0);

  await createCell(page, "FirstStage");
  await expect(toolbar).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Place Cell" })).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Edit Cell Interface…" }),
  ).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: /Preflight/u })).toHaveCount(
    0,
  );
  expect(
    await toolbar.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThan(90);
});

test("creates and deletes an unreferenced reusable Cell", async ({ page }) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");

  await expect(page.getByTestId("document-count")).toHaveText("2");
  await expect(page.getByTestId("document-selector")).toHaveValue(/document-/u);
  await expect(page.getByTestId("status")).toContainText(
    "Created Cell ReusableStage",
  );

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: "Delete" }).last().click();
  const confirm = page.getByRole("dialog", { name: "Delete Cell" });
  await confirm.getByRole("button", { name: "Delete Cell" }).click();
  await expect(page.getByTestId("document-count")).toHaveText("1");
  await expect(page.getByTestId("active-document-id")).toHaveText(
    "document-main",
  );
  await expect(page.getByTestId("status")).toContainText(
    "Deleted Cell ReusableStage",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("document-count")).toHaveText("2");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("document-count")).toHaveText("1");
});

test("resets the Cell selected in Manager without opening it", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "Child");
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(manager).not.toContainText("Review Symbol");
  await manager
    .locator(".cell-manager-list-item")
    .filter({ hasText: "Child" })
    .click();
  await manager.getByText("Reset Cell", { exact: true }).click();
  await manager.getByRole("button", { name: "Reset Cell Body" }).click();
  await manager
    .getByRole("dialog", { name: "Reset Cell Body in Child?" })
    .getByRole("button", { name: "Reset Cell Body" })
    .click();
  await manager.getByRole("button", { name: "Close Cell Manager" }).click();

  const resetProject = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    resetProject.documents.find(
      (candidate: { name: string }) => candidate.name === "Child",
    ).instances,
  ).toHaveLength(0);

  await page.keyboard.press("Control+z");
  const restoredProject = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    restoredProject.documents.find(
      (candidate: { name: string }) => candidate.name === "Child",
    ).instances,
  ).toHaveLength(1);
});

test("manages Cell rename and lists callers", async ({ page }) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await runCellCommand(page, "Place Cell");
  const insert = page.getByRole("dialog", { name: "Place Hierarchical Cell" });
  await insert.getByRole("option", { name: /ReusableStage/u }).click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByRole("button", { name: /ReusableStage.*1 callers/u })
    .click();
  await expect(manager).toContainText("1 callers");
  await manager.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename Cell" });
  await rename.getByLabel("Cell name").fill("Stage");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(manager).toContainText("Stage");
  await manager.locator(".cell-manager-callers summary").click();
  await manager.getByRole("button", { name: "Jump to caller" }).click();
  await expect(page.getByTestId("active-document-id")).toHaveText(
    "document-main",
  );
  const canvas = page.getByTestId("schematic-canvas");
  await expect(canvas.locator('[data-kind="instance-value"]')).toContainText(
    "Stage",
  );
  await expect(
    canvas.locator('[data-kind="instance-value"]'),
  ).not.toContainText("ReusableStage");
  await expect(canvas.locator('[data-kind="instance-label"]')).toHaveCount(0);
});

test("declares and places a Cell Pin on a new local Net", async ({ page }) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");

  const canvas = page.getByTestId("schematic-canvas");
  await placeCellPin(page, {
    name: "Vout",
    direction: "output",
    position: { x: 300, y: 180 },
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");

  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();
  await expect(page.getByLabel("Cell Pin properties")).toHaveCount(0);
  await expect(page.getByLabel("Cell Pin name")).toHaveCount(0);
  await expect(page.getByLabel("Cell Pin direction")).toHaveCount(0);
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const nameEditor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(
    page.getByRole("toolbar", { name: "Text formatting" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("Vout");
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await nameEditor.fill("OUT");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Renamed Cell Pin to OUT",
  );
  await page.getByTestId("hit-P1").click();
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("OUT");
  await setCellTerminalDirection(page, "OUT", "input");
  await expect(page.getByTestId("status")).toContainText(
    "Updated Cell port direction",
  );

  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await page
    .getByTestId("cell-command-menu")
    .getByRole("button", { name: "Place Cell" })
    .click();
  const insertDialog = page.getByRole("dialog", {
    name: "Place Hierarchical Cell",
  });
  await insertDialog.getByRole("option", { name: /ReusableStage/u }).click();
  await canvas.click({ position: { x: 420, y: 180 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(canvas.locator('[data-pin-name="OUT"]')).toHaveCount(1);

  await page.getByTestId("hit-X1").click();
  const layoutShelf = page.getByTestId("selection-shelf");
  if ((await layoutShelf.getAttribute("aria-expanded")) === "false") {
    await layoutShelf.click();
  }
  const layout = page.getByLabel("Cell symbol layout");
  await expect(layout).toBeVisible();
  await layout.getByLabel("Cell symbol width").fill("120");
  await layout.getByLabel("Cell symbol width").press("Tab");
  await expect(page.getByTestId("status")).toContainText(
    "Resized ReusableStage",
  );
  await layout.getByLabel("Cell symbol OUT pin side").selectOption("north");
  await expect(page.getByTestId("status")).toContainText(
    "Moved Cell symbol pin",
  );
  await layout
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  const layoutOverlay = page.getByTestId("cell-symbol-layout-overlay");
  await expect(layoutOverlay).toBeVisible();
  const bodyHandle = page.getByTestId("cell-symbol-body-handle");
  const bodyHandleBox = await bodyHandle.boundingBox();
  expect(bodyHandleBox).not.toBeNull();
  if (bodyHandleBox) {
    await page.mouse.move(
      bodyHandleBox.x + bodyHandleBox.width / 2,
      bodyHandleBox.y + bodyHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bodyHandleBox.x + bodyHandleBox.width / 2 + 30,
      bodyHandleBox.y + bodyHandleBox.height / 2 + 30,
    );
    await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
    const previewBodyBox = await bodyHandle.boundingBox();
    expect(previewBodyBox!.x).toBeGreaterThan(bodyHandleBox.x);
    await page.mouse.up();
    await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  }
  await expect(page.getByTestId("status")).toContainText(
    /Resized ReusableStage|Committed revision/u,
  );
  const pinHandle = page.locator('[data-testid^="cell-symbol-pin-handle-"]');
  const pinHandleBox = await pinHandle.boundingBox();
  expect(pinHandleBox).not.toBeNull();
  if (pinHandleBox) {
    await page.mouse.move(
      pinHandleBox.x + pinHandleBox.width / 2,
      pinHandleBox.y + pinHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      pinHandleBox.x + pinHandleBox.width / 2 + 20,
      pinHandleBox.y + pinHandleBox.height / 2,
    );
    await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
    await expect(page.getByTestId("cell-symbol-layout-preview")).toContainText(
      "OUT",
    );
    await page.mouse.up();
  }
  await expect(page.getByTestId("status")).toContainText(
    "Moved Cell symbol pin",
  );

  // Pointer cancellation discards only the preview, with no persisted edit.
  const committedPinBox = await pinHandle.boundingBox();
  expect(committedPinBox).not.toBeNull();
  await page.mouse.move(
    committedPinBox!.x + committedPinBox!.width / 2,
    committedPinBox!.y + committedPinBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    committedPinBox!.x + committedPinBox!.width / 2 + 40,
    committedPinBox!.y + committedPinBox!.height / 2,
  );
  await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
  await pinHandle.dispatchEvent("pointercancel", {
    pointerId: 1,
    bubbles: true,
  });
  await page.mouse.up();
  await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  expect((await pinHandle.boundingBox())!.x).toBeCloseTo(committedPinBox!.x, 1);
  await page.screenshot({
    path: test.info().outputPath("cell-symbol-properties.png"),
  });

  // Closing Properties must leave the transient grip mode too; otherwise the
  // selected Cell keeps suppressing its ordinary hit target.
  await layoutShelf.click();
  await expect(layoutOverlay).toBeHidden();
  await expect(page.getByTestId("hit-X1")).toBeVisible();

  await layoutShelf.click();
  await layout
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  await expect(layoutOverlay).toBeVisible();

  // A normal canvas click exits the mode before normal pointer handling. The
  // Cell can then use its normal direct-manipulation path again.
  await canvas.click({ position: { x: 40, y: 420 } });
  await expect(layoutOverlay).toBeHidden();
  const instanceHit = page.getByTestId("hit-X1");
  const beforeMove = await instanceHit.boundingBox();
  expect(beforeMove).not.toBeNull();
  if (beforeMove) {
    await page.mouse.move(
      beforeMove.x + beforeMove.width / 2,
      beforeMove.y + beforeMove.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeMove.x + beforeMove.width / 2 + 40,
      beforeMove.y + beforeMove.height / 2,
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await instanceHit.boundingBox())?.x ?? 0)
      .toBeGreaterThan(beforeMove.x + 10);
  }
});

test("declares a top Formal Cell Pin and exports the top interface", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "VIN",
    direction: "input",
    position: { x: 300, y: 180 },
  });
  await page.getByTestId("hit-P1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toHaveCount(0);

  await clickCommand(page, "Netlist", "Check Report…");
  const preflight = page.getByRole("dialog", { name: "Check Report" });
  await expect(preflight.getByTestId("netlist-preview")).toContainText(
    ".subckt dut VIN",
  );
  await expect(preflight).not.toContainText("GENERATED_NET_NAME");
  await expect(preflight).not.toContainText("MISSING_DEVICE_DEFINITION");
});

test("copies and independently deletes Formal Cell Pins", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await placeCellPin(page, {
    name: "VIN",
    direction: "input",
    position: { x: 280, y: 180 },
  });

  await page.getByTestId("hit-P1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toHaveCount(0);
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.keyboard.press("c");
  await page.mouse.move(canvasBox!.x + 440, canvasBox!.y + 180);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 440, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Copied 1 components");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-P1-copy-1")).toBeVisible();
  await expect(page.locator('[data-object-id="instance-label-P1"]')).toHaveText(
    "VIN",
  );
  await expect(
    page.locator('[data-object-id="instance-label-P1-copy-1"]'),
  ).toHaveText("Vin2");
  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await expect(page.getByTestId("hit-P1-copy-1")).toBeVisible();

  await page.getByTestId("hit-P1-copy-1").click();
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(
    page.locator('[data-object-id="instance-label-P1-copy-1"]'),
  ).toHaveText("Vin2");
  await clickCommand(page, "Netlist", "Check Report…");
  await expect(
    page
      .getByRole("dialog", { name: "Check Report" })
      .getByTestId("netlist-preview"),
  ).toContainText(".subckt dut VIN2");
});

test("edits a Cell Pin name and RichText presentation in place", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "VBIAS",
    position: { x: 300, y: 180 },
  });
  await expect(
    page.getByTestId("annotation-hit-instance-reference-P1"),
  ).toHaveCount(0);
  await page.getByTestId("hit-P1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toHaveCount(0);
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("VBIAS");

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("VBIAS");

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill("VINP");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("VINP");

  await clickCommand(page, "Netlist", "Check Report…");
  const preflight = page.getByRole("dialog", { name: "Check Report" });
  await expect(preflight).not.toContainText("MISSING_DEVICE_DEFINITION");
  await expect(preflight.getByTestId("netlist-preview")).toContainText(
    ".subckt dut VINP",
  );
});

test("keeps the Placement Tray out of the manually authored Cell Pin workflow", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await placeCellPin(page, {
    name: "Vout",
    position: { x: 300, y: 180 },
  });
  await expect(
    page.getByTestId("annotation-hit-instance-label-P1"),
  ).toBeVisible();
  await expect(
    page.getByTestId("annotation-hit-instance-reference-P1"),
  ).toHaveCount(0);
  await page.getByTestId("hit-P1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(
    page.getByRole("button", { name: "Return component to Placement Tray" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Placement Tray" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("hit-P1")).toBeVisible();
  await expect(page.getByLabel("Cell Pin properties")).toHaveCount(0);
});

test("authors formal Cell parameters without entering Cell Symbol Layout", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await placeCellPin(page, {
    name: "Vout",
    position: { x: 300, y: 180 },
  });

  await runCellCommand(page, "Manage Cells…");
  const dialog = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(dialog.getByLabel("Formal port Vout direction")).toHaveValue(
    "passive",
  );
  await expect(
    dialog.getByText("Cell symbol layout", { exact: false }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Formal parameters")
    .getByRole("button", { name: "Add" })
    .click();
  await dialog.getByLabel("Formal parameter 1 name").fill("gain");
  await dialog.getByLabel("Formal parameter gain default").fill("10");
  await dialog.getByRole("button", { name: "Apply parameters" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Updated Cell formal parameters",
  );
  await dialog.getByRole("button", { name: "Close Cell Manager" }).click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("status")).toContainText("Committed revision");
});

test("deletes a wired child Cell Pin through the ordinary instance path", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await placeCellPin(page, {
    name: "Vout",
    position: { x: 300, y: 180 },
  });
  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("hit-P1")).toHaveCount(1);
});

test("places an existing Cell and blocks deleting its shared definition", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();

  await runCellCommand(page, "Place Cell");
  const dialog = page.getByRole("dialog", { name: "Place Hierarchical Cell" });
  await expect(
    dialog.getByRole("option", { name: /ReusableStage/u }),
  ).toBeVisible();
  await expect(dialog.getByTestId("insert-component-nmos")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  const fullInsert = page.getByRole("dialog", { name: "Insert Component" });
  await expect(fullInsert.getByTestId("insert-component-nmos")).toBeVisible();
  await page.keyboard.press("Escape");

  await runCellCommand(page, "Place Cell");
  const cellDialog = page.getByRole("dialog", {
    name: "Place Hierarchical Cell",
  });
  await cellDialog.getByRole("option", { name: /ReusableStage/u }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 360, y: 230 } });
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Shift+R");
  await expect(preview).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await canvas.click({ position: { x: 360, y: 230 } });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText(
    "Placed ReusableStage as X1",
  );
  await expect(canvas.locator('[data-kind="instance-value"]')).toContainText(
    "ReusableStage",
  );
  await expect(canvas.locator('[data-kind="instance-label"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(
    manager.getByRole("button", { name: "Delete" }).last(),
  ).toBeDisabled();
  await expect(page.getByTestId("document-count")).toHaveText("2");
});

test("allows distinct Cell Pins to expose one internal contact", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await page.getByTestId("shapes-chip-port").click();
  await canvas.click({ position: { x: 240, y: 200 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("shapes-chip-port").click();
  await canvas.click({ position: { x: 240, y: 200 } });
  // The existing Port is the visible current Net name, so a second Cell Pin
  // placed on the same contact adopts it while retaining independent identity.
  await expect(page.getByTestId("status")).toContainText("Added Cell Pin Vin");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-P1")).toBeVisible();
  await expect(page.getByTestId("hit-P2")).toBeVisible();
});

test("renaming one Cell Pin leaves another interface Pin alone", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "Vother",
    position: { x: 260, y: 180 },
  });
  await placeCellPin(page, {
    name: "Vshared",
    position: { x: 260, y: 320 },
  });

  const labels = page.locator(
    '[data-testid^="annotation-hit-instance-label-"]',
  );
  await expect(labels).toHaveCount(2);

  await page.getByTestId("hit-P2").click();
  await renameCellPinOnCanvas(page, "P2", "Vbias");

  await expect(page.getByTestId("status")).toContainText("Renamed Cell Pin");
  const texts = await page
    .locator('[data-testid="schematic-canvas"] text')
    .allTextContents();
  expect(texts).toContain("Vother");
  expect(texts).toContain("Vbias");
});

test("same-name Cell Pins stay independent while the final interface groups them", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "VIN",
    direction: "input",
    position: { x: 260, y: 180 },
  });
  await placeCellPin(page, {
    name: "ALIAS",
    direction: "output",
    position: { x: 260, y: 320 },
  });

  await page.getByTestId("hit-P2").click();
  await renameCellPinOnCanvas(page, "P2", "vin");

  await expect(page.getByTestId("status")).toContainText("Renamed Cell Pin");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(
    manager.getByRole("table", { name: "Formal port order" }).getByRole("row"),
  ).toHaveCount(1);
  await expect(manager).toContainText("2 markers");
  await expect(manager).toContainText("Direction conflict");
  await manager.getByRole("button", { name: "Close Cell Manager" }).click();
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      netlist: {
        terminals: Array<{
          id: string;
          name: string;
          netId: string;
          direction: string;
          interfaceInstanceIds: string[];
        }>;
      };
    }>;
  };
  const terminals = saved.documents[0]!.netlist.terminals;
  expect(terminals).toHaveLength(2);
  expect(terminals.map((terminal) => terminal.name.toLowerCase())).toEqual([
    "vin",
    "vin",
  ]);
  expect(new Set(terminals.map((terminal) => terminal.id)).size).toBe(2);
  expect(new Set(terminals.map((terminal) => terminal.netId)).size).toBe(2);
  expect(terminals.map((terminal) => terminal.direction)).toEqual([
    "input",
    "output",
  ]);
  expect(terminals.map((terminal) => terminal.interfaceInstanceIds)).toEqual([
    ["P1"],
    ["P2"],
  ]);

  await clickCommand(page, "Netlist", "Check Report…");
  const preview = await page
    .getByRole("dialog", { name: "Check Report" })
    .getByTestId("netlist-preview")
    .innerText();
  expect(preview).toContain(".subckt dut VIN");
  expect(preview).not.toContain("ALIAS");
  await page.getByTestId("check-report-close").click();

  await page.getByTestId("hit-P2").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P2")).toHaveCount(0);
  await expect(page.getByTestId("hit-P1")).toBeVisible();
});
