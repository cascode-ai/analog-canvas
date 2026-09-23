import type { CircuitProject, ProjectSimulationFolder } from "@icm/model";
import { readSimulationExperimentConfig } from "@icm/model";
import {
  problem,
  type SimulationOperation,
  type Capabilities,
} from "./contract.js";
import { SimulationFiles } from "./files.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";
import { resolveSimulationEngine } from "./profile-engine.js";

/** Project and session sources enter exactly the same compiler and preparation path. */
export async function prepareExecutionInput(
  op: Extract<SimulationOperation, { operation: "prepare" }>,
  caps: Capabilities | undefined,
  getProject: () => CircuitProject,
  files: SimulationFiles,
  selectCapabilities?: (profileId: string) => Promise<Capabilities>,
) {
  // Capture before any capability/network await. Human edits during discovery
  // must not change the meaning of an already submitted revision.
  const project = structuredClone(getProject());
  async function prepare(
    folder: ProjectSimulationFolder,
    variant?: Parameters<typeof prepareSourceExecutionInput>[3],
  ) {
    const config = readSimulationExperimentConfig(folder);
    if (!config.ok) {
      const failure = resolveSimulationEngine(folder, { profiles: [] });
      if (!failure.ok) return failure;
    }
    const selected =
      config.ok && selectCapabilities
        ? await selectCapabilities(config.config.environment.profileId)
        : caps;
    if (!selected?.configured)
      return problem(
        "simulation-not-configured",
        "The selected execution Profile is unavailable; authored input remains available.",
        "prepare",
        "retry-after",
      );
    return prepareSourceExecutionInput(project, folder, selected, variant);
  }
  const source = op.source;
  if (source.kind === "project-folder") {
    if (project.structureRevision !== source.expectedStructureRevision) {
      const failure = problem(
        "PROJECT_STRUCTURE_REVISION_CONFLICT",
        "Project structure changed; reconcile the source before preparing again",
        "prepare",
        "reprepare",
      );
      return {
        ...failure,
        error: {
          ...failure.error,
          currentRevision: project.structureRevision,
        },
      };
    }
    const folder = project.simulationFolders.find(
      (folder) => folder.id === source.folderId,
    );
    if (!folder)
      return problem(
        "SIMULATION_FOLDER_MISSING",
        "The requested experiment no longer exists",
        "prepare",
      );
    return prepare(folder, source.variant);
  }
  const read = files.snapshot(source.workspaceId, source.expectedRevision);
  if (!read.ok) return read;
  const { workspace } = read;
  const folder: ProjectSimulationFolder = {
    id: workspace.id,
    name: "Session experiment",
    version: 4,
    input: {
      kind: "source",
      entry: workspace.entry!,
      configPath: workspace.configPath,
      files: workspace.files,
      dependencies: [],
      circuitBindings: [],
    },
  };
  return prepare(folder);
}
