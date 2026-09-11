import {
  readSimulationExperimentConfig,
  type ProjectSimulationSetup,
} from "@icm/model";
import { test, expect } from "@playwright/test";
import { parseProject } from "@icm/project-protocol";

import { downloadBytes, recoveryProjectTexts } from "./editor-fixtures.js";
import { ota, profile, editSimulationFile } from "./simulation-e2e-fixtures.js";
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
  expect(savedSetup?.input.kind).toBe("source");
  if (savedSetup?.input.kind !== "source")
    throw new Error("qualified OTA fixture setup is not source");
  const parsed = readSimulationExperimentConfig(savedSetup);
  if (!parsed.ok) throw Error(parsed.message);
  const originalSetupInput = parsed.config;
  const config = structuredClone(originalSetupInput);
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
        rawfileCollection: "declared-single-ascii",
        maxOutputBytes: 1048576,
        inputs: ["source", "raw"],
        analyses: ["op", "dc", "ac", "tran"],
        parsedAnalyses: ["op", "dc", "ac", "tran"],
        profiles: [
          {
            id: profile.id,
            label: profile.displayName,
            corners: ["tt", "ff", "ss", "fs", "sf"],
            dependencies: [
              { id: profile.models.id, sha256: profile.models.contentSha256 },
            ],
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
  // Canvas picking and authored scoped expressions share the same config file.
  await panel.getByRole("button", { name: "Pick Net", exact: true }).click();
  await page.getByTestId("route-hit-tb-vinp-route").click({ force: true });
  await panel.getByRole("button", { name: "Picking Nets…" }).click();
  await panel
    .getByRole("button", { name: "Pick current", exact: true })
    .click();
  await page.getByTestId("terminal-VINP-+").click();
  await expect(
    page.getByTestId("terminal-VINP-+-current-pick-marker"),
  ).toHaveClass(/origin/u);
  await page.getByTestId("terminal-VINP--").click();
  await panel.getByRole("button", { name: "Picking current…" }).click();
  const pickedProject = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  const pickedConfig = readSimulationExperimentConfig(
    pickedProject.simulationSetups[0]!,
  );
  expect(pickedConfig.ok && pickedConfig.config.outputs.length).toBe(6);
  const circuit = {
    bindingId: savedSetup.input.circuitBindings[0]!.id,
    callPath: [],
  };
  config.outputs.push(
    {
      id: "child-voltage",
      label: "Child input",
      expression: {
        kind: "voltage",
        circuit,
        documentId: "document-ota-5t",
        anchor: { kind: "terminal", instanceId: "PVINP", pinName: "P" },
        occurrence: ["XDUT"],
      },
    },
    {
      id: "supply-current",
      label: "Input current",
      expression: {
        kind: "current",
        circuit,
        documentId: "document-ota-5t-testbench",
        instanceId: "VINP",
        pinName: "+",
        occurrence: [],
      },
    },
    {
      id: "child-current",
      label: "Child current",
      expression: {
        kind: "current",
        circuit,
        documentId: "document-ota-5t",
        instanceId: "I_INTERNAL_PROBE",
        pinName: "+",
        occurrence: ["XDUT"],
      },
    },
  );
  await editSimulationFile(
    page,
    savedSetup.input.configPath,
    JSON.stringify(config, null, 2),
  );
  await panel
    .getByRole("button", { name: "Prepare deck", exact: true })
    .click();
  await expect(panel.getByLabel("Prepare files")).toBeVisible();
  await panel
    .getByRole("button", { name: "prepared.cir", exact: true })
    .click();
  const preview = panel.getByRole("region", { name: "File preview" });
  const download = page.waitForEvent("download");
  await preview.getByRole("button", { name: "Download", exact: true }).click();
  const stream = await (await download).createReadStream();
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
  expect(deck).toContain('.lib "icm-models.lib" tt');
  expect(deck).toContain("tran 2e-8 0.000004");
  expect(executions).toBe(0);
  const saved = await downloadBytes(page, "File", "Export Project File…");
  const reloaded = parseProject(saved.toString());
  expect(
    readSimulationExperimentConfig(reloaded.simulationSetups[0]!),
  ).toMatchObject({ ok: true, config: { outputs: config.outputs } });
  expect(
    reloaded.simulationSetups[0]!.input.files.find(
      (f) => f.path === savedSetup.input.entry,
    )?.text,
  ).toBe(
    savedSetup.input.files.find((f) => f.path === savedSetup.input.entry)?.text,
  );
  await page.reload();
  await page.getByTestId("project-file").setInputFiles({
    name: "reopened.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await page.getByTestId("open-analog-simulation").click();
  await panel.getByRole("button", { name: "More code actions" }).click();
  await panel.getByRole("button", { name: "Advanced configuration" }).click();
  await expect(
    panel.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText(profile.id);
  const reopened = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    readSimulationExperimentConfig(reopened.simulationSetups[0]!),
  ).toMatchObject({ ok: true, config: { outputs: config.outputs } });
});

test("uncommitted source survives reload and an explicit working-copy recovery fork", async ({
  page,
}) => {
  await page.route("**/api/simulate", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "source-recovery.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(ota)),
  });
  await expect.poll(() => recoveryProjectTexts(page)).toContain(ota.id);
  await page.getByTestId("open-analog-simulation").click();
  const panel = page.getByRole("region", { name: "Analog simulation" });
  const editor = panel.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const marker = "* unsaved recovery 🧪";
  await editor.click();
  await editor.press("Control+End");
  await page.keyboard.insertText(`\n${marker}`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage)
          .filter((key) => key.startsWith("icm.code-drafts:"))
          .map((key) => sessionStorage.getItem(key))
          .join("\n"),
      ),
    )
    .toContain(marker);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  const banner = page.getByTestId("startup-recovery-banner");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(banner).toBeHidden();
  await page.getByTestId("hit-XDUT").click();
  await page.getByTestId("open-analog-simulation").click();
  await expect(panel.locator(".cm-activeLine")).toContainText("XDUT");
  await expect(editor).not.toBeFocused();
  await panel.getByRole("tab", { name: "run.cir", exact: false }).click();
  await expect(editor).toContainText(marker);
  const saved = parseProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    saved.simulationSetups[0]!.input.files.some((file) =>
      file.text.includes(marker),
    ),
  ).toBe(true);
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
    activeSetup?.input.kind === "source"
      ? activeSetup.input.circuitBindings[0]?.documentId
      : undefined;
  expect(activeTestbenchId).toBe("document-ota-5t-testbench");
  await page.route("**/api/simulate", async (route) =>
    route.fulfill({
      json: {
        configured: true,
        rawfileCollection: "declared-single-ascii",
        maxOutputBytes: 1048576,
        inputs: ["source", "raw"],
        analyses: ["op", "dc", "ac", "tran"],
        parsedAnalyses: ["op", "dc", "ac", "tran"],
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
  await selector.click();
  page.once(
    "dialog",
    (dialog) => void dialog.accept("OTA OP, DC, AC, and TRAN"),
  );
  await panel.getByRole("button", { name: "Rename…", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("already exists");
  page.once("dialog", (dialog) => void dialog.accept("Bias sweep"));
  await panel.getByRole("button", { name: "Rename…", exact: true }).click();
  await expect(selector).toContainText("Bias sweep");
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
    )?.input.circuitBindings[0]?.documentId,
  ).toBe(activeTestbenchId);
  expect(
    new Set(
      saved.simulationSetups.map(
        (setup: ProjectSimulationSetup) =>
          setup.input.circuitBindings[0]?.documentId,
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
