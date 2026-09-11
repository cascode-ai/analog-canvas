import type { CircuitProject, ProjectSimulationFolder } from "@icm/model";
import {
  problem,
  type SimulationOperation,
  type Capabilities,
} from "./contract.js";
import { SimulationFiles } from "./files.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";

/** Project and session sources enter exactly the same compiler and preparation path. */
export async function prepareExecutionInput(
  op: Extract<SimulationOperation, { operation: "prepare" }>,
  caps: Capabilities,
  getProject: () => CircuitProject,
  files: SimulationFiles,
) {
  const project = getProject();
  const source = op.source;
  if (source.kind === "project-folder") {
    if (project.structureRevision !== source.expectedStructureRevision)
      return problem(
        "PROJECT_STRUCTURE_REVISION_CONFLICT",
        "Read the current Project revision and prepare again",
        "prepare",
        "reprepare",
      );
    const folder = project.simulationFolders.find(
      (folder) => folder.id === source.folderId,
    );
    if (!folder)
      return problem(
        "SIMULATION_FOLDER_MISSING",
        "The requested experiment no longer exists",
        "prepare",
      );
    return prepareSourceExecutionInput(project, folder, caps, source.variant);
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
  return prepareSourceExecutionInput(project, folder, caps);
}
