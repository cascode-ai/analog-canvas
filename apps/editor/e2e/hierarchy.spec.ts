import { parseSavedProject } from "./editor-fixtures";
import { expect, test } from "@playwright/test";
import { analyzeDesignNetlist } from "@icm/netlist";
import { reviewedExternalBindingForMaster } from "@icm/devices";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
} from "@icm/model";
import { hierarchicalSymbolId } from "@icm/symbols";
import { hierarchyParameterFixture } from "../../../netlists/hierarchy-parameters/fixture";

import {
  revealPropertiesShelf,
  clickCommand,
  downloadBytes,
  setComponentParameter,
  expectComponentCodeField,
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

test("creates a Cell parameter from a device JSON field with atomic Undo", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "Resistors");
  const childId = await page.getByTestId("active-document-id").innerText();
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await page.getByTestId("hit-R1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false")
    await shelf.click();
  await page
    .getByRole("button", { name: "Use Cell parameter for Value" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Hierarchical para" });
  await expect(dialog).not.toHaveAttribute("aria-modal", "true");
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeLessThan(300);
  expect(bounds.height).toBeLessThan(240);
  await page.screenshot({
    path: test.info().outputPath("parameter-popover.png"),
  });
  await dialog.getByLabel("Cell parameter name").press("Escape");
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "Use Cell parameter for Value" })
    .click();
  await shelf.click();
  await expect(dialog).toHaveCount(0);
  await shelf.click();
  await page
    .getByRole("button", { name: "Use Cell parameter for Value" })
    .click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("hit-R1").click();
  await revealPropertiesShelf(page);
  if ((await shelf.getAttribute("aria-expanded")) === "false")
    await shelf.click();
  await page
    .getByRole("button", { name: "Use Cell parameter for Value" })
    .click();
  await dialog.getByLabel("Cell parameter name").fill("Rbase");
  await dialog.getByLabel("Cell parameter default").fill("1k");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const save = async () =>
    parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(
        "utf8",
      ),
    );
  const child = (project: Awaited<ReturnType<typeof save>>) =>
    project.documents.find(
      (document: { id: string }) => document.id === childId,
    );
  const bound = child(await save());
  expect(bound.netlist.formalParameters).toEqual([
    { name: "Rbase", defaultValue: "1k" },
  ]);
  expect(bound.instances[0].netlist.parameters.value).toBe("{Rbase}");
  await page.keyboard.press("Control+z");
  const undone = child(await save());
  expect(undone.netlist.formalParameters).toEqual([]);
  expect(undone.instances[0].netlist.parameters.value).not.toBe("{Rbase}");
  await page.keyboard.press("Control+Shift+z");
  expect(child(await save()).instances[0].netlist.parameters.value).toBe(
    "{Rbase}",
  );
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(
    manager.getByRole("button", { name: "Remove parameter Rbase" }),
  ).toBeDisabled();
  await manager.getByLabel("Parameter Rbase name").fill("Resistance");
  await manager.getByLabel("Parameter Rbase name").press("Enter");
  await expect(manager.getByLabel("Parameter Resistance name")).toBeVisible();
  await manager.getByLabel("Close Cell Manager").click();
  expect(child(await save()).instances[0].netlist.parameters.value).toBe(
    "{Resistance}",
  );
  await page.keyboard.press("Control+z");
  const renameUndone = child(await save());
  expect(renameUndone.netlist.formalParameters[0].name).toBe("Rbase");
  expect(renameUndone.instances[0].netlist.parameters.value).toBe("{Rbase}");
  await page.keyboard.press("Control+Shift+z");
  await runCellCommand(page, "Manage Cells…");
  await manager.getByLabel("Parameter Resistance default").fill("3k");
  await manager.getByLabel("Parameter Resistance default").press("Enter");
  await expect(page.getByTestId("status")).toContainText(
    "Updated Cell parameter",
  );
  await manager.getByLabel("Close Cell Manager").click();
  expect(child(await save()).netlist.formalParameters[0].defaultValue).toBe(
    "3k",
  );
});

