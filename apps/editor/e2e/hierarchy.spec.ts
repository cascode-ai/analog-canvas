import { expect, test, type Locator, type Page } from "@playwright/test";
import { compileNgspiceSourceSimulation } from "@icm/netlist";
import {
  completedNgspiceRun,
  ngspiceCapabilities,
  profile,
} from "./simulation-e2e-fixtures.js";
import { sessionUser, signIn } from "./gallery-fixtures.js";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  createSimulationFolder,
  routeEndpoints,
  type CircuitProject,
} from "@icm/model";
import {
  hierarchicalSymbolId,
  withProjectComponentDefinitions,
} from "@icm/symbols";
import { hierarchyParameterFixture } from "../../../netlists/hierarchy-parameters/fixture";
import {
  executeProjectTransaction,
  createExternalSubcircuitInstance,
} from "@icm/edit-engine";
import { serializeProject } from "@icm/project-protocol";

import {
  revealPropertiesShelf,
  clickCommand,
  exportedProject,
  downloadBytes,
  expectStatus,
  openCellManager,
  openCellManagerTab,
  openMenu,
  openProject,
  openProjectFile,
  copyNetlistText,
  readAgentClaim,
  showNetlistPanel,
} from "./editor-fixtures.js";
import { placedInstance, clickRoute } from "./canvas-fixtures.js";
import { resolveDocumentLogicalNets } from "@icm/derived";

function fitsWidth(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el.scrollWidth <= el.clientWidth);
}

function listItem(manager: Locator, name: string | RegExp): Locator {
  return manager.locator(".cell-manager-list-item").filter({ hasText: name });
}

function modelNetlist(manager: Locator): Locator {
  return manager.getByLabel("External model netlist");
}

function cellLayoutProject() {
  const project = createEmptyProject("cell-layout", "Cell layout");
  const child = createEmptyDocument("layout-child", "LayoutStage");
  for (const name of ["A", "B", "C", "D", "E", "F"]) {
    child.instances.push({ id: `P${name}`, symbolId: "port", placement: null });
    child.nets.push({
      id: `inside-${name}`,
      terminals: [{ instanceId: `P${name}`, pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: name,
      name,
      netId: `inside-${name}`,
      direction: "passive",
      interfaceInstanceIds: [`P${name}`],
    });
  }
  child.presentation.cellSymbol = {
    bodyBounds: { left: -80, right: 80, top: -80, bottom: 80 },
    pinPlacements: [
      { terminalId: "A", side: "west", offset: -40 },
      { terminalId: "B", side: "west", offset: -10 },
      { terminalId: "C", side: "west", offset: 40 },
      { terminalId: "D", side: "north", offset: 0 },
      { terminalId: "E", side: "east", offset: 0 },
      { terminalId: "F", side: "south", offset: 0 },
    ],
  };
  project.documents.push(child);
  const parent = project.documents[0]!;
  for (const [id, x] of [
    ["X1", 260],
    ["X2", 620],
  ] as const)
    parent.instances.push({
      ...placedInstance(id, hierarchicalSymbolId("LayoutStage"), x, 220),
      reference: id,
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    });
  parent.instances.push({
    ...placedInstance("R1", "resistor", 440, 450),
    reference: "R1",
    netlist: { parameters: { value: "1k" } },
  });
  return withProjectComponentDefinitions(project);
}

async function editCellLayout(page: Page) {
  await page.getByTestId("hit-X1").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false")
    await shelf.click();
  await page
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  await expect(page.getByTestId("cell-symbol-layout-overlay")).toBeVisible();
}

test("Cell layout composes additive and framed pin selection, spacing, arrangement and Wire", async ({
  page,
}) => {
  await openProject(page, serializeProject(cellLayoutProject()));
  await editCellLayout(page);
  const handles = page.locator('[data-testid^="cell-symbol-pin-handle-"]');
  const selected = page.locator(
    '[data-testid^="cell-symbol-pin-handle-"][data-selected="true"]',
  );
  const parentPart = await page.getByTestId("hit-R1").boundingBox();
  await pressAndMove(page, parentPart!, { x: 40, y: 0 });
  await page.mouse.up();
  for (const id of ["A", "B", "C"])
    await page
      .getByTestId(`cell-symbol-pin-handle-${id}`)
      .click({ modifiers: id === "A" ? [] : ["ControlOrMeta"] });
  await expect(selected).toHaveCount(3);
  await page.keyboard.press("w");
  await expectStatus(page, "Select exactly one");
  await expect(page.getByTestId("cell-symbol-layout-overlay")).toBeVisible();
  await page
    .getByRole("button", { name: "Equal spacing", exact: true })
    .click();
  const a = await page.getByTestId("cell-symbol-pin-handle-A").boundingBox();
  const b = await page.getByTestId("cell-symbol-pin-handle-B").boundingBox();
  const c = await page.getByTestId("cell-symbol-pin-handle-C").boundingBox();
  expect(b!.y).toBeCloseTo((a!.y + c!.y) / 2, 1);
  // A window frame replaces the internal selection, independent of parent hits.
  await page.mouse.move(a!.x - 18, a!.y - 18);
  await page.mouse.down();
  await page.mouse.move(c!.x + c!.width + 18, c!.y + c!.height + 18, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(selected).toHaveCount(3);
  await page.getByRole("button", { name: "Arrange east", exact: true }).hover();
  await expect(page.getByTestId("cell-symbol-layout-limit")).toContainText(
    "occupied",
  );
  await page.getByRole("button", { name: "Arrange east", exact: true }).click();
  await expectStatus(page, /occupied/iu); // E already owns the centre slot.
  await expect(selected).toHaveCount(3);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("ArrowDown");
  await expectStatus(page, "Updated LayoutStage layout");
  const sourceHandle = await page
    .getByTestId("cell-symbol-pin-handle-A")
    .boundingBox();
  const eastHandle = await page
    .getByTestId("cell-symbol-pin-handle-E")
    .boundingBox();
  await pressAndMove(page, sourceHandle!, {
    x: eastHandle!.x - sourceHandle!.x,
    y: 0,
  });
  await page.mouse.up();
  await expectStatus(page, "Updated LayoutStage layout");
  const saved = await exportedProject(page);
  expect(
    saved.documents
      .find((cell: any) => cell.id === "layout-child")
      .presentation.cellSymbol.pinPlacements.slice(0, 3),
  ).toEqual([
    { terminalId: "A", side: "east", offset: -30 },
    { terminalId: "B", side: "east", offset: 10 },
    { terminalId: "C", side: "east", offset: 50 },
  ]);
  expect(
    saved.documents[0].instances.find((item: any) => item.id === "R1").placement
      .position,
  ).toEqual({ x: 440, y: 450 });
  // A crossing frame can acquire a pin by touching its handle's edge.
  const after = await page
    .getByTestId("cell-symbol-pin-handle-A")
    .boundingBox();
  await page.mouse.move(after!.x + after!.width + 12, after!.y - 3);
  await page.mouse.down();
  await page.mouse.move(
    after!.x + after!.width - 2,
    after!.y + after!.height + 3,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(selected).toHaveCount(1);
  await page.keyboard.press("w");
  await expect(page.getByTestId("cell-symbol-layout-overlay")).toHaveCount(0);
  await expectStatus(page, "Wire source: X1.A");
  await expect(handles).toHaveCount(0);
  await page.keyboard.press("Escape");
});

async function applyModel(manager: Locator): Promise<void> {
  await manager
    .getByRole("button", { name: "Apply model", exact: true })
    .click();
}

test("Cell layout reconciles a selected pin removed by an HTTP Agent", async ({
  page,
  request,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openProject(page, serializeProject(cellLayoutProject()));
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  const claimed = await request.post(`${baseURL}/api/agent/claims`, {
    data: await readAgentClaim(panel),
  });
  expect(claimed.ok()).toBe(true);
  const session = await claimed.json();
  await panel.getByLabel("Close Agent dialog").click();
  await editCellLayout(page);
  await page.getByTestId("cell-symbol-pin-handle-A").click();
  const send = async (payload: Record<string, unknown>) => {
    const response = await request.post(
      `${baseURL}/api/agent/sessions/${session.sessionId}/circuit`,
      {
        headers: {
          Authorization: `Bearer ${session.agentToken}`,
          "x-agent-context": session.contextRevision,
        },
        data: {
          apiVersion: "3.0",
          requestId: crypto.randomUUID(),
          documentId: "layout-child",
          ...payload,
        },
      },
    );
    const result = await response.json();
    if (payload.operation === "snapshot" && result.ok)
      session.contextRevision = response.headers()["x-agent-context"];
    expect(response.ok(), JSON.stringify(result.error)).toBe(true);
    expect(result.ok, JSON.stringify(result.error ?? result.diagnostics)).toBe(
      true,
    );
    return result;
  };
  const snapshot = await send({ operation: "snapshot" });
  await send({
    operation: "transact",
    transactionId: crypto.randomUUID(),
    expectedRevision: snapshot.revision,
    expectedStructureRevision: snapshot.snapshot.project.structureRevision,
    command: { kind: "remove-cell-terminal", terminalId: "A" },
  });
  await expect(page.getByTestId("cell-symbol-pin-handle-A")).toHaveCount(0);
  await page.getByTestId("schematic-canvas").focus();
  await page.keyboard.press("w");
  await expectStatus(page, "Select exactly one");
  await expect(page.getByTestId("cell-symbol-layout-overlay")).toBeVisible();
  await page.getByTestId("cell-symbol-pin-handle-B").click();
  await page.keyboard.press("w");
  await expectStatus(page, "Wire source: X1.B");
  expect(errors).toEqual([]);
});

test("process shortcuts change only visible model text and clipboard failure stays inline", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Denied");
        },
      },
    }),
  );
  await page.goto("/editor");
  const manager = await openCellManagerTab(page, "External Circuits");
  const editor = modelNetlist(manager);
  await editor.fill(
    ".subckt pair D G S B\nX1 D G S B sky130_fd_pr__nfet_01v8 w=2 l=0.15 nf=2 m=8\n.ends pair\n",
  );
  await expect(manager.getByLabel("Model process")).toHaveValue("sky130");
  await manager.getByLabel("Model process").selectOption("sg13g2");
  await expect(editor).toContainText("sg13_lv_nmos");
  await expect(editor).toContainText("ng=2");
  const copy = manager.getByRole("button", {
    name: "Copy model netlist",
    exact: true,
  });
  await expect(copy).toBeDisabled();
  await applyModel(manager);
  await expect(manager.getByLabel("Model process")).toHaveValue("sg13g2");
  const before = await editor.innerText();
  await copy.click();
  await expect(manager.getByRole("status")).toContainText(
    "Could not copy model netlist.",
  );
  await expect(copy).toBeFocused();
  await expect.poll(() => editor.innerText()).toBe(before);
  await manager.getByLabel("Model process").focus();
  await manager.getByLabel("Model process").selectOption("tsmc28");
  await expect(manager.getByLabel("Model process")).toHaveValue("sg13g2");
  await expect.poll(() => editor.innerText()).toBe(before);
  await expect(manager.getByRole("status")).toContainText(
    "This device has no reviewed counterpart in the selected process.",
  );
  await expect(manager.getByLabel("Model process")).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await editor.fill(
    ".subckt GM_STAGE INP INN OUT VSS params: GM=1m RL=10k CL=10p\nGsignal VSS OUT INP INN {GM}\nRload OUT VSS {RL}\nCload OUT VSS {CL}\nRinp INP VSS 1T\nRinn INN VSS 1T\n.ends GM_STAGE\n",
  );
  await applyModel(manager);
  await expect(manager.getByLabel("Model process")).toHaveValue("abstract");
  const independent = await editor.innerText();
  await manager.getByLabel("Model process").focus();
  await manager.getByLabel("Model process").selectOption("sky130");
  await expect(manager.getByRole("status")).toContainText(
    "This model has no reviewed process devices to replace.",
  );
  await expect(manager.getByRole("status")).toHaveCount(1);
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await expect(manager.getByLabel("Model process")).toHaveValue("abstract");
  await expect.poll(() => editor.innerText()).toBe(independent);
  await expect(manager.getByLabel("Model process")).toBeFocused();
  await manager
    .getByRole("button", { name: "New External Circuit", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", { name: "New External Circuit", exact: true }),
  ).toBeVisible();
  await listItem(manager, "GM_STAGE").click();
  await expect.poll(() => modelNetlist(manager).innerText()).toBe(independent);
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("converts the external draft with the reused format selector and keeps failed conversion inline", async ({
  page,
}) => {
  await page.goto("/editor");
  const manager = await openCellManagerTab(page, "External Circuits");
  const editor = modelNetlist(manager);
  await editor.fill(
    ".subckt rc A B params: RVAL=1k\nR1 A B {RVAL}\n.ends rc\n",
  );
  await manager.getByLabel("Model format").selectOption("spectre");
  await expect(editor).toContainText("subckt rc (A B)");
  await expect(editor).toContainText("parameters RVAL=1000");
  await editor.press("ControlOrMeta+z");
  await expect(manager.getByLabel("Model format")).toHaveValue("spice");
  await expect(editor).toContainText(".subckt rc A B params: RVAL=1k");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(manager.getByLabel("Model format")).toHaveValue("spectre");
  await expect(editor).toContainText("parameters RVAL=1000");
  await applyModel(manager);
  await expect(manager.getByLabel("Model format")).toHaveValue("spectre");
  await editor.fill("subckt rc (A B)\nB1 (A B) bsource v=sin(time)\nends rc\n");
  await manager.getByLabel("Model format").focus();
  await manager.getByLabel("Model format").selectOption("spice");
  await expect(manager.getByLabel("Model format")).toHaveValue("spectre");
  await expect(editor).toContainText("bsource v=sin(time)");
  await expect(manager.getByRole("status")).toContainText("Edit model");
  await expect(manager.getByRole("status")).toHaveCount(1);
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(manager.getByLabel("Model format")).toBeFocused();
});

test("starts an external model with English comments and copies only its applied complete definition", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as unknown as { modelClipboard: string }).modelClipboard =
            text;
        },
      },
    });
  });
  await page.goto("/editor");
  const manager = await openCellManagerTab(page, "External Circuits");
  const editor = modelNetlist(manager);
  const starter = await editor.innerText();
  expect(starter.trim().split("\n")).toHaveLength(2);
  expect(starter).toMatch(/^\* [A-Za-z]/);
  expect(starter).not.toMatch(/[\u4e00-\u9fff]/);
  expect(starter).toContain("* .subckt my_cell PIN1 PIN2 params: PARAM1=1");
  await expect(manager.getByLabel("Model format")).toHaveValue("spice");
  const copy = manager.getByRole("button", {
    name: "Copy model netlist",
    exact: true,
  });
  await expect(copy).toBeDisabled();
  await manager.getByLabel("Model format").selectOption("spectre");
  const spectreStarter = await editor.innerText();
  expect(spectreStarter.trim().split("\n")).toHaveLength(3);
  expect(
    spectreStarter
      .split("\n")
      .filter(Boolean)
      .every((line) => line.startsWith("// ")),
  ).toBe(true);
  expect(spectreStarter).toContain(
    "// subckt my_cell (PIN1 PIN2)\n// parameters PARAM1=1",
  );
  expect(spectreStarter).not.toMatch(/[\u4e00-\u9fff]/);
  await expect(copy).toBeDisabled();
  await manager.getByLabel("Model format").selectOption("spice");
  await expect.poll(() => editor.innerText()).toBe(starter);
  await editor.fill(".subckt empty\n.ends empty\n");
  await expect(copy).toBeDisabled();
  await applyModel(manager);
  await expect(copy).toBeEnabled();
  await copy.click();
  const text = await page.evaluate(
    () => (window as unknown as { modelClipboard: string }).modelClipboard,
  );
  expect(text).toContain(".subckt empty\n.ends empty");
  expect(text).not.toContain(".subckt dut");
  await editor.fill(".subckt empty\n* draft\n.ends empty\n");
  await expect(copy).toBeDisabled();
});

