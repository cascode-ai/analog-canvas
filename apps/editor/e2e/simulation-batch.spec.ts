import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import { parseProject } from "@icm/project-protocol";

import { ota, profile } from "./simulation-e2e-fixtures.js";
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
  await panel.getByTitle("Batch queue", { exact: true }).click();
  const batch = panel.locator(".simulation-batch-menu-popover");
  await expect(batch).toContainText("Batch · finished");
  await expect(
    batch.getByRole("button", { name: /TT finished/ }),
  ).toBeEnabled();
  await expect(
    batch.getByRole("button", { name: /FF finished/ }),
  ).toBeEnabled();
  expect(executions).toBe(2);
  await batch.getByRole("button", { name: /FF finished/ }).click();
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
  const runPlan = panel.getByLabel("Run Plan settings");
  await runPlan.locator(":scope > summary").click();
  await runPlan
    .getByRole("button", { name: "Temperature", exact: true })
    .click();
  const temperatures = runPlan.getByLabel("Run Plan temperatures");
  await expect(temperatures).toHaveValue("-40, 27, 125");
  await temperatures.fill("");
  await expect(temperatures).toHaveValue("");
  await temperatures.fill("-20, nope");
  await temperatures.press("Enter");
  await expect(temperatures).toHaveValue("-20, nope");
  await expect(runPlan.getByRole("alert")).toContainText("finite number");
  await temperatures.fill("-20, 0, 25.5");
  await temperatures.press("Enter");
  await expect(temperatures).toHaveValue("-20, 0, 25.5");
  await panel.getByRole("button", { name: "Apply setup" }).click();
  await panel.getByRole("button", { name: "Prepare deck" }).click();
  await panel.getByTitle("Batch queue", { exact: true }).click();
  await expect(panel.locator(".simulation-batch-menu-popover")).toContainText(
    "Batch · prepared",
  );
  await expect(panel.getByLabel("Prepare files")).toBeVisible();
  expect(executions).toBe(0);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.locator(".simulation-batch-menu-popover")).toContainText(
    "Batch · finished",
  );
  expect(executions).toBe(6);
});
