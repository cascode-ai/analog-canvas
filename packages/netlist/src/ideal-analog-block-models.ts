import { deriveStableId } from "@icm/model";
import { builtInModelContract, subcircuitDescriptor } from "@icm/devices";

import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";

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
  target: IdealBlockTarget,
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
  if (!Object.hasOwn(MODELS, target)) return null;
  const name = target as IdealBlockTarget;
  const model = MODELS[name];
  // The adder has no setting: Y is A + B.
  const parameter = builtInModelContract(name)?.parameters[0];
  if (name !== "adder" && !parameter)
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
      name,
      reference,
      "vcvs",
      nodes,
      "gain",
      expression,
      format,
    );
  const g = (nodes: readonly [string, string, string, string]) =>
    controlledSource(name, "GCORE", "vccs", nodes, "gm", "gm", format);
  const instances: DesignNetlistInstance[] =
    name === "opamp"
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
            : name === "adder"
              ? // Two unity sources stacked through nsum: V(Y) = V(A) + V(B).
                [
                  e("ESUMA", ["Y", "nsum", "A", "0"], "1"),
                  e("ESUMB", ["nsum", "0", "B", "0"], "1"),
                ]
              : [g(["0", "VOUT", "VIP", "VIN"])];

  return {
    origin: "generated-model",
    id: deriveStableId("netlist-ideal-block-cell", name),
    name,
    ports: model.ports.map((port, index) => ({
      id: deriveStableId("netlist-ideal-block-port", name, String(index)),
      name: port,
      netName: port,
    })),
    nets: [
      ...model.ports.map((port, index) => ({
        id: deriveStableId("netlist-ideal-block-net", name, String(index)),
        name: port,
        scope: "local" as const,
      })),
      ...(name === "adder"
        ? [
            {
              id: deriveStableId("netlist-ideal-block-net", name, "nsum"),
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
