import {
  builtInModelContract,
  builtInModelContracts,
  builtInModelDefaults,
  type BuiltInModelRecipe,
} from "@icm/devices";
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
  inputs: readonly string[];
  fn: Exclude<
    Extract<BuiltInModelRecipe, { family: "logic" }>["implementation"],
    "flip-flop"
  >;
};

type FlipFlop = {
  reset: boolean;
  complement: boolean;
};

/** Every subcircuit target this module gives a body. */
export const IDEAL_LOGIC_TARGETS: readonly string[] = builtInModelContracts
  .filter((model) => model.family === "logic")
  .map((model) => model.target);

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
  const model = builtInModelContract(target);
  if (model?.family !== "logic")
    throw new Error(`No ideal logic model: ${target}`);
  const ports = model.ports.map((port) => port.name);
  return {
    name: target,
    ports,
    comment: `Ideal ${model.symbolId}: switches at V(VDD,VSS)/2; vt sets the step width, td the delay`,
    parameters: Object.entries(builtInModelDefaults(target)).map(
      ([name, defaultValue]) => ({ name, defaultValue }),
    ),
    elements:
      model.implementation === "flip-flop"
        ? flipFlopBody({
            reset: ports.includes("RST"),
            complement: ports.includes("QBAR"),
          })
        : combinationalBody({
            fn: model.implementation,
            inputs: model.ports
              .filter((port) => port.direction === "input")
              .map((port) => port.name),
          }),
  };
}

/** Existing SPICE consumer API, projected from the shared recipe. */
export function spiceIdealLogicSubcircuit(target: string): string[] {
  return printSpiceBehavioralModel(idealLogicModel(target));
}
