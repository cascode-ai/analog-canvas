import type { CircuitProject, ProjectSimulationSetup } from "@icm/model";
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
  if (source.kind === "project-setup") {
    if (project.structureRevision !== source.expectedStructureRevision)
      return problem(
        "PROJECT_STRUCTURE_REVISION_CONFLICT",
        "Read the current Project revision and prepare again",
        "prepare",
        "reprepare",
      );
    const setup = project.simulationSetups.find(
      (setup) => setup.id === source.setupId,
    );
    if (!setup)
      return problem(
        "SIMULATION_SETUP_MISSING",
        "The requested experiment no longer exists",
        "prepare",
      );
    return prepareSourceExecutionInput(project, setup, caps, source.variant);
  }
  const read = files.snapshot(source.workspaceId, source.expectedRevision);
  if (!read.ok) return read;
  const { workspace } = read;
  const setup: ProjectSimulationSetup = {
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
  return prepareSourceExecutionInput(project, setup, caps);
}
