import { describe, expect, it } from "vitest";
import { resultCatalog } from "./result-catalog.js";
import { ResultCatalogSchema, type ArtifactRef } from "./contract.js";

const file = (
  id: string,
  role: ArtifactRef["role"],
  extra: Partial<ArtifactRef> = {},
): ArtifactRef => ({
  id,
  name: "result.json",
  mediaType: "application/json",
  byteLength: 10,
  sha256: "a".repeat(64),
  role,
  ...extra,
});
const run = {
  id: "run",
  preparedId: "prepared",
  inputRevision: "rev",
  state: "finished" as const,
};
describe("result catalog", () => {
  it("links native plots, JSON and CSV without embedding samples or confusing authored names", () => {
    const catalog = resultCatalog(
      {
        ...run,
        artifacts: [
          file("user", "source"),
          file("json", "result"),
          file("csv", "table", { analysisIndex: 0 }),
          file("raw", "raw", { sourcePath: "gain.raw" }),
          file("other", "raw", { sourcePath: "other.raw" }),
        ],
        result: {
          outcome: { status: "completed" },
          data: {
            schemaVersion: 1,
            analyses: [
              {
                analysis: "ac",
                plotName: "AC",
                rawPlotOrdinals: [3],
                frequencyHz: [1, 2],
                probes: [
                  {
                    name: "v(out)",
                    quantity: "voltage",
                    unit: "V",
                    real: [2, 3],
                    imag: [0, 1],
                  },
                ],
              },
            ],
            rawPlots: [
              {
                ordinal: 3,
                artifactPath: "gain.raw",
                artifactPlotOrdinal: 0,
                analysisIndex: 0,
                plotName: "AC",
                pointCount: 2,
                variables: ["frequency", "v(out)"],
              },
            ],
          },
        },
      },
      "complete",
    );
    expect(ResultCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog.datasets).toEqual([
      {
        id: "run:analysis:0",
        analysisIndex: 0,
        analysis: "ac",
        plotName: "AC",
        pointCount: 2,
        axis: { name: "frequency", unit: "Hz" },
        signals: [{ name: "v(out)", quantity: "voltage", unit: "V" }],
        representations: [
          { artifactId: "json", fileId: "json", selector: "/data/analyses/0" },
          { artifactId: "csv", fileId: "csv", selector: "" },
          { artifactId: "raw", fileId: "raw", selector: "plot:0" },
        ],
      },
    ]);
    expect(JSON.stringify(catalog)).not.toContain('"real"');
  });
  it("keeps execution failure independent of complete collection and accepts log-only runs", () => {
    expect(
      resultCatalog(
        {
          ...run,
          artifacts: [file("log", "log")],
          result: { outcome: { status: "failed" } },
        },
        "complete",
      ),
    ).toMatchObject({
      execution: "failed",
      collection: "complete",
      datasets: [],
    });
    expect(
      resultCatalog({ ...run, artifacts: [], state: "lost" }, "partial"),
    ).toMatchObject({ execution: "lost", collection: "partial" });
  });
  it("registers integrated noise scalars with exact result selectors", () => {
    const catalog = resultCatalog(
      {
        ...run,
        artifacts: [file("json", "result")],
        result: {
          outcome: { status: "completed" },
          data: {
            schemaVersion: 1,
            analyses: [
              {
                analysis: "noise",
                plotName: "Noise Analysis",
                frequencyHz: [10, 100],
                outputNoiseDensity: [1e-9, 2e-9],
                inputNoiseDensity: [5e-10, 1e-9],
                integratedOutputNoise: 1.5e-8,
                integratedInputNoise: 7.5e-9,
                units: {
                  outputDensity: "V/sqrt(Hz)",
                  inputDensity: "V/sqrt(Hz)",
                  integratedOutput: "V",
                  integratedInput: "V",
                },
              },
            ],
            rawPlots: [],
          },
        },
      },
      "complete",
    );

    expect(ResultCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(catalog.datasets[0]?.scalars).toEqual([
      {
        name: "integratedOutputNoise",
        quantity: "integrated-output-noise",
        unit: "V",
        representations: [
          {
            artifactId: "json",
            fileId: "json",
            selector: "/data/analyses/0/integratedOutputNoise",
          },
        ],
      },
      {
        name: "integratedInputNoise",
        quantity: "integrated-input-noise",
        unit: "V",
        representations: [
          {
            artifactId: "json",
            fileId: "json",
            selector: "/data/analyses/0/integratedInputNoise",
          },
        ],
      },
    ]);
    expect(JSON.stringify(catalog)).not.toContain("1.5e-8");
  });
});
