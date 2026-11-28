import { readFileSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";
import {
  createSimulationFolder,
  type ProjectSimulationFolder,
} from "@icm/model";
import {
  createSimulationEnvironmentMetadata,
  createSimulationInputMetadata,
  readSimulationData,
} from "@icm/spice-run";
import { downloaded, exampleProject, openProject } from "./editor-fixtures.js";

export const profile = JSON.parse(
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
  models: {
    id: string;
    contentSha256: string;
    library: { runtimePath: string };
  };
  /** The devices the worker advertises, which a new folder's default reads. */
  qualifiedScope: { devices: string[] };
};

export const ota = JSON.parse(
  readFileSync(
    new URL(
      "../../../netlists/native-ota-library/legacy-source.icproj.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

/** ngspice's captured OP of a two-resistor divider (`v(mid)` = 0.5 V). */
export const dividerOpRawfile = readFileSync(
  new URL("../../../fixtures/ngspice-rawfile/divider-op.raw", import.meta.url),
  "utf8",
);

/**
 * The capabilities a configured service advertises: one ngspice Profile with
 * the hosted SKY130 identity, running the given analyses.
 */
export function ngspiceCapabilities(analyses: string[] = ["op"]) {
  return {
    configured: true,
    rawfileCollection: "declared-single-ascii",
    maxOutputBytes: 1048576,
    inputs: ["structured", "raw"],
    analyses,
    parsedAnalyses: analyses,
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
  };
}

/**
 * The simulation service's answer to one execution request: a completed run
 * that returns the captured divider OP rawfile. Only the simulator is a fixture.
 */
export async function completedNgspiceRun(body: {
  preparedDeck: string;
  inputRevision: string;
  netlist: string;
  testbench: string;
}) {
  const rawfile = dividerOpRawfile;
  const reading = readSimulationData(rawfile);
  if (reading.status !== "read") throw Error("Invalid rawfile fixture");
  return {
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
  };
}

/** Open a Project in the editor, enter Analog simulation and return its panel. */
export async function openSimulation(
  page: Page,
  project: object,
  name?: string,
): Promise<Locator> {
  await openProject(page, project, name);
  await page.getByTestId("open-analog-simulation").click();
  return page.getByRole("region", { name: "Analog simulation" });
}

/** The simulation source editor within this page or region. */
export function sourceEditor(scope: Page | Locator): Locator {
  return scope.getByRole("textbox", { name: "Simulation source editor" });
}

/** Open the source Helper in this page or region and choose one entry. */
export async function chooseHelperEntry(
  scope: Page | Locator,
  name: string,
): Promise<void> {
  await scope.getByRole("button", { name: "Helper", exact: true }).click();
  await scope.getByRole("option", { name, exact: true }).click();
}

/** A folder's file at this path, its entry source by default. */
export function folderFile(
  folder: ProjectSimulationFolder,
  path = folder.input.entry,
) {
  return folder.input.files.find((file) => file.path === path)!;
}

/** The bytes of the file that clicking this control downloads. */
export function downloadClicked(target: Locator): Promise<Buffer> {
  return downloaded(target.page(), () => target.click());
}

/**
 * Answer capability requests with these capabilities and abort every other
 * simulation request; returns the number of aborted runs so far.
 */
export async function abortRunsOffering(
  page: Page,
  capabilities: object,
): Promise<() => number> {
  let executions = 0;
  await page.route("**/api/simulate", (route) => {
    if (route.request().postDataJSON().operation !== "capabilities") {
      executions++;
      return route.abort();
    }
    return route.fulfill({ json: capabilities });
  });
  return () => executions;
}

/** The RC simulation example Project as the editor ships it. */
export const rcExample = () => exampleProject("simulation-rc.icproj.json");

/** The RC example with one ngspice divider folder for scripted simulation E2E. */
export async function ngspiceDividerProject(id: string, name: string) {
  const project = rcExample();
  const folder = createSimulationFolder({
    id,
    name,
    profileId: profile.id,
    engine: "ngspice",
  });
  folder.input.entry = "run.cir";
  folder.input.circuitBindings = [];
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: profile.id },
      }),
    },
    {
      path: "run.cir",
      text: [
        "Divider OP",
        "V1 in 0 DC 1",
        "R1 in mid 1k",
        "R2 mid 0 1k",
        ".control",
        "set filetype=ascii",
        "op",
        "write divider.raw v(in) v(mid) i(v1)",
        ".endc",
        ".end",
        "",
      ].join("\n"),
    },
  ];
  project.simulationFolders = [folder];
  return project;
}

export async function editSimulationFile(
  page: Page,
  path: string,
  text: string,
) {
  const panel = page.getByRole("region", { name: "Analog simulation" });
  if (path === "experiment.json") {
    if (
      (await panel
        .getByRole("button", { name: "Explorer", exact: true })
        .getAttribute("aria-expanded")) !== "true"
    )
      await panel
        .getByRole("button", { name: "Explorer", exact: true })
        .click();
    const folderId = await panel
      .getByRole("treeitem", { name: "Run", exact: true })
      .getAttribute("data-folder-id");
    await panel
      .getByRole("treeitem", { name: "experiment.json", exact: true })
      .and(panel.locator(`[data-folder-id="${folderId}"]`))
      .click();
  } else await panel.getByRole("tab", { name: path, exact: false }).click();
  const editor = sourceEditor(panel);
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
}