test("traces a parent Net through the second Cell occurrence and returns to its Net", async ({
  page,
}) => {
  const project = hierarchyParameterFixture();
  const parent = project.documents[0]!;
  const child = project.documents[1]!;
  for (const [index, id] of ["X1", "X2"].entries()) {
    parent.instances.find((instance) => instance.id === id)!.placement = {
      position: { x: 300 + index * 250, y: 200 },
      rotation: 0,
      mirror: "none",
    };
  }
  parent.junctions.push({
    id: "trace-tail",
    netId: "B",
    position: { x: 380, y: 200 },
    role: "route-anchor",
  });
  parent.routes.push(
    createRoutePath({
      id: "trace-parent",
      netId: "B",
      start: { kind: "terminal", instanceId: "X2", pinName: "IN" },
      end: { kind: "junction", junctionId: "trace-tail" },
      bends: [],
      modes: ["manual"],
    }),
  );
  for (const [index, id] of ["port-IN", "R1"].entries()) {
    child.instances.find((instance) => instance.id === id)!.placement = {
      position: { x: 180 + index * 200, y: 180 },
      rotation: 0,
      mirror: "none",
    };
  }
  child.routes.push(
    createRoutePath({
      id: "trace-child",
      netId: "IN",
      start: { kind: "terminal", instanceId: "port-IN", pinName: "P" },
      end: { kind: "terminal", instanceId: "R1", pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "trace.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const route = page.getByTestId("route-hit-trace-parent");
  // A horizontal SVG polyline has zero bounding-box height; click its rendered
  // midpoint like the shared manual route interactions, not its CSS box.
  await expect(route).toBeAttached();
  const point = await route.evaluate((element) => {
    const line = element as SVGPolylineElement;
    const first = line.points.getItem(0);
    const second = line.points.getItem(1);
    const screen = new DOMPoint(
      (first.x + second.x) / 2,
      (first.y + second.y) / 2,
    ).matrixTransform(line.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("h");
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false")
    await shelf.click();
  await page.getByRole("button", { name: /Enter: X2\.IN/ }).click();
  await expect(page.getByTestId("active-document-id")).toHaveText(child.id);
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    "IN",
  );
  await expect(
    page.getByRole("button", { name: /Return: X1\.IN/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Return: X2\.IN/ }).click();
  await expect(page.getByTestId("active-document-id")).toHaveText(parent.id);
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    "B",
  );
});

test("edits independent parent parameter overrides and follows definition renames", async ({
  page,
}) => {
  const project = hierarchyParameterFixture();
  project.documents[0]!.instances.find(
    (instance) => instance.id === "X1",
  )!.netlist!.parameters = { RBASE: "2k" };
  for (const [index, id] of ["X1", "X2"].entries()) {
    project.documents[0]!.instances.find(
      (instance) => instance.id === id,
    )!.placement = {
      position: { x: 300 + index * 250, y: 200 },
      rotation: 0,
      mirror: "none",
    };
  }
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "parameters.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("hit-X1").click();
  await revealPropertiesShelf(page);
  const initialShelf = page.getByTestId("selection-shelf");
  if ((await initialShelf.getAttribute("aria-expanded")) === "false")
    await initialShelf.click();
  await expectComponentCodeField(page, "parameters.RBASE", "2k");
  await page.getByTestId("hit-X2").dblclick();
  // Double-click enters the Cell; return to the specific parent and inspect with a single click.
  await page.keyboard.press("Shift+e");
  await page.getByTestId("hit-X2").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false")
    await shelf.click();
  await expectComponentCodeField(page, "parameters.Rbase", "");
  await expect(page.getByText("// Default: 1k", { exact: true })).toBeVisible();
  await setComponentParameter(page, "Rbase", "4k");
  await expectComponentCodeField(page, "parameters.Rbase", "4k");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: /Resistors.*2 callers/u }).click();
  await manager.getByLabel("Parameter Rbase name").fill("Resistance");
  await manager.getByLabel("Parameter Rbase name").press("Enter");
  await expect(manager.getByLabel("Parameter Resistance name")).toBeVisible();
  await manager.getByLabel("Parameter Resistance default").fill("3k");
  await manager.getByLabel("Parameter Resistance default").press("Enter");
  await manager.getByLabel("Close Cell Manager").click();
  await page.getByTestId("hit-X1").click();
  await expectComponentCodeField(page, "parameters.Resistance", "2k");
  await page.getByTestId("hit-X2").click();
  await expectComponentCodeField(page, "parameters.Resistance", "4k");
  await setComponentParameter(page, "Resistance", "");
  await expectComponentCodeField(page, "parameters.Resistance", "");
  await expect(page.getByText("// Default: 3k", { exact: true })).toBeVisible();
  await clickCommand(page, "Edit", "Undo");
  await expectComponentCodeField(page, "parameters.Resistance", "4k");
  await clickCommand(page, "Edit", "Redo");
  await expectComponentCodeField(page, "parameters.Resistance", "");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(
    saved.documents[0].instances.find(
      (instance: { id: string }) => instance.id === "X2",
    ).netlist.parameters,
  ).toEqual({});
});

test("keeps a chosen simulation Cell independent of later default Top changes", async ({
  page,
}) => {
  const project = hierarchyParameterFixture();
  const other = createEmptyDocument("other", "Other");
  project.documents.push(other);
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      json: {
        configured: false,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op"],
        parsedAnalyses: ["op"],
        profiles: [],
        maxTimeoutMs: 15000,
        maxInputBytes: 1048576,
        cancel: true,
      },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "simulation-entry.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await panel
    .getByLabel("Simulation Cell", { exact: true })
    .selectOption("resistors");
  const name = panel.getByRole("textbox", {
    name: "New simulation folder name",
  });
  await name.fill("Child experiment");
  await name.press("Enter");
  await expect(
    panel.getByRole("treeitem", {
      name: "Folder Child experiment",
      exact: true,
    }),
  ).toBeVisible();
  const snapshot = async (): Promise<CircuitProject> =>
    parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(),
    );
  const before = await snapshot();
  expect(before.topDocumentId).toBe(project.topDocumentId);
  expect(before.simulationFolders[0]!.input.circuitBindings).toContainEqual(
    expect.objectContaining({ documentId: "resistors" }),
  );
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByRole("complementary", { name: "Cells", exact: true })
    .getByRole("button", { name: /Other/ })
    .click();
  await manager
    .locator(".cell-manager-list-item")
    .filter({ hasText: "Other" })
    .dragTo(manager.locator(".cell-manager-list-item").first());
  await manager.getByLabel("Close Cell Manager").click();
  const after = await snapshot();
  expect(after.topDocumentId).toBe("other");
  expect(after.simulationFolders).toEqual(before.simulationFolders);
});

test("sets a Cell as default Top without changing its circuit and supports Undo", async ({
  page,
}) => {
  await page.goto("/editor");
  const originalTop = await page.getByTestId("active-document-id").innerText();
  await createCell(page, "NewTop");
  const childId = await page.getByTestId("active-document-id").innerText();
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(manager.locator(".cell-manager-list-heading")).toHaveCount(0);
  expect(
    (await manager
      .getByRole("button", { name: "New Cell", exact: true })
      .boundingBox())!.height,
  ).toBeLessThan(40);
  await manager
    .getByRole("button", { name: "Set as Top", exact: true })
    .click();
  await expect(manager.getByRole("button", { name: "Set as Top" })).toHaveCount(
    0,
  );
  await manager.getByRole("button", { name: "Close Cell Manager" }).click();
  const save = async () =>
    parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(
        "utf8",
      ),
    );
  const changed = await save();
  expect(changed.topDocumentId).toBe(childId);
  expect(changed.documents).toHaveLength(2);
  expect(changed.documents[0].id).toBe(childId);
  await page.keyboard.press("Control+z");
  const undone = await save();
  expect(undone.topDocumentId).toBe(originalTop);
  expect(undone.documents[0].id).toBe(originalTop);
  await page.keyboard.press("Control+Shift+z");
  expect((await save()).topDocumentId).toBe(childId);
});

test("saves ordinary Cell order without changing Top and restores it with Undo", async ({
  page,
}) => {
  const project = hierarchyParameterFixture();
  project.documents.push(createEmptyDocument("extra", "Extra"));
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "order.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const snapshot = async () =>
    parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(),
    );
  const normalized = await snapshot();
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .locator(".cell-manager-list-item")
    .filter({ hasText: "Extra" })
    .dragTo(
      manager
        .locator(".cell-manager-list-item")
        .filter({ hasText: "Resistors" }),
    );
  await expect(manager.locator(".cell-manager-list-item strong")).toHaveText([
    "dut",
    "Extra",
    "Resistors",
  ]);
  await page.screenshot({ path: test.info().outputPath("cell-manager.png") });
  await manager.getByLabel("Close Cell Manager").click();
  const reordered = await snapshot();
  expect(reordered.topDocumentId).toBe(project.topDocumentId);
  expect(reordered.documents.map((cell: { id: string }) => cell.id)).toEqual([
    project.topDocumentId,
    "extra",
    "resistors",
  ]);
  await page.keyboard.press("Control+z");
  // Undo/Redo intentionally advance revisions; compare all persisted contents
  // and list order without expecting historical revision counters to rewind.
  const contents = (documents: CircuitProject["documents"]) =>
    documents.map(({ revision: _revision, ...document }) => document);
  expect(contents((await snapshot()).documents)).toEqual(
    contents(normalized.documents),
  );
  await page.keyboard.press("Control+Shift+z");
  expect(contents((await snapshot()).documents)).toEqual(
    contents(reordered.documents),
  );
});

test("opens distinct structural occurrences while keeping one stable definition list", async ({
  page,
}) => {
  const project = hierarchyParameterFixture();
  project.documents.push(createEmptyDocument("unused", "Unused"));
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "tree.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  for (const instance of ["X1", "X2"]) {
    await runCellCommand(page, "Manage Cells…");
    const manager = page.getByRole("dialog", { name: "Cell Manager" });
    await expect(
      manager
        .getByRole("complementary", { name: "Cells", exact: true })
        .getByRole("button", { name: /Unused/ }),
    ).toBeVisible();
    await manager.getByText("Hierarchy", { exact: true }).click();
    await manager
      .getByRole("button", {
        name: `Expand ${project.documents[0]!.name}`,
        exact: true,
      })
      .click();
    await manager
      .getByRole("button", { name: `${instance} · Resistors`, exact: true })
      .click();
    await expect(manager).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Up", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Shift+e");
    await expect(page.getByTestId("status")).toContainText(
      project.documents[0]!.name,
    );
  }
});

