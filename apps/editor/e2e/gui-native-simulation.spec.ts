import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { normalizeImportedProjectConductors } from "../src/document/project-conductor-normalization";
import { downloadBytes } from "./editor-fixtures.js";
import {
  agentNativeProfile,
  createAgentNativeExecutor,
} from "./native-simulation-executor.mjs";

for (const profileId of [undefined, "native-service-profile"]) {
  test(`GUI creates native experiments with ${profileId ?? "offline candidate"} identity`, async ({
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
          rawfileCollection: "native-multi-ascii",
          inputs: ["source"],
          analyses: ["op"],
          parsedAnalyses: ["op"],
          profiles: profileId
            ? [{ id: profileId, corners: [], dependencies: [] }]
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
    await panel.getByRole("button", { name: "Set up", exact: true }).click();
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
    expect(entry).toContain("analysis");
    expect(entry).not.toContain(".control");
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
  const executor = await createAgentNativeExecutor();
  let executions = 0;
  const results: Awaited<ReturnType<typeof executor.execute>>[] = [];
  try {
    await page.route("**/api/simulate", async (route) => {
      const input = route.request().postDataJSON();
      if (input.operation === "capabilities")
        return route.fulfill({ json: executor.capabilities });
      expect(input.language).toBe("vacask");
      expect(
        input.files.find((f: { path: string }) => f.path === "circuit.spice"),
      ).toBeTruthy();
      const result = await executor.execute(input);
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
    expect(results[0]!.metadata!.environment).toEqual(executor.environment);
    const bytes = await downloadBytes(page, "File", "Export Project File…");
    const saved = parseProject(bytes.toString());
    expect(saved.documents).toEqual(
      normalizeImportedProjectConductors(
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
  } finally {
    await executor.close();
  }
});
