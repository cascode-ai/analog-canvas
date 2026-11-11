import { deriveStableId } from "@icm/model";
import {
  ADDER_TARGET,
  adderBodyFor,
  adderBodySigns,
  adderInputSigns,
  builtInModelContract,
  callsIdealComparatorBody,
  idealComparatorBodyFor,
  idealComparatorModelTarget,
  type BuiltInSubcircuitDescriptor,
  type InputSign,
} from "@icm/devices";

import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { semiconductorDeviceCell } from "./semiconductor-device-models.js";

/**
 * The master a built-in block's call names. An authored target wins: any
 * subcircuit the author retargeted the block to. A comparator bound to the
 * ideal comparator, under either body's name, calls the body its high level
 * chooses: the one reading its own VDD, or the numeric one. An adder left on
 * its own body calls the body its input signs choose, whatever the Project
 * defines (#1928). An invalid sign leaves the adder on `adder`, for export
 * to refuse.
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
  if (callsIdealComparatorBody(descriptor, target))
    return idealComparatorBodyFor(
      instance.netlist?.parameters,
      idealComparatorModelTarget(target),
    );
  if (
    descriptor.target !== ADDER_TARGET ||
    target.toLowerCase() !== ADDER_TARGET
  )
    return target;
  const signs = adderInputSigns(instance.netlist?.parameters).map(
    (input) => input.sign,
  );
  if (!signs.every((sign): sign is InputSign => sign !== null)) return target;
  const body = adderBodyFor(signs);
  return body === ADDER_TARGET ? target : body;
}

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
 * exceed those rails. The single-ended op-amp is limited and has bodies of
 * its own (generated-models.ts); the fully differential op-amp's outputs sit
 * about `vocm` (ground by default), held there as an ideal CMFB holds them.
 * A unijunction, PUT or Shockley diode is a body of primitive cards the
 * same way (semiconductor-device-models.ts).
 */
export function idealAnalogBlockCell(
  target: string,
  format: NetlistFormat,
): DesignNetlistCell | null {
  const device = semiconductorDeviceCell(target, format);
  if (device) return device;
  // Every adder body shares the adder's model entry; its signs choose the
  // body and are never a SPICE parameter of it.
  const adderSigns = adderBodySigns(target);
  const name = adderSigns ? ADDER_TARGET : target;
  const model = builtInModelContract(name);
  if (model?.family !== "linear") return null;
  const ports = model.ports.map((port) => port.name);
  const parameters = adderSigns ? [] : model.parameters;
  if (!adderSigns && parameters.length === 0)
    throw new Error(`Ideal analog model has no parameter: ${name}`);
  const differential = model.implementation === "opamp_differential";

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
  const gain = (sign: InputSign) => (sign === "-" ? "-1" : "1");
  const instances: DesignNetlistInstance[] = adderSigns
    ? // Two sources stacked through nsum: V(Y) = ±V(A) ± V(B).
      [
        e("ESUMA", ["Y", "nsum", "A", "0"], gain(adderSigns[0])),
        e("ESUMB", ["nsum", "0", "B", "0"], gain(adderSigns[1])),
      ]
    : differential
      ? [
          {
            id: deriveStableId("netlist-ideal-block-source", target, "VCM"),
            reference: "VCM",
            invocationKind: "primitive",
            deviceClass: "voltage-source",
            target: null,
            nodes: [
              { pinName: "+", netName: "ncm" },
              { pinName: "-", netName: "0" },
            ],
            parameters: [
              { name: "dc", rawValue: format === "spice" ? "{vocm}" : "vocm" },
            ],
          },
          e("EPLUS", ["VOP", "ncm", "VIP", "VIN"], "gain/2"),
          e("EMINUS", ["VON", "ncm", "VIN", "VIP"], "gain/2"),
        ]
      : model.implementation === "voltage_amplifier"
        ? [e("ECORE", ["VOUT", "0", "VIN", "0"])]
        : model.implementation === "transconductance"
          ? [g(["0", "VOUT", "VIN", "0"])]
          : [g(["0", "VOUT", "VIP", "VIN"])];

  return {
    origin: "generated-model",
    id: deriveStableId("netlist-ideal-block-cell", target),
    name: target,
    ports: ports.map((port, index) => ({
      id: deriveStableId("netlist-ideal-block-port", target, String(index)),
      name: port,
      netName: port,
    })),
    nets: [
      ...ports.map((port, index) => ({
        id: deriveStableId("netlist-ideal-block-net", target, String(index)),
        name: port,
        scope: "local" as const,
      })),
      ...(adderSigns || differential
        ? [
            {
              id: deriveStableId(
                "netlist-ideal-block-net",
                target,
                adderSigns ? "nsum" : "ncm",
              ),
              name: adderSigns ? "nsum" : "ncm",
              scope: "local" as const,
            },
          ]
        : []),
    ],
    formalParameters: parameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.defaultValue !== undefined
        ? { defaultValue: parameter.defaultValue }
        : {}),
    })),
    instances,
  };
}
