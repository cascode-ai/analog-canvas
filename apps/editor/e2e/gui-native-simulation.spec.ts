import { test, expect } from "@playwright/test";
import type { parseProject } from "@icm/project-protocol";
import { exportedProject } from "./editor-fixtures.js";
import { createAgentNativeExecutor } from "./native-simulation-executor.mjs";
import {
  folderFile,
  nativeRcProject,
  openSimulation,
  rcExample,
} from "./simulation-e2e-fixtures.js";

test("GUI retains the sign-in failure after a rejected run is read again", async ({
  page,
}) => {
  const project = await nativeRcProject("sign-in-rejected", "Sign-in rejected");
  const executor = await createAgentNativeExecutor();
  try {
    await page.route("**/api/simulate", (route) => {
      if (route.request().postDataJSON().operation === "capabilities")
        return route.fulfill({ json: executor.capabilities });
      return route.fulfill({
        status: 401,
        json: {
          error: "SIGN_IN_REQUIRED",
          message: "Sign in to run simulations",
        },
      });
    });
    const panel = await openSimulation(
      page,
      project,
      "sign-in-rejected.icproj.json",
    );
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("failed");
    await expect(panel).toContainText("Sign in to run simulations");
    await expect(panel).not.toContainText("SIMULATION_DETAILS_INVALID");
    await expect(
      panel.getByRole("tab", { name: "Console", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    await executor.close();
  }
});

// The GUI's one end-to-end native run: replayed VACASK records by default,
// the real executable with ICM_E2E_VACASK_REAL=1.
test("GUI shows unruled VACASK measurements and opens their Console evidence", async ({
  page,
}) => {
  const project = await nativeRcProject("native-specs", "Native measurements");
  const executor = await createAgentNativeExecutor();
  try {
    await page.route("**/api/simulate", async (route) => {
      const input = route.request().postDataJSON();
      if (input.operation === "capabilities")
        return route.fulfill({ json: executor.capabilities });
      const result = await executor.execute(input);
      // Only the external process report is scripted; the Editor, service,
      // collector, artifact materialization and navigation are real.
      result.log +=
        '\nICM_MEASUREMENT_V1 {"name":"native_gain","status":"available","value":2,"unit":"V"}';
      return route.fulfill({ json: result });
    });
    const panel = await openSimulation(
      page,
      project,
      "native-specs.icproj.json",
    );
    await panel.getByRole("button", { name: "Run", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("completed");
    await panel.getByRole("tab", { name: "Specs", exact: true }).click();
    await panel.locator(".simulation-spec-other summary").click();
    const measurement = panel.getByRole("button", {
      name: "native_gain",
      exact: true,
    });
    await expect(measurement).toHaveAttribute("title", /log\.txt:/);
    await expect(panel.locator(".simulation-spec-other")).toContainText(
      "Measured only",
    );
    await measurement.click();
    await expect(
      panel.getByRole("tab", { name: "Console", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(panel.locator(".simulation-console-view")).toContainText(
      '"name":"native_gain"',
    );
    await expect(panel).not.toContainText("earlier source snapshot");
  } finally {
    await executor.close();
  }
});

// Offline, with no Profile advertised, a new experiment takes the native
// candidate and its VACASK starter. Choosing an advertised environment is
// simulation-workspace's "a new experiment takes the environment the Agent
// would"; each engine's starter text is simulation-starter.test.ts.
test("GUI creates an offline experiment with the VACASK candidate identity", async ({
  page,
}) => {
  const project = rcExample();
  project.simulationFolders = [];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      json: {
        configured: false,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op"],
        parsedAnalyses: ["op"],
        profiles: [],
        maxTimeoutMs: 15000,
        maxInputBytes: 1048576,
        cancel: true,
      },
    }),
  );
  const panel = await openSimulation(
    page,
    project,
    "no-experiments.icproj.json",
  );
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
  const saved: ReturnType<typeof parseProject> = await exportedProject(page);
  const folder = saved.simulationFolders[0]!;
  const config = JSON.parse(folderFile(folder, folder.input.configPath).text);
  expect(config).toEqual({
    version: 2,
    environment: { profileId: "vacask-sky130-candidate" },
  });
  const entry = folderFile(folder).text;
  expect(entry).toContain("analysis op op");
  expect(entry).not.toContain(".control");
});
