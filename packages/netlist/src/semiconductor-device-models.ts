import { deriveStableId } from "@icm/model";
import { builtInModelContract } from "@icm/devices";

import {
  GENERIC_DIODE_MODEL,
  GENERIC_NPN_MODEL,
  GENERIC_PNP_MODEL,
} from "./extract-generic-models.js";
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
 * - `put` (`a g k`): the two-transistor thyristor, a PNP from the anode
 *   with its base on the anode gate and an NPN to the cathode collecting
 *   from that gate, each driving the other's base. 1 MΩ from the inner
 *   (cathode) gate to K keeps that node defined while both are off, and
 *   10 pF across it gives the regenerative switch a finite speed a
 *   transient can follow. It fires once the anode is a diode drop above G.
 * - `shockley` (`a k`): the same two transistors with the gate inside, and
 *   the centre junction's avalanche as a diode behind a source of
 *   vbo − 1.9 V, so the anode breaks over at about vbo: through Q1's
 *   emitter, that diode and 1 kΩ from the inner p gate to K, until Q2
 *   turns on and the pair latches. It holds at about 0.8 V down to about
 *   0.8 mA; 10 pF across the 1 kΩ, as in the PUT.
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
    deviceClass: "resistor" | "capacitor" | "diode" | "bjt" | "voltage-source",
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
      "value" in value
        ? [
            {
              name: deviceClass === "voltage-source" ? "dc" : "value",
              rawValue: value.value,
            },
          ]
        : [],
  });
  const generic = (
    name: string,
    card: DesignNetlistModel,
  ): DesignNetlistModel => ({
    name,
    type: card.type,
    parameters: structuredClone(card.parameters),
  });
  let internal: string[];
  let instances: DesignNetlistInstance[];
  let models: DesignNetlistModel[];
  if (model.implementation === "ujt") {
    const [e, b1, b2] = ports as [string, string, string];
    internal = ["nb"];
    instances = [
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
    models = [generic("de", GENERIC_DIODE_MODEL)];
  } else if (model.implementation === "shockley") {
    const [a, k] = ports as [string, string];
    internal = ["n1", "p2", "nz"];
    instances = [
      part(
        "bjt",
        "Q1",
        [
          ["C", "p2"],
          ["B", "n1"],
          ["E", a],
        ],
        { target: "qp" },
      ),
      part(
        "bjt",
        "Q2",
        [
          ["C", "n1"],
          ["B", "p2"],
          ["E", k],
        ],
        { target: "qn" },
      ),
      part(
        "voltage-source",
        "VBO",
        [
          ["+", "n1"],
          ["-", "nz"],
        ],
        { value: expression("vbo-1.9") },
      ),
      part(
        "diode",
        "DBO",
        [
          ["A", "nz"],
          ["K", "p2"],
        ],
        { target: "dj" },
      ),
      part(
        "resistor",
        "RGK",
        [
          ["1", "p2"],
          ["2", k],
        ],
        { value: "1k" },
      ),
      part(
        "capacitor",
        "CGK",
        [
          ["1", "p2"],
          ["2", k],
        ],
        { value: "10p" },
      ),
    ];
    models = [
      generic("qn", GENERIC_NPN_MODEL),
      generic("qp", GENERIC_PNP_MODEL),
      generic("dj", GENERIC_DIODE_MODEL),
    ];
  } else {
    const [a, g, k] = ports as [string, string, string];
    internal = ["nk"];
    instances = [
      part(
        "bjt",
        "Q1",
        [
          ["C", "nk"],
          ["B", g],
          ["E", a],
        ],
        { target: "qp" },
      ),
      part(
        "bjt",
        "Q2",
        [
          ["C", g],
          ["B", "nk"],
          ["E", k],
        ],
        { target: "qn" },
      ),
      part(
        "resistor",
        "RGK",
        [
          ["1", "nk"],
          ["2", k],
        ],
        { value: "1Meg" },
      ),
      part(
        "capacitor",
        "CGK",
        [
          ["1", "nk"],
          ["2", k],
        ],
        { value: "10p" },
      ),
    ];
    models = [
      generic("qn", GENERIC_NPN_MODEL),
      generic("qp", GENERIC_PNP_MODEL),
    ];
  }
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
