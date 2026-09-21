import { parseSavedProject } from "./editor-fixtures";
import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";
import {
  createSimulationFolder,
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  generateCircuitSource,
  simulationSignals,
  nativeSimulationDevices,
  vacaskIdentifier,
} from "@icm/netlist";

import {
  revealPropertiesShelf,
  clickNetlistWorkflowCommand,
  downloadBytes,
  readRecoveryRecords,
} from "./editor-fixtures.js";
import { ota, profile, editSimulationFile } from "./simulation-e2e-fixtures.js";

test("simulation Agent entry is passive and reuses the existing connection panel", async ({
  page,
}) => {
  let creates = 0;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(
    "**/api/agent/sessions/sim-guide/editor",
    (route) => {
      socket = route;
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
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "agent-guidance.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
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
  const initialSurface = await page
    .getByRole("region", { name: "Analog simulation" })
    .boundingBox();
  const connectBounds = await guide
    .getByRole("button", { name: "Connect Agent", exact: true })
    .boundingBox();
  expect(connectBounds!.y + connectBounds!.height).toBeLessThanOrEqual(
    initialSurface!.y + initialSurface!.height,
  );
  await page
    .getByRole("region", { name: "Analog simulation" })
    .screenshot({ path: test.info().outputPath("agent-start.png") });
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
  await expect(
    guide.getByRole("button", { name: "View connection info", exact: true }),
  ).toBeVisible();
  expect(creates).toBe(1);
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
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
  await guide.screenshot({
    path: test.info().outputPath("agent-connected.png"),
  });
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
  await guide.screenshot({
    path: test.info().outputPath("agent-start-narrow.png"),
  });
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
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "my-circuit.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .getByRole("textbox", { name: "Circuit name" })
    .fill("My unsaved circuit");
  await page.getByRole("textbox", { name: "Circuit name" }).press("Enter");
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  const cards = panel.getByRole("group", { name: "Simulation examples" });
  await expect(cards).not.toBeVisible();
  await panel.getByText("Explore examples", { exact: true }).click();
  await expect(cards.getByRole("button")).toHaveCount(4);
  await panel.screenshot({
    path: test.info().outputPath("simulation-starters.png"),
  });
  await expect(panel).not.toContainText("No DUT instance");
  await cards
    .getByRole("button", { name: "RC Filters Low-pass & high-pass" })
    .click();
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
  await cards
    .getByRole("button", { name: "RC Filters Low-pass & high-pass" })
    .click();
  await confirmation
    .getByRole("button", { name: "Open example", exact: true })
    .click();
  const guard = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(cards).toBeVisible();
  await cards
    .getByRole("button", { name: "RC Filters Low-pass & high-pass" })
    .click();
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
  await expect(
    panel.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText("Click Run");
});
test("native metadata is hidden per folder while damaged configuration stays repairable", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const native = createSimulationFolder({
    id: "native",
    name: "Native",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  const repair = createSimulationFolder({
    id: "repair",
    name: "Repair",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  const config = repair.input.files.find(
    (file) => file.path === repair.input.configPath,
  )!;
  const original = config.text;
  config.text = "{";
  project.simulationFolders = [native, repair];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "metadata.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await expect(
    panel.locator(
      '[data-folder-id="native"][data-file-path="experiment.json"]',
    ),
  ).toHaveCount(0);
  await panel
    .getByRole("treeitem", { name: "Folder Repair", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Toggle Repair", exact: true })
    .click();
  await panel
    .getByRole("treeitem", { name: "experiment.json", exact: true })
    .click();
  const editor = panel.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await expect(editor).toHaveText("{");
  await editor.fill(original);
  await panel.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(
    panel.getByRole("treeitem", { name: "experiment.json", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByRole("tab", { name: "Configuration" })).toHaveCount(
    0,
  );
  await expect(panel.getByRole("tab", { name: /run\.cir/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const saved = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  for (const folder of saved.simulationFolders)
    expect(
      folder.input.files.find((file) => file.path === folder.input.configPath)!
        .text,
    ).toBe(original);
});

test("native Circuit source edits persist source fields and distinguish mega from milli", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "native-values",
    name: "Native values",
    documentId: project.topDocumentId,
    profileId: "candidate",
  });
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "native-values.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  await page.getByRole("tab", { name: /circuit\.spice/ }).click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const generated = generateCircuitSource(
    project,
    folder.input.circuitBindings[0]!,
    folder.input,
  );
  if (!generated.ok) throw Error(JSON.stringify(generated.diagnostics));
  const body = generated.source.sourceBodies!.find(
    (b) => b.instanceId === "VDD",
  )!;
  const text =
    generated.source.text.slice(0, body.startOffset) +
    ' type="sine" dc=1m mag=1 phase=-90 sinedc=0 ampl=1 freq=1M' +
    generated.source.text.slice(body.endOffset);
  await expect(editor).toContainText('type="dc"');
  await editor.fill(text);
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save source", exact: true }),
  ).toHaveAttribute("data-save-state", "saved");
  const saved = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const params = saved.documents
    .find((d) => d.id === body.documentId)!
    .instances.find((i) => i.id === body.instanceId)!.netlist!.parameters;
  expect(params).toMatchObject({
    dc: "0.001",
    frequency: "1000000",
    waveform: "sin",
    acMagnitude: "1",
    acPhase: "-90",
  });
  const projected = generateCircuitSource(
    saved,
    folder.input.circuitBindings[0]!,
    saved.simulationFolders[0]!.input,
  );
  if (!projected.ok) throw Error("Expected native projection after save");
  expect(projected.source.text).toContain(
    'type="sine" dc=0.001 mag=1 phase=-90',
  );
  expect(projected.source.text).toContain("freq=1000000");
});

test("Code edits native AC fields and routes parameter declarations to authored Code", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "source-parameters",
    name: "Source parameters",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "source-parameters.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  await page.getByRole("tab", { name: /circuit\.spice/ }).click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const generated = generateCircuitSource(
    project,
    folder.input.circuitBindings[0]!,
    folder.input,
  );
  if (!generated.ok) throw Error("Expected generated source");
  // DOM innerText can omit the final newline and includes display-only ghosts.
  const source = generated.source.text;
  const body = generated.source.sourceBodies!.find(
    (p) => p.instanceId === "VDD",
  )!;
  expect(body).toBeDefined();
  const edited =
    source.slice(0, body.startOffset) +
    ' type="dc" dc=1.8 mag=1 phase=-90' +
    source.slice(body.endOffset);
  expect(edited).not.toBe(source);
  await editor.fill(edited);
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save source", exact: true }),
  ).toHaveAttribute("data-save-state", "saved");
  const saved = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const sourceParameters = (p: typeof saved) =>
    p.documents
      .find((d) => d.id === project.topDocumentId)!
      .instances.find((i) => i.id === "VDD")!.netlist!.parameters;
  expect(sourceParameters(saved)).toMatchObject({
    acMagnitude: "1",
    acPhase: "-90",
  });
  const applied = generateCircuitSource(
    saved,
    folder.input.circuitBindings[0]!,
    folder.input,
  );
  if (!applied.ok) throw Error("Expected applied source");
  const appliedBody = applied.source.sourceBodies!.find(
    (p) => p.instanceId === "VDD",
  )!;
  await editor.fill(
    applied.source.text.slice(0, appliedBody.startOffset) +
      ' type="dc" dc=(VBIAS)' +
      applied.source.text.slice(appliedBody.endOffset),
  );
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("option", { name: "Design variable (parameters)…", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /run\.cir/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const declarationLine = editor
    .locator(".cm-line")
    .filter({ hasText: /^parameters(?:\s|$)/ });
  await expect(declarationLine).toHaveCount(1);
  await expect(page.locator(".simulation-parameter-ghost")).toContainText(
    "name=expression",
  );
  await editor.press("ControlOrMeta+z");
  await expect(declarationLine).toHaveCount(0);
  const redoShortcut = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta+Shift+z" : "Control+y",
  );
  await editor.press(redoShortcut);
  await expect(declarationLine).toHaveCount(1);
  await expect(page.locator(".simulation-parameter-ghost")).toContainText(
    "name=expression",
  );
  await page.keyboard.type("VBIAS=1.8");
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save source", exact: true }),
  ).toHaveAttribute("data-save-state", "saved");
  const final = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(sourceParameters(final)).toMatchObject({ dc: "{VBIAS}" });
  expect(sourceParameters(final)).not.toHaveProperty("acMagnitude");
  expect(sourceParameters(final)).not.toHaveProperty("acPhase");
  expect(
    final.simulationFolders[0]!.input.files.find(
      (f) => f.path === folder.input.entry,
    )!.text,
  ).toContain("parameters VBIAS=1.8");
  expect(
    JSON.parse(
      final.simulationFolders[0]!.input.files.find(
        (f) => f.path === "experiment.json",
      )!.text,
    ),
  ).toEqual({ version: 2, environment: { profileId: profile.id } });
});

test("new experiments explicitly bind the selected Cell without requiring a Testbench", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = [];
  const dut = project.documents.find((cell) => cell.name === "ota_5t")!;
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "cell-selection.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  await page
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  const name = page.getByLabel("New simulation folder name");
  const cell = page.getByRole("combobox", {
    name: "Simulation Cell",
    exact: true,
  });
  await expect(cell).toHaveValue(project.topDocumentId);
  const setupCard = page.locator(
    ".simulation-start-workspace > .workspace-inline-name",
  );
  const dockedCard = await setupCard.boundingBox();
  expect(dockedCard!.width).toBeLessThanOrEqual(360);
  // Resize via the window control without blurring the form into a commit.
  await name.press("Escape");
  await page
    .getByRole("button", { name: "Maximize simulation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  expect((await setupCard.boundingBox())!.width).toBeLessThanOrEqual(360);
  await setupCard.screenshot({
    path: test.info().outputPath("manual-setup-card.png"),
  });
  await name.fill("OTA direct");
  await page.getByRole("heading", { name: "Simulate with an Agent" }).click();
  await expect(name).toHaveCount(0);
  await expect(
    page.getByRole("treeitem", { name: "Folder OTA direct", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await name.fill("OTA direct");
  await name.press("Tab");
  await expect(cell).toBeFocused();
  await cell.selectOption(dut.id);
  await page.getByRole("heading", { name: "Simulate with an Agent" }).click();
  await expect(cell).toHaveCount(0);
  await page
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await name.fill("OTA direct");
  await cell.selectOption(dut.id);
  // Moving between fields must not prematurely create the folder.
  await expect(name).toBeVisible();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore simulation panel", exact: true })
    .click();
  const folderRow = page.getByRole("treeitem", {
    name: "Folder OTA direct",
    exact: true,
  });
  await expect(folderRow).toHaveText("OTA direct");
  await expect(folderRow).toHaveAttribute("title", "Cell: ota_5t");
  await expect(folderRow).toHaveAttribute("aria-description", "Cell: ota_5t");
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await expect(editor).toContainText('include "circuit.spice"');
  await expect(editor).toContainText("op");
  await expect(
    page.getByRole("treeitem", { name: "experiment.json", exact: true }),
  ).toHaveCount(0);
  await editor.focus();
  const folderWidth = (await folderRow.boundingBox())!.width;
  await folderRow.hover();
  await expect(editor).toBeFocused();
  expect((await folderRow.boundingBox())!.width).toBe(folderWidth);
  await page.getByRole("tab", { name: /circuit\.spice/ }).click();
  await expect(editor).toContainText("XM1");
  await expect(editor).not.toContainText("XDUT");
  const saved = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const folder = saved.simulationFolders[0]!;
  expect(folder.input.circuitBindings).toEqual([
    {
      id: "circuit",
      path: "circuit.spice",
      documentId: dut.id,
      emission: "top-level",
    },
  ]);
  expect(folder.input.files.map((file) => file.path)).toEqual([
    "run.cir",
    "experiment.json",
  ]);
  expect(saved.topDocumentId).toBe(project.topDocumentId);
  expect(saved.documents).toEqual(
    parseProject(serializeProject(project)).documents,
  );
  const generated = generateCircuitSource(
    saved,
    folder.input.circuitBindings[0]!,
  );
  expect(generated.ok).toBe(true);
  if (!generated.ok) throw new Error("Expected generated Cell source");
  expect((await editor.innerText()).trim()).toBe(generated.source.text.trim());

  // The next default follows Canvas, not the existing experiment's root.
  await page.getByTestId("document-selector").selectOption(dut.id);
  await page
    .getByRole("button", { name: "+ New experiment", exact: true })
    .click();
  await expect(cell).toHaveValue(dut.id);
  await cell.press("Escape");
  await expect(name).toHaveCount(0);
  await page
    .getByTestId("document-selector")
    .selectOption(project.topDocumentId);
  await page
    .getByRole("button", { name: "+ New experiment", exact: true })
    .click();
  await expect(cell).toHaveValue(project.topDocumentId);
  await cell.press("Escape");
  await expect(folderRow).toHaveAttribute("title", "Cell: ota_5t");
  const unchanged = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(unchanged.simulationFolders).toEqual(saved.simulationFolders);
  // Binding and label survive reopening the saved Project.
  await page.getByTestId("project-file").setInputFiles({
    name: "reopen.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(unchanged)),
  });
  await expect(folderRow).toHaveAttribute("title", "Cell: ota_5t");
});

test("tab context menus replace workspace more actions without discarding source", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "tab-actions",
    name: "Tab actions",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  folder.input.files.push({ path: "notes.json", text: "{}\n" });
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "tabs.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await expect(
    panel.getByRole("button", { name: "More code actions" }),
  ).toHaveCount(0);
  const editor = panel.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const runTab = panel.getByRole("tab", { name: /run\.cir/ });
  const circuitTab = panel.getByRole("tab", { name: /circuit\.spice/ });
  const draft = "* retained after closing tabs\n";
  await editor.fill(draft);
  await circuitTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(circuitTab).toHaveCount(0);
  await expect(runTab).toHaveAttribute("aria-selected", "true");
  await panel
    .getByRole("treeitem", { name: "circuit.spice", exact: true })
    .click();
  await panel
    .getByRole("treeitem", { name: "notes.json", exact: true })
    .click();
  await expect(panel.getByRole("tab", { name: "notes.json" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await circuitTab.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close others", exact: true })
    .click();
  await expect(
    panel
      .getByRole("tablist", { name: "Open simulation files" })
      .getByRole("tab"),
  ).toHaveCount(1);
  await expect(circuitTab).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("treeitem", { name: "run.cir", exact: true }).click();
  await expect(editor).toHaveText(draft);
  await runTab.focus();
  await runTab.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Close all", exact: true }).click();
  await expect(
    panel
      .getByRole("tablist", { name: "Open simulation files" })
      .getByRole("tab"),
  ).toHaveCount(0);
  await expect(
    panel.getByText(
      "Select a file to edit. Closing tabs does not delete files.",
    ),
  ).toBeVisible();
  await panel.getByRole("treeitem", { name: "run.cir", exact: true }).click();
  await expect(editor).toHaveText(draft);
  await runTab.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Close others", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("source save applies locally while signed out and leaves File Save cloud-owned", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "local-save",
    name: "Local save",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  project.simulationFolders = [folder];
  let cloudWrites = 0;
  await page.route("**/api/projects**", (route) => {
    if (["POST", "PUT"].includes(route.request().method())) cloudWrites++;
    return route.fulfill({ status: 401, json: { error: "Sign in" } });
  });
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "local-save.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const save = page.getByRole("button", { name: "Save source", exact: true });
  const source = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!.text;
  await editor.fill(`${source}\n* local button save\n`);
  await expect(save).toHaveAttribute("data-save-state", "dirty");
  await save.click();
  await expect(save).toHaveAttribute("data-save-state", "saved");
  await expect(save).toBeDisabled();
  await expect(page.getByRole("tab", { name: /run\.cir/ })).not.toContainText(
    "●",
  );
  await editor.fill(`${source}\n* local keyboard save\n`);
  await editor.press("ControlOrMeta+s");
  await expect(save).toHaveAttribute("data-save-state", "saved");
  expect(cloudWrites).toBe(0);
  await expect(page.getByTestId("status")).not.toContainText("Sign in to save");
  await expect
    .poll(async () =>
      (await readRecoveryRecords(page)).some((record) =>
        record.projectText.includes("* local keyboard save"),
      ),
    )
    .toBe(true);
  const bytes = await downloadBytes(page, "File", "Export Project File…");
  const applied = parseProject(bytes.toString());
  expect(
    applied.simulationFolders[0]!.input.files.find(
      (file) => file.path === folder.input.entry,
    )!.text,
  ).toContain("* local keyboard save");
  await page
    .locator("summary")
    .filter({ hasText: /^File$/ })
    .click();
  await page.getByTestId("save-cloud-project").click();
  await expect(page.getByTestId("status")).toContainText("Sign in to save");
  expect(cloudWrites).toBe(1);
  await expect(save).toHaveAttribute("data-save-state", "saved");
});

test("Helper keeps signal selection continuous and shares the file row without stealing focus", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "continuous-signals",
    name: "Continuous signals",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "continuous.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
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
  await editor.fill(
    folder.input.files.find((file) => file.path === folder.input.entry)!.text,
  );
  await helper.click();
  await page
    .getByRole("option", { name: "Pick Net on Canvas", exact: true })
    .click();
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
  const validSource = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!.text;
  await editor.fill(`${validSource}\nsave v(`);
  await helper.click();
  await page
    .getByRole("option", { name: "Save voltage…", exact: true })
    .click();
  await output.click();
  await expect(output).not.toContainText("Added");
  await expect(output).toBeEnabled();
  await expect(editor).not.toContainText("v(vout)");
  await search.press("Escape");
  await editor.fill(validSource);
  await helper.click();
  await page
    .getByRole("option", { name: "Save voltage…", exact: true })
    .click();
  await output.click();
  await expect(output).toContainText("Added");
  await expect(editor).toContainText("v(vout)");
});

test("native text-only Helper discovers exact-case nodes and declared voltage-source branches", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "native-text-discovery",
    name: "Native discovery",
    profileId: profile.id,
  });
  folder.input.files.find((file) => file.path === folder.input.entry)!.text =
    `Native discovery
model supply vsource
model load resistor
feed (Out 0) supply dc=1
Feed (out 0) supply dc=2
VnotVoltage (Out out) load r=1k
control
analysis bias op
endc
`;
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "native-text.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const helper = page.getByRole("button", { name: "Helper", exact: true });
  const picker = page.getByRole("dialog", { name: "Save signal" });
  await helper.click();
  await page
    .getByRole("option", { name: "Save terminal current…", exact: true })
    .click();
  await expect(
    picker.getByRole("button", { name: "i(VnotVoltage)", exact: true }),
  ).toHaveCount(0);
  await picker.getByRole("button", { name: "i(feed)", exact: true }).click();
  await picker.getByRole("button", { name: "i(Feed)", exact: true }).click();
  await expect(editor).toContainText("save i(feed) i(Feed)");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await helper.click();
  await page
    .getByRole("option", { name: "Save voltage…", exact: true })
    .click();
  await picker.getByRole("button", { name: "v(Out)", exact: true }).click();
  await picker.getByRole("button", { name: "v(out)", exact: true }).click();
  await expect(editor).toContainText("save i(feed) i(Feed) v(Out) v(out)");
});

test("native device OP Helper inserts inspectable model-native saves without SPICE aliases", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "native-op-helper",
    name: "Native OP",
    documentId: project.topDocumentId,
    profileId: "candidate",
  });
  // Offline authoring proof only: no claim that these default model values
  // replace the foundry wrapper. Numeric compiler/helper proof runs separately.
  const device = nativeSimulationDevices(project, folder.input).find(
    (d) => d.polarity,
  )!;
  folder.input.files.find((f) => f.path === folder.input.entry)!.text +=
    `\nsubckt ${device.card.target} (D G S B)\nmodel core sp_bsim4v8 type=1\nInner (D G S B) core\nends\n`;
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "native-op.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("option", { name: "Save device operating point…", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Save signal" });
  const save = `p('${device.reference}:Inner',gm)`;
  const choice = picker.getByRole("button", {
    name: `${device.reference}:Inner · gm (model-native) — ${save}`,
  });
  await choice.click();
  await expect(choice).toContainText("Added");
  await expect(editor).toContainText(`save ${save}`);
  await expect(editor).not.toContainText("[gm]");
  await expect(
    picker.getByRole("textbox", { name: "Search signal" }),
  ).toBeFocused();
});

