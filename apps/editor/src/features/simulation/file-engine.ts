import {
  readSimulationExperimentConfig,
  type ProjectSimulationFolder,
} from "@icm/model";
import type { Executor } from "@icm/simulation-service";
import { authoringEngine } from "./authoring-engine";
import {
  simulationExecutor,
  type SimulationExecutorOptions,
} from "./simulation-executor";

/** Shared by human and Agent File Resources; never selects execution by extension. */
export function simulationFileEngine(
  options: SimulationExecutorOptions & {
    /** The session's own Executor, when it has one. */
    executor?: () => Promise<Executor>;
  },
) {
  const executor = options.executor ?? simulationExecutor(options);
  return async (folder: ProjectSimulationFolder) => {
    const config = readSimulationExperimentConfig(folder);
    if (!config.ok) throw new Error(config.message);
    const [{ resolveSimulationEngine }, loaded] = await Promise.all([
      import("@icm/simulation-service"),
      executor(),
    ]);
    let capabilities;
    try {
      capabilities = await loaded.capabilities(
        config.config.environment.profileId,
      );
    } catch (error) {
      const local = authoringEngine(folder);
      if (local) return local;
      throw error;
    }
    const selected = resolveSimulationEngine(folder, capabilities);
    if (!selected.ok) throw new Error(selected.error.message);
    return selected.engine;
  };
}
