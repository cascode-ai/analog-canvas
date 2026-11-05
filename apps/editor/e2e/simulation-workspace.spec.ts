import {
  test,
  expect,
  type Locator,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { unzipSync } from "fflate";
import {
  createSimulationFolder,
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
} from "@icm/model";
import { parseProject } from "@icm/project-protocol";

import {
  revealPropertiesShelf,
  clickNetlistWorkflowCommand,
  downloadBytes,
  exportedProject,
  expectStatus,
  openProject,
  openProjectFile,
  readRecoveryRecords,
  openCellManager,
  openMenu,
  renameProject,
} from "./editor-fixtures.js";
import {
  chooseHelperEntry,
  completedNgspiceRun,
  downloadClicked,
  ngspiceCapabilities,
  editSimulationFile,
  folderFile,
  openSimulation,
  ota,
  profile,
  sourceEditor,
} from "./simulation-e2e-fixtures.js";

/** A starter folder on the Project's top Cell, in the hosted Profile. */
function starterFolder(
  project: { topDocumentId: string },
  id: string,
  name: string,
  engine: "vacask" | "ngspice" = "vacask",
) {
  return createSimulationFolder({
    id,
    name,
    engine,
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
}

/** A simulation folder's row in this page or region's file tree. */
function folderRow(scope: Page | Locator, name: string) {
  return scope.getByRole("treeitem", { name: `Folder ${name}`, exact: true });
}

/**
 * Open the OTA Project with one starter folder while every simulation request
 * is refused, as an offline service would; return the folder.
 */
async function openOfflineFolder(page: Page, id: string, name: string) {
  const project = parseProject(JSON.stringify(ota));
  const folder = starterFolder(project, id, name);
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await openSimulation(page, project);
  return folder;
}

test("simulation Agent entry is passive and reuses the existing connection panel", async ({
  page,
}) => {
  let creates = 0;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(
    "**/api/agent/sessions/sim-guide/editor",
    (route) => {
      socket = route;
      route.onMessage((message) => {
        const control = JSON.parse(String(message));
        if (control.kind === "heartbeat") {
          route.send(JSON.stringify({ ...control, kind: "heartbeat-ack" }));
        }
      });
    },
  );
  await page.route("**/api/agent/sessions", async (route) => {
    creates += 1;
    await route.fulfill({
      json: {
        ok: true,
        session: {
          sessionId: "sim-guide",
          editorSecret: "sim-secret",
          claimCode: "sim-guide.claim",
          claimExpiresAt: Date.now() + 300_000,
          expiresAt: Date.now() + 3_600_000,
        },
      },
    });
  });
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = [];
  const simulation = await openSimulation(page, project);
  const bar = page.locator(".simulation-taskbar");
  const guide = page.getByRole("region", { name: "Agent simulation guide" });
  await expect(guide.getByRole("heading")).toHaveText(
    "Simulate with an Agent (recommended)",
  );
  await expect(guide.getByRole("listitem")).toHaveCount(3);
  await expect(bar.locator(".simulation-agent-guidance")).toHaveCount(0);
  await expect(
    guide.getByRole("button", { name: "Set up manually", exact: true }),
  ).toBeVisible();
  const initialSurface = await simulation.boundingBox();
  const connectBounds = await guide
    .getByRole("button", { name: "Connect Agent", exact: true })
    .boundingBox();
  expect(connectBounds!.y + connectBounds!.height).toBeLessThanOrEqual(
    initialSurface!.y + initialSurface!.height,
  );
  await expect(page.getByTestId("connect-agent-panel")).toHaveCount(0);
  expect(creates).toBe(0);
  await guide
    .getByRole("button", { name: "Connect Agent", exact: true })
    .click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("agent-copy-text")).toHaveValue(
    /sim-guide.claim/,
  );
  // The native dialog correctly removes the background guide from the
  // accessibility tree. Inspect the passive guide after closing the dialog.
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await expect(
    guide.getByRole("button", { name: "View connection info", exact: true }),
  ).toBeVisible();
  expect(creates).toBe(1);
  await expect.poll(() => socket !== null).toBe(true);
  socket!.send(
    JSON.stringify({
      protocolVersion: "1.0",
      sessionId: "sim-guide",
      messageId: "ready",
      requestId: "ready",
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "session.ready", sessionId: "sim-guide" },
    }),
  );
  await expect(guide.getByRole("status")).toContainText("Agent connected");
  await expect(panel).toHaveCount(0);
  await page
    .getByRole("button", { name: "Maximize simulation", exact: true })
    .click();
  await expect(guide.getByRole("status")).toContainText(
    "Tell your Agent your simulation goal.",
  );
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 480, height: 640 });
  await expect(
    guide.getByRole("button", { name: "Connection details", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".simulation-start-workspace")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.setViewportSize(originalViewport);
  await guide
    .getByRole("button", { name: "Connection details", exact: true })
    .click();
  await expect(panel).toBeVisible();
  expect(creates).toBe(1);
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await guide
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await page.getByLabel("New simulation folder name").fill("Agent experiment");
  await page.getByLabel("New simulation folder name").press("Enter");
  await expect(guide).toHaveCount(0);
  await expect(
    bar.getByRole("button", { name: "Agent connected", exact: true }),
  ).toBeVisible();
});

test("simulation examples confirm whole-Project replacement and protect existing work", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = [];
  await openProject(page, project);
  await renameProject(page, "My unsaved circuit");
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  const cards = panel.getByRole("group", { name: "Simulation examples" });
  await expect(cards).not.toBeVisible();
  await panel.getByText("Explore examples", { exact: true }).click();
  await expect(cards.getByRole("button")).toHaveCount(4);
  await expect(panel).not.toContainText("No DUT instance");
  const rcFilters = cards.getByRole("button", {
    name: "RC Filters Low-pass & high-pass",
  });
  await rcFilters.click();
  const confirmation = page.getByRole("dialog", { name: "Open RC Filters?" });
  await expect(confirmation).toContainText("entire Project");
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(cards).toBeVisible();
  await expect
    .poll(async () =>
      (await readRecoveryRecords(page)).some(
        (record) => JSON.parse(record.projectText).id === project.id,
      ),
    )
    .toBe(true);
  await rcFilters.click();
  await confirmation
    .getByRole("button", { name: "Open example", exact: true })
    .click();
  const guard = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(cards).toBeVisible();
  await rcFilters.click();
  await confirmation
    .getByRole("button", { name: "Open example", exact: true })
    .click();
  await guard.getByRole("button", { name: "Continue without saving" }).click();
  await expect(cards).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Run", exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".simulation-source-context")).toContainText(
    "Canvas source:",
  );
  await expect(sourceEditor(panel)).toContainText("Click Run");
});

