import type { CircuitProject, SimulationRunVariant } from "@icm/model";
import { applySimulationParameter } from "@icm/netlist";

export type SimulationProjectVariant = SimulationRunVariant;

export type ProjectVariantResult =
  | {
      ok: true;
      project: CircuitProject;
      setup: CircuitProject["simulationSetups"][number];
    }
  | { ok: false; code: string; message: string };

/**
 * Project a run-only variant over a cloned Project. It deliberately emits no
 * Project edits: saved setup intent remains unchanged while compilation,
 * digesting and later input-status checks see the exact same projected input.
 */
export function projectSimulationVariant(
  input: CircuitProject,
  setupId: string,
  variant?: SimulationProjectVariant,
): ProjectVariantResult {
  const project = structuredClone(input);
  const setup = project.simulationSetups.find((item) => item.id === setupId);
  if (!setup) {
    return {
      ok: false,
      code: "SIMULATION_SETUP_MISSING",
      message: `Simulation setup does not exist: ${setupId}`,
    };
  }
  if (variant?.environment) {
    setup.input.environment = {
      ...setup.input.environment,
      ...variant.environment,
    };
  }
  if (
    ((variant?.parameters?.length ?? 0) > 0 ||
      (variant?.variables?.length ?? 0) > 0) &&
    setup.input.kind !== "structured"
  ) {
    return {
      ok: false,
      code: "SIMULATION_VARIANT_REQUIRES_STRUCTURED_SETUP",
      message: "Instance parameter variants require a structured Project setup",
    };
  }
  if (setup.input.kind === "structured") {
    const overrides = new Map(
      (variant?.variables ?? []).map(({ variableId, value }) => [
        variableId,
        value,
      ]),
    );
    for (const variable of setup.input.designVariables) {
      const value = overrides.get(variable.id) ?? variable.value;
      for (const binding of variable.bindings) {
        const result = applySimulationParameter(
          project,
          binding,
          value,
          "Design Variable",
          "SIMULATION_VARIABLE_BINDING",
          true,
        );
        if (!result.ok) return result;
      }
    }
    for (const variableId of overrides.keys()) {
      if (!setup.input.designVariables.some(({ id }) => id === variableId)) {
        return {
          ok: false,
          code: "SIMULATION_VARIABLE_MISSING",
          message: `Design Variable does not exist: ${variableId}`,
        };
      }
    }
  }
  for (const override of variant?.parameters ?? []) {
    const result = applySimulationParameter(
      project,
      override,
      override.value,
      "Variant",
      "SIMULATION_VARIANT",
    );
    if (!result.ok) return result;
  }
  return { ok: true, project, setup };
}