test("protects reviewed External interfaces and navigates their callers", async ({
  page,
}) => {
  const reviewed = reviewedExternalBindingForMaster("sky130_fd_pr__nfet_01v8")!;
  await page.goto("/editor");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByRole("group", { name: "Definition type" })
    .getByRole("button", { name: "External Circuit Defs", exact: true })
    .click();
  await manager
    .getByLabel("External subcircuit target")
    .fill(reviewed.masterName);
  await manager
    .getByLabel("External subcircuit terminals")
    .fill(reviewed.terminals.map((item) => item.targetName).join(", "));
  await manager
    .getByRole("button", { name: "Create External Circuit Def", exact: true })
    .click();
  await expect(
    manager.getByLabel("External subcircuit target"),
  ).toHaveAttribute("readonly", "");
  await expect(
    manager.getByLabel("External subcircuit terminals"),
  ).toHaveAttribute("readonly", "");
  await expect(
    manager.getByRole("button", { name: "Save definition" }),
  ).toBeDisabled();
  await expect(manager.getByText(/fixed PDK interface/)).toBeVisible();
  await manager.getByRole("button", { name: "Place", exact: true }).click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 260, y: 200 } });
  await page.keyboard.press("Escape");
  await runCellCommand(page, "Manage Cells…");
  await manager
    .getByRole("group", { name: "Definition type" })
    .getByRole("button", { name: "External Circuit Defs", exact: true })
    .click();
  await manager
    .getByRole("complementary", { name: "External Circuit Defs" })
    .getByRole("button", { name: new RegExp(reviewed.masterName) })
    .click();
  await manager.getByText("Callers (1)", { exact: true }).click();
  await manager.getByRole("button", { name: "Jump to caller" }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText("Opened caller");
});

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
    .getByRole("button", { name: "External Circuit Defs", exact: true })
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
    .getByRole("button", { name: "Create External Circuit Def", exact: true })
    .click();
  const externalList = manager.getByRole("complementary", {
    name: "External Circuit Defs",
  });
  await expect(externalList.locator(".cell-manager-list-heading")).toHaveCount(
    0,
  );
  await externalList.getByRole("button", { name: /amplifier/ }).click();
  expect(
    (await externalList
      .getByRole("button", { name: "New External Circuit Def", exact: true })
      .boundingBox())!.height,
  ).toBeLessThan(40);
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
    .getByRole("button", { name: "External Circuit Defs", exact: true })
    .click();
  await expect(
    manager.getByLabel("External subcircuit formal parameters"),
  ).toHaveValue("gain=20");
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+z");
  await runCellCommand(page, "Manage Cells…");
  await types
    .getByRole("button", { name: "External Circuit Defs", exact: true })
    .click();
  await externalList.getByRole("button", { name: /amplifier/ }).click();
  await expect(
    manager.getByLabel("External subcircuit formal parameters"),
  ).toHaveValue("gain=10");
  await manager
    .getByRole("button", { name: "Delete definition", exact: true })
    .click();
  await manager.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    externalList.getByRole("button", { name: /amplifier/ }),
  ).toBeVisible();
  await manager
    .getByRole("button", { name: "Delete definition", exact: true })
    .click();
  await manager
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    externalList.getByRole("button", { name: /amplifier/ }),
  ).toHaveCount(0);
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+z");
  await runCellCommand(page, "Manage Cells…");
  await types
    .getByRole("button", { name: "External Circuit Defs", exact: true })
    .click();
  await externalList.getByRole("button", { name: /amplifier/ }).click();
  await expect(
    manager.getByLabel("External subcircuit formal parameters"),
  ).toHaveValue("gain=10");
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+Shift+z");
  await runCellCommand(page, "Manage Cells…");
  await types
    .getByRole("button", { name: "External Circuit Defs", exact: true })
    .click();
  await expect(
    externalList.getByRole("button", { name: /amplifier/ }),
  ).toHaveCount(0);
});

