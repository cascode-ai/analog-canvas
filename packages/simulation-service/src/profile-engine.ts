import {
  readSimulationExperimentConfig,
  type ProjectSimulationFolder,
} from "@icm/model";
import { problem, type Capabilities } from "./contract.js";

export type SimulationEngine = "ngspice" | "vacask";

/** Compatibility for a single-engine executor that predates explicit Profile
 * dialects. Mixed discovery must declare the engine on each Profile. */
export function profileEngine(
  profile: Capabilities["profiles"][number],
  collection?: Capabilities["rawfileCollection"],
): SimulationEngine | undefined {
  if (profile.engine) return profile.engine;
  if (
    profile.modelLibrary ||
    profile.modelSymbols ||
    collection === "native-multi-ascii"
  )
    return "vacask";
  if (collection === "declared-single-ascii") return "ngspice";
  return undefined;
}

export function resolveSimulationEngine(
  folder: ProjectSimulationFolder,
  caps: Pick<Capabilities, "profiles" | "rawfileCollection">,
) {
  const config = readSimulationExperimentConfig(folder);
  if (!config.ok)
    return {
      ok: false as const,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        message: config.message,
        stage: "prepare" as const,
        recovery: "fix-input" as const,
        diagnostics: [
          {
            code: "SIMULATION_CONFIG_INVALID",
            severity: "error" as const,
            message: config.message,
            path: config.path,
          },
        ],
      },
    };
  const profile = caps.profiles.find(
    (p) => p.id === config.config.environment.profileId,
  );
  if (!profile)
    return problem(
      "SIMULATION_PROFILE_UNKNOWN",
      "Select a Profile advertised by capabilities",
      "prepare",
    );
  const engine = profileEngine(profile, caps.rawfileCollection);
  if (!engine)
    return problem(
      "SIMULATION_ENGINE_UNAVAILABLE",
      "The selected Profile does not declare an execution dialect",
      "prepare",
      "retry-after",
    );
  return { ok: true as const, engine, profile };
}
