import {
  readSimulationExperimentConfig,
  type ProjectSimulationFolder,
} from "@icm/model";
import { problem, type Capabilities, type Problem } from "./contract.js";

export type SimulationEngine = "ngspice";

/** Resolve the execution dialect for an advertised Profile. */
export function profileEngine(
  profile: Capabilities["profiles"][number],
  collection?: Capabilities["rawfileCollection"],
): SimulationEngine | undefined {
  if (profile.engine) return profile.engine;
  if (collection === "declared-single-ascii") return "ngspice";
  return undefined;
}

export function resolveSimulationEngine(
  folder: ProjectSimulationFolder,
  caps: Pick<Capabilities, "profiles" | "rawfileCollection">,
) {
  const config = readSimulationExperimentConfig(folder);
  if (!config.ok) {
    const diagnostics =
      config.fields.length > 0
        ? config.fields.map((issue) => ({
            code: "SIMULATION_CONFIG_INVALID" as const,
            severity: "error" as const,
            message: issue.field
              ? `${issue.field}: ${issue.message}`
              : issue.message,
            path: config.path,
          }))
        : [
            {
              code: "SIMULATION_CONFIG_INVALID" as const,
              severity: "error" as const,
              message: config.message,
              path: config.path,
            },
          ];
    const error: Problem = {
      code: "SIMULATION_COMPILE_REFUSED",
      message:
        config.fields.length > 0
          ? `${config.message}: ${diagnostics[0]!.message}`
          : config.message,
      stage: "prepare",
      recovery: "fix-input",
      diagnostics,
    };
    return { ok: false as const, error };
  }
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
