import { test, expect, type WebSocketRoute } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { strFromU8, unzipSync } from "fflate";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";

const loadModule = createRequire(import.meta.url);
const { PNG } = loadModule("pngjs") as {
  PNG: {
    sync: {
      read(input: Buffer): {
        readonly width: number;
        readonly height: number;
        readonly data: Uint8Array;
      };
    };
  };
};
const profile = JSON.parse(
  readFileSync(
    new URL(
      "../../../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  id: string;
  displayName: string;
  simulator: { version: string };
  models: { library: { runtimePath: string } };
};
import { openMenu, downloadBytes } from "./editor-fixtures.js";
import { parseProject } from "@icm/project-protocol";
const ota = JSON.parse(
  readFileSync(
    new URL(
      "../src/examples/five-transistor-ota-sky130.icproj.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("plot PNG export retains every curve when the source charts rerender", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  const bytes = await page.evaluate(async () => {
    const plotModule = "/src/features/simulation/ac-response-plot.ts";
    const exportModule = "/src/features/simulation/simulation-plot-export.ts";
    const { acResponseSvg } = await import(plotModule);
    const { buildVisibleSimulationPlotDownload } = await import(exportModule);
    const root = document.createElement("div");
    document.body.append(root);
    const points = [1, 10, 100, 1000, 10000].map((frequency, index) => ({
      frequency,
      real: 1,
      imaginary: 0,
      magnitude: [0, 1, 0.2, 0.8, 0][index],
      magnitudeDb: [0, 20, 4, 16, 0][index],
      phaseDeg: [0, -90, -20, -70, 0][index],
    }));
    root.innerHTML = ["db20", "phase"]
      .map((kind) =>
        acResponseSvg(
          [{ label: "v(out)", unit: "V", points }],
          { width: 600, height: 340 },
          { kind },
        ),
      )
      .join("");
    try {
      const pending = buildVisibleSimulationPlotDownload(root, "png");
      // Busy-state/plot updates replace innerHTML while the first image decodes.
      // The second chart must not read styles from its now-detached SVG.
      root.replaceChildren();
      return Array.from((await pending).bytes as Uint8Array);
    } finally {
      root.remove();
    }
  });
  const entries = unzipSync(Uint8Array.from(bytes));
  expect(Object.keys(entries)).toHaveLength(2);
  for (const [name, bytes] of Object.entries(entries)) {
    await test
      .info()
      .attach(name, { body: Buffer.from(bytes), contentType: "image/png" });
    const png = PNG.sync.read(Buffer.from(bytes));
    let blue = 0;
    let dark = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      const r = png.data[index]!;
      const g = png.data[index + 1]!;
      const b = png.data[index + 2]!;
      if (b > 140 && r < 60 && g > 60 && g < 140) blue++;
      if (r < 32 && g < 32 && b < 32) dark++;
    }
    expect(blue, `${name}: curve remains visible`).toBeGreaterThan(500);
    expect(
      dark / (png.width * png.height),
      `${name}: no filled black region`,
    ).toBeLessThan(0.03);
  }
});

