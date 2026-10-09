import {
  builtInModelContract,
  builtInModelContracts,
  builtInModelDefaults,
} from "@icm/devices";
import {
  voltage,
  printSpiceBehavioralModel,
  type BehavioralModel,
} from "./behavioral-model.js";

/**
 * Ideal ngspice bodies for the multiplier and the two converters. They are
 * nonlinear, so unlike the adder their canonical bodies use B-sources. The
 * native VACASK generator consumes these same reviewed equations.
 *
 * - The multiplier is a signal-flow mixing node: V(Y) = gain·V(A)·V(B) from
 *   ground, gain in 1/V. VDD/VSS stay in the interface, unused, as for the
 *   ideal amplifiers.
 * - The ADC and the DAC each map their input onto 2^bits levels between VSS
 *   and VDD, without a clock: the output is VSS + LSB·code, where code is the
 *   input's whole number of LSBs, clamped to 0 … 2^bits − 1. One analog pin
 *   each carries the code as that voltage, so an ADC into a DAC reproduces
 *   the quantized input.
 */

/** Full scale, kept off zero while the supplies settle. */
const RANGE = "max(V(VDD,VSS),1u)";
const LEVELS = "pow(2,bits)";
const quantizer = [
  voltage(
    "BQ",
    "VOUT",
    "VSS",
    `${RANGE}/${LEVELS}*min(max(floor(V(VIN,VSS)*${LEVELS}/${RANGE}),0),${LEVELS}-1)`,
  ),
];

/**
 * Every subcircuit target this module gives a body.
 * @internal Tests hold every signal model contract to a body.
 */
export const IDEAL_SIGNAL_TARGETS: readonly string[] = builtInModelContracts
  .filter((model) => model.family === "signal")
  .map((model) => model.target);

/** The `.subckt` text of one block, ready for an ngspice file. */
export function idealSignalModel(target: string): BehavioralModel {
  const model = builtInModelContract(target);
  if (model?.family !== "signal")
    throw new Error(`No ideal signal model: ${target}`);
  return {
    name: target,
    ports: model.ports.map((port) => port.name),
    comment:
      model.implementation === "multiplier"
        ? "Ideal multiplier: V(Y) = gain*V(A)*V(B) from ground"
        : `Ideal ${target.toUpperCase()}: 2^bits levels between VSS and VDD, no clock`,
    parameters: Object.entries(builtInModelDefaults(target)).map(
      ([name, defaultValue]) => ({ name, defaultValue }),
    ),
    elements:
      model.implementation === "multiplier"
        ? [voltage("BY", "Y", "0", "gain*V(A)*V(B)")]
        : quantizer,
  };
}

/** @internal Tests read each printed body. */
export function spiceIdealSignalSubcircuit(target: string): string[] {
  return printSpiceBehavioralModel(idealSignalModel(target));
}
