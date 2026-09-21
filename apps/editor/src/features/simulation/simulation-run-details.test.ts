import { expect, it } from "vitest";
import { SimulationFiles } from "@icm/simulation-service/files";
import type { Run } from "@icm/simulation-service/contract";
import { SimulationRunDetails } from "./simulation-run-details";

it.each([false, true])(
  "hydrates legacy or Spec-only evidence without mutating receipts (Spec: %s)",
  async (current) => {
    const files = new SimulationFiles();
    const specs = {
      schemaVersion: 1,
      runId: "r",
      preparedId: "p",
      inputDigest: "a".repeat(64),
      results: [],
    };
    const outputData = {
      schemaVersion: 1,
      analyses: [],
      diagnostics: [],
      ...(current ? { specs } : {}),
    };
    const artifact = await files.put(
      current ? "specs.json" : "outputs.json",
      "application/json",
      JSON.stringify(current ? specs : outputData),
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
  },
);
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

it.each([false, true])(
  "preserves diagnostics alongside Specs in either file order (%s)",
  async (reverse) => {
    const files = new SimulationFiles();
    const specs = {
      schemaVersion: 1,
      runId: "r",
      preparedId: "p",
      inputDigest: "a".repeat(64),
      results: [],
    };
    const diagnostics = [
      { outputId: "noise", code: "NO_DATA", message: "Noise analysis failed" },
    ];
    const artifacts = [
      await files.put("specs.json", "application/json", JSON.stringify(specs)),
      await files.put(
        "outputs.json",
        "application/json",
        JSON.stringify({ schemaVersion: 1, analyses: [], diagnostics }),
      ),
    ];
    if (reverse) artifacts.reverse();
    const result = await new SimulationRunDetails().read(files, {
      id: "r",
      preparedId: "p",
      inputRevision: "i",
      state: "finished",
      resultPreview: true,
      artifacts,
    });
    expect(result).toMatchObject({
      ok: true,
      run: { outputData: { specs, diagnostics }, resultPreview: false },
    });
  },
);
