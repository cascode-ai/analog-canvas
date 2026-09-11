import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
} from "../packages/model/dist/index.js";
import {
  generateCircuitSource,
  compileSourceSimulation,
} from "../packages/netlist/dist/index.js";
import { verifyPreviewCandidate } from "./lib/preview-candidate.mjs";
import {
  validateHostedSky130NoiseResult,
  validateHostedSky130Result,
} from "./preview-simulation-smoke.mjs";

const { unzipSync } = createRequire(
  new URL("../apps/editor/package.json", import.meta.url),
)("fflate");

// No intercepted simulation response, private browser state, or direct run API:
// bootstrap with a portable Project, then author/run/export through the GUI.
const baseUrl = new URL(
  process.argv[2] ?? "https://analog-canvas-preview.tokenzhang.com",
);
const outputDirectory = resolve(
  process.env.ICM_GUI_ACCEPTANCE_OUTPUT_DIR ??
    "test-results/preview-source-gui",
);
const fixtureText = await readFile(
  new URL(
    "../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json",
    import.meta.url,
  ),
  "utf8",
);
const project = parseProject(fixtureText);
const folder = project.simulationFolders[0];
const parsed = readSimulationExperimentConfig(folder);
assert(parsed.ok);
const config = parsed.config;
const binding = folder.input.circuitBindings.find(
  (item) => item.emission === "top-level",
);
assert(binding);
const generated = generateCircuitSource(project, binding);
assert(generated.ok);
const parameter = generated.source.parameters.find(
  (item) => item.descriptor.displayRole === "width",
);
assert(parameter);
const program =
  folder.input.files
    .find((file) => file.path === folder.input.entry)
    .text.replace(
      ".endc",
      "noise v(vout) VINP dec 20 1 1000000000\nwrite out.raw noise1.all noise2.all\n.endc",
    ) + "\n* Source workspace GUI acceptance\n";
config.deviceOperatingPoints = ["M1", "M3"].map((instanceId) => ({
  id: `gui-op-${instanceId}`,
  documentId: "document-ota-5t",
  instanceId,
  occurrence: ["XDUT"],
  circuit: { bindingId: binding.id, callPath: [] },
}));
const qualified = replaceSimulationExperimentConfig(
  structuredClone(folder),
  config,
);
qualified.input.files.find((file) => file.path === folder.input.entry).text =
  program;
