import { test, expect } from "@playwright/test";
import { parseProject } from "@icm/project-protocol";

import {
  clickNetlistWorkflowCommand,
  downloadBytes,
} from "./editor-fixtures.js";
import { ota, profile } from "./simulation-e2e-fixtures.js";
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
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
