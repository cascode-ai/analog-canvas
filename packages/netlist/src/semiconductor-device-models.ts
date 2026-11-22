import { deriveStableId } from "@icm/model";
import { builtInModelContract } from "@icm/devices";

import {
  GENERIC_DIODE_MODEL,
  GENERIC_NMOS_MODEL,
  GENERIC_NPN_MODEL,
  GENERIC_PNP_MODEL,
  GENERIC_SCHOTTKY_MODEL,
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
 * - `scr` (`a g k`): the PUT's pair with the gate on the NPN's base, 10 kΩ
 *   and 10 pF holding the inner (anode) gate and 1 kΩ and 10 pF the gate.
 *   Both transistors start the operating point off, so a thyristor rests
 *   off until its gate draws about 0.65 mA, then latches.
 * - `igbt` (`c g e`): an NMOS (W/L 1m/1u, vth0 4 V on the generic BSIM4
 *   card) from the base of a PNP to E, the PNP from C to E.
 * - `crd` (`a k`): a JFET with its gate on its source, area idss/1 mA on a
 *   card of IDSS 1 mA, VTO −2 V and LAMBDA 0.002.
 * - `schottky_npn` (`c b e`): an NPN with a Schottky diode (the generic DSCH
 *   card) from base to collector, which holds it out of deep saturation.
 *
 * Regulators and board parts (family `board`) are bodies the same way:
 * - `tl431` (`k a ref`): a 2.495 V reference, an error amplifier of gain
 *   1000 and an NPN sinking K to A, so REF is held 2.495 V above A.
 * - `voltage_regulator`, `voltage_reference` (`in gnd out`): a reference at
 *   vout, an error amplifier of gain 1000 and an NPN pass transistor from IN
 *   to OUT (no dropout or current limit model).
 * - `solar_cell` (`p n`): a photocurrent isc in parallel with a diode.
 * - `antenna` (`p`): 1 GΩ to ground, so its Net is never floating.
 * - `controlled_current_source` (`p n ctrl`): gm·V(CTRL) from + to −.
 */
export function semiconductorDeviceCell(
  target: string,
  format: NetlistFormat,
): DesignNetlistCell | null {
  const model = builtInModelContract(target);
  if (model?.family !== "semiconductor" && model?.family !== "board")
    return null;
  const ports = model.ports.map((port) => port.name);
  const expression = (text: string) =>
    format === "spice" ? `{${text}}` : text;
  const valueName = {
    "voltage-source": "dc",
    "current-source": "dc",
    vcvs: "gain",
    vccs: "gm",
  } as const;
  const part = (
    deviceClass:
      | "resistor"
      | "capacitor"
      | "diode"
      | "bjt"
      | "jfet"
      | "mos"
      | "voltage-source"
      | "current-source"
      | "vcvs"
      | "vccs",
    reference: string,
    nodes: readonly (readonly [string, string])[],
    value:
      | {
          target: string;
          parameters?: readonly (readonly [string, string])[];
          off?: true;
        }
      | { value: string },
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
              name: Object.hasOwn(valueName, deviceClass)
                ? valueName[deviceClass as keyof typeof valueName]
                : "value",
              rawValue: value.value,
            },
          ]
        : (value.parameters ?? []).map(([name, rawValue]) => ({
            name,
            rawValue,
          })),
    ...("target" in value && value.off ? { initiallyOff: true as const } : {}),
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
  } else if (model.implementation === "scr") {
    const [a, g, k] = ports as [string, string, string];
    internal = ["n1"];
    instances = [
      part(
        "bjt",
        "Q1",
        [
          ["C", g],
          ["B", "n1"],
          ["E", a],
        ],
        { target: "qp", off: true },
      ),
      part(
        "bjt",
        "Q2",
        [
          ["C", "n1"],
          ["B", g],
          ["E", k],
        ],
        { target: "qn", off: true },
      ),
      part(
        "resistor",
        "RAG",
        [
          ["1", "n1"],
          ["2", a],
        ],
        { value: "10k" },
      ),
      part(
        "capacitor",
        "CAG",
        [
          ["1", "n1"],
          ["2", a],
        ],
        { value: "10p" },
      ),
      part(
        "resistor",
        "RGK",
        [
          ["1", g],
          ["2", k],
        ],
        { value: "1k" },
      ),
      part(
        "capacitor",
        "CGK",
        [
          ["1", g],
          ["2", k],
        ],
        { value: "10p" },
      ),
    ];
    models = [
      generic("qn", GENERIC_NPN_MODEL),
      generic("qp", GENERIC_PNP_MODEL),
    ];
  } else if (model.implementation === "igbt") {
    const [c, g, e] = ports as [string, string, string];
    internal = ["nb"];
    instances = [
      part(
        "mos",
        "M1",
        [
          ["D", "nb"],
          ["G", g],
          ["S", e],
          ["B", e],
        ],
        {
          target: "nm",
          parameters: [
            ["w", "1m"],
            ["l", "1u"],
          ],
        },
      ),
      part(
        "bjt",
        "Q1",
        [
          ["C", e],
          ["B", "nb"],
          ["E", c],
        ],
        { target: "qp" },
      ),
    ];
    models = [
      {
        name: "nm",
        type: "nmos",
        parameters: [
          ...structuredClone(GENERIC_NMOS_MODEL.parameters),
          { name: "vth0", rawValue: "4" },
        ],
      },
      generic("qp", GENERIC_PNP_MODEL),
    ];
  } else if (model.implementation === "crd") {
    const [a, k] = ports as [string, string];
    internal = [];
    instances = [
      part(
        "jfet",
        "J1",
        [
          ["D", a],
          ["G", k],
          ["S", k],
        ],
        { target: "cj", parameters: [["area", expression("idss/1m")]] },
      ),
    ];
    // IDSS = BETA·VTO² = 1 mA at unit area.
    models = [
      {
        name: "cj",
        type: "NJF",
        parameters: [
          { name: "VTO", rawValue: "-2" },
          { name: "BETA", rawValue: "0.25m" },
          { name: "LAMBDA", rawValue: "0.002" },
        ],
      },
    ];
  } else if (model.implementation === "tl431") {
    const [k, a, ref] = ports as [string, string, string];
    internal = ["nr", "nx", "nb"];
    instances = [
      part(
        "voltage-source",
        "VREF",
        [
          ["+", "nr"],
          ["-", a],
        ],
        { value: "2.495" },
      ),
      part(
        "vcvs",
        "EAMP",
        [
          ["OUT+", "nx"],
          ["OUT-", a],
          ["CTRL+", ref],
          ["CTRL-", "nr"],
        ],
        { value: "1000" },
      ),
      part(
        "resistor",
        "RB",
        [
          ["1", "nx"],
          ["2", "nb"],
        ],
        { value: "1k" },
      ),
      part(
        "bjt",
        "Q1",
        [
          ["C", k],
          ["B", "nb"],
          ["E", a],
        ],
        { target: "qn" },
      ),
      part(
        "diode",
        "DREV",
        [
          ["A", a],
          ["K", k],
        ],
        { target: "dj" },
      ),
    ];
    models = [
      generic("qn", GENERIC_NPN_MODEL),
      generic("dj", GENERIC_DIODE_MODEL),
    ];
  } else if (model.implementation === "regulator") {
    const [input, gnd, out] = ports as [string, string, string];
    internal = ["nr", "nx", "nb"];
    instances = [
      part(
        "voltage-source",
        "VREF",
        [
          ["+", "nr"],
          ["-", gnd],
        ],
        { value: expression("vout") },
      ),
      part(
        "vcvs",
        "EAMP",
        [
          ["OUT+", "nx"],
          ["OUT-", gnd],
          ["CTRL+", "nr"],
          ["CTRL-", out],
        ],
        { value: "1000" },
      ),
      part(
        "resistor",
        "RB",
        [
          ["1", "nx"],
          ["2", "nb"],
        ],
        { value: "1k" },
      ),
      part(
        "bjt",
        "Q1",
        [
          ["C", input],
          ["B", "nb"],
          ["E", out],
        ],
        { target: "qn" },
      ),
    ];
    models = [generic("qn", GENERIC_NPN_MODEL)];
  } else if (model.implementation === "solar_cell") {
    const [p, n] = ports as [string, string];
    internal = [];
    instances = [
      part(
        "current-source",
        "IPH",
        [
          ["+", n],
          ["-", p],
        ],
        { value: expression("isc") },
      ),
      part(
        "diode",
        "D1",
        [
          ["A", p],
          ["K", n],
        ],
        { target: "dj" },
      ),
    ];
    models = [generic("dj", GENERIC_DIODE_MODEL)];
  } else if (model.implementation === "antenna") {
    const [p] = ports as [string];
    internal = [];
    instances = [
      part(
        "resistor",
        "R1",
        [
          ["1", p],
          ["2", "0"],
        ],
        { value: "1G" },
      ),
    ];
    models = [];
  } else if (model.implementation === "controlled_current_source") {
    const [p, n, ctrl] = ports as [string, string, string];
    internal = [];
    instances = [
      part(
        "vccs",
        "GCORE",
        [
          ["OUT+", p],
          ["OUT-", n],
          ["CTRL+", ctrl],
          ["CTRL-", "0"],
        ],
        { value: expression("gm") },
      ),
    ];
    models = [];
  } else if (model.implementation === "schottky_npn") {
    const [c, b, e] = ports as [string, string, string];
    internal = [];
    instances = [
      part(
        "bjt",
        "Q1",
        [
          ["C", c],
          ["B", b],
          ["E", e],
        ],
        { target: "qn" },
      ),
      part(
        "diode",
        "DS",
        [
          ["A", b],
          ["K", c],
        ],
        { target: "ds" },
      ),
    ];
    models = [
      generic("qn", GENERIC_NPN_MODEL),
      generic("ds", GENERIC_SCHOTTKY_MODEL),
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
