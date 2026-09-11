import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { strFromU8, unzipSync } from "fflate";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";
import {
  createSourceSimulationSetup,
  readSimulationExperimentConfig,
  replaceSimulationExperimentConfig,
} from "@icm/model";
import { parseProject } from "@icm/project-protocol";

import {
  clickNetlistWorkflowCommand,
  downloadBytes,
} from "./editor-fixtures.js";
import { ota, profile, editSimulationFile } from "./simulation-e2e-fixtures.js";

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
test("human simulation uses saved setup, survives minimizing, recovers a bad input and exports results", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const project = parseProject(JSON.stringify(ota));
  let setup = createSourceSimulationSetup({
    id: "setup-e2e",
    name: "E2E setup",
    profileId: profile.id,
    documentId: project.topDocumentId,
  });
  const parsed = readSimulationExperimentConfig(setup);
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
  setup = replaceSimulationExperimentConfig(setup, config);
  project.simulationSetups = [setup];
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  const panel = page.getByRole("region", { name: "Analog simulation" });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(/PROBE|probe/);
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
    setup.input.configPath,
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
    "write out.raw",
    "noise v(vout) VINP dec 10 1 1e6",
    "write out.raw",
    ".endc",
    ".end",
    "",
  ].join("\n");
  await editSimulationFile(page, setup.input.entry, program);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => executions).toBe(1);
  await panel.getByRole("button", { name: "Minimize simulation" }).click();
  expect(cancellations).toBe(0);
  release();
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(panel.getByRole("status")).toHaveText("finished · completed");
  // A completed run belongs to its setup, not whichever setup is currently visible.
  await panel.getByTitle("Simulation setup", { exact: true }).click();
  await panel.getByRole("button", { name: "New setup", exact: true }).click();
  await panel.getByRole("button", { name: /Run current Cell/ }).click();
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
  await panel.getByRole("tab", { name: "Results", exact: true }).click();
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
  await panel.getByRole("button", { name: "Maximize results" }).click();
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
  await expect(panel.locator(".ac-response .ac-trace").first()).toHaveCSS(
    "stroke-width",
    "2.4px",
  );
  await expect(panel.locator(".ac-response .ac-axis-label").first()).toHaveCSS(
    "fill",
    "rgb(52, 64, 84)",
  );
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
  await panel.getByRole("button", { name: "Restore results" }).click();
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await panel.getByRole("button", { name: "Maximize results" }).click();
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
  await panel.getByRole("button", { name: "Restore results" }).click();
  config.outputs[0]!.label = "new-output";
  await editSimulationFile(
    page,
    setup.input.configPath,
    JSON.stringify(config, null, 2),
  );
  await editSimulationFile(
    page,
    setup.input.entry,
    program.replace(".control", ".temp 30\n.control"),
  );
  await downloadBytes(page, "File", "Export Project File…");
  await expect(panel.getByRole("alert")).toContainText(
    "earlier Project revision",
  );
  await panel.getByRole("tab", { name: "Results", exact: true }).click();
  await panel.getByRole("button", { name: "Maximize results" }).click();
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
  await expect(page.locator(".app-workspace")).toHaveClass(
    /simulation-maximized/,
  );
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
    await expect
      .poll(async () => {
        const [first, second] = await Promise.all([
          plotCards.nth(0).boundingBox(),
          plotCards.nth(1).boundingBox(),
        ]);
        if (!first || !second) return null;
        return {
          sameColumn: Math.abs(second.x - first.x) < 1,
          sameWidth: Math.abs(second.width - first.width) < 1,
          verticallySeparated: second.y > first.y + first.height,
        };
      })
      .toEqual({
        sameColumn: true,
        sameWidth: true,
        verticallySeparated: true,
      });
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
  await panel.getByRole("button", { name: "Restore results" }).click();
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
  const reopenedSetup = parseProject(saved.toString()).simulationSetups[0]!;
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
  await panel.getByRole("tab", { name: "Results", exact: true }).click();
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
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(page.getByLabel("Testbench Cell")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create experiment for this Cell" })
    .click();
  await page.getByRole("button", { name: /Run current Cell/ }).click();
  const configured = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    configured.simulationSetups[0].input.circuitBindings[0].documentId,
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
  await expect(page.getByTestId("simulation-resize-handle")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Simulation Code workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore simulation panel" }).click();
  await expect(page.locator(".app-workspace")).not.toHaveClass(
    /simulation-maximized/,
  );
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
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