test("source save applies locally while signed out and leaves File Save cloud-owned", async ({
  page,
}) => {
  let cloudWrites = 0;
  await page.route("**/api/projects**", (route) => {
    if (["POST", "PUT"].includes(route.request().method())) cloudWrites++;
    return route.fulfill({ status: 401, json: { error: "Sign in" } });
  });
  const folder = await openOfflineFolder(page, "local-save", "Local save");
  const editor = sourceEditor(page);
  const save = page.getByRole("button", { name: "Save source", exact: true });
  const source = folderFile(folder).text;
  await editor.fill(`${source}\n* local keyboard save\n`);
  await expect(save).toHaveAttribute("data-save-state", "dirty");
  await editor.press("ControlOrMeta+s");
  await expect(save).toHaveAttribute("data-save-state", "saved");
  await expect(page.getByRole("tab", { name: /run\.cir/ })).not.toContainText(
    "●",
  );
  expect(cloudWrites).toBe(0);
  await expect(page.getByTestId("status")).not.toContainText("Sign in to save");
  await expect
    .poll(async () =>
      (await readRecoveryRecords(page)).some((record) =>
        record.projectText.includes("* local keyboard save"),
      ),
    )
    .toBe(true);
  await openMenu(page, "File");
  await page.getByTestId("save-cloud-project").click();
  await expectStatus(page, "Sign in to save");
  expect(cloudWrites).toBe(1);
  await expect(save).toHaveAttribute("data-save-state", "saved");
});