test("creates and places an external interface with connected netlist semantics", async ({
  page,
}) => {
  await page.goto("/editor");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByRole("group", { name: "Definition type" })
    .getByRole("button", { name: "External Circuit Defs" })
    .click();
  const create = manager.getByRole("button", {
    name: "Create External Circuit Def",
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
    .getByRole("button", { name: "New External Circuit Def", exact: true })
    .click();
  await expect(manager.getByLabel("External subcircuit target")).toHaveValue(
    "",
  );
  await manager.getByLabel("External subcircuit target").fill("external_load");
  await create.click();
  await expect(manager.getByRole("alert")).toContainText(/duplicate/i);
  await manager
    .getByRole("complementary", { name: "External Circuit Defs" })
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
  const project = parseSavedProject(
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
  await expect(internalLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "out",
  );
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.press("Home");
  await editor.press("ArrowRight");
  await editor.press("Shift+End");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    internalLabel.locator('[data-text-run="subscript"]'),
  ).toHaveCount(0);
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
  await expect(parentPin.locator('[data-text-run="subscript"]')).toHaveCount(0);
  await page.getByTestId("hit-X1").dblclick();
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await editor.focus();
  await editor.press("Control+Home");
  await editor.press("ArrowRight");
  await editor.press("Shift+End");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await expect(editor.locator("sub")).toHaveText("out");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(internalLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "out",
  );
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await expect(parentPin).toHaveText("Vout");
  await expect(parentPin.locator('[data-text-run="subscript"]')).toHaveText(
    "out",
  );
});

test("formats every Port label in the current Cell without renaming it", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, { name: "IND", position: { x: 280, y: 160 } });
  await placeCellPin(page, { name: "out", position: { x: 280, y: 240 } });
  const firstLabel = page.locator('[data-object-id="instance-label-P1"]');
  const secondLabel = page.locator('[data-object-id="instance-label-P2"]');
  await expect(firstLabel.locator('[data-text-run="subscript"]')).toHaveCount(
    0,
  );
  await expect(secondLabel.locator('[data-text-run="subscript"]')).toHaveCount(
    0,
  );

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: "Format all Port labels" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Formatted all Port labels",
  );
  await manager.getByLabel("Close Cell Manager").click();

  await expect(firstLabel).toHaveText("IND");
  await expect(firstLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "ND",
  );
  await expect(
    firstLabel.locator(
      '[data-text-run="span"][style*="font-style:italic"][style*="font-weight:700"]',
    ),
  ).toHaveText("I");
  await expect(
    firstLabel.locator(
      '[data-text-run="subscript"] [data-text-run="span"][style*="font-style:normal"][style*="font-weight:700"]',
    ),
  ).toHaveText("ND");
  await expect(secondLabel).toHaveText("out");
  await expect(secondLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "ut",
  );
  const project = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(
    project.documents[0]!.netlist?.terminals.map(
      (port: { name: string }) => port.name,
    ),
  ).toEqual(["IND", "out"]);

  await page.keyboard.press("Control+z");
  await expect(firstLabel).toHaveText("IND");
  await expect(firstLabel.locator('[data-text-run="subscript"]')).toHaveCount(
    0,
  );
  await expect(secondLabel).toHaveText("out");
  await expect(secondLabel.locator('[data-text-run="subscript"]')).toHaveCount(
    0,
  );
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
  const project = parseSavedProject(
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
  await expect(manager.locator(".cell-row-menu")).toHaveCount(0);
  await manager
    .getByRole("button", { name: "Delete", exact: true })
    .last()
    .click();
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

test("keeps Manager free of reset actions and opens definitions by double click", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "Child");
  const childId = await page.getByTestId("active-document-id").innerText();
  await placeComponent(page, "resistor", { x: 320, y: 200 });
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(manager).not.toContainText("Reset Cell");
  await expect(manager).not.toContainText("Project hierarchy");
  await expect(manager).not.toContainText("Outside Top");
  await manager
    .locator(".cell-manager-list-item")
    .filter({ hasText: "Child" })
    .dblclick();
  await expect(manager).toHaveCount(0);
  await expect(page.getByTestId("active-document-id")).toHaveText(childId);
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
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
  await manager.getByLabel("Cell name", { exact: true }).fill("Cancelled");
  await manager.getByLabel("Cell name", { exact: true }).press("Escape");
  await expect(manager.getByLabel("Cell name", { exact: true })).toHaveValue(
    "ReusableStage",
  );
  await manager.getByLabel("Cell name", { exact: true }).fill("Stage");
  await manager.getByLabel("Cell name", { exact: true }).press("Enter");
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
    page
      .locator('[data-object-id="instance-label-P1"]')
      .locator('[data-text-run="subscript"]'),
  ).toHaveText("IN");
  await expect(
    page.locator('[data-object-id="instance-label-P1-copy-1"]'),
  ).toHaveText("Vout");
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
  ).toHaveText("Vout");
  await clickCommand(page, "Netlist", "Check Report…");
  await expect(
    page
      .getByRole("dialog", { name: "Check Report" })
      .getByTestId("netlist-preview"),
  ).toContainText(".subckt dut VOUT");
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
  await expect(
    page
      .locator('[data-object-id="instance-label-P1"]')
      .locator('[data-text-run="subscript"]'),
  ).toHaveText("BIAS");

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("vINPUT");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const renamedLabel = page.locator('[data-object-id="instance-label-P1"]');
  await expect(renamedLabel).toHaveText("vINPUT");
  await expect(renamedLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "INPUT",
  );

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("vINPUT");

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

