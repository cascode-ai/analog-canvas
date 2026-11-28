import {
  NativeSimulationExperimentConfigSchema,
  readSimulationExperimentConfig,
  type CircuitProject,
  type ProjectSimulationFolder,
} from "@icm/model";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";

/**
 * Explicit, non-destructive migration boundary. Never silently erase a legacy
 * binding, sweep, measurement or label that cannot be represented losslessly.
 */
export function migrateSimulationConfigToNative(
  project: CircuitProject,
  folder: ProjectSimulationFolder,
):
  | { ok: true; folder: ProjectSimulationFolder }
  | { ok: false; message: string } {
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.authority === "code") return { ok: true, folder };
  const config = parsed.config;
  const pending: string[] = [];
  if (config.variables.some((variable) => variable.bindings.length))
    pending.push(
      "replace Canvas variable bindings with explicit parameter expressions and Cell interfaces",
    );
  if (config.runPlan.mode !== "nominal")
    pending.push("move the saved sweep into SPICE control Code");
  if (config.outputs.length)
    pending.push(
      "translate named outputs/expressions into SPICE save/write control Code",
    );
  if (config.deviceOperatingPoints.length)
    pending.push(
      "use Helper to save Device OP vectors, then remove legacy Device OP selections",
    );
  if (config.measurements.length)
    pending.push(
      "translate saved measurement rules into SPICE meas control Code",
    );
  if (config.collection.rawfile !== null)
    pending.push(
      "declare the write path in SPICE control Code, then remove collection.rawfile",
    );
  if (config.environment.corner)
    pending.push(
      "declare the model dependency and .lib section in Code, then remove environment.corner",
    );
  if (pending.length)
    return {
      ok: false,
      message: `Legacy intent is retained. Before converting: ${pending.join("; ")}. No source or configuration was changed.`,
    };
  const next = structuredClone(folder);
  next.input.files.find((file) => file.path === next.input.configPath)!.text =
    JSON.stringify(
      NativeSimulationExperimentConfigSchema.parse({
        version: 2,
        environment: { profileId: config.environment.profileId },
      }),
      null,
      2,
    ) + "\n";
  const compiled = compileNgspiceSourceSimulation(project, next);
  if (!compiled.ok)
    return {
      ok: false,
      message: compiled.diagnostics.map((d) => d.message).join("; "),
    };
  return { ok: true, folder: next };
}