test("Helper keeps signal selection continuous and shares the file row without stealing focus", async ({
  page,
}) => {
  const folder = await openOfflineFolder(
    page,
    "continuous-signals",
    "Continuous signals",
  );
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  const editor = sourceEditor(page);
  const helper = page.getByRole("button", { name: "Helper", exact: true });
  const tab = page.getByRole("tab", { name: /run.cir/ });
  const helperBox = (await helper.boundingBox())!;
  const tabBox = (await tab.boundingBox())!;
  expect(Math.abs(helperBox.y - tabBox.y)).toBeLessThan(10);
  expect(helperBox.x).toBeGreaterThan(tabBox.x + tabBox.width);
  await expect(
    page.getByText("Try another analysis", { exact: true }),
  ).toHaveCount(0);
  await helper.click();
  const helperPopup = page.getByRole("dialog", { name: "Insert / Helper" });
  const popupBox = (await helperPopup.boundingBox())!;
  await page
    .getByRole("option", { name: "Save voltage…", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Save signal" });
  const search = picker.getByRole("textbox", { name: "Search signal" });
  await expect(search).toBeFocused();
  const pickerBox = (await picker.boundingBox())!;
  expect(Math.abs(pickerBox.x - popupBox.x)).toBeLessThan(2);
  expect(Math.abs(pickerBox.height - popupBox.height)).toBeLessThan(2);
  const output = picker.getByRole("button", { name: /— vout(?:\s|$)/ });
  await output.click();
  await expect(search).toBeFocused();
  await expect(output).toContainText("Added");
  await picker.getByRole("button", { name: /— vinp(?:\s|$)/ }).click();
  await expect(search).toBeFocused();
  await expect(editor).toContainText("save v(vout) v(vinp)");
  await expect(output).toBeDisabled();
  await output.click({ force: true });
  expect((await editor.innerText()).match(/v\(vout\)/g)).toHaveLength(1);
  await search.press("Escape");
  await expect(picker).toHaveCount(0);
  // Dismissing the helper by clicking code must leave focus at that click.
  await helper.click();
  await editor.click({ position: { x: 2, y: 8 } });
  await expect(helperPopup).toHaveCount(0);
  await expect(editor).toBeFocused();
  await editor.fill(folderFile(folder).text);
  await chooseHelperEntry(page, "Pick Net on Canvas");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("route-hit-tb-vinp-route").click({ force: true });
  await expect(canvas).toHaveClass(/simulation-net-pick-active/);
  await expect(editor).not.toBeFocused();
  await page.getByTestId("route-hit-tb-vout-route").click({ force: true });
  await expect(editor).toContainText("save v(vinp) v(vout)");
  await expect(canvas).toHaveClass(/simulation-net-pick-active/);
  await expect(editor).not.toBeFocused();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(canvas).not.toHaveClass(/simulation-net-pick-active/);
  // An incomplete source must remain repairable, not falsely acknowledge an
  // acquisition that the editor refused to insert.
  const validSource = folderFile(folder).text;
  await editor.fill(`${validSource}\nsave v(`);
  await chooseHelperEntry(page, "Save voltage…");
  await output.click();
  await expect(output).not.toContainText("Added");
  await expect(output).toBeEnabled();
  await expect(editor).not.toContainText("v(vout)");
  await search.press("Escape");
  await editor.fill(validSource);
  await chooseHelperEntry(page, "Save voltage…");
  await output.click();
  await expect(output).toContainText("Added");
  await expect(editor).toContainText("v(vout)");
});

/** The hosted ngspice service's capabilities, offering the SKY130 Profile. */
const hosted = ngspiceCapabilities();
const capabilities = {
  ...hosted,
  inputs: ["source", "raw"],
  profiles: [
    { ...hosted.profiles[0]!, devices: profile.qualifiedScope.devices },
  ],
};

// Results, run files and downloads are owned by simulation-spec-results,
// simulation-artifact-files and project-run-history tests and by
// simulation-storage.spec.ts; this run keeps the human lifecycle.
test("human simulation refuses a bad output, survives minimizing, cancels, and keeps its status through reload", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  let folder = starterFolder(project, "folder-e2e", "E2E folder", "ngspice");
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok) throw Error(parsed.message);
  const config = parsed.config;
  config.environment.corner = "tt";
  const output = (instanceId: string, pinName: string) => ({
    id: "out",
    label: "out",
    expression: {
      kind: "voltage" as const,
      circuit: { bindingId: "circuit", callPath: [] },
      documentId: project.topDocumentId,
      anchor: { kind: "terminal" as const, instanceId, pinName },
      occurrence: [],
    },
  });
  config.outputs = [output("missing-instance", "out")];
  folder = replaceSimulationExperimentConfig(folder, config);
  project.simulationFolders = [folder];
  let executions = 0,
    cancellations = 0;
  let release = () => {};
  let pending = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({ json: capabilities });
    if (body.operation === "cancel") {
      cancellations++;
      release();
      return route.fulfill({ json: { ok: true } });
    }
    executions++;
    await pending;
    // The acquisition inserted for the Canvas vout output.
    expect(body.preparedDeck).toContain("v(vout)");
    const run = await completedNgspiceRun(body);
    await route.fulfill({
      json: {
        ...run,
        log: "ngspice OP\n",
        data: {
          ...run.data,
          analyses: [
            {
              ...run.data.analyses[0],
              probes: [
                { name: "v(vout)", quantity: "voltage", unit: "V", value: 0.5 },
              ],
            },
          ],
        },
        cancelled: cancellations > 0,
      },
    });
  });
  const panel = await openSimulation(page, project);
  // An output naming no part is refused before anything runs.
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await panel.getByRole("tab", { name: "Console", exact: true }).click();
  await expect(panel.getByLabel("Simulation results")).toContainText(
    /PROBE|probe/,
  );
  expect(executions).toBe(0);
  config.outputs = [output("XDUT", "vout")];
  await editSimulationFile(
    page,
    folder.input.configPath,
    JSON.stringify(config, null, 2),
  );
  const program = [
    "* Source-owned E2E experiment",
    '.include "circuit.spice"',
    ".control",
    "set filetype=ascii",
    "op",
    "write out.raw",
    ".endc",
    ".end",
    "",
  ].join("\n");
  await editSimulationFile(page, folder.input.entry, program);
  // A run outlives minimizing the panel and completes in its folder.
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(1);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  expect(cancellations).toBe(0);
  release();
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(panel.getByRole("status")).toHaveText("completed");
  pending = new Promise<void>((r) => {
    release = r;
  });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(2);
  await panel.getByRole("button", { name: "Cancel run" }).click();
  await expect(panel.getByRole("status")).toContainText("cancelled");
  expect(cancellations).toBe(1);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  const saved = await downloadBytes(page, "File", "Export Project File…");
  await page.reload();
  // Explicit import is the persistence contract, not browser recovery heuristics.
  await openProjectFile(page, saved);
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(sourceEditor(panel)).toContainText(
    "Source-owned E2E experiment",
  );
  // The folder's status outlives the reload: its newest run, the cancelled
  // one, read from the browser archive, which also keeps the completed run.
  await expect(panel.getByRole("status")).toHaveText("cancelled");
  await panel.locator(".simulation-run-history > summary").click();
  const savedArchives = panel.getByRole("region", {
    name: "Saved folder results",
  });
  await expect(savedArchives).toContainText("E2E folder");
  await expect(
    savedArchives.getByRole("listitem").filter({ hasText: "completed" }),
  ).not.toHaveCount(0);
  expect(executions).toBe(2);
});

