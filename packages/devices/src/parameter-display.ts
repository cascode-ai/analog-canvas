import type { DeviceParameterDefinition } from "./contract.js";
import { deviceDescriptor } from "./registry.js";
import {
  instanceParameterContract,
  type ParameterOwner,
  type InstanceParameterContract,
} from "./instance-parameters.js";

/** Project-owned parameter lookup shared by presentation consumers. */
export interface InstanceParameterResolver {
  readonly resolveParameters?:
    | ((instance: ParameterOwner) => InstanceParameterContract | undefined)
    | undefined;
}

export interface ParameterDisplayContract {
  readonly definitions: readonly DeviceParameterDefinition[];
  readonly individual: readonly DeviceParameterDefinition[];
  readonly summary: "value" | "mos" | "geometry" | "none";
  readonly magnetic: boolean;
}

/** Model selection owns the fields; artwork only selects established typography. */
export function parameterDisplayContract(
  instance: ParameterOwner,
  resolver?: InstanceParameterResolver,
): ParameterDisplayContract {
  const binding = instance.netlist?.binding;
  const bound =
    binding?.kind === "external-subcircuit" || binding?.kind === "subcircuit";
  const contract = resolver?.resolveParameters
    ? resolver.resolveParameters(instance)
    : bound
      ? undefined
      : instanceParameterContract({}, instance);
  const definitions =
    binding?.kind === "unresolved-subcircuit" && !contract?.model
      ? []
      : (contract?.definitions ?? []);
  const descriptor = deviceDescriptor(instance.symbolId);
  const magnetic =
    !bound &&
    ["xfmr", "tcoil", "center-tap-inductor"].includes(instance.symbolId);
  const geometry =
    definitions.some((p) => p.displayRole === "width") &&
    definitions.some((p) => p.displayRole === "length");
  const summary = geometry
    ? descriptor?.deviceClass === "mos"
      ? "mos"
      : "geometry"
    : definitions.some((p) => p.displayRole === "value")
      ? "value"
      : "none";
  const individual = magnetic
    ? [
        ...definitions.filter((p) => p.name === "k"),
        ...definitions.filter((p) => p.name !== "k"),
      ]
    : bound && (contract?.open || descriptor?.deviceClass !== "mos")
      ? definitions
      : definitions.filter((p) => p.displayRole === "multiplier");
  return { definitions, individual, summary, magnetic };
}