test("native save completion previews its mapped Net on the real Canvas", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "completion-preview-folder",
    name: "Completion preview",
    documentId: project.topDocumentId,
    profileId: profile.id,
  });
  project.simulationFolders = [folder];
  const mapped = Object.entries(simulationSignals(project, folder.input)).find(
    ([, signal]) =>
      signal.targets.some(
        (target) =>
          target.documentId === project.topDocumentId &&
          target.netId === "tb-vout-net",
      ),
  );
  if (!mapped)
    throw Error("Expected the OTA output Net to have a native vector");
  const [vector, signal] = mapped;
  const target = signal.targets.find(
    (candidate) =>
      candidate.documentId === project.topDocumentId &&
      candidate.netId === "tb-vout-net",
  )!;
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "completion-preview.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const source = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!.text;
  await editor.fill(`${source.slice(0, source.indexOf("endc"))}save`);
  await expect(page.locator(".simulation-code-status")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save source", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("tab", { name: /run\.cir/ })).toContainText("●");
  await page.keyboard.type(" ");
  const selector = `v(${vacaskIdentifier(vector)})`;
  const option = page.getByRole("option").filter({
    has: page.locator(".cm-completionLabel").filter({
      hasText: new RegExp(
        `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      ),
    }),
  });
  await expect(option).toBeVisible();
  await option.hover();
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    target.netId,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
});

test("incomplete circuit opens Code and saves invalid parameter drafts across reload and folder duplication", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const root = project.topDocumentId;
  const cell = project.documents.find((d) => d.id === root)!;
  const capacitor = cell.instances.find((i) => i.reference === "CL")!;
  delete capacitor.netlist!.parameters.value;
  const unconfiguredMos = project.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.symbolId === "nmos")!;
  unconfiguredMos.netlist = { parameters: {} };
  const folder = createSimulationFolder({
    id: "draft-folder",
    name: "Draft",
    documentId: root,
    profileId: profile.id,
  });
  project.simulationFolders = [folder];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline authoring fixture" },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "unfinished.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("tab", { name: "circuit.spice", exact: false }).click();
  const editor = panel.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await expect(editor).toContainText("<value>");
  await expect(editor).toContainText("<model>");
  await expect(panel.locator(".cm-lintRange-error").first()).toBeVisible();
  await editor.click();
  await editor.press("Control+Home");
  // Numeric fields are editable; a deliberately incomplete value remains saveable.
  const source = generateCircuitSource(
    project,
    folder.input.circuitBindings[0]!,
  );
  if (!source.ok) throw Error("Expected incomplete authoring projection");
  const original = source.source.text;
  await editor.press("ControlOrMeta+A");
  // `bad-value` is valid native subtraction, not an invalid numeric draft.
  // A trailing operator is incomplete in either dialect and cannot be applied.
  await page.keyboard.insertText(original.replace("<value>", "bad-value+"));
  await expect(editor).toContainText("bad-value+");
  const saveSource = panel.getByRole("button", {
    name: "Save source",
    exact: true,
  });
  await saveSource.click();
  await expect(saveSource).toHaveAttribute("data-save-state", "failed");
  await expect(editor).toContainText("bad-value+");
  const bytes = await downloadBytes(page, "File", "Export Project File…");
  const saved = parseProject(bytes.toString());
  expect(saved.simulationFolders[0]!.input.drafts?.[0]?.text).toContain(
    "bad-value+",
  );
  expect(
    saved.documents
      .find((d) => d.id === root)!
      .instances.find((i) => i.id === capacitor.id)!.netlist!.parameters.value,
  ).toBeUndefined();
  await page.reload();
  await page.getByTestId("project-file").setInputFiles({
    name: "saved.icproj.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await page.getByTestId("open-analog-simulation").click();
  await panel.getByRole("tab", { name: "circuit.spice", exact: false }).click();
  await expect(editor).toContainText("bad-value+");
  await panel
    .getByRole("treeitem", { name: "Folder Draft", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate…" }).click();
  await panel.getByLabel("New simulation folder name").fill("Draft copy");
  await panel.getByLabel("New simulation folder name").press("Enter");
  await expect(
    panel.getByRole("treeitem", { name: "Folder Draft copy", exact: true }),
  ).toBeVisible();
});

test("human simulation uses saved folder, survives minimizing, recovers a bad input and exports results", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const project = parseProject(JSON.stringify(ota));
  let folder = createSimulationFolder({
    id: "folder-e2e",
    name: "E2E folder",
    engine: "ngspice",
    profileId: profile.id,
    documentId: project.topDocumentId,
  });
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok) throw Error(parsed.message);
  const config = parsed.config;
  config.environment.corner = "tt";
  config.outputs = [
    {
      id: "out",
      label: "out",
      expression: {
        kind: "voltage",
        circuit: { bindingId: "circuit", callPath: [] },
        documentId: project.topDocumentId,
        anchor: {
          kind: "terminal",
          instanceId: "missing-instance",
          pinName: "out",
        },
        occurrence: [],
      },
    },
  ];
  folder = replaceSimulationExperimentConfig(folder, config);
  project.simulationFolders = [folder];
  let calls = 0,
    executions = 0,
    cancellations = 0;
  let release = () => {};
  let pending = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/simulate", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          rawfileCollection: "declared-single-ascii",
          maxOutputBytes: 1048576,
          inputs: ["source", "raw"],
          analyses: ["op", "ac", "tran", "noise"],
          parsedAnalyses: ["op", "ac", "tran", "noise"],
          profiles: [
            {
              id: profile.id,
              corners: ["tt"],
              dependencies: [
                { id: profile.models.id, sha256: profile.models.contentSha256 },
              ],
            },
          ],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    if (body.operation === "cancel") {
      cancellations++;
      release();
      return route.fulfill({ json: { ok: true } });
    }
    executions++;
    await pending;
    // Fixture response matches the acquisition inserted for the Canvas vout probe.
    const requestedVector = "v(vout)";
    expect(body.preparedDeck).toContain(requestedVector);
    const rawfile = readFileSync(
      new URL(
        "../../../fixtures/ngspice-rawfile/divider-op.raw",
        import.meta.url,
      ),
      "utf8",
    );
    const reading = readSimulationData(rawfile);
    if (reading.status !== "read") throw Error("raw fixture");
    await route.fulfill({
      json: {
        outcome: { status: "completed" },
        diagnostics: [],
        log: "ngspice OP\nat_one_tau = 5.00000e-01\n",
        durationMs: 1,
        data: {
          ...reading.data,
          analyses: [
            {
              ...reading.data.analyses[0],
              probes: [
                {
                  name: requestedVector,
                  quantity: "voltage",
                  unit: "V",
                  value: 0.5,
                },
              ],
            },
            {
              analysis: "ac",
              plotName: "AC response",
              frequencyHz: [1, 10, 100],
              probes: [
                {
                  name: requestedVector,
                  quantity: "voltage",
                  unit: "V",
                  real: [10, 7, 1],
                  imag: [0, -3, -1],
                },
              ],
            },
            {
              analysis: "tran",
              plotName: "Transient response",
              timeSeconds: [0, 1e-9, 10e-9],
              scalars: [
                {
                  name: "at_one_tau",
                  quantity: "voltage",
                  unit: "V",
                  value: 0.5,
                },
              ],
              probes: [
                {
                  name: requestedVector,
                  quantity: "voltage",
                  unit: "V",
                  value: [0, 0.5, 1],
                },
              ],
            },
            {
              analysis: "noise",
              plotName: "Noise Analysis",
              frequencyHz: [1, 10, 100],
              outputNoiseDensity: [1e-9, 8e-10, 6e-10],
              inputNoiseDensity: [2e-9, 1.6e-9, 1.2e-9],
              integratedOutputNoise: 9e-8,
              integratedInputNoise: 1.8e-7,
              units: {
                outputDensity: "V/sqrt(Hz)",
                inputDensity: "V/sqrt(Hz)",
                integratedOutput: "V",
                integratedInput: "V",
              },
            },
          ],
        },
        rawfile,
        executedDeck: body.preparedDeck,
        cancelled: cancellations > 0,
        metadata: {
          schemaVersion: 1,
          input: await createSimulationInputMetadata({
            inputRevision: body.inputRevision,
            netlist: body.netlist,
            testbench: body.testbench,
            deck: body.preparedDeck,
          }),
          configuration: { modelLibrary: null },
          environment: await createSimulationEnvironmentMetadata({
            executor: "local-host",
            reproducibility: "observed",
            profileId: profile.id,
            platform: "linux/x64",
            simulator: {
              name: "ngspice",
              version: profile.simulator.version,
              binarySha256: null,
            },
            models: null,
            startupSha256: null,
          }),
        },
      },
    });
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "simulation.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  expect(calls).toBe(0);
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await panel.getByRole("tab", { name: "Console", exact: true }).click();
  await expect(panel.getByLabel("Simulation results")).toContainText(
    /PROBE|probe/,
  );
  expect(executions).toBe(0);
  config.outputs[0] = {
    id: "out",
    label: "first-output",
    expression: {
      kind: "voltage",
      circuit: { bindingId: "circuit", callPath: [] },
      documentId: project.topDocumentId,
      anchor: { kind: "terminal", instanceId: "XDUT", pinName: "vout" },
      occurrence: [],
    },
  };
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
    "set appendwrite",
    "op",
    "write out.raw",
    "ac dec 10 1 1e6",
    "write out.raw",
    "tran 1e-9 1e-6 0 5e-10",
    "meas tran at_one_tau FIND v(vout) AT=1e-9",
    '* @spec at_one_tau <= 2 unit=V label={"runs":[{"kind":"text","value":"V"},{"kind":"span","style":"subscript","children":[{"kind":"text","value":"out"}]}]}',
    "write out.raw",
    "noise v(vout) VINP dec 10 1 1e6",
    "write out.raw",
    ".endc",
    ".end",
    "",
  ].join("\n");
  await editSimulationFile(page, folder.input.entry, program);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(1);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  expect(cancellations).toBe(0);
  release();
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(panel.getByRole("status")).toHaveText("completed");
  await expect(
    panel
      .locator(".simulation-code-output-tabs")
      .getByRole("button", { name: "Archive", exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator(".simulation-results-header")).toHaveCount(0);
  // A completed run belongs to its folder, not whichever folder is currently visible.
  await panel.getByRole("button", { name: "+ New experiment" }).click();
  await panel.getByLabel("New simulation folder name").fill("Second folder");
  await panel.getByLabel("New simulation folder name").press("Enter");
  await expect(panel.getByRole("status")).not.toHaveText("completed");
  await expect(
    panel.getByRole("button", { name: "Toggle E2E folder" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    panel.getByRole("button", { name: "Toggle Second folder" }),
  ).toHaveAttribute("aria-expanded", "true");
  await panel
    .getByRole("treeitem", { name: "Folder Second folder", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "New file…", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Relative file path" })
    .fill("bias.spice");
  await panel
    .getByRole("textbox", { name: "Relative file path" })
    .press("Enter");
  await expect(panel.getByRole("tab", { name: /bias.spice/ })).toBeVisible();
  await panel.getByRole("button", { name: "Helper", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Search commands or purpose" })
    .fill("Save voltage");
  await panel.getByRole("option", { name: "Save voltage…" }).click();
  await panel.getByRole("textbox", { name: "Search signal" }).fill("v(out)");
  await panel
    .getByRole("button", { name: "Use native vector: v(out)" })
    .click();
  await expect(
    panel.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText(".save v(out)");
  await panel
    .getByRole("treeitem", { name: "Folder E2E folder", exact: true })
    .locator("..")
    .locator("..")
    .getByRole("treeitem", { name: "run.cir", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("completed");
  expect(executions).toBe(1);
  await expect(panel.getByRole("tab", { name: "Summary" })).toHaveCount(0);
  await panel.getByRole("tab", { name: "Console" }).click();
  await expect(panel.locator(".simulation-console-summary")).toHaveCount(0);
  await expect(panel.locator(".simulation-console-view > pre")).toBeVisible();
  await panel.getByRole("tab", { name: "Specs", exact: true }).click();
  const specs = panel.getByRole("region", { name: "Specification results" });
  const measurementRow = specs.getByRole("row").filter({ hasText: "Vout" });
  await expect(measurementRow).toContainText("Pass");
  await expect(measurementRow.locator("sub")).toHaveText("out");
  await expect(
    measurementRow.locator(".simulation-spec-unit").first(),
  ).toHaveText("mV");
  await expect(
    measurementRow.locator(".simulation-spec-number").first(),
  ).toHaveCSS("text-align", "right");
  const cells = await measurementRow.locator("th, td").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    }),
  );
  expect(
    cells.every(
      (cell) =>
        Math.abs(cell.top - cells[0]!.top) < 1 &&
        Math.abs(cell.height - cells[0]!.height) < 1,
    ),
  ).toBe(true);
  await expect(
    panel.getByRole("tab", { name: /^(Plot|Operating Point|Compare)$/ }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Maximize results" }).click();
  await expect(specs).toBeVisible();
  await panel.getByRole("button", { name: "Restore results" }).click();
  const runFiles = panel.getByLabel("Run temporary files");
  await expect(panel.getByLabel("Prepare temporary files")).toHaveCount(0);
  await runFiles
    .getByRole("button", { name: "Toggle Run", exact: true })
    .click();
  await runFiles
    .getByRole("button", { name: "Toggle Results", exact: true })
    .click();
  await expect(
    runFiles.getByRole("treeitem", { name: "Logs", exact: true }),
  ).toBeVisible();
  await expect(
    runFiles.getByRole("treeitem", {
      name: /Evidence|Netlist|Other|prepared[.]json|[.]cir/,
    }),
  ).toHaveCount(0);
  const csvFile = runFiles
    .locator('button[data-tree-row="artifact"]')
    .filter({ hasText: /[.]csv/ })
    .first();
  const download = page.waitForEvent("download");
  await csvFile.click();
  await panel
    .getByLabel("File preview")
    .getByRole("button", { name: "Download", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/[.]csv$/);
  const rawFile = runFiles.getByRole("treeitem", {
    name: "out.raw",
    exact: true,
  });
  await rawFile.click({ modifiers: ["ControlOrMeta"] });
  await rawFile.click({ button: "right" });
  const menuZip = async (name: string) => {
    const pending = page.waitForEvent("download");
    await page.getByRole("menuitem", { name, exact: true }).click();
    const stream = await (await pending).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return unzipSync(Buffer.concat(chunks));
  };
  const selectedEntries = await menuZip("Download selected (2)…");
  expect(Object.keys(selectedEntries)).toHaveLength(2);
  await runFiles
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  const visibleEntries = await menuZip("Download…");
  expect(
    Object.keys(visibleEntries).some((path) => path.startsWith("run/logs/")),
  ).toBe(true);
  expect(
    Object.keys(visibleEntries).every((path) =>
      /[.](raw|csv|log|txt)$/.test(path),
    ),
  ).toBe(true);
  expect(
    Object.keys(visibleEntries)
      .filter((path) => path.endsWith(".csv"))
      .map((path) => path.split("/").at(-1))
      .sort(),
  ).toEqual(["ac-1.csv", "noise-3.csv", "op-0.csv", "specs.csv", "tran-2.csv"]);
  await runFiles
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  const diagnostics = await menuZip("Export diagnostic bundle…");
  for (const path of [
    "netlist/prepared.cir",
    "netlist/executed.cir",
    "evidence/source-map.json",
    "evidence/prepared.json",
    "evidence/result.json",
    "evidence/specs.json",
    "evidence/evidence-manifest.json",
  ])
    expect(diagnostics[path]).toBeDefined();
  await panel
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View executed netlist…" }).click();
  await expect(
    panel.getByRole("tab", { name: /executed[.]cir/ }),
  ).toBeVisible();
  const executedBeforeEdit = await panel
    .getByLabel("File preview")
    .locator("pre")
    .innerText();
  const executedTab = panel.getByRole("tab", { name: /executed[.]cir/ });
  await executedTab.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close others", exact: true })
    .click();
  await expect(
    panel
      .getByRole("tablist", { name: "Open simulation files" })
      .getByRole("tab"),
  ).toHaveCount(1);
  await executedTab.focus();
  await executedTab.press("ControlOrMeta+w");
  await expect(panel.getByLabel("File preview")).toHaveCount(0);
  await panel
    .getByRole("treeitem", { name: folder.input.entry, exact: true })
    .and(panel.locator(`[data-folder-id="${folder.id}"]`))
    .click();
  expect(executions).toBe(1);
  config.outputs[0]!.label = "new-output";
  await editSimulationFile(
    page,
    folder.input.configPath,
    JSON.stringify(config, null, 2),
  );
  await editSimulationFile(
    page,
    folder.input.entry,
    program.replace(".control", ".temp 30\n.control"),
  );
  await downloadBytes(page, "File", "Export Project File…");
  await expect(panel.locator(".simulation-code-status")).toContainText(
    "earlier Project revision",
  );
  await panel
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Preview input netlist…" }).click();
  await expect(panel.getByLabel("File preview").locator("pre")).toContainText(
    ".temp 30",
  );
  await panel
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View executed netlist…" }).click();
  await expect(panel.getByLabel("File preview").locator("pre")).toHaveText(
    executedBeforeEdit,
  );
  await runFiles
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  const oldRunDiagnostics = await menuZip("Export diagnostic bundle…");
  expect(
    Buffer.from(oldRunDiagnostics["netlist/prepared.cir"]!).toString(),
  ).toBe(Buffer.from(diagnostics["netlist/prepared.cir"]!).toString());
  await panel.getByRole("tab", { name: "Specs", exact: true }).click();
  await expect(specs).toContainText("Previous run");
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(2);
  await expect(panel.getByRole("status")).toHaveText("completed");
  await expect(specs).not.toContainText("Previous run");
  await runFiles
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Archive current run", exact: true })
    .click();
  pending = new Promise<void>((r) => {
    release = r;
  });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(3);
  await panel.getByRole("button", { name: "Cancel run" }).click();
  await expect(panel.getByRole("status")).toContainText("cancelled");
  expect(cancellations).toBe(1);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const reopenedSetup = parseProject(saved.toString()).simulationFolders[0]!;
  const reopenedProgram = reopenedSetup.input.files.find(
    (f) => f.path === reopenedSetup.input.entry,
  )!.text;
  expect(reopenedProgram).toContain(".temp 30");
  expect(reopenedProgram).toContain("tran 1e-9 1e-6 0 5e-10");
  expect(readSimulationExperimentConfig(reopenedSetup)).toMatchObject({
    ok: true,
    config: { outputs: [{ label: "new-output" }] },
  });
  await page.reload();
  // Explicit import is the persistence contract, not browser recovery heuristics.
  await page.getByTestId("project-file").setInputFiles({
    name: "saved.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(
    panel.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText(".temp 30");
  await expect(panel.getByRole("status")).toHaveText("No run yet");
  await panel.locator(".simulation-run-history > summary").click();
  const savedArchives = panel.getByRole("region", {
    name: "Saved folder results",
  });
  await expect(savedArchives).toContainText("E2E folder");
  // Every completed run is now automatically retained, not only the one
  // explicitly archived above. Reopen a completed result, not the cancelled run.
  await savedArchives
    .getByRole("listitem")
    .filter({ hasText: "finished" })
    .first()
    .getByRole("button", { name: "Open result", exact: true })
    .click();
  await expect(panel.getByRole("status")).toHaveText("completed");
  expect(executions).toBe(3);
});

test("Simulation defaults a new experiment to an ordinary authored Cell", async ({
  page,
}) => {
  await page.goto("/editor");
  await page
    .locator(".command-menu > summary")
    .filter({ hasText: "Edit" })
    .click();
  await page.getByRole("button", { name: "Manage Cells…" }).click();
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: "New Cell" }).click();
  const newCell = page.getByRole("dialog", { name: "New Cell" });
  await newCell.getByLabel("Cell name").fill("Testbench");
  await newCell.getByRole("button", { name: "Create" }).click();
  await page
    .locator(".command-menu > summary")
    .filter({ hasText: "Edit" })
    .click();
  await page
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
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const tb = saved.documents.find(
    (d: { name: string }) => d.name === "Testbench",
  );
  expect(tb.instances[0].netlist.binding).toEqual({
    kind: "subcircuit",
    childDocumentId: "document-main",
  });
  expect(saved.topDocumentId).toBe("document-main");
  expect(saved.simulationFolders).toEqual([]);
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
  await page
    .getByRole("treeitem", { name: "Run", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "View executed netlist…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Export diagnostic bundle…" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("treeitem", { name: "run.cir", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Analysis examples")).toHaveCount(0);
  const configured = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    configured.simulationFolders[0].input.circuitBindings[0].documentId,
  ).toBe(tb.id);
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
  await page.getByRole("button", { name: "Maximize simulation" }).click();
  await expect(page.locator(".app-workspace")).toHaveClass(
    /simulation-maximized/,
  );
  await expect(page.getByTestId("schematic-canvas")).toBeHidden();
  await expect(page.locator(".app-chrome")).toBeHidden();
  const maximizedBounds = await page.locator(".app-workspace").boundingBox();
  expect(maximizedBounds!.y).toBe(0);
  expect(maximizedBounds!.width).toBe(page.viewportSize()!.width);
  await expect(page.getByTestId("simulation-resize-handle")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Simulation Code workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore simulation panel" }).click();
  await expect(page.locator(".app-workspace")).not.toHaveClass(
    /simulation-maximized/,
  );
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await expect(page.locator(".app-chrome")).toBeVisible();
  await expect(page.getByTestId("simulation-resize-handle")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
  await expect(page.getByTestId("examples-toggle")).toBeEnabled();
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
  await expect(
    page.getByRole("region", { name: "Analog simulation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exit simulation" }).click();
  await page
    .getByRole("dialog", { name: "Exit Simulation?" })
    .getByRole("button", { name: "Exit Simulation" })
    .click();
  await expect(
    page.getByRole("region", { name: "Analog simulation" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
});

async function openWorkspace(
  page: Page,
  engine: "vacask" | "ngspice" = "vacask",
) {
  const project = parseProject(JSON.stringify(ota));
  project.simulationFolders = ["Alpha", "Beta"].map((name) =>
    createSimulationFolder({
      id: name,
      name,
      engine,
      documentId: project.topDocumentId,
      profileId: profile.id,
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "interactions.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  return page.getByRole("region", { name: "Simulation Code workspace" });
}

test("Simulation and Properties remain independent through minimization", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const workspace = await openWorkspace(page);
  const editor = workspace.getByRole("textbox", {
    name: "Simulation source editor",
  });
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
  await page
    .getByRole("button", { name: "Minimize simulation", exact: true })
    .click();
  await expect(shelf).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Sim Code", exact: true }).click();
  await expect(editor).toContainText("independent draft");
});

test("maximized simulation reclaims chrome at narrow width and minimizes without losing source", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const workspace = await openWorkspace(page);
  const editor = workspace.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* retained maximized draft\n");
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
  await page.screenshot({
    path: test.info().outputPath("full-window-simulation.png"),
  });
  await page
    .getByRole("button", { name: "Minimize simulation", exact: true })
    .click();
  await expect(page.locator(".app-chrome")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
  await page.getByTestId("open-analog-simulation").click();
  await expect(editor).toContainText("retained maximized draft");
  await expect(page.locator(".app-chrome")).toBeVisible();
});

test("folder activation exposes the run target independently of expansion and selection", async ({
  page,
}) => {
  let executedDeck = "";
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          modelLibrary: {
            path: profile.models.library.runtimePath,
            section: "tt",
          },
          rawfileCollection: "declared-single-ascii",
          maxOutputBytes: 1048576,
          inputs: ["source", "raw"],
          analyses: ["op", "ac", "tran", "noise"],
          parsedAnalyses: ["op", "ac", "tran", "noise"],
          profiles: [
            {
              id: profile.id,
              corners: ["tt"],
              dependencies: [
                { id: profile.models.id, sha256: profile.models.contentSha256 },
              ],
            },
          ],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    executedDeck = body.preparedDeck;
    await route.fulfill({
      status: 503,
      json: { error: "Captured run target" },
    });
  });
  const workspace = await openWorkspace(page, "ngspice");
  const run = page.getByRole("button", { name: "Run", exact: true });
  const alpha = workspace.getByRole("treeitem", {
    name: "Folder Alpha",
    exact: true,
  });
  const beta = workspace.getByRole("treeitem", {
    name: "Folder Beta",
    exact: true,
  });
  await expect(run).toHaveText("Alpha");
  const expanded = await beta.getAttribute("aria-expanded");
  await beta.click();
  await expect(run).toHaveText("Beta");
  await expect(run).toHaveAttribute("title", "Run Beta / run.cir");
  await expect(beta).toHaveAttribute("aria-current", "page");
  await expect(beta).toHaveAttribute("aria-expanded", expanded!);
  await workspace
    .getByRole("button", { name: "Toggle Alpha", exact: true })
    .click();
  await expect(run).toHaveText("Beta");
  await alpha.click({ button: "right" });
  await expect(run).toHaveText("Beta");
  await page.keyboard.press("Escape");
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
  await beta.focus();
  await beta.press("F2");
  const longName = "Beta with a deliberately long simulation folder name";
  const naming = workspace.getByRole("textbox", {
    name: "Folder name",
    exact: true,
  });
  await naming.fill(longName);
  await naming.press("Enter");
  await expect(run).toHaveText(longName);
  expect((await run.boundingBox())!.width).toBeLessThanOrEqual(160);
  await expect(run).toHaveAttribute("title", `Run ${longName} / run.cir`);
  await workspace.screenshot({
    path: test.info().outputPath("explicit-run-target.png"),
  });
});

test("workspace menus, selection, empty editors and resizing share non-destructive semantics", async ({
  page,
}) => {
  const workspace = await openWorkspace(page);
  const files = workspace.getByRole("complementary", {
    name: "Simulation files",
  });
  const alpha = files.getByRole("treeitem", {
    name: "Folder Alpha",
    exact: true,
  });
  const beta = files.getByRole("treeitem", {
    name: "Folder Beta",
    exact: true,
  });
  await expect(
    workspace.getByRole("tab", { name: "run.cir", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const before = await files.boundingBox();
  await files
    .getByRole("treeitem", { name: "circuit.spice", exact: true })
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
  await beta.click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(beta).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("title", "Run Beta / run.cir");
  await files
    .getByRole("button", { name: "Toggle Alpha", exact: true })
    .click();
  await expect(alpha).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("title", "Run Beta / run.cir");
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
  await alpha.press("ArrowRight");
  await files
    .getByRole("treeitem", { name: "run.cir", exact: true })
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
  await expect(handle).toHaveAttribute("aria-valuenow", "240");
  await alpha.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(workspace).toBeVisible();
  // An old Canvas selection must not override explicit activation in another folder.
  await page
    .locator('[data-canvas-hit-kind="instance"]')
    .first()
    .click({ force: true });
  await expect(
    workspace.getByRole("tab", { name: /circuit\.spice/ }),
  ).toHaveAttribute("aria-selected", "true");
  if ((await beta.getAttribute("aria-expanded")) !== "true")
    await files
      .getByRole("button", { name: "Toggle Beta", exact: true })
      .click();
  await beta
    .locator("..")
    .locator("..")
    .getByRole("treeitem", { name: "run.cir", exact: true })
    .click();
  await expect(
    workspace.getByRole("tab", { name: "run.cir", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("title", "Run Beta / run.cir");
});

test("Explorer context downloads preserve multi-selection and directory contents without resizing rename rows", async ({
  page,
}) => {
  const workspace = await openWorkspace(page);
  const tree = workspace.getByRole("tree", { name: "Simulation folders" });
  const alpha = tree.getByRole("treeitem", {
    name: "Folder Alpha",
    exact: true,
  });
  const beta = tree.getByRole("treeitem", { name: "Folder Beta", exact: true });
  const alphaFiles = alpha.locator("../..");
  const circuit = alphaFiles.getByRole("treeitem", {
    name: "circuit.spice",
    exact: true,
  });
  const run = alphaFiles.getByRole("treeitem", {
    name: "run.cir",
    exact: true,
  });
  await expect(
    workspace.getByRole("button", { name: "Explorer", exact: true }),
  ).toHaveCount(1);
  await expect(
    workspace.getByRole("button", { name: /Download selected/ }),
  ).toHaveCount(0);
  await expect(
    alphaFiles.getByRole("treeitem", { name: "Source", exact: true }),
  ).toHaveCount(0);
  await expect(alpha).toHaveAttribute("aria-expanded", "true");
  await expect(beta).toHaveAttribute("aria-expanded", "false");
  await expect(run).toHaveAttribute("aria-level", "2");
  await expect(circuit).toHaveAttribute("aria-level", "2");
  await expect(
    alphaFiles.getByRole("treeitem", { name: "Run", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await run.click();
  await circuit.click({ modifiers: ["ControlOrMeta"] });
  await expect(
    workspace.getByRole("tab", { name: "run.cir", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await run.click({ button: "right" });
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download selected (2)…" }).click();
  const stream = await (await pending).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Object.keys(unzipSync(Buffer.concat(chunks))).sort()).toEqual([
    "Alpha/source/circuit.spice",
    "Alpha/source/run.cir",
  ]);
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
  const models = alphaFiles.getByRole("treeitem", {
    name: "models",
    exact: true,
  });
  await expect(models).toHaveAttribute("aria-expanded", "true");
  await expect(
    alphaFiles.getByRole("treeitem", { name: "local.cir", exact: true }),
  ).toBeVisible();
  await models.click();
  await expect(
    alphaFiles.getByRole("treeitem", { name: "local.cir", exact: true }),
  ).toHaveCount(0);
  await models.click({ button: "right" });
  const nestedDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download…", exact: true }).click();
  expect((await nestedDownload).suggestedFilename()).toMatch(/\.zip$/);
  // Selecting the parent and one descendant must not duplicate ZIP entries.
  await alpha.click({ modifiers: ["ControlOrMeta"] });
  await alpha.click({ button: "right" });
  const folderDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download selected (2)…" }).click();
  const folderStream = await (await folderDownload).createReadStream();
  const folderChunks: Buffer[] = [];
  for await (const chunk of folderStream!)
    folderChunks.push(Buffer.from(chunk));
  const names = Object.keys(unzipSync(Buffer.concat(folderChunks)));
  expect(
    names.filter((path) => path.endsWith("models/bias/local.cir")),
  ).toHaveLength(1);
  expect(names).not.toContain("Alpha/source/experiment.json");
  await workspace.screenshot({
    path: test.info().outputPath("compact-explorer.png"),
  });
  await page.screenshot({
    path: test.info().outputPath("simulation-header.png"),
  });
  // Workspace shortcuts still work while focus is in the file tree.
  await run.focus();
  await run.press("Control+w");
  await expect(workspace.getByRole("tab", { name: /local\.cir/ })).toHaveCount(
    0,
  );
  await models.press("ArrowRight");
  await expect(
    alphaFiles.getByRole("treeitem", { name: "local.cir", exact: true }),
  ).toBeVisible();
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
    .getByRole("button", { name: "+ New experiment", exact: true })
    .click();
  const input = workspace.getByRole("textbox", {
    name: "New simulation folder name",
  });
  await input.fill("Gamma");
  // Switching selection must not implicitly create an experiment.
  await workspace
    .getByRole("treeitem", { name: "Folder Beta", exact: true })
    .click();
  await expect(
    workspace.getByRole("treeitem", { name: "Folder Gamma", exact: true }),
  ).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await workspace
    .getByRole("button", { name: "+ New experiment", exact: true })
    .click();
  await input.fill("Gamma");
  await workspace.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    workspace.getByRole("treeitem", { name: "Folder Gamma", exact: true }),
  ).toHaveCount(1);
  await expect(
    workspace.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText("op");
  await workspace
    .getByRole("button", { name: "+ New experiment", exact: true })
    .click();
  await workspace
    .getByRole("textbox", { name: "New simulation folder name" })
    .fill("Cancelled");
  await page.keyboard.press("Escape");
  await expect(
    workspace.getByRole("treeitem", { name: "Folder Cancelled", exact: true }),
  ).toHaveCount(0);
  const gamma = workspace.getByRole("treeitem", {
    name: "Folder Gamma",
    exact: true,
  });
  await gamma.focus();
  await gamma.press("F2");
  await workspace
    .getByRole("textbox", { name: "Folder name", exact: true })
    .fill("Renamed");
  // Renaming existing folders still commits on blur.
  await workspace
    .getByRole("treeitem", { name: "Folder Beta", exact: true })
    .click();
  const renamed = workspace.getByRole("treeitem", {
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
    workspace.getByRole("tab", { name: /stimulus\.cir/u }),
  ).toBeVisible();
  const editor = workspace.getByRole("textbox", {
    name: "Simulation source editor",
  });
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