const compiled = compileSourceSimulation(project, qualified);
assert(compiled.ok);
await mkdir(outputDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  target: baseUrl.origin,
  fixture: "sky130-ota-5t",
  startedAt: new Date().toISOString(),
  downloads: [],
};
let browser;
let page;
let panel;
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function edit(path, text) {
  if (path === folder.input.configPath) {
    await panel.getByRole("button", { name: "More code actions" }).click();
    await page
      .getByRole("menuitem", { name: "Advanced configuration" })
      .click();
  } else await panel.getByRole("tab", { name: path, exact: false }).click();
  const editor = panel.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
}
async function download(button, name) {
  const pending = page.waitForEvent("download", { timeout: 90_000 });
  await button.click();
  const file = await pending;
  const path = join(outputDirectory, name ?? file.suggestedFilename());
  await file.saveAs(path);
  const bytes = await readFile(path);
  report.downloads.push({
    name: basename(path),
    bytes: bytes.length,
    sha256: digest(bytes),
  });
  return bytes;
}
async function exportProject(name) {
  await page
    .locator("summary")
    .filter({ hasText: /^File$/u })
    .click();
  return parseProject(
    (
      await download(
        page.getByRole("button", { name: "Export Project File…", exact: true }),
        name,
      )
    ).toString(),
  );
}
function entryFromZip(entries, name) {
  const value = Object.entries(entries).find(
    ([path]) => basename(path) === name,
  )?.[1];
  assert(value, `Missing exported ${name}`);
  return Buffer.from(value).toString();
}
try {
  report.candidate = await verifyPreviewCandidate(baseUrl);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(new URL("/editor", baseUrl).href);
  await page.getByTestId("project-file").setInputFiles({
    name: "sky130-ota-5t.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(fixtureText),
  });
  await page
    .locator("summary")
    .filter({ hasText: /^Netlist$/u })
    .click();
  await page.getByTestId("open-analog-simulation").click();
  panel = page.getByRole("region", { name: "Analog simulation" });
  await expect(
    panel.getByRole("tab", { name: "Configuration", exact: true }),
  ).toHaveCount(0);

  const source = generated.source.text;
  const changed =
    source.slice(0, parameter.startOffset) +
    String(Number(parameter.rawValue) * 1.1) +
    source.slice(parameter.endOffset);
  await edit(binding.path, changed);
  const changedProject = await exportProject("resized.icproj.json");
  const changedValue = changedProject.documents
    .find((d) => d.id === parameter.documentId)
    .instances.find((i) => i.id === parameter.instanceId).netlist.parameters[
    parameter.parameter
  ];
  assert.notEqual(
    changedValue,
    parameter.originalValue,
    "Generated parameter text did not reach Canvas",
  );
  await edit(binding.path, source);
  const restoredProject = await exportProject("restored.icproj.json");
  const restoredValue = restoredProject.documents
    .find((d) => d.id === parameter.documentId)
    .instances.find((i) => i.id === parameter.instanceId).netlist.parameters[
    parameter.parameter
  ];
  const restoredSource = generateCircuitSource(restoredProject, binding);
  assert(restoredSource.ok);
  assert.equal(restoredSource.source.text, source);
  report.mappedEdit = {
    documentId: parameter.documentId,
    instanceId: parameter.instanceId,
    parameter: parameter.parameter,
    changedValue,
    restoredValue,
  };

  await edit(folder.input.configPath, JSON.stringify(config, null, 2));
  await edit(
    folder.input.entry,
    program.replace(
      ".control",
      '.include "missing-gui-acceptance.spice"\n.control',
    ),
  );
  await panel.getByRole("button", { name: "More code actions" }).click();
  await page.getByRole("menuitem", { name: "View final deck" }).click();
  await expect(panel).toContainText("missing-gui-acceptance.spice", {
    timeout: 30_000,
  });
  await edit(folder.input.entry, program);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Cancel run", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Cancel run", exact: true }),
  ).toHaveCount(0, { timeout: 240_000 });
  await expect(
    panel.getByRole("tab", { name: "Results", exact: true }),
  ).toHaveCount(0);
  await panel.getByRole("tab", { name: "Files", exact: true }).click();
  await panel.getByRole("button", { name: "Maximize results" }).click();
  const preparedEntries = unzipSync(
    await download(
      panel
        .getByLabel("Prepare files", { exact: true })
        .getByRole("button", { name: "Download ZIP" }),
      "prepare.zip",
    ),
  );
  const runEntries = unzipSync(
    await download(
      panel
        .getByLabel("Run files", { exact: true })
        .getByRole("button", { name: "Download ZIP" }),
      "run.zip",
    ),
  );
  const input = JSON.parse(entryFromZip(preparedEntries, "prepared.json"));
  const result = JSON.parse(entryFromZip(runEntries, "result.json"));
  const outputs = JSON.parse(entryFromZip(runEntries, "outputs.json"));
  assert.equal(
    result.outcome.status,
    "completed",
    JSON.stringify(result.outcome),
  );
  report.numerical = validateHostedSky130Result(
    result,
    "operator-host",
    input.inputRevision,
    compiled.vectors,
    input,
  );
  report.noise = validateHostedSky130NoiseResult(
    result,
    "operator-host",
    input.inputRevision,
    compiled.vectors,
    input,
  );
  assert(outputs.measurements.length > 0);
  assert.equal(outputs.deviceOperatingPoints.length, 2);
  assert(
    outputs.analyses.some((record) =>
      record.outputs.some((output) => output.label),
    ),
  );
  assert(
    entryFromZip(preparedEntries, "prepared.cir").includes("noise v(vout)"),
  );
  assert(entryFromZip(runEntries, "out.raw").includes("Plotname:"));
  assert(Object.keys(runEntries).some((path) => path.endsWith(".csv")));
  report.inputRevision = input.inputRevision;
  report.environment = result.metadata.environment;
  report.recoveredInputError = true;

  await panel.getByRole("tab", { name: "Plot", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "AC Analysis" }),
  ).toBeVisible();
  const plotExport = panel.locator("details.simulation-result-export");
  await plotExport.locator("summary").click();
  await download(
    plotExport.getByRole("button", { name: "Visible plots · SVG" }),
    "plots-svg.zip",
  );
  await download(
    plotExport.getByRole("button", { name: "Visible plots · PNG" }),
    "plots-png.zip",
  );
  await plotExport.locator("summary").click();
  await page.screenshot({ path: join(outputDirectory, "results.png") });
  await panel.getByRole("button", { name: "Restore results" }).click();

  config.runPlan = {
    mode: "sweep",
    axes: [{ kind: "temperature", values: [27, 28] }],
  };
  await edit(folder.input.configPath, JSON.stringify(config, null, 2));
  await panel.getByRole("button", { name: "More code actions" }).click();
  await page.getByRole("menuitem", { name: "View final deck" }).click();
  await panel.getByTitle("Batch queue", { exact: true }).click();
  await expect(panel.locator(".simulation-batch-menu-popover")).toContainText(
    "Batch · prepared",
  );
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    panel.getByTitle("Batch queue", { exact: true }),
  ).toHaveAttribute("aria-label", "Batch queue: finished, 2 of 2 finished", {
    timeout: 300_000,
  });
  report.batch = { state: "finished", points: 2, temperatures: [27, 28] };
  const saved = await exportProject("source-workspace.icproj.json");
  assert(
    saved.simulationFolders
      .find((item) => item.id === folder.id)
      .input.files.some((file) =>
        file.text.includes("Source workspace GUI acceptance"),
      ),
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByTestId("startup-recovery-banner")
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: /^Netlist$/u })
    .click();
  await page.getByTestId("open-analog-simulation").click();
  await expect(
    panel.getByRole("textbox", { name: "Simulation source editor" }),
  ).toContainText("Source workspace GUI acceptance");
  report.saveReload = true;
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  if (page) {
    await page
      .screenshot({ path: join(outputDirectory, "failure.png") })
      .catch(() => {});
    await writeFile(
      join(outputDirectory, "failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => "Page unavailable"),
    );
  }
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(
    join(outputDirectory, "acceptance-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser?.close();
}
