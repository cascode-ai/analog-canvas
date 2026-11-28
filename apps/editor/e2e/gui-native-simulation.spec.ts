import { test, expect } from "@playwright/test";
import type { parseProject } from "@icm/project-protocol";
import { exportedProject } from "./editor-fixtures.js";
import {
  completedNgspiceRun,
  folderFile,
  ngspiceCapabilities,
  ngspiceDividerProject,
  openSimulation,
  profile,
  rcExample,
} from "./simulation-e2e-fixtures.js";

test("GUI retains the sign-in failure after a rejected run is read again", async ({
  page,
}) => {
  const project = await ngspiceDividerProject(
    "sign-in-rejected",
    "Sign-in rejected",
  );
  await page.route("**/api/simulate", (route) => {
    if (route.request().postDataJSON().operation === "capabilities")
      return route.fulfill({ json: ngspiceCapabilities() });
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
});

test("GUI shows unconstrained ngspice measurements and opens their source Spec line", async ({
  page,
}) => {
  const project = await ngspiceDividerProject(
    "ngspice-specs",
    "ngspice measurements",
  );
  const entry = folderFile(project.simulationFolders[0]!);
  entry.text = entry.text.replace(
    "op\n",
    "op\n* @spec v_mid unit=V\nmeas op v_mid find v(mid)\n",
  );
  await page.route("**/api/simulate", async (route) => {
    const input = route.request().postDataJSON();
    if (input.operation === "capabilities")
      return route.fulfill({ json: ngspiceCapabilities() });
    const result = await completedNgspiceRun(input);
    result.log += "\nv_mid = 5.000000e-01\n";
    return route.fulfill({ json: result });
  });
  const panel = await openSimulation(
    page,
    project,
    "ngspice-specs.icproj.json",
  );
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("completed");
  await panel.getByRole("tab", { name: "Specs", exact: true }).click();
  await panel.locator(".simulation-spec-other summary").click();
  const measurement = panel.getByRole("button", {
    name: "v_mid",
    exact: true,
  });
  await expect(measurement).toBeVisible();
  await expect(panel.locator(".simulation-spec-other")).toContainText(
    "Measured only",
  );
  await measurement.click();
  await expect(panel).not.toContainText("earlier source snapshot");
});

test("GUI creates an offline experiment with the default SKY130 ngspice identity", async ({
  page,
}) => {
  const project = rcExample();
  project.simulationFolders = [];
  await page.route("**/api/simulate", (route) =>
    route.fulfill({
      json: {
        configured: false,
        rawfileCollection: "declared-single-ascii",
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
  await name.fill("SPICE first experiment");
  await name.press("Enter");
  await expect(
    panel.getByRole("treeitem", {
      name: "Folder SPICE first experiment",
      exact: true,
    }),
  ).toBeVisible();
  const saved: ReturnType<typeof parseProject> = await exportedProject(page);
  const folder = saved.simulationFolders[0]!;
  const config = JSON.parse(folderFile(folder, folder.input.configPath).text);
  expect(config).toEqual({
    version: 2,
    environment: { profileId: profile.id },
  });
  const entry = folderFile(folder).text;
  expect(entry).toContain(".control");
  expect(entry).toContain("\nop\n");
});
