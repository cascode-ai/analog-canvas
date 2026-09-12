import {
  NativeSimulationExperimentConfigSchema,
  readSimulationExperimentConfig,
  type CircuitProject,
  type ProjectSimulationFolder,
} from "@icm/model";
import { compileSourceSimulation } from "./simulation-source-compile.js";

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
    pending.push("move the saved sweep into native control Code");
  if (config.outputs.length)
    pending.push("move named outputs/expressions into native save/let Code");
  if (config.deviceOperatingPoints.length)
    pending.push(
      "use Helper to save native Device OP vectors, then remove legacy Device OP selections",
    );
  if (config.measurements.length)
    pending.push("move saved measurement rules into native meas Code");
  if (config.environment.corner)
    pending.push(
      "declare the model dependency and .lib corner in Code, then remove environment.corner",
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
  const compiled = compileSourceSimulation(project, next);
  if (!compiled.ok)
    return {
      ok: false,
      message: compiled.diagnostics.map((d) => d.message).join("; "),
    };
  if (compiled.config.collection.rawfile !== config.collection.rawfile)
    return {
      ok: false,
      message:
        "The native write path differs from the legacy collector. Reconcile write and collection.rawfile before converting; no files were changed.",
    };
  return { ok: true, folder: next };
}
