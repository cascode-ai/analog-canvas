import type { CircuitProject } from "@icm/model";

import type { DeviceParameterDefinition } from "./contract.js";
import { deviceDescriptor } from "./registry.js";
import { resolveReviewedExternalBinding } from "./reviewed-external.js";

/**
 * The part of an Instance this needs. Structural, so an Agent Snapshot's
 * Instance qualifies as well as a Project's.
 */
export interface ParameterOwner {
  readonly symbolId: string;
  readonly netlist?:
    | {
        readonly binding?:
          | { readonly kind?: unknown; readonly definitionId?: unknown }
          | undefined;
      }
    | null
    | undefined;
}

/** The parameters an Instance's model owns. */
export interface InstanceParameterContract {
  readonly definitions: readonly DeviceParameterDefinition[];
  /**
   * The model takes parameters beyond `definitions`: an external or
   * hierarchical subcircuit no one has reviewed. Its other names are the
   * author's to choose, not errors.
   */
  readonly open: boolean;
}

/**
 * Which parameters an Instance may carry, decided the way export decides it.
 *
 * - A reviewed PDK binding owns its parameters: a SKY130 resistor takes `w`,
 *   `l` and `mult`, not the built-in resistor's `value`.
 * - An unreviewed external subcircuit, a Cell, or an unresolved subcircuit
 *   takes whatever its definition takes. The built-in descriptor still names
 *   the slots the editor offers.
 * - Any other Instance has its built-in descriptor.
 *
 * Undefined when nothing describes the Instance's parameters: a custom,
 * imported or PDK symbol outside the registry.
 */
export function instanceParameterContract(
  project: Partial<
    Pick<
      CircuitProject,
      "componentDefinitions" | "externalSubcircuitDefinitions"
    >
  >,
  instance: ParameterOwner,
): InstanceParameterContract | undefined {
  const descriptor = deviceDescriptor(
    instance.symbolId,
    project.componentDefinitions
      ? { componentDefinitions: project.componentDefinitions }
      : undefined,
  );
  const binding = instance.netlist?.binding;
  if (binding?.kind === "external-subcircuit") {
    const definitionId = binding.definitionId;
    const definition = project.externalSubcircuitDefinitions?.find(
      (candidate) => candidate.id === definitionId,
    );
    const reviewed = definition
      ? resolveReviewedExternalBinding(
          definition.name,
          definition.terminals.map((terminal) => terminal.name),
        )
      : undefined;
    return reviewed
      ? { definitions: reviewed.parameters, open: false }
      : { definitions: descriptor?.parameters ?? [], open: true };
  }
  if (
    binding?.kind === "subcircuit" ||
    binding?.kind === "unresolved-subcircuit"
  )
    return { definitions: descriptor?.parameters ?? [], open: true };
  return descriptor
    ? { definitions: descriptor.parameters, open: false }
    : undefined;
}