test("a new experiment's setup fits its card, creates only on Create, and asks for an environment when none fits (#1489)", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = [];
  // The SIN testbench also holds the SKY130 varactor, which no environment
  // qualifies.
  project.documents
    .find((cell) => cell.id === "document-ota-5t-testbench-sin")!
    .instances.push({
      id: "varactor",
      reference: "C9",
      symbolId: "capacitor",
      placement: null,
      netlist: {
        binding: {
          kind: "model",
          deviceClass: "capacitor",
          name: "sky130_fd_pr__cap_var_lvt",
        },
        parameters: {},
      },
    });
  const vacask = {
    id: "vacask-sky130-candidate",
    engine: "vacask",
    corners: [],
  };
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      json: { ...capabilities, profiles: [...capabilities.profiles, vacask] },
    }),
  );
  await openSimulation(page, project);
  const setUp = page.getByRole("button", {
    name: "Set up manually",
    exact: true,
  });
  const name = page.getByLabel("New simulation folder name");
  const cell = page.getByRole("combobox", {
    name: "Simulation Cell",
    exact: true,
  });
  const environment = page.getByLabel("Simulation environment", {
    exact: true,
  });
  const card = page.locator(
    ".simulation-start-workspace > .workspace-inline-name",
  );
  const folder = folderRow(page, "SIN check");
  await setUp.click();
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(360);
  await name.press("Escape");
  await page
    .getByRole("button", { name: "Maximize simulation", exact: true })
    .click();
  await setUp.click();
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(360);
  // Moving from the name to the Cell creates nothing.
  await name.fill("SIN check");
  await name.press("Tab");
  await expect(cell).toBeFocused();
  await cell.selectOption("document-ota-5t-testbench-sin");
  await expect(name).toBeVisible();
  await expect(folder).toHaveCount(0);
  // None fits the SIN testbench: Create asks, as the Agent's create refuses.
  await expect(environment).toHaveValue("");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Choose an environment. No Profile qualifies sky130_fd_pr__cap_var_lvt.",
    }),
  ).toBeVisible();
  await expect(folder).toHaveCount(0);
  await environment.selectOption(vacask.id);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(folder).toBeVisible();
  await page
    .getByRole("button", { name: "Restore simulation panel", exact: true })
    .click();
  expect(
    readSimulationExperimentConfig(
      (await exportedProject(page)).simulationFolders[0],
    ),
  ).toMatchObject({ config: { environment: { profileId: vacask.id } } });
});

