import type { Run, ArtifactRef } from "@icm/simulation-service";
import type {
  SimulationEnvironmentMetadata,
  SimulationResult,
} from "@icm/spice-run";

export function collectNativeRunEvidence(options: {
  tool: (name: string, args: unknown) => Promise<unknown>;
  run: Run;
  directory: string;
  compiled: { files: Array<{ path: string; text: string }> };
  expectedEnvironment: SimulationEnvironmentMetadata;
}): Promise<{
  runId: string;
  state: Run["state"];
  outcome: SimulationResult["outcome"];
  environment: SimulationEnvironmentMetadata;
  artifacts: Array<Pick<ArtifactRef, "name" | "sha256">>;
  datasets: Array<{
    analysisIndex: number;
    analysis: string;
    points: number;
    signals: string[];
  }>;
}>;
