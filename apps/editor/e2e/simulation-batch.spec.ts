import {
  createSimulationFolder,
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
} from "@icm/model";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
} from "@icm/spice-run";
import { parseProject } from "@icm/project-protocol";

import { clickNetlistWorkflowCommand } from "./editor-fixtures.js";
import { ota, profile, editSimulationFile } from "./simulation-e2e-fixtures.js";
test("a saved-folder batch prepares first and exposes each ordinary run", async ({
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
  project.simulationFolders = ["TT", "FF"].map((name) => {
    const folder = createSimulationFolder({
      id: "folder-" + name.toLowerCase(),
      name,
      profileId: profile.id,
    });
    folder.input.files.find((f) => f.path === folder.input.entry)!.text = deck;
    return folder;
  });
  let executions = 0;
  await page.route("**/api/simulate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "capabilities")
      return route.fulfill({
        json: {
          configured: true,
          rawfileCollection: "declared-single-ascii",
          maxOutputBytes: 1048576,
          inputs: ["structured", "raw"],
          analyses: ["op", "dc", "ac", "tran", "noise"],
          parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("treeitem", { name: "Folder TT", exact: true }).click();
  await panel
    .getByRole("treeitem", { name: "Folder FF", exact: true })
    .click({ modifiers: ["Control"] });
  await panel
    .getByRole("treeitem", { name: "Folder FF", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Run selected folders (2)" })
    .click();
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
    panel.getByRole("treeitem", { name: "Folder FF", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Run", exact: true }),
  ).toHaveAttribute("title", "Run FF");
  await expect(panel.getByRole("status").first()).toContainText(
    "Batch finished",
  );
});

test("a saved Run Plan prepares without executing and Run starts its ordinary batch", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  let folder = project.simulationFolders[0]!;
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok) throw Error(parsed.message);
  const config = parsed.config;
  config.outputs = [];
  config.runPlan = {
    mode: "sweep",
    axes: [
      { kind: "variable", variableId: "input-level", values: ["0.89", "0.9"] },
    ],
  };
  config.variables = [
    {
      id: "input-level",
      name: "VIN",
      sourcePath: folder.input.entry,
      bindings: [
        {
          documentId: project.topDocumentId,
          instanceId: "VINP",
          parameter: "low",
        },
      ],
    },
  ];
  folder = replaceSimulationExperimentConfig(folder, config);
  folder.input.files.find((f) => f.path === folder.input.entry)!.text =
    '* Run plan\n.param VIN=0.9\n.include "circuit.spice"\n.control\nset filetype=ascii\nop\nwrite out.raw\n.endc\n.end\n';
  project.simulationFolders = [folder];
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
          rawfileCollection: "declared-single-ascii",
          maxOutputBytes: 1048576,
          inputs: ["structured", "raw"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  const panel = page.getByRole("region", { name: "Analog simulation" });
  config.runPlan = {
    mode: "sweep",
    axes: [
      { kind: "variable", variableId: "input-level", values: ["0.89", "0.9"] },
      { kind: "temperature", values: [-20, 0, 25.5] },
    ],
  };
  await editSimulationFile(
    page,
    "experiment.json",
    JSON.stringify(config, null, 2),
  );
  await panel.getByRole("button", { name: "More code actions" }).click();
  await page.getByRole("menuitem", { name: "View final deck" }).click();
  await panel.getByTitle("Batch queue", { exact: true }).click();
  await expect(panel.locator(".simulation-batch-menu-popover")).toContainText(
    "Batch · prepared",
  );
  await expect(panel.getByLabel("Prepare temporary files")).toBeVisible();
  expect(executions).toBe(0);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.locator(".simulation-batch-menu-popover")).toContainText(
    "Batch · finished",
  );
  expect(executions).toBe(6);
});