test("the qualified OTA setup opens unchanged and preserves all root and hierarchical outputs", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const dut = project.documents.find(
    (document) => document.id === "document-ota-5t",
  )!;
  dut.instances.push({
    id: "I_INTERNAL_PROBE",
    symbolId: "current-source",
    placement: null,
    reference: "I1",
    netlist: {
      binding: { kind: "primitive", deviceClass: "current-source" },
      parameters: { dc: "1u" },
    },
  });
  dut.nets
    .find((net) => net.id === "net-cell-pin-pvdd")!
    .terminals.push({ instanceId: "I_INTERNAL_PROBE", pinName: "+" });
  dut.nets
    .find((net) => net.id === "net-dut-tail")!
    .terminals.push({ instanceId: "I_INTERNAL_PROBE", pinName: "-" });
  const savedSetup = project.simulationSetups[0];
  expect(savedSetup?.input.kind).toBe("structured");
  if (savedSetup?.input.kind !== "structured")
    throw new Error("qualified OTA fixture setup is not structured");
  const originalSetupInput = savedSetup.input;
  expect(originalSetupInput.outputs).toHaveLength(4);
  expect(
    originalSetupInput.outputs.filter(
      (output) =>
        (output.expression.kind === "voltage" ||
          output.expression.kind === "current") &&
        output.expression.occurrence.length > 0,
    ),
  ).toHaveLength(2);
  let executions = 0;
  await page.route("**/api/simulate", async (route) => {
    if (route.request().postDataJSON().operation !== "capabilities") {
      executions++;
      return route.abort();
    }
    return route.fulfill({
      json: {
        configured: true,
        inputs: ["structured", "raw"],
        analyses: ["op", "dc", "ac", "tran"],
        parsedAnalyses: ["op", "dc", "ac", "tran"],
        profiles: [
          {
            id: profile.id,
            label: profile.displayName,
            corners: ["tt", "ff", "ss", "fs", "sf"],
          },
        ],
        modelLibrary: {
          path: profile.models.library.runtimePath,
          section: "tt",
        },
        maxTimeoutMs: 120000,
        maxInputBytes: 1048576,
        cancel: true,
        batch: {
          maxItems: 16,
          execution: "sequential",
          sweepAxes: ["corner", "temperature", "variable", "parameter"],
        },
      },
    });
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "qualified-ota.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel
    .locator('details[aria-label="Run Plan settings"] > summary')
    .click();
  await panel.getByRole("radio", { name: "Sweep" }).check();
  await panel.getByLabel("Run Plan corner ff").check();
  await panel.getByLabel("Run Plan corner ss").check();
  await expect(panel).toContainText("3 points");
  await expect(
    page.getByText("The editor hit an unexpected problem"),
  ).toHaveCount(0);
  await panel.getByRole("radio", { name: "Nominal" }).check();
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel
    .locator('details[aria-label="Analyses settings"] > summary')
    .click();
  await panel
    .locator('details[aria-label="Output probes settings"] > summary')
    .click();
  await panel
    .locator('details[aria-label="Output signals settings"] > summary')
    .click();
  await expect(panel.getByLabel("Testbench Cell")).toHaveCount(0);
  await expect(panel.getByLabel("Stop (Hz)")).toHaveValue("1000000000");
  await expect(panel.getByLabel("DC sweep source")).toHaveValue("VINP");
  await expect(panel.getByLabel("TRAN stop (s)")).toHaveValue("0.000004");
  await expect(
    panel.getByText(profile.displayName, { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("Process corner")).toHaveValue("tt");
  await panel.getByLabel("Process corner").selectOption("ff");
  await expect(panel.getByLabel("Process corner")).toHaveValue("ff");
  await panel.getByLabel("Process corner").selectOption("tt");
  await expect(
    panel.getByRole("button", { name: "Remove output" }),
  ).toHaveCount(4);
  await expect(
    panel.locator("li").filter({ hasText: "XDUT · ota_5t · tail" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Pick on canvas" }).click();
  await page.getByTestId("route-hit-tb-vinp-route").click({ force: true });
  await expect(
    panel.getByRole("button", { name: "Remove output" }),
  ).toHaveCount(5);
  await panel.getByRole("button", { name: "Remove output" }).last().click();
  await panel.getByRole("button", { name: "Picking Nets…" }).click();
  await panel
    .getByLabel("Add voltage probe")
    .selectOption({ label: "XDUT · ota_5t · vinp" });
  await panel.getByRole("button", { name: "Pick current" }).click();
  await expect(page.locator(".schematic-canvas")).toHaveClass(
    /simulation-terminal-pick-active/u,
  );
  await page.getByTestId("terminal-VINP-+").click();
  await expect(
    page.getByTestId("terminal-VINP-+-current-pick-marker"),
  ).toHaveClass(/origin/u);
  await expect(
    page.getByTestId("terminal-VINP---current-pick-marker"),
  ).toHaveClass(/partner/u);
  await page.getByTestId("terminal-VINP--").click();
  await panel.getByRole("button", { name: "Picking current…" }).click();
  await panel
    .getByLabel("Add current output")
    .selectOption({ label: "XDUT · ota_5t · I1.+ current" });
  await expect(
    panel.getByRole("button", { name: "Remove output" }),
  ).toHaveCount(7);
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await panel.getByRole("button", { name: "Prepare deck" }).click();
  await expect(panel.getByLabel("Prepare files")).toBeVisible();
  await panel
    .getByRole("button", { name: "prepared.cir", exact: true })
    .click();
  const filePreview = panel.getByRole("region", { name: "File preview" });
  await expect(filePreview).toContainText("prepared.cir");
  const deckDownload = page.waitForEvent("download");
  await filePreview.getByRole("button", { name: "Download" }).click();
  const stream = await (await deckDownload).createReadStream();
  let deck = "";
  for await (const chunk of stream!) deck += chunk.toString();
  for (const vector of [
    "v(vout)",
    "v(ibias)",
    "v(xdut.tail)",
    "v(xdut.nleft)",
    "v(vinp)",
  ])
    expect(deck).toContain(vector);
  expect(deck).toMatch(/i\(vicmprb\d+\)/u);
  expect(deck).toMatch(/i\(v\.xdut\.vicmprb\d+\)/u);
  expect(deck).toMatch(/ac dec 10 1 (?:1000000000|1e\+?9)/i);
  expect(deck).toContain("dc VINP 0.88 0.92 0.005");
  expect(deck).toContain(`.lib "${profile.models.library.runtimePath}" tt`);
  expect(deck).toContain("tran 2e-8 0.000004");
  expect(executions).toBe(0);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const { outputs: savedOutputs, ...savedInput } =
    saved.simulationSetups[0].input;
  const { outputs: originalOutputs, ...originalInput } = originalSetupInput;
  expect(savedInput).toEqual(originalInput);
  expect(savedOutputs.slice(0, 4)).toEqual(originalOutputs);
  expect(savedOutputs.slice(4)).toMatchObject([
    {
      expression: {
        kind: "voltage",
        documentId: "document-ota-5t",
        anchor: {
          kind: "terminal",
          instanceId: "PVINP",
          pinName: "P",
        },
        occurrence: ["XDUT"],
      },
    },
    {
      expression: {
        kind: "current",
        documentId: "document-ota-5t-testbench",
        instanceId: "VINP",
        pinName: "+",
        occurrence: [],
      },
    },
    {
      expression: {
        kind: "current",
        documentId: "document-ota-5t",
        instanceId: "I_INTERNAL_PROBE",
        pinName: "+",
        occurrence: ["XDUT"],
      },
    },
  ]);
  await page.reload();
  await page.getByTestId("project-file").setInputFiles({
    name: "reopened.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel
    .locator('details[aria-label="Analyses settings"] > summary')
    .click();
  await panel
    .locator('details[aria-label="Output signals settings"] > summary')
    .click();
  await expect(
    panel.getByRole("button", { name: "Remove output" }),
  ).toHaveCount(7);
  await expect(panel.getByLabel("Stop (Hz)")).toHaveValue("1000000000");
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("status")).not.toHaveText("Setup changed");
});

test("one Testbench persists several independently named setups", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const existingSetupNames = project.simulationSetups.map(
    (setup) => setup.name,
  );
  const activeSetup = project.simulationSetups.find(
    (setup) => setup.id === "simulation-setup-ota-op-ac",
  );
  const activeTestbenchId =
    activeSetup?.input.kind === "structured"
      ? activeSetup.input.rootDocumentId
      : undefined;
  expect(activeTestbenchId).toBe("document-ota-5t-testbench");
  await page.route("**/api/simulate", async (route) =>
    route.fulfill({
      json: {
        configured: true,
        inputs: ["structured", "raw"],
        analyses: ["op", "dc", "ac", "tran"],
        parsedAnalyses: ["op", "dc", "ac", "tran"],
        profiles: [{ id: profile.id, corners: ["tt"] }],
        maxTimeoutMs: 120000,
        maxInputBytes: 1048576,
        cancel: true,
      },
    }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "multiple-setups.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  const selector = panel.getByTitle("Simulation setup", { exact: true });
  await expect(selector).toContainText("OTA OP, DC, AC, and TRAN");
  await selector.click();
  await panel.getByRole("button", { name: "New setup", exact: true }).click();
  await expect(selector).toContainText(
    `Setup ${existingSetupNames.length + 1}`,
  );
  await panel.getByLabel("Setup name").fill("OTA OP, DC, AC, and TRAN");
  await panel.getByLabel("Setup name").press("Tab");
  await expect(panel.getByRole("alert")).toContainText(
    "EDIT_PRECONDITION: Simulation setup name already exists: OTA OP, DC, AC, and TRAN",
  );
  await panel.getByLabel("Setup name").fill("Bias search");
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await panel.getByLabel("Setup name").fill("Bias sweep");
  await panel.getByLabel("Setup name").press("Tab");
  await expect(panel.getByRole("status")).not.toHaveText("Setup changed");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(saved.simulationSetups).toHaveLength(existingSetupNames.length + 1);
  expect(
    saved.simulationSetups.map((setup: { name: string }) => setup.name),
  ).toEqual([...existingSetupNames, "Bias sweep"]);
  expect(
    saved.simulationSetups.find(
      (setup: { name: string }) => setup.name === "Bias sweep",
    )?.input.rootDocumentId,
  ).toBe(activeTestbenchId);
  expect(
    new Set(
      saved.simulationSetups.map(
        (setup: { input: { rootDocumentId: string } }) =>
          setup.input.rootDocumentId,
      ),
    ),
  ).toEqual(
    new Set(["document-ota-5t-testbench", "document-ota-5t-testbench-sin"]),
  );

  await selector.click();
  await panel.getByRole("button", { name: "Delete Bias sweep" }).click();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Bias sweep", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Delete Bias sweep" }).click();
  await panel.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(selector).toContainText("OTA OP, DC, AC, and TRAN");
  await selector.click();
  await expect(
    panel.getByRole("button", { name: "Bias sweep", exact: true }),
  ).toHaveCount(0);
  const afterDelete = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(afterDelete.simulationSetups).toHaveLength(existingSetupNames.length);
  expect(
    afterDelete.simulationSetups.map((setup: { name: string }) => setup.name),
  ).toEqual(existingSetupNames);
});

test("a saved-setup batch prepares first and exposes each ordinary run", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const deck = readFileSync(
    new URL(
      "../../../fixtures/ngspice-rawfile/divider-op.deck.spi",
      import.meta.url,
    ),
    "utf8",
  );
  const rawfile = readFileSync(
    new URL(
      "../../../fixtures/ngspice-rawfile/divider-op.raw",
      import.meta.url,
    ),
    "utf8",
  );
  project.simulationSetups = ["TT", "FF"].map((name) => ({
    id: `setup-${name.toLowerCase()}`,
    name,
    version: 3,
    input: {
      kind: "raw",
      entry: "main.cir",
      files: [{ path: "main.cir", text: deck }],
      dependencies: [],
      environment: { profileId: profile.id },
    },
  }));
  let executions = 0;
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          inputs: ["structured", "raw"],
          analyses: ["op", "dc", "ac", "tran", "noise"],
          parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
          profiles: [{ id: profile.id, corners: ["tt"] }],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    executions++;
    return route.fulfill({
      json: {
        outcome: { status: "completed" },
        diagnostics: [],
        log: "ngspice OP",
        durationMs: 1,
        rawfile,
        executedDeck: body.preparedDeck,
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
    name: "batch.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByTitle("Simulation setup", { exact: true }).click();
  await panel.getByLabel("Include TT in batch").check();
  await panel.getByLabel("Include FF in batch").check();
  await panel.getByRole("button", { name: "Run selected (2)" }).click();
  const batch = panel.locator(".simulation-batch-strip");
  await expect(batch).toContainText("Batch · finished");
  await expect(
    batch.getByRole("button", { name: /TT · finished/ }),
  ).toBeEnabled();
  await expect(
    batch.getByRole("button", { name: /FF · finished/ }),
  ).toBeEnabled();
  expect(executions).toBe(2);
  await batch.getByRole("button", { name: /FF · finished/ }).click();
  await expect(
    panel.getByTitle("Simulation setup", { exact: true }),
  ).toContainText("FF");
  await expect(panel.getByRole("status").first()).toContainText(
    "Batch finished",
  );
});

test("a saved Run Plan prepares without executing and Run starts its ordinary batch", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const setup = project.simulationSetups.find(
    ({ input }) => input.kind === "structured",
  );
  if (!setup || setup.input.kind !== "structured") throw new Error("setup");
  const setupInput = setup.input;
  const root = project.documents.find(
    ({ id }) => id === setupInput.rootDocumentId,
  )!;
  const source = root.instances.find(({ id }) => id === "VINP")!;
  setupInput.analyses = [{ kind: "op" }];
  setupInput.outputs = [];
  setupInput.designVariables = [
    {
      id: "input-level",
      name: "VIN",
      value: "0.9",
      bindings: [
        {
          documentId: root.id,
          instanceId: source.id,
          parameter: "low",
        },
      ],
    },
  ];
  setupInput.runPlan = {
    mode: "sweep",
    axes: [
      { kind: "variable", variableId: "input-level", values: ["0.89", "0.9"] },
    ],
  };
  project.simulationSetups = [setup];
  const rawfile = readFileSync(
    new URL(
      "../../../fixtures/ngspice-rawfile/divider-op.raw",
      import.meta.url,
    ),
    "utf8",
  );
  let executions = 0;
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          inputs: ["structured", "raw"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: [{ id: profile.id, corners: ["tt"] }],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    executions += 1;
    return route.fulfill({
      json: {
        outcome: { status: "completed" },
        diagnostics: [],
        log: "ngspice OP",
        durationMs: 1,
        rawfile,
        executedDeck: body.preparedDeck,
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
    name: "run-plan.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("button", { name: "Prepare deck" }).click();
  await expect(panel.locator(".simulation-batch-strip")).toContainText(
    "Batch · prepared",
  );
  await expect(panel.getByLabel("Prepare files")).toBeVisible();
  expect(executions).toBe(0);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.locator(".simulation-batch-strip")).toContainText(
    "Batch · finished",
  );
  expect(executions).toBe(2);
});

test("human simulation uses saved setup, survives minimizing, recovers a bad input and exports results", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const project = parseProject(JSON.stringify(ota));
  project.simulationSetups = [
    {
      id: "setup-e2e",
      name: "E2E setup",
      version: 3,
      input: {
        kind: "structured",
        designVariables: [],
        runPlan: { mode: "nominal" },
        rootDocumentId: project.topDocumentId,
        analyses: [
          { kind: "op" },
          { kind: "ac", sweep: "dec", points: 10, startHz: 1, stopHz: 1e6 },
        ],
        outputs: [
          {
            id: "out",
            label: "out",
            expression: {
              kind: "voltage",
              documentId: project.topDocumentId,
              anchor: {
                kind: "terminal",
                instanceId: "missing-instance",
                pinName: "out",
              },
              occurrence: [],
            },
          },
        ],
        environment: { profileId: profile.id },
      },
    },
  ];
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
          inputs: ["structured", "raw"],
          analyses: ["op", "ac", "tran", "noise"],
          parsedAnalyses: ["op", "ac", "tran", "noise"],
          profiles: [{ id: profile.id, corners: ["tt"] }],
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
    const requestedVector =
      /write\s+out\.raw\s+([^\s]+)/iu.exec(body.preparedDeck)?.[1] ?? "v(out)";
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
        log: "ngspice OP",
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
  await page
    .getByRole("button", { name: "Analog simulation", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(/PROBE|probe/);
  expect(executions).toBe(0);
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel
    .locator('details[aria-label="Analyses settings"] > summary')
    .click();
  await panel
    .locator('details[aria-label="Output probes settings"] > summary')
    .click();
  await panel
    .locator('details[aria-label="Output signals settings"] > summary')
    .click();
  await panel.getByRole("button", { name: "Remove output" }).click();
  await panel
    .getByLabel("Add voltage probe")
    .selectOption({ label: "Testbench · vout" });
  await panel.getByLabel("TRAN", { exact: true }).check();
  await panel.getByLabel("TRAN step (s)").fill("1e-9");
  await panel.getByLabel("TRAN stop (s)").fill("1e-6");
  await panel.getByLabel("TRAN maximum step (s)").fill("5e-10");
  await panel.getByLabel("Noise", { exact: true }).check();
  await panel
    .getByLabel("Noise output positive")
    .selectOption({ label: "Testbench · vout" });
  await panel.getByLabel("Noise output negative").selectOption("");
  await panel.getByLabel("Input source").selectOption({ index: 0 });
  await panel.getByLabel("Noise sweep").selectOption("dec");
  await panel.getByLabel("Start (Hz)").last().fill("1");
  await panel.getByLabel("Stop (Hz)").last().fill("1000000");
  await panel.getByLabel(/Output name for/).fill("first-output");
  const analysisBoxes = await panel
    .locator(".simulation-analysis-options > label")
    .all();
  const firstAnalysisBox = (await analysisBoxes[0]!.boundingBox())!;
  expect(analysisBoxes).toHaveLength(5);
  for (const option of analysisBoxes) {
    expect((await option.boundingBox())!.y).toBeCloseTo(firstAnalysisBox.y, 0);
  }
  await panel
    .locator('details[aria-label="Measurements settings"] > summary')
    .click();
  const measurementEditor = panel.locator(".simulation-measurement-editor");
  await measurementEditor
    .getByRole("button", { name: "Add measurement" })
    .click();
  await measurementEditor
    .getByLabel("Name", { exact: true })
    .fill("Peak output");
  await measurementEditor
    .getByRole("combobox", { name: "Analysis", exact: true })
    .selectOption("tran");
  await measurementEditor
    .getByRole("combobox", { name: "Measure", exact: true })
    .selectOption("rms");
  await measurementEditor.getByLabel("Window stop / SI").fill("1e-6");
  const addBox = (await measurementEditor
    .getByRole("button", { name: "Add measurement" })
    .boundingBox())!;
  const removeBox = (await measurementEditor
    .getByRole("button", { name: "Remove measurement" })
    .boundingBox())!;
  expect(addBox.y).toBeCloseTo(removeBox.y, 0);
  expect(
    await measurementEditor.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await measurementEditor.screenshot({
    path: test.info().outputPath("measurement-settings.png"),
  });
  await measurementEditor
    .getByRole("button", { name: "Remove measurement" })
    .click();
  await expect(measurementEditor.locator("fieldset")).toHaveCount(0);
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(1);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  expect(cancellations).toBe(0);
  release();
  await page.getByTestId("open-analog-simulation").click();
  await expect(panel.getByRole("status")).toHaveText("finished · completed");
  // A completed run belongs to its setup, not whichever setup is currently visible.
  await panel.getByTitle("Simulation setup", { exact: true }).click();
  await panel.getByRole("button", { name: "New setup", exact: true }).click();
  await expect(panel.getByRole("status")).not.toHaveText(
    "finished · completed",
  );
  await panel.getByTitle("Simulation setup", { exact: true }).click();
  await panel.getByRole("button", { name: "E2E setup", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("finished · completed");
  expect(executions).toBe(1);
  await expect(panel.getByRole("tab", { name: "Summary" })).toHaveCount(0);
  await panel.getByRole("tab", { name: "Console" }).click();
  await expect(panel.locator(".simulation-console-summary")).toContainText(
    "finished · completed",
  );
  await expect(panel.locator(".simulation-console-view > pre")).toBeVisible();
  await panel.getByRole("tab", { name: "Operating Point" }).click();
  await expect(panel.getByRole("region", { name: "OP results" })).toContainText(
    "0.500000",
  );
  await expect(panel.getByText("1 direct Net voltage")).toBeVisible();
  const opMeasurements = panel.locator(
    "details.simulation-measurement-results",
  );
  await expect(opMeasurements.locator(":scope > summary")).toContainText(
    "1 value",
  );
  await expect(opMeasurements).not.toHaveAttribute("open", "");
  await panel.getByRole("button", { name: "Show on canvas" }).click();
  await expect(page.getByTestId("operating-point-badges")).toContainText(
    "500 mV",
  );
  await panel.getByRole("button", { name: "Hide canvas values" }).click();
  await expect(page.getByTestId("operating-point-badges")).toHaveCount(0);
  await panel.getByRole("tab", { name: "Plot" }).click();
  await expect(
    panel.getByRole("heading", { name: "AC Analysis" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Transient Analysis" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Noise Analysis" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Integrated noise" }),
  ).toContainText("Integrated input-referred noise");
  const plotMeasurements = panel.locator(
    "details.simulation-measurement-results",
  );
  await expect(plotMeasurements).toHaveCount(1);
  await expect(plotMeasurements.locator(":scope > summary")).toContainText(
    "14 values",
  );
  await expect(panel.locator(".spice-ac-plot svg")).toHaveCount(3);
  await expect(panel.locator('svg[aria-label="AC magnitude"]')).toBeVisible();
  await expect(panel.locator('svg[aria-label="AC phase"]')).toHaveCount(0);
  const acDisplay = panel.getByRole("group", { name: "Voltage display" });
  await acDisplay.getByRole("button", { name: "Bode" }).click();
  await expect(panel.locator('svg[aria-label="AC db20"]')).toBeVisible();
  await expect(panel.locator('svg[aria-label="AC phase"]')).toBeVisible();
  await expect(panel.getByLabel("Voltage reference")).toHaveValue("");
  await expect(panel.getByText("ref 1 V", { exact: false })).toHaveCount(0);
  await expect(
    panel
      .locator('svg[aria-label="AC db20"] .ac-axis-title')
      .filter({ hasText: "db20/dBV" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await panel.locator('svg[aria-label="AC db20"]').boundingBox())
          ?.height ?? 0,
    )
    .toBeGreaterThan(300);
  const resultExport = panel.locator("details.simulation-result-export");
  await resultExport.locator("summary").click();
  const svgBundlePromise = page.waitForEvent("download");
  await resultExport
    .getByRole("button", { name: "Visible plots · SVG" })
    .click();
  const svgBundle = await svgBundlePromise;
  expect(svgBundle.suggestedFilename()).toBe("simulation-plots-svg.zip");
  const svgEntries = unzipSync(readFileSync((await svgBundle.path())!));
  expect(Object.keys(svgEntries)).toHaveLength(4);
  const exportedSvg = strFromU8(Object.values(svgEntries)[0]!);
  expect(exportedSvg).toContain('<?xml version="1.0"');
  expect(exportedSvg).toContain('fill="white"');
  expect(exportedSvg).not.toContain("ac-trace-hit");
  const pngBundlePromise = page.waitForEvent("download");
  await resultExport
    .getByRole("button", { name: "Visible plots · PNG" })
    .click();
  const pngBundle = await pngBundlePromise;
  expect(pngBundle.suggestedFilename()).toBe("simulation-plots-png.zip");
  const pngEntries = unzipSync(readFileSync((await pngBundle.path())!));
  expect(Object.keys(pngEntries)).toHaveLength(4);
  expect([...Object.values(pngEntries)[0]!.slice(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  const phasePngEntry = Object.entries(pngEntries).find(([name]) =>
    name.includes("ac-phase"),
  );
  expect(phasePngEntry).toBeDefined();
  const phasePng = PNG.sync.read(Buffer.from(phasePngEntry![1]));
  let darkPixels = 0;
  for (let index = 0; index < phasePng.data.length; index += 4) {
    if (
      phasePng.data[index]! < 32 &&
      phasePng.data[index + 1]! < 32 &&
      phasePng.data[index + 2]! < 32
    )
      darkPixels += 1;
  }
  expect(darkPixels / (phasePng.width * phasePng.height)).toBeLessThan(0.25);
  const csvDownloadPromise = page.waitForEvent("download");
  await resultExport.getByRole("button", { name: "outputs-op-0.csv" }).click();
  expect((await csvDownloadPromise).suggestedFilename()).toBe(
    "outputs-op-0.csv",
  );
  const measurementDownloadPromise = page.waitForEvent("download");
  await resultExport.getByRole("button", { name: "measurements.csv" }).click();
  const measurementDownload = await measurementDownloadPromise;
  expect(measurementDownload.suggestedFilename()).toBe("measurements.csv");
  expect(readFileSync((await measurementDownload.path())!, "utf8")).toContain(
    '"TRAN","Transient response","first-output","Time-weighted RMS"',
  );
  const noiseCsvPromise = page.waitForEvent("download");
  await resultExport
    .getByRole("button", { name: /outputs-noise-\d+\.csv/u })
    .click();
  expect((await noiseCsvPromise).suggestedFilename()).toMatch(
    /outputs-noise-\d+\.csv/u,
  );
  resultExport.evaluate((element) => element.removeAttribute("open"));
  await acDisplay.getByRole("button", { name: "Magnitude" }).click();
  await expect(panel.locator('svg[aria-label="AC magnitude"]')).toBeVisible();
  await expect(panel.locator('svg[aria-label="AC phase"]')).toHaveCount(0);
  await panel.getByRole("tab", { name: "Compare" }).click();
  await expect(
    panel.getByRole("columnheader", { name: "Maximum" }).first(),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Keep current" }).click();
  await expect(
    panel.getByRole("button", { name: "Current kept" }),
  ).toBeDisabled();
  await panel.getByRole("tab", { name: "Plot" }).click();
  expect(
    await panel
      .locator(".ac-response .ac-trace")
      .first()
      .evaluate((trace) => getComputedStyle(trace).strokeWidth),
  ).toBe("2.4px");
  expect(
    await panel
      .locator(".ac-response .ac-axis-label")
      .first()
      .evaluate((label) => getComputedStyle(label).fill),
  ).toBe("rgb(52, 64, 84)");
  await expect(
    panel.getByRole("button", { name: "Hide first-output" }),
  ).toHaveCount(2);
  expect(
    await panel
      .locator(".waveform-trace-list")
      .first()
      .evaluate((list) => getComputedStyle(list).position),
  ).toBe("static");
  const magnitudePlot = panel
    .locator(".ac-plot-row")
    .filter({ hasText: "Magnitude" })
    .locator(".spice-ac-plot")
    .first();
  const magnitudeToolbar = magnitudePlot.locator("..").getByLabel("Plot tools");
  await page.mouse.move(1, 1);
  await expect(
    magnitudeToolbar.getByRole("button", { name: "Zoom in" }),
  ).toBeHidden();
  const plotLayoutBeforeToolbar = await magnitudePlot.evaluate((element) => {
    const plot = element.getBoundingClientRect();
    const toolbar = element
      .parentElement!.querySelector('[aria-label="Plot tools"]')!
      .getBoundingClientRect();
    return { height: plot.height, toolbarGap: plot.top - toolbar.bottom };
  });
  await magnitudeToolbar.hover();
  await expect(
    magnitudeToolbar.getByRole("button", { name: "Zoom in" }),
  ).toBeVisible();
  const toolbarBox = await magnitudeToolbar.boundingBox();
  const lastToolBox = await magnitudeToolbar
    .getByRole("button", { name: "Open plot" })
    .boundingBox();
  expect(lastToolBox!.x + lastToolBox!.width).toBeLessThanOrEqual(
    toolbarBox!.x + toolbarBox!.width,
  );
  const plotLayoutAfterToolbar = await magnitudePlot.evaluate((element) => {
    const plot = element.getBoundingClientRect();
    const toolbar = element
      .parentElement!.querySelector('[aria-label="Plot tools"]')!
      .getBoundingClientRect();
    return { height: plot.height, toolbarGap: plot.top - toolbar.bottom };
  });
  expect(plotLayoutAfterToolbar).toEqual(plotLayoutBeforeToolbar);
  const plotBeforeWheel = await magnitudePlot.innerHTML();
  await magnitudePlot.dispatchEvent("wheel", { deltaY: -120 });
  await expect(magnitudePlot).toHaveJSProperty("innerHTML", plotBeforeWheel);
  const acBounds = (await magnitudePlot.boundingBox())!;
  await page.mouse.move(
    acBounds.x + acBounds.width * 0.3,
    acBounds.y + acBounds.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    acBounds.x + acBounds.width * 0.7,
    acBounds.y + acBounds.height * 0.7,
  );
  await page.mouse.up();
  await expect(magnitudePlot).not.toHaveJSProperty(
    "innerHTML",
    plotBeforeWheel,
  );
  await magnitudeToolbar.hover();
  await magnitudeToolbar.getByRole("button", { name: "Fit plot" }).click();
  await expect(magnitudePlot).toHaveJSProperty("innerHTML", plotBeforeWheel);
  await magnitudeToolbar.hover();
  await expect(
    panel.getByRole("button", { name: "Zoom in" }).first(),
  ).toBeVisible();
  await magnitudePlot.dblclick();
  await expect(
    page.getByRole("dialog", { name: "voltage magnitude plot" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close plot" }).click();
  const tracePoint = await magnitudePlot
    .locator("polyline.ac-trace-hit[data-trace-id]")
    .evaluate((element) => {
      const line = element as SVGPolylineElement;
      const left = line.points.getItem(0);
      const right = line.points.getItem(1);
      // Click between samples so a marker, tick, or grid line at a sampled
      // coordinate cannot intercept the trace-selection regression check.
      const screen = new DOMPoint(
        (left.x + right.x) / 2,
        (left.y + right.y) / 2,
      ).matrixTransform(line.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.click(tracePoint.x, tracePoint.y);
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await expect(
    panel.locator('svg[aria-label="Transient voltage"]'),
  ).toBeVisible();
  const transientPlot = panel
    .locator(".transient-quantity-group")
    .filter({ hasText: "Voltage" })
    .locator(".spice-ac-plot")
    .first();
  const transientShell = transientPlot.locator("..");
  const transientToolbar = transientShell.getByLabel("Plot tools", {
    exact: true,
  });
  await expect(transientPlot.locator(".ac-trace-hit")).toHaveAttribute(
    "fill",
    "none",
  );
  await transientPlot.hover();
  const rightTimeLabel = transientPlot.locator("svg .ac-x-axis-label").last();
  const fullTimeLabel = await rightTimeLabel.textContent();
  const toolbarBounds = await transientToolbar.boundingBox();
  const transientBounds = await transientPlot.boundingBox();
  expect(transientBounds).not.toBeNull();
  await page.mouse.move(
    transientBounds!.x + transientBounds!.width * 0.3,
    transientBounds!.y + transientBounds!.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    transientBounds!.x + transientBounds!.width * 0.7,
    transientBounds!.y + transientBounds!.height * 0.7,
    { steps: 5 },
  );
  await expect(transientPlot.locator(".waveform-selection")).toBeVisible();
  await page.mouse.up();
  expect(toolbarBounds!.y + toolbarBounds!.height).toBeLessThanOrEqual(
    transientBounds!.y,
  );
  await expect(
    panel.locator(".transient-results-explorer .ac-cursor-readout"),
  ).toHaveCount(0);
  await expect(rightTimeLabel).not.toHaveText(fullTimeLabel ?? "");
  const zoomTimeLabel = await rightTimeLabel.textContent();
  await transientToolbar.hover();
  await transientShell.getByRole("button", { name: "Previous view" }).click();
  await expect(rightTimeLabel).toHaveText(fullTimeLabel ?? "");
  await transientShell.getByRole("button", { name: "Next view" }).click();
  await expect(rightTimeLabel).toHaveText(zoomTimeLabel ?? "");
  await transientShell.getByRole("button", { name: "Fit plot" }).click();
  await expect(rightTimeLabel).toHaveText(fullTimeLabel ?? "");
  const yLabels = await transientPlot
    .locator('svg .ac-axis-label:not(.ac-x-axis-label)[text-anchor="end"]')
    .allTextContents();
  await transientToolbar.hover();
  await transientShell.getByRole("button", { name: "Control X axes" }).click();
  const xDrag = (await transientPlot.boundingBox())!;
  await page.mouse.move(
    xDrag.x + xDrag.width * 0.3,
    xDrag.y + xDrag.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    xDrag.x + xDrag.width * 0.7,
    xDrag.y + xDrag.height * 0.7,
    { steps: 5 },
  );
  await expect(transientPlot.locator(".waveform-selection")).toBeVisible();
  await page.mouse.up();
  await expect(rightTimeLabel).not.toHaveText(fullTimeLabel ?? "");
  expect(
    await transientPlot
      .locator('svg .ac-axis-label:not(.ac-x-axis-label)[text-anchor="end"]')
      .allTextContents(),
  ).toEqual(yLabels);
  await transientToolbar.hover();
  await transientShell
    .getByRole("button", { name: "Fit X", exact: true })
    .click();
  await expect(rightTimeLabel).toHaveText(fullTimeLabel ?? "");
  await transientToolbar.hover();
  await transientShell.getByRole("button", { name: "Control XY axes" }).click();
  await transientPlot.click({
    position: {
      x: transientBounds!.width * 0.5,
      y: transientBounds!.height * 0.5,
    },
  });
  const fixedReadout = panel.locator(
    ".transient-results-explorer .ac-cursor-readout",
  );
  await expect(fixedReadout).toBeVisible();
  const measurement = await fixedReadout.textContent();
  await transientPlot.hover({
    position: {
      x: transientBounds!.width * 0.8,
      y: transientBounds!.height * 0.4,
    },
  });
  await expect(fixedReadout).toHaveText(measurement ?? "");
  await transientToolbar.hover();
  await transientShell.getByRole("button", { name: "Place marker B" }).click();
  await transientPlot.click({
    position: {
      x: transientBounds!.width * 0.9,
      y: transientBounds!.height * 0.4,
    },
  });
  await expect(fixedReadout).toContainText("ΔX:");
  await expect(fixedReadout).toContainText("ΔY");
  await expect(fixedReadout).toContainText("1/|Δt|");
  await expect(transientPlot.locator("line.ac-cursor")).toHaveCount(4);
  const markerA = transientPlot.locator('[data-marker="A"]').first();
  const markerBounds = await markerA.boundingBox();
  const markerTextBeforeDrag = await fixedReadout.textContent();
  await page.mouse.move(
    markerBounds!.x + markerBounds!.width / 2,
    markerBounds!.y + markerBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    markerBounds!.x + transientBounds!.width * 0.6,
    markerBounds!.y + 4,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await expect(fixedReadout).not.toHaveText(markerTextBeforeDrag ?? "");
  const markersBeforeRemount = await fixedReadout.textContent();
  await transientToolbar.hover();
  await transientShell
    .getByRole("button", { name: "Ranges", exact: true })
    .click();
  const ranges = transientShell.getByRole("form", { name: "Axis ranges" });
  const rangeBounds = await ranges.boundingBox();
  const shellBounds = await transientShell.boundingBox();
  const plotBoundsWithRanges = await transientPlot.boundingBox();
  expect(rangeBounds!.x).toBeGreaterThanOrEqual(shellBounds!.x);
  expect(rangeBounds!.x + rangeBounds!.width).toBeLessThanOrEqual(
    shellBounds!.x + shellBounds!.width,
  );
  expect(rangeBounds!.y + rangeBounds!.height).toBeLessThanOrEqual(
    plotBoundsWithRanges!.y,
  );
  await ranges.getByLabel("Auto X", { exact: true }).uncheck();
  await ranges.getByLabel("X minimum").fill("8e-9");
  await ranges.getByLabel("X maximum").fill("2e-9");
  await ranges.getByRole("button", { name: "Apply ranges" }).click();
  await expect(ranges.getByRole("alert")).toContainText("Minimum must be less");
  await ranges.getByLabel("X minimum").fill("2e-9");
  await ranges.getByLabel("X maximum").fill("8e-9");
  await ranges.getByLabel("Auto Y", { exact: true }).uncheck();
  await ranges.getByLabel("Y minimum").fill("-1");
  await ranges.getByLabel("Y maximum").fill("2");
  await ranges.getByRole("button", { name: "Apply ranges" }).click();
  await expect(ranges).toHaveCount(0);
  const savedTicks = await rightTimeLabel.textContent();
  await panel.getByRole("tab", { name: "Files" }).click();
  await panel.getByRole("tab", { name: "Plot" }).click();
  await expect(rightTimeLabel).toHaveText(savedTicks ?? "");
  await expect(fixedReadout).toHaveText(markersBeforeRemount ?? "");
  const transientOutputs = panel.locator(".transient-results-explorer");
  await transientOutputs
    .getByRole("button", { name: "Hide first-output" })
    .click();
  await panel.getByRole("tab", { name: "Files" }).click();
  await panel.getByRole("tab", { name: "Plot" }).click();
  await expect(
    transientOutputs.getByRole("button", { name: "Show first-output" }),
  ).toBeVisible();
  await expect(transientPlot).toHaveCount(0);
  await transientOutputs
    .getByRole("button", { name: "Show first-output" })
    .click();
  await expect(rightTimeLabel).toHaveText(savedTicks ?? "");
  await expect(fixedReadout).toHaveText(markersBeforeRemount ?? "");
  await transientToolbar.hover();
  await transientShell.getByRole("button", { name: "Previous view" }).click();
  await expect(rightTimeLabel).toHaveText(fullTimeLabel ?? "");
  await transientShell.getByRole("button", { name: "Next view" }).click();
  await expect(rightTimeLabel).toHaveText(savedTicks ?? "");
  await transientShell.getByRole("button", { name: "Open plot" }).click();
  const waveformDialog = page.getByRole("dialog", {
    name: "Transient voltage plot",
  });
  await expect(waveformDialog.locator(".ac-cursor-readout")).toBeVisible();
  const expandedViewport = await waveformDialog
    .locator(".spice-ac-plot")
    .boundingBox();
  const expandedTick = await waveformDialog
    .locator('svg text[text-anchor="middle"]')
    .last()
    .boundingBox();
  expect(expandedTick!.y + expandedTick!.height).toBeLessThanOrEqual(
    expandedViewport!.y + expandedViewport!.height,
  );
  await expect(waveformDialog.locator("line.ac-grid").first()).not.toHaveCSS(
    "stroke",
    "none",
  );
  await waveformDialog.screenshot({
    path: test.info().outputPath("waveform-tools.png"),
  });
  await waveformDialog.getByRole("button", { name: "Close plot" }).click();
  await panel.getByRole("tab", { name: "Files" }).click();
  await panel.getByLabel("Run Evidence").locator("summary").click();
  await expect(
    panel.getByRole("button", {
      name: "evidence-manifest.json",
      exact: true,
    }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: /Download .*\.csv$/ })
    .first()
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await expect(panel.getByLabel("Run Results")).toBeVisible();
  const bundleDownload = page.waitForEvent("download");
  await panel
    .getByLabel("Run files")
    .getByRole("button", { name: "Download ZIP" })
    .click();
  expect((await bundleDownload).suggestedFilename()).toBe("simulation-run.zip");
  await panel.getByRole("button", { name: "Prepare deck" }).click();
  await expect(panel.getByLabel("Prepare Netlist")).toBeVisible();
  await expect(panel.getByLabel("Run Results")).toBeVisible();
  await expect(panel.getByText("Input identity", { exact: true })).toHaveCount(
    0,
  );
  expect(executions).toBe(1);
  await panel.getByRole("button", { name: "Settings" }).click();
  await panel
    .locator('details[aria-label="Output signals settings"] > summary')
    .click();
  await panel.getByLabel(/Output name for/).fill("new-output");
  await panel.getByLabel("Temperature (°C)").fill("30");
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "earlier Project revision",
  );
  await panel.getByRole("button", { name: "Results" }).click();
  await panel.getByRole("tab", { name: "Plot" }).click();
  await expect(
    panel.getByRole("button", { name: "Hide first-output" }),
  ).toHaveCount(2);
  await expect(
    panel.getByRole("button", { name: "Hide new-output" }),
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(2);
  await expect(panel.getByRole("status")).toHaveText("finished · completed");
  await panel.getByRole("tab", { name: "Plot" }).click();
  await expect(panel.locator(".ac-cursor-readout")).toHaveCount(0);
  await transientToolbar.hover();
  await expect(
    transientShell.getByRole("button", { name: "Previous view" }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Hide new-output" }),
  ).toHaveCount(2);
  await panel.getByRole("tab", { name: "Compare" }).click();
  const comparisonRuns = panel.locator(".simulation-comparison-run");
  await expect(comparisonRuns).toHaveCount(2);
  await expect(comparisonRuns.first()).toContainText("Previous 1");
  await expect(comparisonRuns.last()).toContainText("Current");
  await expect(
    comparisonRuns
      .last()
      .getByRole("columnheader", { name: "Maximum" })
      .first(),
  ).toBeVisible();
  await expect(
    comparisonRuns
      .last()
      .getByRole("columnheader", { name: "Minimum" })
      .first(),
  ).toBeVisible();
  await expect(
    comparisonRuns
      .last()
      .getByRole("columnheader", { name: "Peak to peak" })
      .first(),
  ).toBeVisible();
  await expect(comparisonRuns.last()).toContainText(
    "Transient · Transient response",
  );
  await expect(comparisonRuns.last()).not.toContainText("Time-weighted RMS");
  await expect(
    comparisonRuns.getByRole("button", {
      name: "Remove E2E setup from comparison",
    }),
  ).toBeVisible();
  await expect(
    panel.locator(
      ".simulation-waveform-comparison > header > .simulation-comparison-actions",
    ),
  ).toContainText("Keep current");
  await panel.getByRole("button", { name: "Maximize simulation" }).click();
  const previousViewport = page.viewportSize()!;
  for (const [width, height] of [
    [1440, 1080],
    [1920, 1080],
    [1440, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await panel.getByRole("tab", { name: "Compare" }).click();
    const surfaceBox = (await panel.boundingBox())!;
    for (const selector of [
      ".simulation-taskbar",
      ".simulation-results-header",
    ]) {
      const headerBox = (await panel.locator(selector).boundingBox())!;
      expect(headerBox.x).toBeCloseTo(surfaceBox.x, 0);
      expect(headerBox.width).toBeCloseTo(surfaceBox.width, 0);
    }
    const comparisonBox = (await panel
      .locator(".simulation-comparison-view")
      .boundingBox())!;
    expect(comparisonBox.width).toBeLessThan(surfaceBox.width);
    expect(comparisonBox.x + comparisonBox.width / 2).toBeCloseTo(
      surfaceBox.x + surfaceBox.width / 2,
      0,
    );
    const firstComparisonRunBox = (await comparisonRuns.nth(0).boundingBox())!;
    const secondComparisonRunBox = (await comparisonRuns.nth(1).boundingBox())!;
    expect(secondComparisonRunBox.y).toBeCloseTo(firstComparisonRunBox.y, 0);
    expect(secondComparisonRunBox.x).toBeGreaterThan(
      firstComparisonRunBox.x + firstComparisonRunBox.width,
    );
    await panel.getByRole("tab", { name: "Plot" }).click();
    const plotCards = panel.locator(
      ".simulation-plot-view .simulation-output-results > .simulation-analysis-card",
    );
    await expect(plotCards).toHaveCount(3);
    const firstPlotCardBox = (await plotCards.nth(0).boundingBox())!;
    const secondPlotCardBox = (await plotCards.nth(1).boundingBox())!;
    expect(secondPlotCardBox.x).toBeCloseTo(firstPlotCardBox.x, 0);
    expect(secondPlotCardBox.width).toBeCloseTo(firstPlotCardBox.width, 0);
    expect(secondPlotCardBox.y).toBeGreaterThan(
      firstPlotCardBox.y + firstPlotCardBox.height,
    );
    const card = panel
      .locator(".simulation-analysis-card")
      .filter({
        has: page.locator(".ac-view-toolbar"),
      })
      .first();
    await expect
      .poll(() =>
        card
          .locator(".simulation-analysis-card-body")
          .evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(" ").length,
          ),
      )
      .toBe(2);
    const shell = card.locator(".ac-plot-shell").first();
    await expect
      .poll(async () => (await shell.locator("svg").boundingBox())!.height)
      .toBeGreaterThan(280);
    const shellBox = (await shell.boundingBox())!;
    const titleBox = (await card
      .locator(".simulation-analysis-card-header h3")
      .boundingBox())!;
    const modeBox = (await card.locator(".ac-view-toolbar").boundingBox())!;
    expect(titleBox.x + titleBox.width / 2).toBeCloseTo(
      shellBox.x + shellBox.width / 2,
      0,
    );
    expect(modeBox.x).toBeCloseTo(shellBox.x, 0);
    const [resultsHeaderZIndex, plotToolbarZIndex] = await Promise.all([
      panel
        .locator(".simulation-results-header")
        .evaluate((element) => Number(getComputedStyle(element).zIndex)),
      shell
        .locator(".ac-plot-toolbar")
        .evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    expect(resultsHeaderZIndex).toBeGreaterThan(plotToolbarZIndex);
    await expect
      .poll(() =>
        panel
          .locator(".simulation-results-body")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true);
    await panel.locator(".simulation-results-body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(async () => {
        const box = (await shell.boundingBox())!;
        return box.y + box.height;
      })
      .toBeLessThan(height - 30);
    await page.screenshot({
      path: test.info().outputPath(`maximized-${width}-${height}.png`),
    });
  }
  await page.setViewportSize(previousViewport);
  await panel.getByRole("button", { name: "Restore simulation panel" }).click();
  await panel.getByRole("button", { name: "Archive", exact: true }).click();
  await panel.getByRole("tab", { name: "Compare" }).click();
  await expect(
    panel.getByRole("region", { name: "Saved result archives" }),
  ).toContainText("E2E setup");
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
  expect(
    JSON.parse(saved.toString()).simulationSetups[0].input.environment
      .temperatureC,
  ).toBe(30);
  expect(
    JSON.parse(saved.toString()).simulationSetups[0].input.analyses.find(
      (analysis: { kind: string }) => analysis.kind === "tran",
    ),
  ).toEqual({
    kind: "tran",
    stepSeconds: 1e-9,
    stopSeconds: 1e-6,
    maxStepSeconds: 5e-10,
  });
  await page.reload();
  // Explicit import is the persistence contract, not browser recovery heuristics.
  await page.getByTestId("project-file").setInputFiles({
    name: "saved.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await page.getByTestId("open-analog-simulation").click();
  await panel.getByRole("button", { name: "Settings" }).click();
  await expect(panel.getByLabel("Temperature (°C)")).toHaveValue("30");
  await expect(panel.getByLabel("TRAN", { exact: true })).toBeChecked();
  await expect(panel.getByLabel("TRAN step (s)")).toHaveValue("1e-9");
  await expect(panel.getByRole("status")).toHaveText("No run yet");
  await panel.getByRole("button", { name: "Results" }).click();
  await panel.getByRole("tab", { name: "Compare" }).click();
  const savedArchives = panel.getByRole("region", {
    name: "Saved result archives",
  });
  await expect(savedArchives).toContainText("E2E setup");
  await savedArchives.getByRole("button", { name: "Open" }).click();
  await expect(panel.getByRole("status")).toHaveText("finished · completed");
  expect(executions).toBe(3);
});

test("Simulation creates an ordinary testbench and offers the current Cell at the cursor", async ({
  page,
}) => {
  await page.goto("/editor");
  await page
    .locator(".command-menu > summary")
    .filter({ hasText: "Edit" })
    .click();
  await page.getByRole("button", { name: "New Testbench Cell…" }).click();
  const dialog = page.getByRole("dialog", { name: "New Testbench Cell" });
  await expect(dialog.getByLabel("DUT Cell")).toHaveValue("document-main");
  await expect(dialog.getByText("Auto-derived")).toBeVisible();
  await dialog.getByRole("button", { name: "Create Testbench" }).click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const tb = saved.documents.find(
    (d: { name: string }) => d.name === "Main_tb",
  );
  expect(tb.instances[0].netlist.binding).toEqual({
    kind: "subcircuit",
    childDocumentId: "document-main",
  });
  expect(saved.topDocumentId).toBe("document-main");
  expect(saved.simulationSetups).toEqual([]);
  await page.getByTestId("open-analog-simulation").click();
  await expect(page.getByLabel("Testbench Cell")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply setup" }).click();
  const configured = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(configured.simulationSetups[0].input.rootDocumentId).toBe(tb.id);
  const simulationResize = page.getByTestId("simulation-resize-handle");
  const initialWidth = Number(
    await simulationResize.getAttribute("aria-valuenow"),
  );
  expect(initialWidth).toBe(Math.round(page.viewportSize()!.width * 0.4));
  await simulationResize.press("ArrowRight");
  await expect(simulationResize).toHaveAttribute(
    "aria-valuenow",
    String(initialWidth + 8),
  );
  await page.getByRole("button", { name: "Maximize simulation" }).click();
  await expect(page.locator(".app-workspace")).toHaveClass(
    /simulation-maximized/,
  );
  await expect(page.getByTestId("schematic-canvas")).toBeHidden();
  await expect(page.getByTestId("simulation-resize-handle")).toHaveCount(0);
  const maximizedSetup = await page
    .locator(".simulation-setup-panel form")
    .boundingBox();
  expect(maximizedSetup!.width).toBeLessThanOrEqual(960);
  await page.getByRole("button", { name: "Restore simulation panel" }).click();
  await expect(page.locator(".app-workspace")).not.toHaveClass(
    /simulation-maximized/,
  );
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await expect(page.getByTestId("simulation-resize-handle")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toBeDisabled();
  await expect(page.getByTestId("examples-toggle")).toBeDisabled();
  await page.getByRole("button", { name: "Minimize simulation" }).click();
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
  await expect(page.getByTestId("open-analog-simulation")).toContainText(
    "Minimized",
  );
  await page.getByTestId("open-analog-simulation").click();
  await page.getByRole("button", { name: "Exit simulation" }).click();
  const exitConfirmation = page.getByRole("alertdialog");
  await expect(exitConfirmation).toContainText("temporary run files");
  await exitConfirmation.getByRole("button", { name: "Keep working" }).click();
  await expect(
    page.getByRole("region", { name: "Analog simulation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exit simulation" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Exit Simulation" })
    .click();
  await expect(
    page.getByRole("region", { name: "Analog simulation" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("library-toggle")).toBeEnabled();
});

test("Agent raw simulation recovers input errors, returns a run receipt and exports through Files", async ({
  page,
}) => {
  const id = "simulation-e2e",
    secret = "simulation-editor-secret";
  let socket: WebSocketRoute | undefined;
  const replies: Array<{ kind: string; requestId: string; payload: any }> = [];
  let executions = 0;
  let release = () => {};
  const hold = new Promise<void>((r) => (release = r));
  await page.routeWebSocket(`**/api/agent/sessions/${id}/editor`, (s) => {
    socket = s;
    s.onMessage((m) => replies.push(JSON.parse(String(m))));
  });
  await page.route("**/api/agent/sessions**", async (route) => {
    if (
      route.request().method() === "POST" &&
      new URL(route.request().url()).pathname === "/api/agent/sessions"
    ) {
      expect(route.request().postDataJSON().scopes).toContain("simulation.run");
      await route.fulfill({
        json: {
          ok: true,
          session: {
            sessionId: id,
            editorSecret: secret,
            claimCode: `${id}.claim`,
            claimExpiresAt: Date.now() + 300000,
            expiresAt: Date.now() + 3600000,
          },
        },
      });
    } else await route.fulfill({ json: { ok: true, status: "active" } });
  });
  const rawfile = readFileSync(
    new URL(
      "../../../fixtures/ngspice-rawfile/divider-op.raw",
      import.meta.url,
    ),
    "utf8",
  );
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          inputs: ["structured", "raw"],
          analyses: ["op", "ac"],
          parsedAnalyses: ["op", "ac", "tran"],
          profiles: [{ id: profile.id, corners: ["tt"] }],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      });
    executions++;
    await hold;
    const reading = readSimulationData(rawfile);
    if (reading.status !== "read") throw Error("raw fixture");
    await route.fulfill({
      json: {
        outcome: { status: "completed" },
        diagnostics: [],
        log: "ngspice OP",
        durationMs: 1,
        data: reading.data,
        rawfile,
        executedDeck: body.preparedDeck,
        cancelled: false,
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
  await (
    await openMenu(page, "Agent")
  )
    .getByRole("button", { name: "Connect Agent" })
    .click();
  await page.getByTestId("agent-preset-full").click();
  await expect.poll(() => !!socket).toBe(true);
  const send = async (
    kind: "simulation" | "file",
    payload: Record<string, unknown>,
    requestId: string = crypto.randomUUID(),
  ) => {
    const count = replies.filter(
      (r) => r.requestId === requestId && r.kind === `${kind}-response`,
    ).length;
    socket!.send(
      JSON.stringify({
        protocolVersion: "1.0",
        sessionId: id,
        messageId: crypto.randomUUID(),
        requestId,
        sentAt: new Date().toISOString(),
        kind: `${kind}-request`,
        payload: { apiVersion: "2.0", requestId, ...payload },
      }),
    );
    await expect
      .poll(
        () =>
          replies.filter(
            (r) => r.requestId === requestId && r.kind === `${kind}-response`,
          ).length,
      )
      .toBe(count + 1);
    return replies
      .filter((r) => r.requestId === requestId && r.kind === `${kind}-response`)
      .at(-1)!.payload;
  };
  expect(
    await send("simulation", {
      operation: "prepare",
      source: {
        kind: "project-setup",
        setupId: "missing-setup",
        expectedStructureRevision: 0,
      },
    }),
  ).toMatchObject({ ok: false, error: { code: "SIMULATION_SETUP_MISSING" } });
  const workspace = (
    await send("file", {
      operation: "simulation-input",
      input: { action: "create" },
    })
  ).result.workspace;
  await send("file", {
    operation: "simulation-input",
    input: {
      action: "update",
      workspaceId: workspace.id,
      expectedRevision: 0,
      entry: "main.cir",
      writes: [
        {
          path: "main.cir",
          text: "divider\nV1 in 0 1\nR1 in mid 1k\nR2 mid 0 1k\n.op\n.end",
        },
      ],
    },
  });
  const prepared = (
    await send("simulation", {
      operation: "prepare",
      source: {
        kind: "workspace",
        workspaceId: workspace.id,
        expectedRevision: 1,
        environment: { profileId: profile.id },
      },
    })
  ).prepared;
  expect(executions).toBe(0);
  const start = {
    operation: "start",
    preparedId: prepared.id,
    digest: prepared.digest,
  };
  const run = (await send("simulation", start, "start-id")).run;
  expect(run.state).toBe("running");
  expect((await send("simulation", start, "start-id")).run.id).toBe(run.id);
  expect(executions).toBe(1);
  release();
  let finished: any;
  await expect
    .poll(async () => {
      finished = (
        await send("simulation", { operation: "read", runId: run.id })
      ).run;
      return finished.state;
    })
    .toBe("finished");
  expect(finished.result.data.analyses[0].probes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "v(mid)", value: 0.5 }),
    ]),
  );
  const csv = finished.artifacts.find(
    (a: { name: string }) => a.name === "op-0.csv",
  );
  expect(
    (
      await send("file", {
        operation: "simulation-input",
        input: { action: "artifact", artifactId: csv.id },
      })
    ).result.text,
  ).toContain("0.5");
});
