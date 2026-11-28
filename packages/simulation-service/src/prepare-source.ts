import type {
  CircuitProject,
  ProjectSimulationFolder,
  SimulationRunVariant,
} from "@icm/model";
import type { Capabilities } from "./contract.js";
import { prepareNgspiceExecutionInput } from "./prepare-ngspice.js";
import { resolveSimulationEngine } from "./profile-engine.js";

/** Public Prepare: same source authority for GUI, MCP and session folders. */
export async function prepareSourceExecutionInput(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
  caps: Capabilities,
  variant?: SimulationRunVariant,
) {
  const selected = resolveSimulationEngine(folder, caps);
  if (!selected.ok) return selected;
  return prepareNgspiceExecutionInput(project, folder, caps, variant);
}
