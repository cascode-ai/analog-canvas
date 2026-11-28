import { test, expect } from "@playwright/test";
import { createSimulationFolder } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { ngspiceSimulationDevices } from "@icm/netlist";
import {
  abortRunsOffering,
  chooseHelperEntry,
  ngspiceCapabilities,
  openSimulation,
  ota,
  profile,
  sourceEditor,
} from "./simulation-e2e-fixtures.js";

test("OP and terminal-current pickers insert ngspice save vectors and probe directives", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const folder = createSimulationFolder({
    id: "profile-probes",
    name: "Profile probes",
    profileId: profile.id,
    engine: "ngspice",
    documentId: project.topDocumentId,
  });
  project.simulationFolders = [folder];
  const executions = await abortRunsOffering(page, ngspiceCapabilities());
  await openSimulation(page, project, "profile-probes.icproj.json");
  await chooseHelperEntry(page, "Save device operating point…");
  const picker = page.getByRole("dialog", { name: "Save signal" });
  const device = ngspiceSimulationDevices(project, folder.input).find(
    (d) => d.instanceId === "M1",
  )!;
  const gmVector = `@m.${device.reference.toLowerCase()}.msky130_fd_pr__nfet_01v8[gm]`;
  const choice = picker.getByRole("button", {
    name: `${device.reference} · GM — ${gmVector}`,
  });
  await choice.click();
  await expect(choice).toContainText("Added");
  const editor = sourceEditor(page);
  await expect(editor).toContainText(gmVector);
  await expect(picker.getByRole("status")).toHaveCount(0);
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await chooseHelperEntry(page, "Save terminal current…");
  const current = picker.getByRole("button", { name: /M1\.D current/ });
  await current.click();
  await expect(current).toContainText("Added");
  await expect(editor).toContainText(
    `@m.${device.reference.toLowerCase()}.msky130_fd_pr__nfet_01v8[id]`,
  );
  expect(executions()).toBe(0);
});
