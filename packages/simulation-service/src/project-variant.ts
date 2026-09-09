import type { CircuitProject } from "@icm/model";

import type { SimulationOperation } from "./contract.js";

export type SimulationProjectVariant = NonNullable<
  Extract<
    Extract<SimulationOperation, { operation: "prepare" }>["source"],
    { kind: "project-setup" }
  >["variant"]
>;

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
  if (!variant) return { ok: true, project, setup };

  if (variant.environment) {
    setup.input.environment = {
      ...setup.input.environment,
      ...variant.environment,
    };
  }
  if (
    (variant.parameters?.length ?? 0) > 0 &&
    setup.input.kind !== "structured"
  ) {
    return {
      ok: false,
      code: "SIMULATION_VARIANT_REQUIRES_STRUCTURED_SETUP",
      message: "Instance parameter variants require a structured Project setup",
    };
  }
  for (const override of variant.parameters ?? []) {
    const document = project.documents.find(
      (candidate) => candidate.id === override.documentId,
    );
    if (!document) {
      return {
        ok: false,
        code: "SIMULATION_VARIANT_DOCUMENT_MISSING",
        message: `Variant Document does not exist: ${override.documentId}`,
      };
    }
    const instance = document.instances.find(
      (candidate) => candidate.id === override.instanceId,
    );
    if (!instance?.netlist) {
      return {
        ok: false,
        code: "SIMULATION_VARIANT_INSTANCE_MISSING",
        message: `Variant Instance is unavailable or has no netlist parameters: ${override.instanceId}`,
      };
    }
    instance.netlist.parameters[override.parameter] = override.value;
  }
  return { ok: true, project, setup };
}
