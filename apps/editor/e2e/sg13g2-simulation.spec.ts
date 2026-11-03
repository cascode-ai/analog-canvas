import profile from "../../../containers/ngspice/sg13g2/profile.json" with { type: "json" };
const endpoint = process.env.ICM_SG13G2_URL;
import { test, expect, type Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sg13g2Project } from "../../../packages/simulation-service/test-support/sg13g2-project.js";
import { routeSimulationRequest } from "../../../worker/simulation.js";
import {
  exportedProject,
  readAgentClaim,
  openProject,
  openProjectFile,
  expectComponentCodeField,
  setComponentCodeField,
} from "./editor-fixtures.js";
import {
  openPlacedProperties,
  openSelectionShelf,
  placeComponent,
} from "./manual-editor-fixtures.js";
import { startMcp } from "./mcp-stdio-fixture.js";

// These cases share an executor with one execution slot.
test.describe.configure({ mode: "serial" });

async function routeSg13Executor(page: Page) {
  let executions = 0;
  // Redirect only HTTP: Worker routing and the native executor remain real.
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (!body.operation) executions++;
    const response = await routeSimulationRequest(
      new Request("http://local.test/api/simulate", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      { SG13G2_UPSTREAM_URL: endpoint! },
    );
    await route.fulfill({
      status: response!.status,
      contentType: "application/json",
      body: await response!.text(),
    });
  });
  return () => executions;
}

test("SG13 Properties use qualified targets, model defaults and physical Process presets", async ({
  page,
}) => {
  test.skip(!endpoint, "Requires the qualified SG13G2 executor");
  test.setTimeout(120000);
  await routeSg13Executor(page);
  await openPlacedProperties(page, "nmos", { x: 360, y: 220 });
  await page.getByTestId("netlist-panel-toggle").click();
  await page
    .getByLabel("Netlist process", { exact: true })
    .selectOption("sg13g2");
  await expect(page.getByLabel("R netlist target")).toHaveValue("rppd");
  await expect(page.getByLabel("C netlist target")).toHaveValue("cap_cmim");
  await expect(page.getByLabel("NPN netlist target")).toHaveValue("npn13G2");
  await expect(page.getByLabel("PNP netlist target")).toHaveValue("pnpMPA");
  await openSelectionShelf(page);
  await page.getByLabel("Target netlist options").selectOption("sg13_hv_nmos");
  await expectComponentCodeField(page, "parameters.l", "150n");
  const properties = page.locator(".component-property-code-editor");
  await expect(properties.getByRole("status")).toContainText(
    "supported minimum length",
  );
  await setComponentCodeField(page, "rotation", 90);
  await setComponentCodeField(page, "color", [255, 0, 0]);
  await page
    .getByRole("button", { name: "Model defaults", exact: true })
    .click();
  await expectComponentCodeField(page, "parameters.l", "450n");
  await expectComponentCodeField(page, "parameters.w", "300n");
  await expectComponentCodeField(page, "rotation", 90);
  await expectComponentCodeField(page, "color", [255, 0, 0]);
  await expectComponentCodeField(page, "netlistTarget", "sg13_hv_nmos");
  await expect(properties.getByRole("status")).toHaveCount(0);

  for (const [symbol, target, y] of [
    ["resistor", "rppd", 300],
    ["capacitor", "cap_cmim", 400],
  ] as const) {
    await placeComponent(page, symbol, { x: 520, y });
    await openSelectionShelf(page);
    await expectComponentCodeField(page, "netlistTarget", target);
  }
  await placeComponent(page, "nand-gate", { x: 360, y: 420 });
  await openSelectionShelf(page);
  const targets = page.getByLabel("Target netlist options");
  await expect(targets.locator('option[value="sg13g2_nand2_2"]')).toHaveCount(
    1,
  );
  await targets.selectOption("sg13g2_nand2_2");
  await expectComponentCodeField(page, "netlistTarget", "sg13g2_nand2_2");
  const authored = await exportedProject(page);

  await page.getByTestId("netlist-panel-toggle").click();
  await page.getByLabel("R netlist target").selectOption("");
  const ideal = await exportedProject(page);
  expect(
    ideal.documents[0].instances.find(
      (instance: { reference: string }) => instance.reference === "R1",
    ).netlist,
  ).toMatchObject({
    binding: { kind: "primitive" },
    parameters: { value: "1k" },
  });
  await placeComponent(page, "resistor", { x: 700, y: 300 });
  await openSelectionShelf(page);
  await expectComponentCodeField(page, "netlistTarget", "");
  await expectComponentCodeField(page, "parameters.value", "1k");

  // Use the gate the GUI just authored, with no primitive to hint at the PDK.
  const gateOnly = createEmptyProject("sg13-gates", "SG13 gates", "gates");
  gateOnly.externalSubcircuitDefinitions =
    authored.externalSubcircuitDefinitions;
  gateOnly.documents[0]!.instances = authored.documents[0].instances.filter(
    (instance: { symbolId: string }) => instance.symbolId === "nand-gate",
  );
  await openProjectFile(page, gateOnly, "sg13-gate-only.icproj.json");
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    "SG13 gates",
  );
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel
    .getByRole("button", { name: "Set up manually", exact: true })
    .click();
  await expect(panel.getByLabel("Simulation environment")).toContainText(
    `${profile.displayName} (automatic)`,
  );
  await panel.getByLabel("New simulation folder name").fill("Gate experiment");
  await panel.getByLabel("New simulation folder name").press("Enter");
  const saved = await exportedProject(page);
  const config = saved.simulationFolders[0].input.files.find(
    (file: { path: string }) =>
      file.path === saved.simulationFolders[0].input.configPath,
  );
  expect(JSON.parse(config.text).environment.profileId).toBe(profile.id);
  await test.info().attach("sg13g2-gui-authored-project", {
    body: Buffer.from(JSON.stringify(authored)),
    contentType: "application/json",
  });
});