test("Simulation defaults a new experiment to an ordinary authored Cell", async ({
  page,
}) => {
  await page.goto("/editor");
  const manager = await openCellManager(page);
  await manager.getByRole("button", { name: "New Cell" }).click();
  const newCell = page.getByRole("dialog", { name: "New Cell" });
  await newCell.getByLabel("Cell name").fill("Testbench");
  await newCell.getByRole("button", { name: "Create" }).click();
  await (
    await openMenu(page, "Edit")
  )
    .getByRole("button", { name: "Place Cell from this Project…" })
    .click();
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /dut/u })
    .click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(page.getByLabel("Testbench Cell")).toHaveCount(0);
  const taskbar = page.locator(".simulation-taskbar");
  await expect(taskbar).toHaveCount(1);
  await expect(
    page.getByRole("complementary", { name: "Sim Code", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".simulation-brand")).toHaveCount(0);
  const initialBar = await taskbar.boundingBox();
  expect(initialBar!.height).toBeLessThanOrEqual(36);
  await page
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await page.getByLabel("New simulation folder name").fill("Main experiment");
  await expect(page.getByLabel("Folder template")).toHaveCount(0);
  await expect(page.getByLabel("Folder source")).toHaveCount(0);
  await page.getByLabel("New simulation folder name").press("Enter");
  const runBox = await page
    .getByRole("button", { name: "Run", exact: true })
    .boundingBox();
  const statusBox = await taskbar.getByRole("status").boundingBox();
  expect(runBox!.height).toBeLessThanOrEqual(24);
  expect(statusBox!.x).toBeGreaterThanOrEqual(runBox!.x + runBox!.width);
  expect(Math.abs(statusBox!.y - runBox!.y)).toBeLessThanOrEqual(2);
  await expect(taskbar).toHaveCount(1);
  for (const name of ["Explorer", "Save source"]) {
    const box = await taskbar
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(Math.abs(box!.y - runBox!.y)).toBeLessThanOrEqual(2);
    expect(box!.height).toBeLessThanOrEqual(24);
  }
  expect((await taskbar.boundingBox())!.height).toBeLessThanOrEqual(32);
  const saveButton = taskbar.getByRole("button", {
    name: "Save source",
    exact: true,
  });
  const runButton = taskbar.getByRole("button", { name: "Run", exact: true });
  expect((await saveButton.boundingBox())!.width).toBe(22);
  expect(runBox!.width).toBeGreaterThan(22);
  expect(runBox!.width).toBeLessThanOrEqual(160);
  await expect(saveButton).toHaveText("");
  await expect(runButton).toHaveText("Main experiment");
  await expect(saveButton).toHaveAttribute(
    "title",
    /not a cloud save.*Ctrl\+S/,
  );
  await expect(saveButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(runButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.getByLabel("Analysis examples")).toHaveCount(0);
  // The experiment runs the Cell drawn on the Canvas, not the Project's Top.
  const configured = await exportedProject(page);
  expect(configured.topDocumentId).toBe("document-main");
  expect(
    configured.documents.find(
      (cell: { id: string }) =>
        cell.id ===
        configured.simulationFolders[0].input.circuitBindings[0].documentId,
    ).name,
  ).toBe("Testbench");
  const simulationResize = page.getByTestId("simulation-resize-handle");
  const initialWidth = Number(
    await simulationResize.getAttribute("aria-valuenow"),
  );
  expect(initialWidth).toBe(Math.round(page.viewportSize()!.width * 0.4));
  await simulationResize.press("ArrowRight");
  await expect(simulationResize).toHaveAttribute(
    "aria-valuenow",
    String(initialWidth - 8),
  );
  await page.getByRole("button", { name: "Minimize simulation" }).click();
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
  await expect(page.getByTestId("open-analog-simulation")).toContainText(
    "Minimized",
  );
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await page.getByRole("button", { name: "Exit simulation" }).click();
  const exitConfirmation = page.getByRole("dialog", {
    name: "Exit Simulation?",
  });
  await expect(exitConfirmation).toContainText("temporary run files");
  await exitConfirmation.getByRole("button", { name: "Cancel" }).click();
  const simulation = page.getByRole("region", { name: "Analog simulation" });
  await expect(simulation).toBeVisible();
  await page.getByRole("button", { name: "Exit simulation" }).click();
  await exitConfirmation
    .getByRole("button", { name: "Exit Simulation" })
    .click();
  await expect(simulation).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
});

async function openWorkspace(
  page: Page,
  engine: "vacask" | "ngspice" = "vacask",
) {
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = ["Alpha", "Beta"].map((name) =>
    starterFolder(project, name, name, engine),
  );
  await openSimulation(page, project);
  return page.getByRole("region", { name: "Simulation Code workspace" });
}

