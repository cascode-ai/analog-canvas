import { deriveStableId } from "@icm/model";
import {
  adderInputSigns,
  builtInModelContract,
  subcircuitDescriptor,
  type BuiltInSubcircuitDescriptor,
} from "@icm/devices";

import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";

/**
 * The adder's bodies, one per pattern of input signs, each named after the
 * inputs it subtracts: V(Y) = gA·V(A) + gB·V(B). Both inputs adding is the
 * plain `adder`, so a drawing whose adders all add exports as it always has.
 */
const ADDER_BODIES = {
  adder: [1, 1],
  adder_minus_a: [-1, 1],
  adder_minus_b: [1, -1],
  adder_minus_ab: [-1, -1],
} as const satisfies Record<string, readonly [number, number]>;
type AdderBody = keyof typeof ADDER_BODIES;

/**
 * The master a built-in block's call names. An authored target wins: a
 * comparator's isolated model, or any subcircuit the author retargeted the
 * block to. An adder left on its own body calls the body its input signs
 * choose; an invalid sign leaves it on `adder`, for export to refuse.
 */
export function builtInBlockCallTarget(
  instance: {
    readonly netlist?:
      | {
          readonly binding?:
            { readonly kind?: unknown; readonly name?: unknown } | undefined;
          readonly parameters?: Readonly<Record<string, string>> | undefined;
        }
      | null
      | undefined;
  },
  descriptor: BuiltInSubcircuitDescriptor,
): string {
  const binding = instance.netlist?.binding;
  const target =
    binding?.kind === "unresolved-subcircuit" &&
    typeof binding.name === "string"
      ? binding.name
      : descriptor.target;
  if (
    descriptor.target !== "adder" ||
    target.toLowerCase() !== descriptor.target
  )
    return target;
  const signs = adderInputSigns(instance.netlist?.parameters);
  if (signs.some((input) => input.sign === null)) return target;
  const subtracted = signs
    .filter((input) => input.sign === "-")
    .map((input) => input.pinName.toLowerCase())
    .join("");
  return subtracted ? `adder_minus_${subtracted}` : target;
}

type IdealBlockTarget =
  | "opamp"
  | "opamp_differential"
  | "voltage_amplifier"
  | "transconductance"
  | "differential_transconductance"
  | "adder";

const MODELS: Record<
  IdealBlockTarget,
  {
    symbolId: string;
    ports: readonly string[];
  }
> = {
  opamp: {
    symbolId: "opamp",
    ports: ["VDD", "VSS", "VIP", "VIN", "VOUT"],
  },
  opamp_differential: {
    symbolId: "opamp-differential",
    ports: ["VDD", "VSS", "VIP", "VIN", "VOP", "VON"],
  },
  voltage_amplifier: {
    symbolId: "voltage-amplifier",
    ports: ["VDD", "VSS", "VIN", "VOUT"],
  },
  transconductance: {
    symbolId: "transconductance",
    ports: ["VDD", "VSS", "VIN", "VOUT"],
  },
  differential_transconductance: {
    symbolId: "differential-transconductance",
    ports: ["VDD", "VSS", "VIP", "VIN", "VOUT"],
  },
  // The signal-flow summing node: linear, so SPICE and Spectre share it.
  adder: {
    symbolId: "adder",
    ports: ["VDD", "VSS", "A", "B", "Y"],
  },
};

function controlledSource(
  target: string,
  reference: string,
  deviceClass: "vcvs" | "vccs",
  nodes: readonly [string, string, string, string],
  parameter: "gain" | "gm",
  expression: string,
  format: NetlistFormat,
): DesignNetlistInstance {
  return {
    id: deriveStableId("netlist-ideal-block-source", target, reference),
    reference,
    invocationKind: "primitive",
    deviceClass,
    target: null,
    nodes: nodes.map((netName, index) => ({
      pinName: ["OUT+", "OUT-", "CTRL+", "CTRL-"][index]!,
      netName,
    })),
    parameters: [
      {
        name: parameter,
        rawValue: format === "spice" ? `{${expression}}` : expression,
      },
    ],
  };
}

/**
 * Idealized, frequency-independent E/G-source macros. VDD/VSS stay in the
 * reviewed block interface for existing drawings, but deliberately do not
 * limit or power this model. The ground-referenced output can therefore
 * exceed those rails; a powered/limited amplifier needs a separate model.
 */
export function idealAnalogBlockCell(
  target: string,
  format: NetlistFormat,
): DesignNetlistCell | null {
  // Every adder body shares the adder's model entry; its signs choose the
  // body and are never a SPICE parameter of it.
  const adderGains = Object.hasOwn(ADDER_BODIES, target)
    ? ADDER_BODIES[target as AdderBody]
    : undefined;
  const name = adderGains ? "adder" : target;
  if (!Object.hasOwn(MODELS, name)) return null;
  const model = MODELS[name as IdealBlockTarget];
  const parameter = adderGains
    ? undefined
    : builtInModelContract(name)?.parameters[0];
  if (!adderGains && !parameter)
    throw new Error(`Ideal analog model has no parameter: ${name}`);
  const descriptor = subcircuitDescriptor(model.symbolId);
  if (
    !descriptor ||
    descriptor.target !== name ||
    descriptor.ports.map((port) => port.name).join(",") !==
      model.ports.join(",")
  )
    throw new Error(`Ideal analog model interface drifted: ${name}`);

  const e = (
    reference: string,
    nodes: readonly [string, string, string, string],
    expression = "gain",
  ) =>
    controlledSource(
      target,
      reference,
      "vcvs",
      nodes,
      "gain",
      expression,
      format,
    );
  const g = (nodes: readonly [string, string, string, string]) =>
    controlledSource(target, "GCORE", "vccs", nodes, "gm", "gm", format);
  const instances: DesignNetlistInstance[] = adderGains
    ? // Two sources stacked through nsum: V(Y) = gA·V(A) + gB·V(B).
      [
        e("ESUMA", ["Y", "nsum", "A", "0"], String(adderGains[0])),
        e("ESUMB", ["nsum", "0", "B", "0"], String(adderGains[1])),
      ]
    : name === "opamp"
      ? [e("ECORE", ["VOUT", "0", "VIP", "VIN"])]
      : name === "opamp_differential"
        ? [
            e("EPLUS", ["VOP", "0", "VIP", "VIN"], "gain/2"),
            e("EMINUS", ["VON", "0", "VIN", "VIP"], "gain/2"),
          ]
        : name === "voltage_amplifier"
          ? [e("ECORE", ["VOUT", "0", "VIN", "0"])]
          : name === "transconductance"
            ? [g(["0", "VOUT", "VIN", "0"])]
            : [g(["0", "VOUT", "VIP", "VIN"])];

  return {
    origin: "generated-model",
    id: deriveStableId("netlist-ideal-block-cell", target),
    name: target,
    ports: model.ports.map((port, index) => ({
      id: deriveStableId("netlist-ideal-block-port", target, String(index)),
      name: port,
      netName: port,
    })),
    nets: [
      ...model.ports.map((port, index) => ({
        id: deriveStableId("netlist-ideal-block-net", target, String(index)),
        name: port,
        scope: "local" as const,
      })),
      ...(adderGains
        ? [
            {
              id: deriveStableId("netlist-ideal-block-net", target, "nsum"),
              name: "nsum",
              scope: "local" as const,
            },
          ]
        : []),
    ],
    formalParameters: parameter
      ? [
          {
            name: parameter.name,
            ...(parameter.defaultValue !== undefined
              ? { defaultValue: parameter.defaultValue }
              : {}),
          },
        ]
      : [],
    instances,
  };
}
