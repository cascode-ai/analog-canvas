import { deriveStableId, type CircuitProject } from "@icm/model";
import {
  ADDER_TARGET,
  adderBodyFor,
  adderBodySigns,
  adderInputSigns,
  builtInModelContract,
  type BuiltInSubcircuitDescriptor,
  type InputSign,
} from "@icm/devices";

import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";

/**
 * The subcircuit names a Project defines itself, in lower case, as SPICE
 * compares names: its exported Cells and its declared external definitions.
 * Each replaces any generated body of the same name.
 */
export function projectSubcircuitNames(
  project: Pick<CircuitProject, "externalSubcircuitDefinitions">,
  cellNames: Iterable<string>,
): ReadonlySet<string> {
  return new Set([
    ...Array.from(cellNames, (name) => name.toLowerCase()),
    ...project.externalSubcircuitDefinitions.map((definition) =>
      definition.name.toLowerCase(),
    ),
  ]);
}

/**
 * The master a built-in block's call names. An authored target wins: a
 * comparator's isolated model, or any subcircuit the author retargeted the
 * block to. An adder left on its own body calls the body its input signs
 * choose, unless the Project defines `adder` itself: a Cell or an external
 * definition of that name replaces every built-in adder body, so the call
 * keeps calling it, whatever the signs. An invalid sign leaves the adder on
 * `adder`, for export to refuse.
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
  /** The Project's own subcircuit names; see projectSubcircuitNames. */
  projectNames: ReadonlySet<string>,
): string {
  const binding = instance.netlist?.binding;
  const target =
    binding?.kind === "unresolved-subcircuit" &&
    typeof binding.name === "string"
      ? binding.name
      : descriptor.target;
  if (
    descriptor.target !== ADDER_TARGET ||
    target.toLowerCase() !== ADDER_TARGET ||
    projectNames.has(ADDER_TARGET)
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
 * exceed those rails; a powered/limited amplifier needs a separate model.
 */
export function idealAnalogBlockCell(
  target: string,
  format: NetlistFormat,
): DesignNetlistCell | null {
  // Every adder body shares the adder's model entry; its signs choose the
  // body and are never a SPICE parameter of it.
  const adderSigns = adderBodySigns(target);
  const name = adderSigns ? ADDER_TARGET : target;
  const model = builtInModelContract(name);
  if (model?.family !== "linear") return null;
  const ports = model.ports.map((port) => port.name);
  const parameter = adderSigns ? undefined : model.parameters[0];
  if (!adderSigns && !parameter)
    throw new Error(`Ideal analog model has no parameter: ${name}`);

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
    : model.implementation === "opamp"
      ? [e("ECORE", ["VOUT", "0", "VIP", "VIN"])]
      : model.implementation === "opamp_differential"
        ? [
            e("EPLUS", ["VOP", "0", "VIP", "VIN"], "gain/2"),
            e("EMINUS", ["VON", "0", "VIN", "VIP"], "gain/2"),
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
      ...(adderSigns
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