test("Simulation and Properties stay independent, and maximized simulation reclaims chrome at narrow width, both minimizing without losing source", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const workspace = await openWorkspace(page);
  const editor = sourceEditor(workspace);
  await editor.fill("* independent draft\n");
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) !== "true")
    await shelf.click();
  await expect(editor).toBeVisible();
  await expect(shelf).toHaveAttribute("aria-expanded", "true");
  const codeBox = await page.locator(".editor-simulation-dock").boundingBox();
  const propsBox = await page
    .getByRole("complementary", { name: "Properties", exact: true })
    .boundingBox();
  expect(codeBox!.x).toBeGreaterThanOrEqual(propsBox!.x + propsBox!.width - 1);
  const minimize = page.getByRole("button", {
    name: "Minimize simulation",
    exact: true,
  });
  await minimize.click();
  await expect(shelf).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Sim Code", exact: true }).click();
  await expect(editor).toContainText("independent draft");

  await page.setViewportSize({ width: 900, height: 700 });
  const docked = await workspace.boundingBox();
  await page
    .getByRole("button", { name: "Maximize simulation", exact: true })
    .click();
  await expect(page.locator(".app-chrome")).toBeHidden();
  await expect(page.getByTestId("library-toggle")).toBeHidden();
  await expect(page.getByTestId("examples-toggle")).toBeHidden();
  const agentEntry = workspace.getByRole("button", {
    name: "Connect Agent",
    exact: true,
  });
  await expect(agentEntry).toBeVisible();
  await expect(workspace.locator(".simulation-agent-hint")).toBeHidden();
  const agentBox = await agentEntry.boundingBox();
  const toolbarBox = await workspace
    .locator(".simulation-taskbar")
    .boundingBox();
  expect(agentBox!.x + agentBox!.width).toBeLessThanOrEqual(
    toolbarBox!.x + toolbarBox!.width,
  );
  const bounds = await page.locator(".app-workspace").boundingBox();
  expect(bounds!.y).toBe(0);
  expect(bounds!.width).toBe(900);
  expect(
    (await page.locator(".app-statusbar").boundingBox())!.y,
  ).toBeGreaterThanOrEqual(bounds!.height);
  expect((await workspace.boundingBox())!.height).toBeGreaterThan(
    docked!.height,
  );
  await expect(
    page.getByRole("button", { name: "Restore simulation panel", exact: true }),
  ).toBeVisible();
  await minimize.click();
  await expect(page.locator(".app-chrome")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
  await page.getByTestId("open-analog-simulation").click();
  await expect(editor).toContainText("independent draft");
  await expect(page.locator(".app-chrome")).toBeVisible();
});

