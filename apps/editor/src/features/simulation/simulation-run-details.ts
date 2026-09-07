import { SimulationResultSchema } from "@icm/spice-run";
import {
  SimulationOutputDataSchema,
  type Run,
  type Problem,
} from "@icm/simulation-service/contract";
import type { SimulationFiles } from "@icm/simulation-service/files";
import { readSimulationArtifact } from "./simulation-artifact-files";

/** UI materialization only: MCP retains bounded receipts and paged File access. */
export class SimulationRunDetails {
  private cached = new Map<string, Pick<Run, "result" | "outputData">>();
  async read(
    files: SimulationFiles,
    run: Run,
  ): Promise<{ ok: true; run: Run } | { ok: false; error: Problem }> {
    if (!run.resultPreview) return { ok: true, run };
    const key = run.artifacts.map((a) => a.id).join(":");
    const cached = this.cached.get(key);
    if (cached)
      return { ok: true, run: { ...run, ...cached, resultPreview: false } };
    const details: Pick<Run, "result" | "outputData"> = {};
    try {
      for (const artifact of run.artifacts) {
        if (artifact.name !== "result.json" && artifact.name !== "outputs.json")
          continue;
        const content = await readSimulationArtifact(files, artifact);
        if (!content.ok) return content;
        const value: unknown = JSON.parse(content.content.text);
        if (artifact.name === "result.json")
          details.result = SimulationResultSchema.parse(value);
        else details.outputData = SimulationOutputDataSchema.parse(value);
      }
      if (!details.result && !details.outputData)
        throw new Error("Missing result artifacts");
      this.cached.set(key, details);
      // Mirrors the UI's bounded comparison retention, not a second run registry.
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
