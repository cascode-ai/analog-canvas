import { builtInModelDefaults, subcircuitDescriptor } from "@icm/devices";
import {
  voltage,
  current,
  passive,
  printSpiceBehavioralModel,
  type BehavioralElement,
  type BehavioralModel,
} from "./behavioral-model.js";

/**
 * Ideal behavioural bodies for the Library's logic gates and D flip-flops,
 * as the comparator and the analog blocks have theirs. A placed gate then
 * exports a complete netlist and simulates in ngspice; nobody has to draw
 * its transistors. All backends consume the same typed elements and equations.
 *
 * - An input is high above half the supply, V(VDD,VSS)/2. Its level
 *   0..1 comes from a smooth `tanh` step `vt` wide, which keeps Newton
 *   iterations continuous through a transition.
 * - An output swings from VSS to VDD through a one-pole delay `td`, which
 *   breaks the algebraic loop of gates fed back on themselves (latches,
 *   ring oscillators).
 * - A flip-flop is a master latch open while CK is low and a slave latch
 *   open while CK is high, so Q takes D on the rising edge. RST, when the
 *   symbol has it, is active high and clears both.
 */

type Combinational = {
  kind: "combinational";
  symbolId: string;
  inputs: readonly string[];
  fn: "inverter" | "buffer" | "and" | "nand" | "or" | "nor" | "xor" | "xnor";
};

type FlipFlop = {
  kind: "flip-flop";
  symbolId: string;
  reset: boolean;
  complement: boolean;
};

type LogicModel = Combinational | FlipFlop;

const INPUTS = [
  ["", ["A", "B"]],
  ["_3", ["A", "B", "C"]],
  ["_4", ["A", "B", "C", "D"]],
] as const;

const MODELS: Readonly<Record<string, LogicModel>> = Object.fromEntries([
  [
    "inverter",
    {
      kind: "combinational",
      symbolId: "inverter",
      inputs: ["A"],
      fn: "inverter",
    },
  ],
  [
    "buffer",
    { kind: "combinational", symbolId: "buffer", inputs: ["A"], fn: "buffer" },
  ],
  ...(["and", "nand", "or", "nor", "xor", "xnor"] as const).flatMap((fn) =>
    INPUTS.map(([suffix, inputs]) => [
      `${fn}_gate${suffix}`,
      {
        kind: "combinational",
        symbolId: `${fn}-gate${suffix.replace("_", "-")}`,
        inputs,
        fn,
      },
    ]),
  ),
  [
    "d_flip_flop",
    {
      kind: "flip-flop",
      symbolId: "d-flip-flop",
      reset: false,
      complement: true,
    },
  ],
  [
    "d_flip_flop_q",
    {
      kind: "flip-flop",
      symbolId: "d-flip-flop-q",
      reset: false,
      complement: false,
    },
  ],
  [
    "d_flip_flop_reset",
    {
      kind: "flip-flop",
      symbolId: "d-flip-flop-reset",
      reset: true,
      complement: true,
    },
  ],
]);

/** Every subcircuit target this module gives a body. */
export const IDEAL_LOGIC_TARGETS: readonly string[] = Object.keys(MODELS);

function modelPorts(target: string, model: LogicModel): readonly string[] {
  const ports =
    model.kind === "combinational"
      ? ["VDD", "VSS", ...model.inputs, "Y"]
      : [
          "VDD",
          "VSS",
          "D",
          "CK",
          ...(model.reset ? ["RST"] : []),
          "Q",
          ...(model.complement ? ["QBAR"] : []),
        ];
  const descriptor = subcircuitDescriptor(model.symbolId);
  if (
    !descriptor ||
    descriptor.target !== target ||
    descriptor.ports.map((port) => port.name).join(",") !== ports.join(",")
  )
    throw new Error(`Ideal logic model interface drifted: ${target}`);
  return ports;
}

/** An input's logic level, 0..1 volts on an internal node. */
const level = (pin: string) =>
  voltage(
    `Bh${pin}`,
    `h${pin}`,
    "0",
    `0.5*(1+tanh((V(${pin},VSS)-0.5*V(VDD,VSS))/vt))`,
  );

