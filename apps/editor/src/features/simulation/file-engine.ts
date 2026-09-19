import {
  readSimulationExperimentConfig,
  type ProjectSimulationFolder,
} from "@icm/model";
import { authoringEngine } from "./authoring-engine";

/** Shared by human and Agent File Resources; never selects execution by extension. */
export function simulationFileEngine(options: {
  fetch?: typeof fetch;
  transport?: "direct" | "managed";
}) {
  return async (folder: ProjectSimulationFolder) => {
    const config = readSimulationExperimentConfig(folder);
    if (!config.ok) throw new Error(config.message);
    const {
      createHostedExecutor,
      createManagedHostedExecutor,
      resolveSimulationEngine,
    } = await import("@icm/simulation-service");
    const fetcher =
      options.fetch ??
      ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    const executor =
      options.transport === "managed"
        ? createManagedHostedExecutor({ fetch: fetcher })
        : createHostedExecutor(fetcher);
    let capabilities;
    try {
      capabilities = await executor.capabilities(
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