test("hides empty parameters and does not expose a second declaration workflow", async ({
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
  await expect(
    dialog.getByLabel("Cell parameters", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Apply parameters" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close Cell Manager" }).click();
});

test("confirms connected last-Port deletion and restores caller wires with Undo and Redo", async ({
  page,
}) => {
  const project = createEmptyProject("delete-port", "Delete Port");
  const child = createEmptyDocument("child", "Child");
  child.instances.push({
    id: "P1",
    symbolId: "port",
    placement: { position: { x: 300, y: 180 }, rotation: 0, mirror: "none" },
  });
  child.nets.push({
    id: "inside",
    terminals: [{ instanceId: "P1", pinName: "P" }],
  });
  child.netlist!.terminals.push({
    id: "in",
    name: "IN",
    netId: "inside",
    direction: "input",
    interfaceInstanceIds: ["P1"],
  });
  project.documents.push(child);
  const parent = project.documents[0]!;
  parent.instances.push({
    id: "X1",
    symbolId: hierarchicalSymbolId("Child"),
    reference: "X1",
    placement: { position: { x: 300, y: 180 }, rotation: 0, mirror: "none" },
    netlist: {
      parameters: {},
      binding: { kind: "subcircuit", childDocumentId: child.id },
    },
  });
  parent.nets.push({
    id: "outside",
    terminals: [{ instanceId: "X1", pinName: "IN" }],
  });
  parent.junctions.push({
    id: "tail",
    netId: "outside",
    position: { x: 100, y: 180 },
    role: "route-anchor",
  });
  parent.routes.push(
    createRoutePath({
      id: "lead",
      netId: "outside",
      start: { kind: "terminal", instanceId: "X1", pinName: "IN" },
      end: { kind: "junction", junctionId: "tail" },
      bends: [],
      modes: ["manual"],
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "delete.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("document-selector").selectOption(child.id);
  const snapshot = async (): Promise<CircuitProject> =>
    parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(),
    );
  const circuit = (value: CircuitProject) =>
    value.documents.map(
      ({ revision: _revision, sourceStatus: _status, ...document }) => document,
    );
  const original = await snapshot();
  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  const confirmation = page.getByRole("dialog", {
    name: "Delete connected Cell Ports?",
  });
  await expect(confirmation).toContainText("X1");
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(circuit(await snapshot())).toEqual(circuit(original));
  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await confirmation
    .getByRole("button", { name: "Delete Ports", exact: true })
    .click();
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  const deleted = await snapshot();
  expect(deleted.documents[1]!.netlist!.terminals).toEqual([]);
  expect(deleted.documents[0]!.routes).toHaveLength(1);
  expect(deleted.documents[0]!.routes[0]!.start.kind).toBe("junction");
  expect(deleted.documents[0]!.instances).toHaveLength(1);
  await page.keyboard.press("Control+z");
  expect(circuit(await snapshot())).toEqual(circuit(original));
  await page.keyboard.press("Control+Shift+z");
  expect(circuit(await snapshot())).toEqual(circuit(deleted));
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
  const cellBounds = (await dialog.boundingBox())!;
  const cellArtwork = (await dialog
    .locator(".insert-symbol-artwork")
    .first()
    .boundingBox())!;
  expect(cellBounds.height).toBeGreaterThan(400);
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  const fullInsert = page.getByRole("dialog", { name: "Insert Component" });
  await expect(fullInsert.getByTestId("insert-component-nmos")).toBeVisible();
  const libraryBounds = (await fullInsert.boundingBox())!;
  const libraryArtwork = (await fullInsert
    .locator(".insert-symbol-artwork")
    .first()
    .boundingBox())!;
  expect(cellBounds.width / libraryBounds.width).toBeCloseTo(0.6, 1);
  expect(cellArtwork.height / libraryArtwork.height).toBeCloseTo(1.25, 1);
  await expect(fullInsert).not.toHaveClass(/insert-cell-dialog/u);
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
    manager.getByRole("button", { name: "Delete", exact: true }),
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
  const merge = page.getByRole("dialog", { name: "Merge Cell Ports?" });
  await expect(merge).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P2")).toHaveCount(1);
  await merge.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-object-id="instance-label-P2"]')).toHaveText(
    "ALIAS",
  );
  await renameCellPinOnCanvas(page, "P2", "vin");
  await page.getByRole("button", { name: "Merge Ports", exact: true }).click();
  await expect(merge).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-object-id="instance-label-P2"]')).toHaveText(
    "ALIAS",
  );
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator('[data-object-id="instance-label-P2"]')).toHaveText(
    "vin",
  );
  await expect(
    page
      .locator('[data-object-id="instance-label-P2"]')
      .locator('[data-text-run="subscript"]'),
  ).toHaveText("in");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(
    manager.getByRole("table", { name: "Formal port order" }).getByRole("row"),
  ).toHaveCount(1);
  await expect(manager).toContainText("2 markers");
  await expect(manager).toContainText("Direction conflict");
  await manager.getByRole("button", { name: "Close Cell Manager" }).click();
  const saved = parseSavedProject(
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
  expect(terminals.map((terminal) => terminal.name)).toEqual(["VIN", "vin"]);
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

  // Conflicting interface directions remain editable, but must be resolved
  // before a strict export can produce an executable subcircuit.
  await setCellTerminalDirection(page, "VIN", "input");
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