/** The rail-to-rail output of a 0..1 function, delayed by `td`. */
function drive(expression: string, outputs: readonly [string, string?]) {
  const [output, complement] = outputs;
  return [
    voltage("Bf", "nfn", "VSS", `V(VDD,VSS)*(${expression})`),
    passive("resistor", "Rd", "nfn", "ndl", "1k"),
    passive("capacitor", "Cd", "ndl", "VSS", "td/1000", true),
    voltage(`B${output}`, output, "VSS", "V(ndl,VSS)"),
    ...(complement
      ? [voltage(`B${complement}`, complement, "VSS", "V(VDD,VSS)-V(ndl,VSS)")]
      : []),
  ];
}

function combinationalBody(model: Combinational): BehavioralElement[] {
  const levels = model.inputs.map((pin) => `V(h${pin})`);
  const all = levels.join("*");
  const none = levels.map((value) => `(1-${value})`).join("*");
  // Parity, one input at a time, through internal nodes np1, np2, …
  const parity: BehavioralElement[] = [];
  let odd = levels[0]!;
  for (const [index, value] of levels.slice(1).entries()) {
    if (index === levels.length - 2) {
      odd = `${odd}+${value}-2*${odd}*${value}`;
      break;
    }
    parity.push(
      voltage(
        `Bp${index + 1}`,
        `np${index + 1}`,
        "0",
        `${odd}+${value}-2*${odd}*${value}`,
      ),
    );
    odd = `V(np${index + 1})`;
  }
  const expression = {
    inverter: `1-${levels[0]}`,
    buffer: levels[0]!,
    and: all,
    nand: `1-${all}`,
    or: `1-${none}`,
    nor: none,
    xor: odd,
    xnor: `1-(${odd})`,
  }[model.fn];
  return [
    ...model.inputs.map(level),
    ...(model.fn === "xor" || model.fn === "xnor" ? parity : []),
    ...drive(expression, ["Y"]),
  ];
}

function flipFlopBody(model: FlipFlop): BehavioralElement[] {
  const hold = model.reset ? "*(1-V(hRST))" : "";
  const clear = (node: string) => (model.reset ? `-V(${node})*V(hRST)` : "");
  return [
    level("D"),
    level("CK"),
    ...(model.reset ? [level("RST")] : []),
    // The master follows D while CK is low; the slave follows the master
    // while CK is high. A 1 TΩ leak gives each held node a DC path.
    current(
      "Bm",
      "0",
      "nm",
      `10m*((V(hD)-V(nm))*(1-V(hCK))${hold}${clear("nm")})`,
    ),
    passive("capacitor", "Cm", "nm", "0", "1p"),
    passive("resistor", "Rm", "nm", "0", "1T"),
    current("Bs", "0", "ns", `10m*((V(nm)-V(ns))*V(hCK)${hold}${clear("ns")})`),
    passive("capacitor", "Cs", "ns", "0", "1p"),
    passive("resistor", "Rs", "ns", "0", "1T"),
    ...drive("0.5*(1+tanh((V(ns)-0.5)/10m))", [
      "Q",
      ...(model.complement ? ["QBAR"] : []),
    ] as [string, string?]),
  ];
}

/** The `.subckt` text of one gate or flip-flop, ready for an ngspice file. */
export function idealLogicModel(target: string): BehavioralModel {
  const model = MODELS[target];
  if (!model) throw new Error(`No ideal logic model: ${target}`);
  const ports = modelPorts(target, model);
  return {
    name: target,
    ports,
    comment: `Ideal ${model.symbolId}: switches at V(VDD,VSS)/2; vt sets the step width, td the delay`,
    parameters: Object.entries(builtInModelDefaults(target)).map(
      ([name, defaultValue]) => ({ name, defaultValue }),
    ),
    elements:
      model.kind === "combinational"
        ? combinationalBody(model)
        : flipFlopBody(model),
  };
}

/** Existing SPICE consumer API, projected from the shared recipe. */
export function spiceIdealLogicSubcircuit(target: string): string[] {
  return printSpiceBehavioralModel(idealLogicModel(target));
}
