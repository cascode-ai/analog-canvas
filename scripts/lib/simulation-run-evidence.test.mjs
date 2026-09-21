import { describe, expect, it, vi } from "vitest";

import { materializeSimulationRunEvidence } from "./simulation-run-evidence.mjs";

const artifact = (name) => ({ id: name, name });

describe("bounded simulation run evidence", () => {
  it("leaves an inline run untouched", async () => {
    const run = { resultPreview: false, artifacts: [], result: { data: {} } };
    const read = vi.fn();

    expect(await materializeSimulationRunEvidence(run, read)).toBe(run);
    expect(read).not.toHaveBeenCalled();
  });

  it("hydrates raw and named-output evidence from artifacts", async () => {
    const run = {
      resultPreview: true,
      artifacts: [artifact("result.json"), artifact("outputs.json")],
      result: { outcome: { status: "completed" } },
    };
    const read = vi.fn(async ({ name }) =>
      name === "result.json"
        ? { outcome: { status: "completed" }, data: { analyses: [] } }
        : { schemaVersion: 1, analyses: [], diagnostics: [], measurements: [] },
    );

    const hydrated = await materializeSimulationRunEvidence(run, read);

    expect(hydrated.resultPreview).toBe(false);
    expect(hydrated.result.data).toEqual({ analyses: [] });
    expect(hydrated.outputData.measurements).toEqual([]);
    expect(read.mock.calls.map(([value]) => value.name)).toEqual([
      "result.json",
      "outputs.json",
    ]);
  });

  it("fails clearly when a bounded receipt cannot locate full evidence", async () => {
    await expect(
      materializeSimulationRunEvidence(
        { resultPreview: true, artifacts: [] },
        vi.fn(),
      ),
    ).rejects.toThrow("no result.json artifact");
  });

  it("retains diagnostics when a separate Spec report is present", async () => {
    const diagnostics = [{ code: "NOISE_FAILED", message: "No spectrum" }];
    const specs = { results: [] };
    const read = async ({ name }) =>
      name === "outputs.json"
        ? { diagnostics }
        : name === "specs.json"
          ? specs
          : { data: {} };
    const run = await materializeSimulationRunEvidence(
      {
        resultPreview: true,
        artifacts: [
          artifact("result.json"),
          artifact("specs.json"),
          artifact("outputs.json"),
        ],
      },
      read,
    );
    expect(run.outputData).toMatchObject({ diagnostics, specs });
  });

  it("hydrates new Spec-only results without a duplicate outputs.json", async () => {
    const specs = { schemaVersion: 1, runId: "run", results: [] };
    const read = vi.fn(async ({ name }) =>
      name === "specs.json" ? specs : { data: { analyses: [] } },
    );
    const run = await materializeSimulationRunEvidence(
      {
        resultPreview: true,
        artifacts: [artifact("result.json"), artifact("specs.json")],
      },
      read,
    );
    expect(run.outputData).toEqual({
      schemaVersion: 1,
      analyses: [],
      diagnostics: [],
      specs,
    });
    expect(run.resultPreview).toBe(false);
    expect(read.mock.calls.map(([value]) => value.name)).toEqual([
      "result.json",
      "specs.json",
    ]);
  });
});
