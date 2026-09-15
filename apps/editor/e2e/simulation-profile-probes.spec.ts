import { test, expect } from "@playwright/test";
import { createSimulationFolder } from "@icm/model";
import { readFileSync } from "node:fs";
import { parseProject } from "@icm/project-protocol";
import {
  nativeSimulationDevices,
  type NativeModelLibrarySymbols,
} from "@icm/netlist";
import { ota } from "./simulation-e2e-fixtures.js";

test("Profile-backed OP picker discovers an implicit library without writing its generated include", async ({
  page,
}) => {
  const project = parseProject(JSON.stringify(ota));
  const { library }: { library: NativeModelLibrarySymbols } = JSON.parse(
    readFileSync(
      new URL(
        "../../../netlists/vacask-sky130/model-symbols-tt.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const profile = {
    id: "test",
    corners: [],
    modelSymbols: [library],
    dependencies: [{ id: library.dependencyId, sha256: library.sha256 }],
  };
  const folder = createSimulationFolder({
    id: "profile-probes",
    name: "Profile probes",
    profileId: profile.id,
    documentId: project.topDocumentId,
  });
  project.simulationFolders = [folder];
  let executions = 0;
  // Browser authoring proof only. The separate real-runtime OTA test validates
  // these captured model paths against the actual dependency and native process.
  await page.route("**/api/simulate", (route) => {
    if (route.request().postDataJSON().operation !== "capabilities") {
      executions++;
      return route.abort();
    }
    return route.fulfill({
      json: {
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        profiles: [
          { ...profile, modelLibrary: { dependencyId: library.dependencyId } },
        ],
        analyses: ["op", "ac"],
        parsedAnalyses: ["op", "ac"],
        maxTimeoutMs: 30000,
        maxInputBytes: 1048576,
        cancel: true,
      },
    });
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "profile-probes.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByTestId("open-analog-simulation").click();
  await page.getByRole("button", { name: "Helper", exact: true }).click();
  await page
    .getByRole("option", { name: "Save device operating point…", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Save signal" });
  const device = nativeSimulationDevices(project, folder.input).find(
    (d) => d.instanceId === "M1",
  )!;
  const master = library.masters.find((m) => m.name === device.card.target)!;
  const reference = [device.reference, ...master.primitives[0]!.path].join(":");
  const gm = { reference, save: `p('${reference}',gm)` };
  const choice = picker.getByRole("button", {
    name: `${gm.reference} · gm (model-native) — ${gm.save}`,
  });
  await choice.click();
  await expect(choice).toContainText("Added");
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await expect(editor).toContainText(gm.save);
  await expect(editor).not.toContainText("icm-models");
  await expect(picker.getByRole("status")).toHaveCount(0);
  expect(executions).toBe(0);
});
