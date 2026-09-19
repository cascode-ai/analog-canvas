import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { normalizeImportedProject } from "../src/document/project-import-normalization";
import { downloadBytes } from "./editor-fixtures.js";
import {
  agentNativeProfile,
  createAgentNativeExecutor,
} from "./native-simulation-executor.mjs";

for (const [profileId, engine] of [
  [undefined, "vacask"],
  ["native-service-profile", "vacask"],
  ["ngspice-service-profile", "ngspice"],
] as const) {
  test(`GUI creates ${engine} experiments with ${profileId ?? "offline candidate"} identity`, async ({
    page,
  }) => {
    const project = parseProject(
      await readFile(
        "apps/editor/src/examples/simulation-rc.icproj.json",
        "utf8",
      ),
    );
    project.simulationFolders = [];
    await page.route("**/api/simulate", (route) =>
      route.fulfill({
        json: {
          configured: profileId !== undefined,
          rawfileCollection:
            engine === "vacask"
              ? "native-multi-ascii"
              : "declared-single-ascii",
          inputs: ["source"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: profileId
            ? [{ id: profileId, engine, corners: [], dependencies: [] }]
            : [],
          maxTimeoutMs: 15000,
          maxInputBytes: 1048576,
          cancel: true,
        },
      }),
    );
    await page.goto("/editor");
    await page.getByTestId("project-file").setInputFiles({
      name: "no-experiments.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByTestId("open-analog-simulation").click();
    const panel = page.getByRole("region", { name: "Analog simulation" });
    await panel
      .getByRole("button", { name: "Set up manually", exact: true })
      .click();
    const name = panel.getByRole("textbox", {
      name: "New simulation folder name",
    });
    await name.fill("Native first experiment");
    await name.press("Enter");
    await expect(
      panel.getByRole("treeitem", {
        name: "Folder Native first experiment",
        exact: true,
      }),
    ).toBeVisible();
    const saved = parseProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(),
    );
    const folder = saved.simulationFolders[0]!;
    const config = JSON.parse(
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text,
    );
    expect(config).toEqual({
      version: 2,
      environment: { profileId: profileId ?? "vacask-sky130-candidate" },
    });
    const entry = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    )!.text;
    if (engine === "vacask") {
      expect(entry).toContain("analysis op op");
      expect(entry).not.toContain(".control");
    } else {
      expect(entry).toContain(".control");
      expect(entry).not.toContain("analysis op op");
    }
  });
}

// Real Canvas compilation + human Run + native process + portable Project.
// The local HTTP seam is test-owned, not a cloud/deployment acceptance.
test("GUI imports a Canvas-bound project, runs native AC, exports and reloads it", async ({
  page,
}) => {
  test.skip(
    process.env.ICM_E2E_VACASK_REAL !== "1",
    "Requires explicit native executable and modules",
  );
  test.setTimeout(120000);
  const project = parseProject(
    await readFile(
      "apps/editor/src/examples/simulation-rc.icproj.json",
      "utf8",
    ),
  );
  const folder = project.simulationFolders.find((f) => f.id === "rc-lp-ac")!;
  project.simulationFolders = [folder];
  const configFile = folder.input.files.find(
    (f) => f.path === folder.input.configPath,
  )!;
  configFile.text = JSON.stringify({
    version: 2,
    environment: { profileId: agentNativeProfile },
  });
  const sourceFile = folder.input.files.find(
    (f) => f.path === folder.input.entry,
  )!;
  // This focused GUI test needs no Python. It retains Canvas R/C/source values
  // and the authored AC sweep; only the optional derived Gain report is omitted.
  sourceFile.text = sourceFile.text.replace(
    /^postprocess\(PYTHON,.*\)\r?\n/mu,
    "",
  );
  sourceFile.text = sourceFile.text.replace(
    "analysis ",
    "analysis bias op\nanalysis ",
  );
  const direct = process.env.ICM_E2E_NATIVE_TRANSPORT === "vite";
  const executor = direct ? undefined : await createAgentNativeExecutor();
  let environment = executor?.environment;
  if (direct) {
    if (!process.env.ICM_SIMULATION_URL)
      throw new Error(
        "Vite transport requires ICM_SIMULATION_URL; no intercepted fallback.",
      );
    const health = await fetch(`${process.env.ICM_SIMULATION_URL}/health`);
    expect(health.status).toBe(200);
    environment = (await health.json()).environment;
    expect(environment?.simulator.name).toBe("vacask");
    expect(environment?.profileId).toBe(agentNativeProfile);
  }
  let executions = 0;
  const results: Awaited<
    ReturnType<Awaited<ReturnType<typeof createAgentNativeExecutor>>["execute"]>
  >[] = [];
  try {
    if (direct)
      page.on("response", async (response) => {
        if (new URL(response.url()).pathname !== "/api/simulate") return;
        const input = response.request().postDataJSON();
        if (input.operation !== undefined) return;
        results.push(await response.json());
        executions++;
      });
    else
      await page.route("**/api/simulate", async (route) => {
        const input = route.request().postDataJSON();
        if (input.operation === "capabilities")
          return route.fulfill({ json: executor!.capabilities });
        expect(input.language).toBe("vacask");
        expect(
          input.files.find((f: { path: string }) => f.path === "circuit.spice"),
        ).toBeTruthy();
        const result = await executor!.execute(input);
        results.push(result);
        executions++;
        return route.fulfill({ json: result });
      });
    await page.goto("/editor");
    await page.getByTestId("project-file").setInputFiles({
      name: "native-rc.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.getByTestId("open-analog-simulation").click();
    const panel = page.getByRole("region", { name: "Analog simulation" });
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(() => executions, { timeout: 45000 }).toBe(1);
    await expect(panel.getByRole("status")).toHaveText("completed");
    await expect(
      panel.getByRole("heading", { name: "AC Analysis" }),
    ).toBeVisible();
    const ac = results[0]!.data!.analyses.find((a) => a.analysis === "ac")!;
    expect(ac.frequencyHz).toHaveLength(401);
    expect(ac.probes.some((p) => p.name === "out")).toBe(true);
    expect(results[0]!.metadata!.environment).toEqual(environment);
    await panel
      .getByRole("tab", { name: "Operating Point", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Show on canvas", exact: true }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "Show on canvas", exact: true })
      .click();
    await expect(page.getByTestId("operating-point-badges")).toContainText("V");
    const bytes = await downloadBytes(page, "File", "Export Project File…");
    const saved = parseProject(bytes.toString());
    expect(saved.documents).toEqual(
      normalizeImportedProject(
        project,
        createProjectSymbolResolver(project, builtInSymbols),
      ).project.documents,
    );
    expect(saved.simulationFolders[0]!.input.circuitBindings).toEqual(
      folder.input.circuitBindings,
    );
    expect(
      saved.simulationFolders[0]!.input.files.find(
        (f) => f.path === folder.input.entry,
      )!.text,
    ).toBe(sourceFile.text);
    await page.reload();
    await page.getByTestId("project-file").setInputFiles({
      name: "reloaded-native.icproj.json",
      mimeType: "application/json",
      buffer: bytes,
    });
    await page.getByTestId("open-analog-simulation").click();
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(() => executions, { timeout: 45000 }).toBe(2);
    await expect(panel.getByRole("status")).toHaveText("completed");
    expect(results[1]!.data).toEqual(results[0]!.data);
    await test.info().attach("native-gui-run-evidence", {
      body: Buffer.from(
        JSON.stringify({
          transport: direct ? "vite" : "intercepted-native",
          environment,
          results,
        }),
      ),
      contentType: "application/json",
    });
  } finally {
    await executor?.close();
  }
});
