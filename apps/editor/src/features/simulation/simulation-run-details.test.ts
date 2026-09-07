import { expect, it } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";
import type { Run } from "@icm/simulation-service/contract";
import { SimulationRunDetails } from "./simulation-run-details";

it("hydrates full outputs without changing the bounded receipt, and retains current input status", async () => {
  const files = new SimulationFiles();
  const outputData = { schemaVersion: 1, analyses: [], diagnostics: [] };
  const artifact = await files.put(
    "outputs.json",
    "application/json",
    JSON.stringify(outputData),
  );
  const run: Run = {
    id: "r",
    preparedId: "p",
    inputRevision: "i",
    state: "finished",
    resultPreview: true,
    artifacts: [artifact],
  };
  const details = new SimulationRunDetails();
  expect(await details.read(files, run)).toMatchObject({
    ok: true,
    run: { outputData, resultPreview: false },
  });
  expect(run.outputData).toBeUndefined();
  expect(
    await details.read(files, { ...run, inputStatus: "changed" }),
  ).toMatchObject({ ok: true, run: { inputStatus: "changed" } });
});
it("reports expired files as recoverable without throwing", async () => {
  const files = new SimulationFiles();
  const artifact = await files.put("outputs.json", "application/json", "{}");
  files.clear();
  expect(
    await new SimulationRunDetails().read(files, {
      id: "r",
      preparedId: "p",
      inputRevision: "i",
      state: "finished",
      resultPreview: true,
      artifacts: [artifact],
    }),
  ).toMatchObject({ ok: false });
});
