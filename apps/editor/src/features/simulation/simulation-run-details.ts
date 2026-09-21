import { SimulationResultSchema } from "@icm/spice-run";
import {
  SimulationOutputDataSchema,
  SimulationSpecReportSchema,
  type Run,
  type Problem,
} from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";
import { readSimulationArtifact } from "./simulation-artifact-files";

/** UI materialization from complete files; Agent receipts never inline samples. */
export class SimulationRunDetails {
  private cached = new Map<string, Pick<Run, "result" | "outputData">>();
  async read(
    files: SimulationFiles,
    run: Run,
  ): Promise<{ ok: true; run: Run } | { ok: false; error: Problem }> {
    if (!run.resultPreview) return { ok: true, run };
    if (!run.catalog) {
      const catalog = await files.catalog(run.id);
      if (catalog) run = { ...run, catalog };
    }
    const key = run.artifacts.map((a) => a.id).join(":");
    const cached = this.cached.get(key);
    if (cached)
      return { ok: true, run: { ...run, ...cached, resultPreview: false } };
    const details: Pick<Run, "result" | "outputData"> = {};
    try {
      for (const artifact of run.artifacts) {
        if (
          !["result.json", "outputs.json", "specs.json"].includes(artifact.name)
        )
          continue;
        const content = await readSimulationArtifact(files, artifact);
        if (!content.ok) return content;
        const value: unknown = JSON.parse(content.content.text);
        if (artifact.name === "result.json")
          details.result = SimulationResultSchema.parse(value);
        else if (artifact.name === "specs.json")
          details.outputData = {
            schemaVersion: 1,
            analyses: [],
            diagnostics: [],
            ...details.outputData,
            specs: SimulationSpecReportSchema.parse(value),
          };
        else {
          const output = SimulationOutputDataSchema.parse(value);
          details.outputData = {
            ...output,
            ...(details.outputData?.specs
              ? { specs: details.outputData.specs }
              : {}),
          };
        }
      }
      if (!details.result && !details.outputData)
        throw new Error("Missing result artifacts");
      this.cached.set(key, details);
      // Bound materialized history in memory; this is not a second run registry.
      if (this.cached.size > 5)
        this.cached.delete(this.cached.keys().next().value!);
      return { ok: true, run: { ...run, ...details, resultPreview: false } };
    } catch {
      return {
        ok: false,
        error: {
          code: "SIMULATION_DETAILS_INVALID",
          message:
            "Full result files are unavailable or invalid. The run receipt and other artifacts remain accessible.",
          stage: "read",
          recovery: "retry-after",
        },
      };
    }
  }
}