// 1440×900 sets the symbol beside its controls; 720×450 is the short
// viewport in the 680–860 px band, where the controls stack after Apply. The
// 430 px Apply & Place case below closes the Manager instead.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 720, height: 450 },
]) {
  test(`external Manager keeps primary actions and symbol layout visible at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/editor");
    const manager = await openCellManagerTab(page, "External Circuits");
    await modelNetlist(manager).fill(
      ".subckt layout A B\nR1 A B 1k\n.ends layout\n",
    );
    const box = await manager
      .getByRole("button", { name: "Apply & Place" })
      .boundingBox();
    expect(await fitsWidth(manager)).toBe(true);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    const interfaceBox = await manager
      .getByLabel("Parsed model interface")
      .boundingBox();
    expect(interfaceBox!.y + interfaceBox!.height).toBeLessThanOrEqual(box!.y);
    await applyModel(manager);
    const controls = manager.getByLabel("Cell symbol layout", { exact: true });
    const preview = manager.getByLabel("Symbol preview", { exact: true });
    await expect(preview).toBeVisible();
    await expect(manager).not.toContainText("Applied version");
    await expect(manager.locator(".external-model-path")).toHaveCount(0);
    const controlBox = await controls.boundingBox();
    const previewBox = await preview.boundingBox();
    if (viewport.width >= 1024) {
      expect(previewBox!.x).toBeGreaterThanOrEqual(
        controlBox!.x + controlBox!.width,
      );
      const a = await manager.getByLabel("Model A direction").boundingBox();
      const b = await manager.getByLabel("Model B direction").boundingBox();
      expect(a!.y).toBe(b!.y);
      expect(b!.x).toBeGreaterThan(a!.x);
    }
    expect(await fitsWidth(controls)).toBe(true);
    expect(
      await controls.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll("input, select"), (control) => {
          const box = control.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right;
        }).every(Boolean);
      }),
    ).toBe(true);
    expect(await fitsWidth(manager)).toBe(true);
    await manager.getByLabel("Model A direction").selectOption("input");
    await expect(manager.getByLabel("Model A direction")).toHaveValue("input");
  });
}

test("searches definitions without discarding the selected model", async ({
  page,
}) => {
  await page.goto("/editor");
  const manager = await openCellManagerTab(page, "External Circuits");
  await modelNetlist(manager).fill(
    ".subckt searchable A B\nR1 A B 1k\n.ends searchable\n",
  );
  await applyModel(manager);
  const list = manager.getByRole("complementary", {
    name: "External Circuits",
  });
  await expect(list.getByRole("button", { name: /searchable/ })).toBeVisible();
  await list.getByRole("searchbox").fill("missing");
  await expect(list.getByRole("button", { name: /searchable/ })).toHaveCount(0);
  await expect(list.getByRole("status")).toHaveText("No matches");
  await expect(modelNetlist(manager)).toContainText("R1 A B 1k");
  await list.getByRole("searchbox").fill("SEARCH");
  await expect(list.getByRole("button", { name: /searchable/ })).toBeVisible();
  await expect(manager.locator(".external-model-symbol")).toBeVisible();
});

test("applies and places an external model in a compact narrow Manager", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 800 });
  await page.goto("/editor");
  const manager = await openCellManagerTab(page, "External Circuits");
  await expect(manager.getByRole("group", { name: "Model files" })).toHaveCount(
    0,
  );
  await modelNetlist(manager).fill(
    ".subckt compact A B\nR1 A B 1k\n.ends compact\n",
  );
  // Closing or switching tabs asks before an unsaved model is dropped.
  const guard = page.getByRole("dialog", { name: "Unsaved model" });
  for (const leave of [
    manager.getByRole("button", { name: "Close Cell Manager" }),
    manager.getByRole("tab", { name: "Cells", exact: true }),
  ]) {
    await leave.click();
    await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(modelNetlist(manager)).toContainText("R1 A B 1k");
  }
  const applyPlace = manager.getByRole("button", {
    name: "Apply & Place",
    exact: true,
  });
  const bounds = await applyPlace.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
  expect(await fitsWidth(manager)).toBe(true);
  await applyPlace.click();
  await expect(manager).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await openCellManagerTab(page, "External Circuits");
  await manager.getByRole("button", { name: /compact/ }).click();
  await manager.getByRole("button", { name: "Place", exact: true }).click();
  await page.getByRole("button", { name: "Netlist", exact: true }).click();
  await placeFirstAt(page, { x: 200, y: 250 });
  await openCellManagerTab(page, "External Circuits");
  await manager.getByRole("button", { name: /compact/ }).click();
  await modelNetlist(manager).fill(
    ".subckt compact A B\nR1 A B 2k\n.ends compact\n",
  );
  await manager.getByText("Callers (1)", { exact: true }).click();
  await manager.getByRole("button", { name: "Jump to caller" }).click();
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep editing" }).click();
  await expect(modelNetlist(manager)).toContainText("R1 A B 2k");
  await manager.getByRole("button", { name: "Jump to caller" }).click();
  await guard.getByRole("button", { name: "Discard changes" }).click();
  await expect(manager).toHaveCount(0);
});

test("refuses copying a legacy interface-only model until its native implementation is applied", async ({
  page,
}) => {
  const project = createEmptyProject("legacy-model", "Legacy model");
  const definition = {
    id: "legacy",
    name: "legacy_gain",
    interfaceStatus: "declared" as const,
    terminals: [
      { id: "a", name: "A", direction: "input" as const },
      { id: "b", name: "B", direction: "output" as const },
    ],
    formalParameters: [],
  };
  const body = ".subckt legacy_gain A B\nR1 A B 1k\n.ends legacy_gain\n";
  project.externalSubcircuitDefinitions.push(definition);
  const document = project.documents[0]!;
  document.instances.push(
    createExternalSubcircuitInstance("X1", definition, {
      position: { x: 200, y: 200 },
      rotation: 0,
      mirror: "none",
    }),
  );
  for (const pinName of ["A", "B"])
    document.noConnects.push({
      id: pinName,
      endpoint: { kind: "terminal", instanceId: "X1", pinName },
    });
  const experiment = createSimulationFolder({
    id: "old-experiment",
    name: "Old experiment",
    profileId: "local",
    documentId: document.id,
  });
  experiment.input.files.push({ path: "legacy.spice", text: body });
  project.simulationFolders.push(experiment);
  await page.goto("/editor?new=1");
  await openProjectFile(page, serializeProject(project), "legacy.icproj.json");
  const netlist = await showNetlistPanel(page);
  await expect(netlist.getByTestId("netlist-issues")).toContainText(
    "Legacy declaration legacy_gain has no Project-owned implementation",
  );
  await expect(netlist.getByTestId("copy-netlist-panel")).toBeDisabled();
  const manager = await openCellManagerTab(page, "External Circuits");
  await manager.getByRole("button", { name: /legacy_gain/ }).click();
  await manager
    .getByRole("button", { name: "Define implementation…", exact: true })
    .click();
  await modelNetlist(manager).fill(body);
  await applyModel(manager);
  await manager.getByLabel("Close Cell Manager").click();
  const copied = await copyNetlistText(page, "spice");
  expect(copied).toContain(body);
  expect(copied.match(/^\.subckt legacy_gain\b/gm)).toHaveLength(1);
  const saved: CircuitProject = await exportedProject(page);
  expect(
    saved.externalSubcircuitDefinitions[0]!.terminals.map(
      (terminal) => terminal.id,
    ),
  ).toEqual(["a", "b"]);
  expect(saved.externalSubcircuitDefinitions[0]!.implementation?.kind).toBe(
    "source",
  );
});

test("shares multiple model entries, explicitly forks and reopens an undoable portable Project", async ({
  page,
}) => {
  let executions = 0;
  await page.route("**/api/simulate", (route) => {
    executions++;
    return route.abort();
  });
  await page.goto("/editor?new=1");
  let manager = await openCellManagerTab(page, "External Circuits");
  const text =
    ".subckt first A B\nR1 A B 1k\n.ends first\n.subckt second A B\nR1 A B 2k\n.ends second\n";
  await modelNetlist(manager).fill(text);
  await manager
    .getByLabel("External model entry", { exact: true })
    .selectOption("first");
  await applyModel(manager);
  await manager
    .getByRole("button", { name: "New External Circuit", exact: true })
    .click();
  await manager
    .getByLabel("External model source owner", { exact: true })
    .selectOption({ label: "model.spice" });
  await manager
    .getByLabel("External model entry", { exact: true })
    .selectOption("second");
  await applyModel(manager);
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await expect(manager).toContainText("Shared by 2 definitions");
  await manager.getByText("More", { exact: true }).click();
  await manager
    .getByRole("button", { name: "Fork model…", exact: true })
    .click();
  await modelNetlist(manager).fill(
    text.replaceAll("first", "fork_first").replaceAll("second", "fork_second"),
  );
  await manager
    .getByLabel("External model entry", { exact: true })
    .selectOption("fork_first");
  await applyModel(manager);
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+z");
  manager = await openCellManagerTab(page, "External Circuits");
  await expect(manager.locator(".cell-manager-list-item")).toHaveCount(2);
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+Shift+z");
  const saved: CircuitProject = await exportedProject(page);
  expect(saved.modelSources).toHaveLength(2);
  expect(saved.externalSubcircuitDefinitions).toHaveLength(3);
  expect(
    saved.externalSubcircuitDefinitions
      .slice(0, 2)
      .map((d) => d.implementation!.sourceId),
  ).toEqual([saved.modelSources![0]!.id, saved.modelSources![0]!.id]);
  await openProjectFile(page, serializeProject(saved), "owned.icproj.json");
  manager = await openCellManagerTab(page, "External Circuits");
  await listItem(manager, "fork_first").click();
  await expect(modelNetlist(manager)).toContainText(".subckt fork_first A B");
  expect(executions).toBe(0);
});

test("imports a long-named Cloud Cell with a child and owned model into the original parent", async ({
  page,
}) => {
  const source = hierarchyParameterFixture();
  source.name =
    "Source Project with a deliberately long name for narrow viewport import";
  const defined = executeProjectTransaction(source, {
    projectId: source.id,
    expectedStructureRevision: source.structureRevision,
    transactionId: "define",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "cloud-model",
          language: "spice",
          entry: "model.spice",
          files: [
            {
              path: "model.spice",
              text: ".subckt imported_model A B\nR1 A B 7k\n.ends imported_model\n",
            },
          ],
          dependencies: [],
          revision: 0,
        },
        definitions: [{ definitionId: "model", entry: "imported_model" }],
      },
    ],
  });
  if (!defined.ok) throw Error(JSON.stringify(defined));
  const reusable = defined.project;
  const child = reusable.documents.find(
    (d) => d.id !== reusable.topDocumentId,
  )!;
  child.instances.push(
    createExternalSubcircuitInstance(
      "XMODEL",
      reusable.externalSubcircuitDefinitions[0]!,
      { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    ),
  );
  child.noConnects.push(
    ...["A", "B"].map((pinName) => ({
      id: `nc-${pinName}`,
      endpoint: { kind: "terminal" as const, instanceId: "XMODEL", pinName },
    })),
  );
  const record = {
    id: "cloud-source",
    name: source.name,
    revision: 1,
    schemaVersion: 66,
    updatedAt: "2026-10-07T00:00:00Z",
    projectText: serializeProject(reusable),
  };
  await signIn(
    page,
    sessionUser({
      id: "author",
      displayName: "Author",
      email: "author@example.com",
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [record] } }),
  );
  let unavailable = true;
  await page.route("**/api/projects/cloud-source", (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: { error: "temporarily unavailable" },
        })
      : route.fulfill({ json: { project: record } }),
  );
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/editor?new=1");
  const manager = await openCellManager(page);
  await manager
    .getByRole("button", { name: "Import Cell", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Import Cloud Cell",
    exact: true,
  });
  await dialog.getByLabel("Source Project").selectOption("cloud-source");
  await expect(
    dialog.getByRole("button", { name: "Import", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("status")).toBeVisible();
  unavailable = false;
  await dialog.getByLabel("Source Project").selectOption("");
  await dialog.getByLabel("Source Project").selectOption("cloud-source");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    manager.getByRole("button", { name: "Place", exact: true }),
  ).toBeEnabled();
  await manager.getByRole("button", { name: "Place", exact: true }).click();
  await placeFirstAt(page, { x: 280, y: 200 });
  const saved: CircuitProject = await exportedProject(page);
  expect(
    saved.documents.find((d) => d.id === saved.topDocumentId)!.instances,
  ).toHaveLength(1);
  expect(saved.documents).toHaveLength(3);
  expect(saved.modelSources![0]!.files[0]!.text).toContain("R1 A B 7k");
  await openProjectFile(page, serializeProject(saved), "imported.icproj.json");
  await openCellManagerTab(page, "External Circuits");
  await listItem(manager, "imported_model").click();
  await expect(page.getByLabel("External model netlist")).toContainText(
    "R1 A B 7k",
  );
});

test("places a selected local Cell directly from Manager and explains self placement", async ({
  page,
}) => {
  const project = createEmptyProject("manager-placement", "Manager placement");
  project.documents.push(createEmptyDocument("child", "Child"));
  await openProject(page, project, "cells.icproj.json");
  const manager = await openCellManager(page);
  await expect(
    manager.getByRole("button", { name: "Place", exact: true }),
  ).toBeDisabled();
  await expect(manager).toContainText("A Cell cannot contain itself");
  await listItem(manager, "Child").click();
  await manager.getByRole("button", { name: "Place", exact: true }).click();
  await expect(manager).toHaveCount(0);
  await placeFirstAt(page, { x: 350, y: 220 });
});

test("a runtime diagnostic opens the exact applied helper file while retaining its saved draft", async ({
  page,
}) => {
  const empty = createEmptyProject("runtime-model", "Runtime model");
  const helper =
    "* original helper\n.subckt failing A\nB1 A 0 V={unknown_function(0)}\n.ends failing\n";
  const created = executeProjectTransaction(empty, {
    projectId: empty.id,
    expectedStructureRevision: empty.structureRevision,
    transactionId: "define",
    actor: { kind: "human", id: "test" },
    edits: [
      {
        kind: "apply_model_source",
        source: {
          id: "source",
          language: "spice",
          entry: "main.spice",
          revision: 0,
          files: [
            { path: "main.spice", text: '.include "helper.spice"\n' },
            { path: "helper.spice", text: helper },
          ],
          dependencies: [],
        },
        definitions: [{ definitionId: "failing", entry: "failing" }],
      },
    ],
  });
  if (!created.ok) throw Error(JSON.stringify(created));
  const project = created.project;
  project.modelSources![0]!.draft = {
    entry: "main.spice",
    baseRevision: 1,
    files: [{ path: "main.spice", text: ".subckt unfinished A\nB1 A 0 V={" }],
    dependencies: [],
  };
  project.documents[0]!.instances.push(
    createExternalSubcircuitInstance(
      "X1",
      project.externalSubcircuitDefinitions[0]!,
      { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    ),
  );
  project.documents[0]!.noConnects.push({
    id: "nc",
    endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
  });
  const folder = createSimulationFolder({
    id: "runtime",
    name: "Runtime",
    engine: "ngspice",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  project.simulationFolders = [folder];
  const compiled = compileNgspiceSourceSimulation(project, folder);
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  const file = compiled.generated[0]!;
  const location = {
    file: file.path,
    line: file.text.slice(0, file.text.indexOf("B1 A 0")).split("\n").length,
  };
  await page.route("**/api/simulate", async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation === "capabilities")
      return route.fulfill({
        json: {
          ...ngspiceCapabilities(["op", "ac", "tran", "noise"]),
          inputs: ["source", "raw"],
        },
      });
    await route.fulfill({
      json: {
        outcome: { status: "failed" },
        diagnostics: [
          { severity: "error", text: "Error: unknown_function", location },
        ],
        log: "Error: unknown_function",
        durationMs: 1,
        // The same run metadata a completed run reports.
        metadata: (await completedNgspiceRun(request)).metadata,
      },
    });
  });
  await page.goto("/editor?new=1");
  await openProjectFile(page, serializeProject(project), "runtime.icproj.json");
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  // Completing a run selects its result view. Open Console after that outcome,
  // so this source-navigation test does not race the pending result selection.
  await expect(
    panel.getByRole("status").filter({ hasText: /^failed$/ }),
  ).toBeVisible();
  await panel.getByRole("tab", { name: "Console", exact: true }).click();
  await panel
    .getByRole("button", {
      name: `Open model source at ${location.file}:${location.line}`,
      exact: true,
    })
    .click();
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  const editor = modelNetlist(manager);
  await expect(editor).toContainText("B1 A 0 V={unknown_function(0)}");
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await expect(manager.locator(".cm-code-highlight")).toContainText("B1 A 0");
  await manager
    .getByRole("button", { name: "Open saved draft", exact: true })
    .click();
  await expect(editor).toContainText(".subckt unfinished A");
  await expect(editor).toHaveAttribute("aria-readonly", "false");
  await manager.getByLabel("Close Cell Manager").click();
  const saved: CircuitProject = await exportedProject(page);
  expect(saved.modelSources![0]!.files[1]!.text).toBe(helper);
  expect(saved.modelSources![0]!.draft!.files[0]!.text).toBe(
    project.modelSources![0]!.draft!.files[0]!.text,
  );
});

/** Press at a box's center and move by `delta`, leaving the button down. */
async function pressAndMove(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  delta: { x: number; y: number },
): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta.x, y + delta.y);
}

/** Click the armed placement onto the canvas as the first instance. */
async function placeFirstAt(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
}

/** Type into the open canvas text editor and apply it. */
async function applyCanvasText(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill(text);
  await page.getByRole("button", { name: "Apply text changes" }).click();
}

async function createCell(page: Page, name: string): Promise<void> {
  const manager = await openCellManager(page);
  await manager.getByRole("button", { name: "New Cell" }).click();
  const editor = page.getByRole("dialog", { name: "New Cell" });
  await expect(editor).toHaveAttribute("autocomplete", "off");
  await expect(editor.getByLabel("Cell name")).toHaveAttribute(
    "autocomplete",
    "off",
  );
  await editor.getByLabel("Cell name").fill(name);
  await editor.getByRole("button", { name: "Create" }).click();
}

async function openCellDefinition(
  page: Page,
  name: string | RegExp,
): Promise<void> {
  const manager = await openCellManager(page);
  await listItem(manager, name).first().dblclick();
}

async function openTopCell(page: Page): Promise<void> {
  await openCellDefinition(page, /Top/u);
}

async function placeCellPin(
  page: Page,
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
  await applyCanvasText(page, options.name);
  await expect(
    page.getByRole("dialog", { name: "Change Cell signal members?" }),
  ).toHaveCount(0);
  if (options.direction) {
    const manager = await openCellManager(page);
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
  page: Page,
  instanceId: string,
  name: string,
): Promise<void> {
  await page
    .getByTestId(`annotation-hit-instance-label-${instanceId}`)
    .dblclick();
  await applyCanvasText(page, name);
}

async function setCellTerminalDirection(
  page: Page,
  name: string,
  direction: "input" | "output" | "inout" | "passive",
): Promise<void> {
  const manager = await openCellManager(page);
  await manager
    .getByLabel(`Formal port ${name} direction`)
    .selectOption(direction);
  await manager.getByLabel("Close Cell Manager").click();
}

test("saves ordinary Cell order without changing Top and restores it with Undo", async ({
  page,
}) => {
  const project = hierarchyParameterFixture();
  project.documents.push(createEmptyDocument("extra", "Extra"));
  await openProject(page, project, "order.icproj.json");
  const snapshot = () => exportedProject(page);
  const normalized = await snapshot();
  const manager = await openCellManager(page);
  await listItem(manager, "Extra").dragTo(listItem(manager, "Resistors"));
  await expect(manager.locator(".cell-manager-list-item strong")).toHaveText([
    "dut",
    "Extra",
    "Resistors",
  ]);
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

test("manages external declarations independently of local Cell interfaces", async ({
  page,
}) => {
  await page.goto("/editor");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  const types = manager.getByRole("tablist", { name: "Definition type" });
  const externalList = manager.getByRole("complementary", {
    name: "External Circuits",
  });
  const parameters = manager.getByLabel(
    "External subcircuit formal parameters",
  );
  const openAmplifier = async () => {
    await openCellManagerTab(page, "External Circuits");
    await externalList.getByRole("button", { name: /amplifier/ }).click();
  };
  await openCellManager(page);
  await expect(
    manager.getByLabel("Cell interface", { exact: true }),
  ).toBeVisible();
  await expect(manager.getByLabel("External subcircuit target")).toHaveCount(0);
  await types
    .getByRole("tab", { name: "External Circuits", exact: true })
    .click();
  await expect(
    manager.getByLabel("Cell interface", { exact: true }),
  ).toHaveCount(0);
  await manager.getByText("More", { exact: true }).click();
  await manager
    .getByRole("button", { name: "Create placeholder…", exact: true })
    .click();
  await manager.getByLabel("External subcircuit target").fill("amplifier");
  await manager
    .getByLabel("External subcircuit terminals")
    .fill("IN, OUT, VDD, VSS");
  await parameters.fill("gain=10");
  await manager
    .getByRole("button", { name: "Create External Circuit Def", exact: true })
    .click();
  await externalList.getByRole("button", { name: /amplifier/ }).click();
  await parameters.fill("gain=20");
  await manager.getByRole("button", { name: "Save definition" }).click();
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+z");
  await openAmplifier();
  await expect(parameters).toHaveValue("gain=10");
  // Deleting asks first; Cancel keeps the definition.
  const remove = manager.getByRole("button", {
    name: "Delete definition",
    exact: true,
  });
  await remove.click();
  await manager.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    externalList.getByRole("button", { name: /amplifier/ }),
  ).toBeVisible();
  await remove.click();
  await manager
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(
    externalList.getByRole("button", { name: /amplifier/ }),
  ).toHaveCount(0);
  await manager.getByLabel("Close Cell Manager").click();
  await page.keyboard.press("Control+z");
  await openAmplifier();
  await expect(parameters).toHaveValue("gain=10");
});

test("keeps Hierarchy discoverable and restores the operation row on demand", async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.goto("/editor");

  // Even this narrow, the header's Circuit menu is in view and holds the
  // Cell Manager under Hierarchy.
  const toggle = page.getByTestId("circuit-menu").locator(":scope > summary");
  const toolbar = page.locator('.toolbar-row[aria-label="Document hierarchy"]');
  await expect(toggle).toBeInViewport({ timeout: 15_000 });
  const entry = (await openMenu(page, "Hierarchy")).getByTestId(
    "hierarchy-entry",
  );
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText("Cell Manager…");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);

  await createCell(page, "FirstStage");
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Manage Cells…" }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Place Cell" }),
  ).toBeEnabled();
  await expect(toggle).toBeVisible();
  await toolbar.getByRole("button", { name: "Place Cell" }).click();
  await expect(
    page.getByRole("dialog", { name: "Place Hierarchical Cell" }),
  ).toBeVisible();
});

test("a Cell Pin shows a display alias, here and on its block, and keeps its name", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "AliasStage");
  await placeCellPin(page, {
    name: "IN",
    direction: "input",
    position: { x: 300, y: 180 },
  });
  const pinLabel = page.locator('[data-object-id="instance-label-P1"]');
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const alias = page.getByRole("checkbox", { name: "Use display alias" });
  await expect(alias).not.toBeChecked();
  await alias.check();
  await applyCanvasText(page, "Bias input");
  await expect(page.getByTestId("status")).toHaveText(
    "Showing Bias input as a display alias; the Pin stays IN",
  );
  await expect(pinLabel).toHaveText("Bias input");
  // Reopened, it is still the alias, and editing it keeps the Pin's name.
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await expect(alias).toBeChecked();
  await applyCanvasText(page, "Bias in");
  await expect(pinLabel).toHaveText("Bias in");

  await openTopCell(page);
  await clickCommand(page, "Edit", "Place Cell from this Project…");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /AliasStage/u })
    .click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 420, y: 180 } });
  await page.keyboard.press("Escape");
  // The block's pin is still IN to the netlist, drawn as the alias.
  const pin = canvas.locator('[data-pin-name="IN"]');
  await expect(pin).toHaveCount(1);
  await expect(
    canvas.locator('[data-object-id="X1"][data-symbol-id]'),
  ).toContainText("Bias in");

  // Turned off, the label names the Pin again.
  await openCellDefinition(page, /AliasStage/u);
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await alias.uncheck();
  await expect(pinLabel).toHaveText("IN");
});

test("edits a vector Cell Pin with width feedback, invalid draft retention and Escape cancellation", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await createCell(page, "VectorStage");
  await placeCellPin(page, { name: "IN", position: { x: 300, y: 180 } });
  const label = page.getByTestId("annotation-hit-instance-label-P1");
  await label.dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  const preview = page.getByLabel("Cell Pin signal preview");
  await editor.fill("IN<3:>");
  await expect(preview).toContainText(
    "Signal indices must be integers or inclusive ranges",
  );
  await editor.press("Enter");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText("IN<3:>");
  await editor.fill("IN<3:0>");
  await expect(preview).toHaveText("4 members · IN<3> → IN<2> → IN<1> → IN<0>");
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Change Cell signal members?" }),
  ).toHaveCount(0);
  await label.dblclick();
  await editor.fill("IN<0:3>");
  await expect(preview).toHaveText("4 members · IN<0> → IN<1> → IN<2> → IN<3>");
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  const saved: CircuitProject = await exportedProject(page);
  const child = saved.documents.find((cell) => cell.name === "VectorStage")!;
  expect(
    child.netlist!.terminals[0]!.signal?.members.map((member) => member.name),
  ).toEqual(["IN<3>", "IN<2>", "IN<1>", "IN<0>"]);
  await openTopCell(page);
  await clickCommand(page, "Edit", "Place Cell from this Project…");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /VectorStage/u })
    .click();
  await placeFirstAt(page, { x: 420, y: 180 });
  await expect(
    page.getByTestId("schematic-canvas").locator('[data-pin-name="IN<3:0>"]'),
  ).toHaveCount(1);
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
  await expectStatus(page, "Renamed Cell Pin to OUT");
  await page.getByTestId("hit-P1").click();
  await expect(
    page.locator('[data-object-id="instance-label-P1"]'),
  ).toContainText("OUT");
  await setCellTerminalDirection(page, "OUT", "input");
  await expectStatus(page, "Updated Cell port direction");

  await openTopCell(page);
  await clickCommand(page, "Edit", "Place Cell from this Project…");
  const insertDialog = page.getByRole("dialog", {
    name: "Place Hierarchical Cell",
  });
  await insertDialog.getByRole("option", { name: /ReusableStage/u }).click();
  await placeFirstAt(page, { x: 420, y: 180 });
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
  await expectStatus(page, "Resized ReusableStage");
  await layout.getByLabel("Cell symbol OUT pin side").selectOption("north");
  await expectStatus(page, "Moved Cell symbol pin");
  await layout
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  const layoutOverlay = page.getByTestId("cell-symbol-layout-overlay");
  await expect(layoutOverlay).toBeVisible();
  const bodyHandle = page.getByTestId("cell-symbol-body-handle");
  const bodyHandleBox = await bodyHandle.boundingBox();
  expect(bodyHandleBox).not.toBeNull();
  if (bodyHandleBox) {
    await pressAndMove(page, bodyHandleBox, { x: 30, y: 30 });
    await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
    const previewBodyBox = await bodyHandle.boundingBox();
    expect(previewBodyBox!.x).toBeGreaterThan(bodyHandleBox.x);
    await page.mouse.up();
    await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  }
  await expectStatus(page, "Updated ReusableStage layout");
  const pinHandle = page.locator('[data-testid^="cell-symbol-pin-handle-"]');
  const pinHandleBox = await pinHandle.boundingBox();
  expect(pinHandleBox).not.toBeNull();
  if (pinHandleBox) {
    await pressAndMove(page, pinHandleBox, { x: 20, y: 0 });
    await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
    await expect(page.getByTestId("cell-symbol-layout-preview")).toContainText(
      "OUT",
    );
    await page.mouse.up();
  }
  await expectStatus(page, "Updated ReusableStage layout");

  // Pointer cancellation discards only the preview, with no persisted edit.
  const committedPinBox = await pinHandle.boundingBox();
  expect(committedPinBox).not.toBeNull();
  await pressAndMove(page, committedPinBox!, { x: 40, y: 0 });
  await expect(page.getByTestId("cell-symbol-layout-preview")).toBeVisible();
  await pinHandle.dispatchEvent("pointercancel", {
    pointerId: 1,
    bubbles: true,
  });
  await page.mouse.up();
  await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  expect((await pinHandle.boundingBox())!.x).toBeCloseTo(committedPinBox!.x, 1);

  // Properties visibility does not own the pinned layout session.
  await layoutShelf.click();
  await expect(layoutOverlay).toBeVisible();
  await expect(
    page.locator('[data-testid^="cell-symbol-body-handle"]'),
  ).toHaveCount(8);
  const beforeZoomView = await canvas.getAttribute("viewBox");
  const beforeZoomGrip = await bodyHandle.boundingBox();
  await bodyHandle.hover();
  await page.mouse.wheel(0, -160);
  await expect
    .poll(() => canvas.getAttribute("viewBox"))
    .not.toBe(beforeZoomView);
  await expect
    .poll(async () => (await bodyHandle.boundingBox())!.width)
    .toBeCloseTo(beforeZoomGrip!.width, 0);
  const panStart = await canvas.boundingBox();
  const beforePanView = await canvas.getAttribute("viewBox");
  await page.mouse.move(panStart!.x + 100, panStart!.y + 300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(panStart!.x + 140, panStart!.y + 320, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(() => canvas.getAttribute("viewBox"))
    .not.toBe(beforePanView);
  await expect(layoutOverlay).toBeVisible();
  const beforeCaptureLoss = await bodyHandle.boundingBox();
  await pressAndMove(page, beforeCaptureLoss!, { x: 25, y: 25 });
  await bodyHandle.evaluate((element) => {
    const circle = element as SVGCircleElement;
    if (circle.hasPointerCapture(1)) circle.releasePointerCapture(1);
  });
  await page.mouse.up();
  await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  expect((await bodyHandle.boundingBox())!.x).toBeCloseTo(
    beforeCaptureLoss!.x,
    1,
  );
  // A miss clears only the internal pin selection.
  await canvas.click({ position: { x: 40, y: 420 } });
  await expect(layoutOverlay).toBeVisible();
  // Escape in a gesture discards it; a second, idle Escape finishes layout.
  const beforeCancel = await bodyHandle.boundingBox();
  await pressAndMove(page, beforeCancel!, { x: 40, y: 30 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByTestId("cell-symbol-layout-preview")).toHaveCount(0);
  await expect(layoutOverlay).toBeVisible();
  expect((await bodyHandle.boundingBox())!.x).toBeCloseTo(beforeCancel!.x, 1);
  await page.keyboard.press("Escape");
  await expect(layoutOverlay).toBeHidden();
  const instanceHit = page.getByTestId("hit-X1");
  const beforeMove = await instanceHit.boundingBox();
  expect(beforeMove).not.toBeNull();
  if (beforeMove) {
    await pressAndMove(page, beforeMove, { x: 40, y: 0 });
    await page.mouse.up();
    await expect
      .poll(async () => (await instanceHit.boundingBox())?.x ?? 0)
      .toBeGreaterThan(beforeMove.x + 10);
  }
});

test("confirms connected last-Port deletion and restores caller wires with Undo and Redo", async ({
  page,
}) => {
  const project = createEmptyProject("delete-port", "Delete Port");
  const child = createEmptyDocument("child", "Child");
  child.instances.push(placedInstance("P1", "port", 300, 180));
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
    ...placedInstance("X1", hierarchicalSymbolId("Child"), 300, 180),
    reference: "X1",
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
  await openProject(page, project, "delete.icproj.json");
  await openCellDefinition(page, child.name);
  const snapshot = (): Promise<CircuitProject> => exportedProject(page);
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
  await expect(confirmation).toHaveJSProperty("open", true);
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
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

test("places an existing Cell and blocks deleting its shared definition", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await openTopCell(page);

  await clickCommand(page, "Edit", "Place Cell from this Project…");
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

  await clickCommand(page, "Edit", "Place Cell from this Project…");
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
  await expectStatus(page, "Placed ReusableStage as X1");
  await expect(canvas.locator('[data-kind="instance-value"]')).toContainText(
    "ReusableStage",
  );
  await expect(canvas.locator('[data-kind="instance-label"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  const manager = await openCellManager(page);
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
  await expectStatus(page, "Added Cell Pin Vinp");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-P1")).toBeVisible();
  await expect(page.getByTestId("hit-P2")).toBeVisible();
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
  // A typed name is shown as written; no subscript or underscore is guessed.
  await expect(
    page
      .locator('[data-object-id="instance-label-P2"]')
      .locator('[data-text-run="subscript"]'),
  ).toHaveCount(0);
  const manager = await openCellManager(page);
  await expect(
    manager.getByRole("table", { name: "Formal port order" }).getByRole("row"),
  ).toHaveCount(1);
  await expect(manager).toContainText("2 markers");
  await expect(manager).toContainText("Direction conflict");
  await manager.getByRole("button", { name: "Close Cell Manager" }).click();
  const saved: CircuitProject = await exportedProject(page);
  const terminals = saved.documents[0]!.netlist!.terminals;
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
});

test("entering a Cell with E, and leaving it, lands on the F fit (#1686)", async ({
  page,
}) => {
  const project = createEmptyProject("fit-on-enter", "Fit on enter");
  const top = project.documents[0]!;
  const child = createEmptyDocument("far", "Far");
  child.instances.push({
    ...placedInstance("R1", "resistor", 2400, 1800),
    reference: "R1",
  });
  top.instances.push({
    ...placedInstance("X1", hierarchicalSymbolId("Far"), 200, 120),
    reference: "X1",
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: child.id },
      parameters: {},
    },
  });
  project.documents.push(child);
  await openProject(page, project, "fit-on-enter.icproj.json");
  const canvas = page.getByTestId("schematic-canvas");
  // Move the camera off the fit, so a remembered view would show.
  const nudge = async () => {
    const before = await canvas.getAttribute("viewBox");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect(canvas).not.toHaveAttribute("viewBox", before!);
  };
  // The view the navigation landed on is the one F gives.
  const expectFitted = async () => {
    const landed = await canvas.getAttribute("viewBox");
    await page.keyboard.press("f");
    await expectStatus(page, "Fit Document");
    await expect(canvas).toHaveAttribute("viewBox", landed!);
  };

  await page.getByTestId("hit-X1").click();
  await nudge();
  await page.keyboard.press("e");
  await expectStatus(page, "Opened Cell Far");
  await expect(page.getByTestId("hit-R1")).toBeInViewport();
  await expectFitted();

  await nudge();
  await page.keyboard.press("Shift+E");
  await expect(page.getByTestId("hit-X1")).toBeInViewport();
  await expectFitted();
});

test("names an unfinished layout Wire inline and commits its path and Label in one undo", async ({
  page,
}) => {
  await openProject(page, serializeProject(cellLayoutProject()));
  const before: CircuitProject = await exportedProject(page);
  await editCellLayout(page);
  await page.getByTestId("cell-symbol-pin-handle-A").click();
  await page.keyboard.press("w");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 130, y: 340 } });
  await canvas.hover({ position: { x: 300, y: 340 } });
  const preview = page.getByTestId("wire-preview");
  const points = await preview.getAttribute("points");
  await page.keyboard.press("l");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toBeFocused();
  await editor.fill("PARENT");
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(preview).toHaveAttribute("points", points!);
  await canvas.dblclick({ position: { x: 300, y: 340 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const after: CircuitProject = await exportedProject(page);
  expect(after.documents[0]!.routes.length).toBe(
    before.documents[0]!.routes.length + 1,
  );
  expect(
    after.documents[0]!.connectivityEvidence.some(
      (e) => e.kind === "name-claim" && e.name === "PARENT",
    ),
  ).toBe(true);
  await page.keyboard.press("Control+z");
  const undo: CircuitProject = await exportedProject(page);
  expect(
    undo.documents.map(({ revision: _revision, ...cell }) => cell),
  ).toEqual(before.documents.map(({ revision: _revision, ...cell }) => cell));
  await page.keyboard.press("Control+Shift+z");
  const redo: CircuitProject = await exportedProject(page);
  expect(
    redo.documents.map(({ revision: _revision, ...cell }) => cell),
  ).toEqual(after.documents.map(({ revision: _revision, ...cell }) => cell));
});

for (const expression of ["CLK", "DATA<1:0>", "CLK,RESET"]) {
  test(`inline Wire naming preserves Label overbar semantics for ${expression}`, async ({
    page,
  }) => {
    await page.goto("/editor?new=1");
    const before: CircuitProject = await exportedProject(page);
    const canvas = page.getByTestId("schematic-canvas");
    await page.keyboard.press("w");
    await canvas.click({ position: { x: 280, y: 220 } });
    await canvas.click({ position: { x: 410, y: 220 } });
    await page.keyboard.press("l");
    const editor = page.getByRole("textbox", { name: "Canvas text editor" });
    await editor.fill(expression);
    await editor.press("ControlOrMeta+A");
    await page.getByRole("button", { name: "Overbar", exact: true }).click();
    await editor.press("Enter");
    await expect(editor).toHaveCount(0);
    await canvas.dblclick({ position: { x: 520, y: 340 } });
    await expectStatus(page, "Committed route");
    await page.keyboard.press("Escape");
    const after: CircuitProject = await exportedProject(page);
    const claim = after.documents[0]!.connectivityEvidence.find(
      (item) => item.kind === "name-claim",
    );
    expect(claim).toMatchObject({
      name: expression === "CLK" ? "CLK_bar" : expression,
    });
    const circuit = (project: CircuitProject) =>
      project.documents.map(({ revision: _revision, ...document }) => document);
    await page.keyboard.press("Control+z");
    expect(circuit(await exportedProject(page))).toEqual(circuit(before));
    await page.keyboard.press("Control+Shift+z");
    expect(circuit(await exportedProject(page))).toEqual(circuit(after));
    await openProject(page, serializeProject(after));
    expect((await exportedProject(page)).documents).toEqual(after.documents);
  });
}

test("Wire naming owns text keys, restores the previous draft on Escape and cancels without orphans", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  const before: CircuitProject = await exportedProject(page);
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 280, y: 220 } });
  await canvas.click({ position: { x: 410, y: 220 } });
  for (let step = 0; step < 3; step += 1)
    await canvas.click({ button: "middle", position: { x: 410, y: 370 } });
  await expectStatus(page, "any angle");
  await canvas.hover({ position: { x: 410, y: 370 } });
  const preview = page.getByTestId("wire-preview");
  const points = await preview.getAttribute("points");
  await page.keyboard.press("l");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("DATA<3:0>");
  await canvas.click({ position: { x: 650, y: 430 } });
  await expect(editor).toBeVisible();
  await expect(preview).toHaveAttribute("points", points!);
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);
  await page.keyboard.press("l");
  await expect(editor).toHaveText("DATA<3:0>");
  await editor.press("End");
  await editor.press("Backspace");
  await expect(preview).toHaveAttribute("points", points!);
  await editor.press("Enter");
  await expect(editor).toBeVisible();
  await editor.fill("DATA<1,1>");
  await editor.press("Enter");
  await expect(editor).toBeVisible();
  await expect(preview).toHaveAttribute("points", points!);
  await editor.fill("CLK,clk");
  await editor.press("Enter");
  await expect(editor).toBeVisible();
  await expect(preview).toHaveAttribute("points", points!);
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(preview).toHaveAttribute("points", points!);
  await page.keyboard.press("l");
  await expect(editor).toHaveText("DATA<3:0>");
  await editor.press("Escape");
  await page.keyboard.press("Backspace");
  await expect(preview).not.toHaveAttribute("points", points!);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  expect((await exportedProject(page)).documents).toEqual(before.documents);
});

for (const { fromBus, name } of [
  { fromBus: false, name: "CLK" },
  { fromBus: true, name: "CLK" },
  { fromBus: false, name: "DATA<3>" },
]) {
  test(`keeps inline scalar ${name} while wiring ${fromBus ? "from" : "onto"} a bus member`, async ({
    page,
  }) => {
    await page.goto("/editor?new=1");
    await createCell(page, "ScalarLanding");
    await placeCellPin(page, {
      name: "DATA<3:0>",
      position: { x: 300, y: 180 },
    });
    await openTopCell(page);
    await clickCommand(page, "Edit", "Place Cell from this Project…");
    await page
      .getByRole("dialog", { name: "Place Hierarchical Cell" })
      .getByRole("option", { name: /ScalarLanding/u })
      .click();
    await placeFirstAt(page, { x: 300, y: 180 });
    const before: CircuitProject = await exportedProject(page);
    const canvas = page.getByTestId("schematic-canvas");
    const bus = canvas.locator('[data-endpoint-key="terminal:X1:DATA<3:0>"]');
    const selection = page.getByRole("textbox", {
      name: "Bus member expression",
    });
    await page.keyboard.press("w");
    if (fromBus) {
      await bus.click();
      await selection.fill("<3>");
      await selection.press("Enter");
    } else {
      await canvas.click({ position: { x: 600, y: 350 } });
    }
    await canvas.click({ position: { x: 450, y: 350 } });
    await page.keyboard.press("l");
    const editor = page.getByRole("textbox", { name: "Canvas text editor" });
    await editor.fill(name);
    await editor.press("Enter");
    await expect(editor).toHaveCount(0);
    if (fromBus) {
      await canvas.dblclick({ position: { x: 600, y: 350 } });
    } else {
      await bus.click();
      await expect(selection).toBeVisible();
      await selection.fill("<3>");
      await selection.press("Enter");
    }
    await expectStatus(page, "Committed route");
    await page.keyboard.press("Escape");
    const after: CircuitProject = await exportedProject(page);
    const top = after.documents[0]!;
    const child = after.documents.find(
      (cell) => cell.name === "ScalarLanding",
    )!;
    const memberId = child.netlist!.terminals[0]!.signal!.members[0]!.id;
    expect(top.routes).toHaveLength(1);
    expect(top.routes[0]!.members).toBeUndefined();
    expect(
      routeEndpoints(top.routes[0]!).some(
        (endpoint) => endpoint.memberId === memberId,
      ),
    ).toBe(true);
    expect(top.connectivityEvidence).toContainEqual(
      expect.objectContaining({ kind: "name-claim", name }),
    );
    expect(resolveDocumentLogicalNets(top).groups).toHaveLength(1);
    expect(resolveDocumentLogicalNets(child).groups).toHaveLength(4);
    expect(child.netlist!.terminals[0]!.signal).toEqual(
      before.documents.find((cell) => cell.name === "ScalarLanding")!.netlist!
        .terminals[0]!.signal,
    );
    expect(top.nets.flatMap((net) => net.terminals)).toEqual([
      { instanceId: "X1", pinName: "DATA<3:0>", memberId },
    ]);
    const circuit = (project: CircuitProject) =>
      project.documents.map(({ revision: _revision, ...document }) => document);
    await page.keyboard.press("Control+z");
    expect(circuit(await exportedProject(page))).toEqual(circuit(before));
    await page.keyboard.press("Control+Shift+z");
    expect(circuit(await exportedProject(page))).toEqual(circuit(after));
    await openProject(page, serializeProject(after));
    expect((await exportedProject(page)).documents).toEqual(after.documents);
  });
}

test("selects an ordered slice in place without losing authored Wire points", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await createCell(page, "Slices");
  await placeCellPin(page, { name: "DATA<7:0>", position: { x: 300, y: 180 } });
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("w");
  await canvas.locator('[data-endpoint-key="terminal:P1:P"]').click();
  await canvas.click({ position: { x: 520, y: 180 } });
  const selection = page.getByRole("textbox", {
    name: "Bus member expression",
  });
  await selection.fill("<7,3,0>");
  await expect(page.getByLabel("Bus selection preview")).toContainText(
    "DATA<7> → DATA<3> → DATA<0>",
  );
  await selection.press("Enter");
  await canvas.dblclick({ position: { x: 520, y: 360 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const saved: CircuitProject = await exportedProject(page);
  const cell = saved.documents.find((item) => item.name === "Slices")!;
  const members = cell.netlist!.terminals[0]!.signal!.members;
  expect(
    cell.routes[0]!.members!.map((member) => member.startMemberId),
  ).toEqual([members[0]!.id, members[4]!.id, members[7]!.id]);
  expect(cell.routes[0]!.legs.length).toBeGreaterThan(1);
  await page.keyboard.press("w");
  await clickRoute(page, cell.routes[0]!.id, 0.5, 0);
  await selection.fill("<6>");
  await expect(page.getByLabel("Bus selection preview")).toContainText(
    "not available",
  );
  await selection.fill("<3>");
  await selection.press("Enter");
  await canvas.dblclick({ position: { x: 680, y: 320 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const nested: CircuitProject = await exportedProject(page);
  const nestedCell = nested.documents.find((item) => item.name === "Slices")!;
  expect(nestedCell.routes.filter((route) => !route.members)).toHaveLength(1);
  expect(nestedCell.nets).toHaveLength(8);
});

test("names a free Wire bundle inline, maps it into a child and restores it through recovery and reopen", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await createCell(page, "BundleStage");
  await placeCellPin(page, { name: "IN<3:0>", position: { x: 300, y: 180 } });
  await openTopCell(page);
  await clickCommand(page, "Edit", "Place Cell from this Project…");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /BundleStage/u })
    .click();
  await placeFirstAt(page, { x: 600, y: 180 });
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 280, y: 350 } });
  await canvas.click({ position: { x: 400, y: 350 } });
  await page.keyboard.press("l");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("CLK,RESET,DATA<1:0>");
  await expect(page.getByLabel("Net Label signal preview")).toContainText(
    "4 members",
  );
  await editor.press("Enter");
  await canvas.locator('[data-endpoint-key="terminal:X1:IN<3:0>"]').click();
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const saved: CircuitProject = await exportedProject(page);
  const top = saved.documents[0]!;
  const child = saved.documents.find((cell) => cell.name === "BundleStage")!;
  const logical = resolveDocumentLogicalNets(top);
  expect(
    child.netlist!.terminals[0]!.signal!.members.map(
      (member) =>
        logical.byBaseNetId.get(
          top.nets.find((net) =>
            net.terminals.some(
              (terminal) =>
                terminal.instanceId === "X1" && terminal.memberId === member.id,
            ),
          )!.id,
        )!.name,
    ),
  ).toEqual(["CLK", "RESET", "DATA<1>", "DATA<0>"]);
  await page.reload();
  await expect(
    canvas.locator('[data-endpoint-key="terminal:X1:IN<3:0>"]'),
  ).toBeVisible();
  expect((await exportedProject(page)).documents).toEqual(saved.documents);
  await openProject(page, serializeProject(saved));
  expect((await exportedProject(page)).documents).toEqual(saved.documents);
});

test("refuses widening a fixed scalar in the inline Wire name editor and retains its route", async ({
  page,
}) => {
  await openProject(page, serializeProject(cellLayoutProject()));
  const before: CircuitProject = await exportedProject(page);
  await editCellLayout(page);
  await page.getByTestId("cell-symbol-pin-handle-A").click();
  await page.keyboard.press("w");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 130, y: 340 } });
  await canvas.hover({ position: { x: 300, y: 340 } });
  const points = await page.getByTestId("wire-preview").getAttribute("points");
  await page.keyboard.press("l");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("DATA<3:0>");
  await editor.press("Enter");
  await expect(editor).toBeVisible();
  await expectStatus(page, "scalar source cannot be widened");
  await editor.press("Escape");
  await expect(page.getByTestId("wire-preview")).toHaveAttribute(
    "points",
    points!,
  );
  await page.keyboard.press("Escape");
  expect((await exportedProject(page)).documents).toEqual(before.documents);
});

test("starts a whole bus by default and optionally chooses a member without committing cancelled drafts", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await createCell(page, "BusDrawing");
  await placeCellPin(page, { name: "DATA<3:0>", position: { x: 300, y: 180 } });
  await placeCellPin(page, { name: "SINK", position: { x: 300, y: 360 } });
  await placeCellPin(page, { name: "OTHER", position: { x: 470, y: 360 } });
  await placeCellPin(page, {
    name: "NARROW<1:0>",
    position: { x: 650, y: 360 },
  });
  const canvas = page.getByTestId("schematic-canvas");
  const busPin = canvas.locator('[data-endpoint-key="terminal:P1:P"]');
  const scalarPin = canvas.locator('[data-endpoint-key="terminal:P2:P"]');
  await page.keyboard.press("w");
  await busPin.click();
  const choice = page.getByRole("combobox", { name: "Bus connection" });
  await expect(choice).toBeVisible();
  await expect(choice).toHaveValue("whole");
  await expect(choice).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(choice).toHaveCount(0);
  let saved: CircuitProject = await exportedProject(page);
  expect(
    saved.documents.find((cell) => cell.name === "BusDrawing")!.routes,
  ).toHaveLength(0);
  await page.keyboard.press("w");
  await busPin.click();
  await canvas.dblclick({ position: { x: 530, y: 180 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  saved = await exportedProject(page);
  const child = saved.documents.find((cell) => cell.name === "BusDrawing")!;
  expect(child.routes).toHaveLength(1);
  expect(child.routes[0]!.members).toHaveLength(4);
  await page.keyboard.press("w");
  await scalarPin.click();
  await busPin.click();
  await expect(choice).toBeVisible();
  await expect(choice.locator("option")).toHaveCount(5);
  await choice.selectOption({ label: "DATA<2>" });
  await page.keyboard.press("Escape");
  saved = await exportedProject(page);
  const after = saved.documents.find((cell) => cell.name === "BusDrawing")!;
  expect(after.routes).toHaveLength(2);
  const member = after.netlist!.terminals.find(
    (pin) => pin.name === "DATA<3:0>",
  )!.signal!.members[1]!;
  const sink = after.netlist!.terminals.find((pin) => pin.name === "SINK")!;
  expect(sink.netId).toBe(member.netId);
  await page.keyboard.press("w");
  await busPin.click();
  await choice.selectOption({ label: "DATA<1>" });
  await canvas.locator('[data-endpoint-key="terminal:P3:P"]').click();
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const reverse: CircuitProject = await exportedProject(page);
  const final = reverse.documents.find((cell) => cell.name === "BusDrawing")!;
  expect(final.routes).toHaveLength(3);
  expect(
    final.netlist!.terminals.find((pin) => pin.name === "OTHER")!.netId,
  ).toBe(
    final.netlist!.terminals.find((pin) => pin.name === "DATA<3:0>")!.signal!
      .members[2]!.netId,
  );
  await page.keyboard.press("w");
  await busPin.click();
  const narrow = canvas.locator('[data-endpoint-key="terminal:P4:P"]');
  await narrow.hover();
  await expect(page.getByLabel("Wire connection preview")).toContainText(
    "Choose 2 bus member(s)",
  );
  await narrow.click();
  await expectStatus(page, "Choose 2 bus member(s)");
  const expression = page.getByRole("textbox", {
    name: "Bus member expression",
  });
  await expression.fill("<3>");
  await expect(page.getByLabel("Bus selection preview")).toContainText(
    "Select 2 members",
  );
  await expect(
    page.getByRole("button", { name: "Use selection" }),
  ).toBeDisabled();
  await expression.press("Escape");
  await page.keyboard.press("Escape");
  const refused: CircuitProject = await exportedProject(page);
  const refusedCell = refused.documents.find(
    (cell) => cell.name === "BusDrawing",
  )!;
  expect(refusedCell.routes).toEqual(final.routes);
  expect(refusedCell.nets).toEqual(final.nets);
  expect(refusedCell.annotations).toEqual(final.annotations);
});

test("names a loose bus with a Label and maps its order into differently named Cell pins after reopening", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await createCell(page, "InputStage");
  await placeCellPin(page, { name: "IN<0:3>", position: { x: 300, y: 180 } });
  await openTopCell(page);
  await clickCommand(page, "Edit", "Place Cell from this Project…");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /InputStage/u })
    .click();
  await placeFirstAt(page, { x: 600, y: 180 });
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("w");
  await canvas.click({ position: { x: 310, y: 350 } });
  await canvas.dblclick({ position: { x: 600, y: 350 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const loose: CircuitProject = await exportedProject(page);
  const routeId = loose.documents[0]!.routes[0]!.id;
  await clickRoute(page, routeId, 0.5, 0);
  await page.keyboard.press("l");
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  for (const invalidName of ["A,,B", "DATA[3:0]"]) {
    await editor.fill(invalidName);
    await editor.press("Enter");
    await expect(editor).toBeVisible();
    await editor.press("Escape");
    expect((await exportedProject(page)).documents).toEqual(loose.documents);
    await clickRoute(page, routeId, 0.5, 0);
    await page.keyboard.press("l");
  }
  await editor.fill("PARENT<3:0>");
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Overbar", exact: true }).click();
  await expect(page.getByLabel("Net Label signal preview")).toContainText(
    "4 members",
  );
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);
  await page.keyboard.press("w");
  await clickRoute(page, routeId, 0.7, 0);
  await expect(
    page.getByRole("combobox", { name: "Bus connection" }),
  ).toHaveValue("whole");
  await canvas.locator('[data-endpoint-key="terminal:X1:IN<0:3>"]').click();
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  await placeCellPin(page, { name: "PARENT<2>", position: { x: 300, y: 260 } });
  await page.keyboard.press("w");
  await canvas.locator('[data-endpoint-key="terminal:P1:P"]').click();
  await canvas.locator('[data-endpoint-key="terminal:X1:IN<0:3>"]').click();
  await expect(
    page.getByRole("combobox", { name: "Bus connection" }),
  ).toHaveCount(0);
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const saved: CircuitProject = await exportedProject(page);
  await openProject(page, serializeProject(saved));
  const reopened: CircuitProject = await exportedProject(page);
  const top = reopened.documents[0]!;
  const child = reopened.documents.find((cell) => cell.name === "InputStage")!;
  const logical = resolveDocumentLogicalNets(top);
  expect(child.netlist!.terminals[0]!.name).toBe("IN<0:3>");
  const formal = child.netlist!.terminals[0]!.signal!.members;
  expect(
    formal.map((member) => {
      const net = top.nets.find((item) =>
        item.terminals.some(
          (terminal) =>
            terminal.instanceId === "X1" && terminal.memberId === member.id,
        ),
      )!;
      return logical.byBaseNetId.get(net.id)?.name;
    }),
  ).toEqual(["PARENT<3>", "PARENT<2>", "PARENT<1>", "PARENT<0>"]);
  const netlist = await copyNetlistText(page, "spice");
  const call = netlist.split("\n").find((line) => /^X1\s/iu.test(line));
  expect(call).toBeDefined();
  const nodes = call!.trim().split(/\s+/u).slice(1, -1);
  expect(nodes).toHaveLength(4);
  expect(new Set(nodes).size).toBe(4);
  for (const node of nodes) expect(node).toContain("PARENT");
});

test("keeps a legacy bracketed Cell Pin scalar when changing only its formatting", async ({
  page,
}) => {
  const project = createEmptyProject("legacy-format", "Legacy format");
  const document = project.documents[0]!;
  document.instances.push(placedInstance("P1", "port", 300, 200));
  document.nets.push({
    id: "legacy",
    terminals: [{ instanceId: "P1", pinName: "P" }],
  });
  document.netlist!.terminals.push({
    id: "legacy-pin",
    name: "OLD<3:>",
    netId: "legacy",
    direction: "input",
    interfaceInstanceIds: ["P1"],
  });
  document.annotations.push({
    id: "pin-label",
    kind: "instance-label",
    binding: { kind: "cell-terminal-name", terminalId: "legacy-pin" },
    anchor: {
      kind: "object",
      objectId: "P1",
      localOffset: { x: 0, y: -20 },
      fallbackPosition: { x: 300, y: 180 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  await openProject(page, serializeProject(project));
  await page.getByTestId("annotation-hit-pin-label").dblclick();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(page.getByLabel("Cell Pin signal preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toHaveCount(0);
  const saved: CircuitProject = await exportedProject(page);
  expect(saved.documents[0]!.netlist!.terminals[0]).toMatchObject({
    name: "OLD<3:>",
  });
  expect(saved.documents[0]!.netlist!.terminals[0]).not.toHaveProperty(
    "signal",
  );
});

test("keeps an unnamed caller member selector visible without creating a parent name when reopened or formatted", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await createCell(page, "UnnamedInputStage");
  await placeCellPin(page, {
    name: "INPUT<7:4>",
    position: { x: 300, y: 180 },
  });
  await openTopCell(page);
  await clickCommand(page, "Edit", "Place Cell from this Project…");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /UnnamedInputStage/u })
    .click();
  await placeFirstAt(page, { x: 600, y: 180 });
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("w");
  await canvas.locator('[data-endpoint-key="terminal:X1:INPUT<7:4>"]').click();
  await page
    .getByRole("combobox", { name: "Bus connection" })
    .selectOption({ label: "INPUT<6>" });
  await canvas.dblclick({ position: { x: 310, y: 350 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const before: CircuitProject = await exportedProject(page);
  const parentBefore = before.documents[0]!;
  const childBefore = before.documents.find(
    (cell) => cell.name === "UnnamedInputStage",
  )!;
  const selectedMember = childBefore.netlist!.terminals[0]!.signal!.members[1]!;
  const selector = parentBefore.annotations.find(
    (annotation) =>
      annotation.binding?.kind === "net-name" &&
      annotation.binding.memberEndpoint,
  )!;
  expect(selector).toBeDefined();
  expect(selector.binding).toMatchObject({
    kind: "net-name",
    memberEndpoint: {
      kind: "terminal",
      instanceId: "X1",
      pinName: "INPUT<7:4>",
      memberId: selectedMember.id,
    },
  });
  expect(parentBefore.connectivityEvidence).toEqual([]);
  expect(
    resolveDocumentLogicalNets(parentBefore).groups.every(
      (net) => net.name === undefined,
    ),
  ).toBe(true);
  const visibleLabel = () =>
    canvas.locator(`[data-object-id="${selector.id}"]`);
  const textWeights = (locator: ReturnType<typeof visibleLabel>) =>
    locator.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const weights: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim())
          weights.push(getComputedStyle(node.parentElement!).fontWeight);
      }
      return weights;
    });
  await expect(visibleLabel()).toContainText("INPUT<6>");
  await openProject(page, serializeProject(before));
  await expect(visibleLabel()).toContainText("INPUT<6>");
  await page.getByTestId(`annotation-hit-${selector.id}`).dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(editor).toHaveText("INPUT<6>");
  await editor.press("ControlOrMeta+A");
  const bold = page.getByRole("button", { name: "Bold", exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => textWeights(editor)).toEqual(["400"]);
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(editor).toHaveCount(0);
  await expect(visibleLabel()).toContainText("INPUT<6>");
  const after: CircuitProject = await exportedProject(page);
  const parentAfter = after.documents[0]!;
  expect(parentAfter.connectivityEvidence).toEqual([]);
  expect(parentAfter.nets).toEqual(parentBefore.nets);
  expect(parentAfter.routes).toEqual(parentBefore.routes);
  expect(
    parentAfter.annotations.find((annotation) => annotation.id === selector.id)!
      .binding,
  ).toEqual(selector.binding);
  expect(
    parentAfter.annotations.find((annotation) => annotation.id === selector.id)
      ?.formatOverride,
  ).toBeDefined();
  await expect.poll(() => textWeights(visibleLabel())).toEqual(["400"]);
  expect(
    after.documents.find((cell) => cell.id === childBefore.id)!.netlist!
      .terminals,
  ).toEqual(childBefore.netlist!.terminals);
  await openProject(page, serializeProject(after));
  await expect(visibleLabel()).toContainText("INPUT<6>");
  await expect.poll(() => textWeights(visibleLabel())).toEqual(["400"]);
  await page.keyboard.press("w");
  await canvas.locator('[data-endpoint-key="terminal:X1:INPUT<7:4>"]').click();
  await page
    .getByRole("combobox", { name: "Bus connection" })
    .selectOption({ label: "Whole bus · 4 members" });
  await canvas.dblclick({ position: { x: 310, y: 180 } });
  await expectStatus(page, "Committed route");
  await page.keyboard.press("Escape");
  const drawing: CircuitProject = await exportedProject(page);
  expect(drawing.documents[0]!.connectivityEvidence).toEqual([]);
  const bus = drawing.documents[0]!.routes.find((route) => route.members)!;
  expect(bus.members).toHaveLength(4);
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  const exportedStructure = await page.evaluate(
    ({ svg, busId, selectorId, memberId }) => {
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      return {
        valid: document.querySelector("parsererror") === null,
        bus:
          document.querySelector(`polyline[data-object-id="${busId}"]`) !==
          null,
        tap:
          document.querySelector(
            `[data-role="bus-tap"][data-member-id="${memberId}"]`,
          ) !== null,
        label: document.querySelector(`[data-object-id="${selectorId}"]`)
          ?.textContent,
        editing:
          document.querySelector(
            '[data-layer="editor-overlay"], .hit-target, [data-canvas-overlay]',
          ) !== null,
      };
    },
    {
      svg,
      busId: bus.id,
      selectorId: selector.id,
      memberId: selectedMember.id,
    },
  );
  expect(exportedStructure).toEqual({
    valid: true,
    bus: true,
    tap: true,
    label: "INPUT<6>",
    editing: false,
  });
  const png = await downloadBytes(page, "File", "Export PNG");
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const raster = await page.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i + 3]! > 0 &&
          Math.min(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) < 128
        )
          ink++;
      const result = { width: image.width, height: image.height, ink };
      image.close();
      return result;
    },
    [...png],
  );
  expect(raster.width).toBeGreaterThan(0);
  expect(raster.height).toBeGreaterThan(0);
  expect(raster.ink).toBeGreaterThan(0);
  const pdf = await downloadBytes(page, "File", "Export PDF");
  const pdfText = pdf.toString("latin1");
  expect(pdfText).toMatch(/^%PDF-/u);
  expect(pdfText).toMatch(/\/Type\s*\/Page\b/u);
  expect(pdfText.trimEnd()).toMatch(/%%EOF$/u);
});