test("GUI and public MCP run thirteen SG13G2 devices and a gate", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !endpoint,
    "Requires the qualified SG13G2 image and built MCP dependencies",
  );
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "icm-sg13g2-mcp-"));
  let child: ReturnType<typeof startMcp> | undefined;
  try {
    const executions = await routeSg13Executor(page);
    const { project, folder } = sg13g2Project();
    await openProject(page, project, "sg13g2.icproj.json");
    await page.getByTestId("hit-MN").click({ position: { x: 1, y: 1 } });
    await openSelectionShelf(page);
    const targets = page.getByLabel("Target netlist options");
    await targets.selectOption("");
    await targets.selectOption("sg13_lv_nmos");
    await setComponentCodeField(page, "parameters.ng", "1");
    await expectComponentCodeField(page, "parameters.ng", "1");
    await setComponentCodeField(page, "parameters.ng", "2");
    await expectComponentCodeField(page, "parameters.ng", "2");
    await page.getByTestId("open-analog-simulation").click();
    const panel = page.getByRole("region", { name: "Analog simulation" });
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("completed", {
      timeout: 30000,
    });
    expect(executions()).toBe(1);
    const saved = await exportedProject(page);
    const config = saved.simulationFolders[0].input.files.find(
      (f: { path: string }) => f.path === folder.input.configPath,
    );
    expect(JSON.parse(config.text).environment.profileId).toBe(profile.id);

    await page.getByRole("button", { name: "Agent", exact: true }).click();
    const claim = await readAgentClaim(page.getByTestId("connect-agent-panel"));
    child = startMcp(baseURL!, join(root, "connector.json"));
    await child.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "sg13g2-qualification", version: "1" },
    });
    child.notify("notifications/initialized");
    const connected = await child.tool("connect", claim);
    expect(connected.ok, JSON.stringify(connected)).toBe(true);
    const prepared = await child.tool("simulation", {
      request: {
        operation: "prepare",
        source: {
          kind: "project-folder",
          folderId: folder.id,
          expectedStructureRevision: saved.structureRevision,
        },
      },
    });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    const started = await child.tool("simulation", {
      request: {
        operation: "start",
        preparedId: prepared.prepared.id,
        digest: prepared.prepared.digest,
      },
    });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    let finished: any;
    await expect
      .poll(
        async () => {
          const read = await child!.tool("simulation", {
            request: { operation: "read", runId: started.run.id },
            detail: "full",
          });
          expect(read.ok, JSON.stringify(read)).toBe(true);
          finished = read.run;
          return finished.state;
        },
        { timeout: 30000 },
      )
      .toBe("finished");
    expect(finished.result.outcome.status, JSON.stringify(finished)).toBe(
      "completed",
    );
    expect(finished.result.metadata.environment).toMatchObject({
      profileId: profile.id,
      models: { contentSha256: profile.models.contentSha256 },
    });
    expect(executions()).toBe(2);
    const synced = await child.tool("simulation_files", {
      request: { action: "sync", runId: finished.id },
      basePath: join(root, "evidence"),
      detail: "full",
    });
    expect(synced.ok, JSON.stringify(synced)).toBe(true);
    const artifact = finished.artifacts.find(
      (a: { name: string }) => a.name === "result.json",
    );
    const file = synced.files.find((f: { id: string }) => f.id === artifact.id);
    const bytes = await readFile(file.outputPath);
    const result = JSON.parse(bytes.toString("utf8"));
    expect(result.outcome.status).toBe("completed");
    expect(result.data).toBeDefined();
    await test.info().attach("sg13g2-real-mcp-result", {
      body: bytes,
      contentType: "application/json",
    });
    await test.info().attach("sg13g2-saved-project", {
      body: Buffer.from(JSON.stringify(saved)),
      contentType: "application/json",
    });
  } finally {
    await child?.close();
    await rm(root, { recursive: true, force: true });
  }
});