test("tab and tree menus, empty editors and resizing never discard source, and only activation picks the run target", async ({
  page,
}) => {
  let executedDeck = "";
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          ...capabilities,
          modelLibrary: {
            path: profile.models.library.runtimePath,
            section: "tt",
          },
        },
      });
    executedDeck = body.preparedDeck;
    await route.fulfill({
      status: 503,
      json: { error: "Captured run target" },
    });
  });
  const workspace = await openWorkspace(page, "ngspice");
  const files = workspace.getByRole("complementary", {
    name: "Simulation files",
  });
  const alpha = folderRow(files, "Alpha");
  const beta = folderRow(files, "Beta");
  const run = page.getByRole("button", { name: "Run", exact: true });
  const editor = sourceEditor(workspace);
  const tabs = workspace
    .getByRole("tablist", { name: "Open simulation files" })
    .getByRole("tab");
  const runTab = workspace.getByRole("tab", { name: /run\.cir/ });
  const circuitTab = workspace.getByRole("tab", { name: /circuit\.spice/ });
  const fileRow = (name: string) =>
    files.getByRole("treeitem", { name, exact: true }).first();
  await expect(
    workspace.getByRole("button", { name: "More code actions" }),
  ).toHaveCount(0);

  // Tab menus close tabs, never the source they show.
  const draft = "* retained after closing tabs\n";
  await editor.fill(draft);
  await circuitTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(circuitTab).toHaveCount(0);
  await expect(runTab).toHaveAttribute("aria-selected", "true");
  await fileRow("circuit.spice").click();
  await circuitTab.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close others", exact: true })
    .click();
  await expect(tabs).toHaveCount(1);
  await expect(circuitTab).toHaveAttribute("aria-selected", "true");
  await fileRow("run.cir").click();
  await expect(editor).toHaveText(draft);
  await runTab.focus();
  await runTab.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Close all", exact: true }).click();
  await expect(tabs).toHaveCount(0);
  await expect(
    workspace.getByText(
      "Select a file to edit. Closing tabs does not delete files.",
    ),
  ).toBeVisible();
  await fileRow("run.cir").click();
  await expect(editor).toHaveText(draft);
  await runTab.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close others", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  // A file's menu keeps the open tab and the tree's width; one outside click
  // both dismisses it and activates its target.
  const before = await files.boundingBox();
  await fileRow("circuit.spice").click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Actions for circuit.spice" }),
  ).toBeVisible();
  await expect(runTab).toHaveAttribute("aria-selected", "true");
  expect((await files.boundingBox())!.width).toBe(before!.width);
  await beta.click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(beta).toHaveAttribute("aria-selected", "true");
  await expect(run).toHaveText("Beta");
  await expect(run).toHaveAttribute("title", "Run Beta / run.cir");
  await expect(beta).toHaveAttribute("aria-current", "page");

  // Expansion, a menu or a multi-selection never moves the run target;
  // activating a folder does.
  await files
    .getByRole("button", { name: "Toggle Alpha", exact: true })
    .click();
  await expect(run).toHaveText("Beta");
  await alpha.click({ button: "right" });
  await expect(run).toHaveText("Beta");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await alpha.click({ modifiers: ["ControlOrMeta"] });
  await expect(run).toHaveText("Beta");
  await alpha.focus();
  await alpha.press("Enter");
  await expect(run).toHaveText("Alpha");
  await beta.click();
  await expect(run).toHaveText("Beta");
  await expect(run.locator("svg")).toBeVisible();
  await run.click();
  await expect.poll(() => executedDeck.split(/\r?\n/)[0]).toBe("Beta");

  // The files pane resizes by keyboard and resets on double-click.
  const handle = workspace.getByRole("separator", {
    name: "Resize simulation files",
  });
  const original = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", String(original + 10));
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "240");

  // An old Canvas selection must not override explicit activation.
  await page
    .locator('[data-canvas-hit-kind="instance"]')
    .first()
    .click({ force: true });
  await expect(circuitTab).toHaveAttribute("aria-selected", "true");
  await expect(run).toHaveAttribute("title", "Run Beta / run.cir");

  const longName = "Beta with a deliberately long simulation folder name";
  await beta.focus();
  await beta.press("F2");
  const naming = workspace.getByRole("textbox", {
    name: "Folder name",
    exact: true,
  });
  await naming.fill(longName);
  await naming.press("Enter");
  await expect(run).toHaveText(longName);
  expect((await run.boundingBox())!.width).toBeLessThanOrEqual(160);
  await expect(run).toHaveAttribute("title", `Run ${longName} / run.cir`);
});

