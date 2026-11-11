import { deriveStableId } from "@icm/model";
import { builtInModelContract } from "@icm/devices";

import { GENERIC_DIODE_MODEL } from "./extract-generic-models.js";
import type {
  DesignNetlistCell,
  DesignNetlistInstance,
  DesignNetlistModel,
} from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";

/**
 * The textbook equivalent circuits of the switching devices SPICE has no
 * card for, each a body of primitive cards its call names, on the generic
 * cards' parameters under names of the body's own (a model inside a
 * subcircuit is that subcircuit's, so a Project's DIODE, NPN or PNP never
 * reaches it):
 *
 * - `ujt` (`e b1 b2`): the base bar split at the emitter junction, rbb·eta
 *   to B1 and rbb·(1 − eta) to B2, and the emitter diode onto that point.
 *   It fires at the peak point eta·V(B2, B1) plus a diode drop; there is no
 *   conductivity modulation, so no negative resistance past it.
 */
export function semiconductorDeviceCell(
  target: string,
  format: NetlistFormat,
): DesignNetlistCell | null {
  const model = builtInModelContract(target);
  if (model?.family !== "semiconductor") return null;
  const ports = model.ports.map((port) => port.name);
  const expression = (text: string) =>
    format === "spice" ? `{${text}}` : text;
  const part = (
    deviceClass: "resistor" | "diode",
    reference: string,
    nodes: readonly (readonly [string, string])[],
    value: { target: string } | { value: string },
  ): DesignNetlistInstance => ({
    id: deriveStableId("netlist-semiconductor-device", target, reference),
    reference,
    invocationKind: "primitive",
    deviceClass,
    target: "target" in value ? value.target : null,
    nodes: nodes.map(([pinName, netName]) => ({ pinName, netName })),
    parameters:
      "value" in value ? [{ name: "value", rawValue: value.value }] : [],
  });
  const generic = (
    name: string,
    card: DesignNetlistModel,
  ): DesignNetlistModel => ({
    name,
    type: card.type,
    parameters: structuredClone(card.parameters),
  });
  const [e, b1, b2] = ports as [string, string, string];
  const internal = ["nb"];
  const instances = [
    part(
      "resistor",
      "RB1",
      [
        ["1", "nb"],
        ["2", b1],
      ],
      { value: expression("rbb*eta") },
    ),
    part(
      "resistor",
      "RB2",
      [
        ["1", b2],
        ["2", "nb"],
      ],
      { value: expression("rbb*(1-eta)") },
    ),
    part(
      "diode",
      "DE",
      [
        ["A", e],
        ["K", "nb"],
      ],
      { target: "de" },
    ),
  ];
  const models = [generic("de", GENERIC_DIODE_MODEL)];
  return {
    origin: "generated-model",
    id: deriveStableId("netlist-semiconductor-device-cell", target),
    name: target,
    ports: ports.map((port, index) => ({
      id: deriveStableId(
        "netlist-semiconductor-device-port",
        target,
        String(index),
      ),
      name: port,
      netName: port,
    })),
    nets: [...ports, ...internal].map((name) => ({
      id: deriveStableId("netlist-semiconductor-device-net", target, name),
      name,
      scope: "local" as const,
    })),
    formalParameters: model.parameters.map((parameter) => ({
      name: parameter.name,
      ...(parameter.defaultValue !== undefined
        ? { defaultValue: parameter.defaultValue }
        : {}),
    })),
    instances,
    models,
  };
}