test("Explorer context downloads preserve multi-selection and directory contents without resizing rename rows", async ({
  page,
}) => {
  const workspace = await openWorkspace(page);
  const tree = workspace.getByRole("tree", { name: "Simulation folders" });
  const alpha = folderRow(tree, "Alpha");
  const beta = folderRow(tree, "Beta");
  const alphaFiles = alpha.locator("../..");
  const file = (name: string) =>
    alphaFiles.getByRole("treeitem", { name, exact: true });
  const circuit = file("circuit.spice");
  const run = file("run.cir");
  const downloadSelected = page.getByRole("menuitem", {
    name: "Download selected (2)…",
  });
  await expect(
    workspace.getByRole("button", { name: "Explorer", exact: true }),
  ).toHaveCount(1);
  await expect(
    workspace.getByRole("button", { name: /Download selected/ }),
  ).toHaveCount(0);
  await expect(file("Source")).toHaveCount(0);
  await expect(alpha).toHaveAttribute("aria-expanded", "true");
  await expect(beta).toHaveAttribute("aria-expanded", "false");
  await expect(run).toHaveAttribute("aria-level", "2");
  await expect(circuit).toHaveAttribute("aria-level", "2");
  await expect(file("Run")).toHaveAttribute("aria-expanded", "false");
  await run.click();
  await circuit.click({ modifiers: ["ControlOrMeta"] });
  await expect(
    workspace.getByRole("tab", { name: "run.cir", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await run.click({ button: "right" });
  expect(
    Object.keys(unzipSync(await downloadClicked(downloadSelected))).sort(),
  ).toEqual(["Alpha/source/circuit.spice", "Alpha/source/run.cir"]);
  await circuit.click();
  await run.click({ modifiers: ["Shift"] });
  await expect(
    alphaFiles.getByRole("treeitem", { selected: true }),
  ).toHaveCount(2);
  await expect(
    workspace.getByRole("tab", { name: /circuit\.spice/ }),
  ).toHaveAttribute("aria-selected", "true");
  await beta.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Download…", exact: true }),
  ).toBeVisible();
  await expect(run).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  const bounds = await run.locator("..").boundingBox();
  await run.focus();
  await run.press("F2");
  const name = tree.getByRole("textbox", { name: "Relative file path" });
  const editingBounds = await name.locator("../..").boundingBox();
  expect(editingBounds!.height).toBe(bounds!.height);
  expect(editingBounds!.width).toBe(bounds!.width);
  await name.press("Escape");
  await alpha.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New file…", exact: true }).click();
  await name.fill("models/bias/local.cir");
  await name.press("Enter");
  const models = file("models");
  await expect(models).toHaveAttribute("aria-expanded", "true");
  await expect(file("local.cir")).toBeVisible();
  await models.click();
  await expect(file("local.cir")).toHaveCount(0);
  await models.click({ button: "right" });
  const nestedDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download…", exact: true }).click();
  expect((await nestedDownload).suggestedFilename()).toMatch(/\.zip$/);
  // Selecting the parent and one descendant must not duplicate ZIP entries.
  await alpha.click({ modifiers: ["ControlOrMeta"] });
  await alpha.click({ button: "right" });
  const names = Object.keys(unzipSync(await downloadClicked(downloadSelected)));
  expect(
    names.filter((path) => path.endsWith("models/bias/local.cir")),
  ).toHaveLength(1);
  expect(names).not.toContain("Alpha/source/experiment.json");
  // Workspace shortcuts still work while focus is in the file tree.
  await run.focus();
  await run.press("Control+w");
  await expect(workspace.getByRole("tab", { name: /local\.cir/ })).toHaveCount(
    0,
  );
  await models.press("ArrowRight");
  await expect(file("local.cir")).toBeVisible();
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
  const newExperiment = workspace.getByRole("button", {
    name: "+ New experiment",
    exact: true,
  });
  await newExperiment.click();
  const input = workspace.getByRole("textbox", {
    name: "New simulation folder name",
  });
  await expect(input).toHaveAttribute("autocomplete", "off");
  await input.fill("Gamma");
  // Switching selection must not implicitly create an experiment.
  await folderRow(workspace, "Beta").click();
  await expect(folderRow(workspace, "Gamma")).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await newExperiment.click();
  await input.fill("Gamma");
  await workspace.getByRole("button", { name: "Create", exact: true }).click();
  await expect(folderRow(workspace, "Gamma")).toHaveCount(1);
  await expect(sourceEditor(workspace)).toContainText("op");
  await newExperiment.click();
  await input.fill("Cancelled");
  await page.keyboard.press("Escape");
  await expect(folderRow(workspace, "Cancelled")).toHaveCount(0);
  const gamma = folderRow(workspace, "Gamma");
  await gamma.focus();
  await gamma.press("F2");
  const folderName = workspace.getByRole("textbox", {
    name: "Folder name",
    exact: true,
  });
  // Another folder's name, in any case, is refused before any edit.
  await folderName.fill("beta");
  await folderName.press("Enter");
  await expect(folderName).toHaveAttribute("aria-invalid", "true");
  await expect(workspace).toContainText("already exists");
  await folderName.fill("Renamed");
  // Renaming existing folders still commits on blur.
  await folderRow(workspace, "Beta").click();
  const renamed = folderRow(workspace, "Renamed");
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New file…", exact: true }).click();
  const fileName = workspace.getByRole("textbox", {
    name: "Relative file path",
  });
  await expect(fileName).toHaveAttribute("autocomplete", "off");
  await fileName.fill("run.cir");
  await fileName.press("Enter");
  await expect(fileName).toHaveAttribute("aria-invalid", "true");
  await fileName.fill("stimulus.cir");
  await fileName.press("Enter");
  await expect(
    workspace.getByRole("tab", { name: /stimulus\.cir/u }),
  ).toBeVisible();
  const editor = sourceEditor(workspace);
  await editor.click();
  await editor.press("Control+End");
  await editor.pressSequentially("* Editable new file");
  await expect(editor).toContainText("Editable new file");
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
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(renamed).toBeVisible();
  await renamed
    .locator("..")
    .locator("..")
    .getByRole("treeitem", { name: "stimulus.cir", exact: true })
    .click();
  await expect(editor).toContainText("Editable new file");
  expect(nativeDialogs).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "The editor hit an unexpected problem" }),
  ).toHaveCount(0);
});
