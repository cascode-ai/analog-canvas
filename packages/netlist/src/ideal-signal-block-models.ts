import { builtInModelDefaults, subcircuitDescriptor } from "@icm/devices";

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

type SignalModel = {
  symbolId: string;
  ports: readonly string[];
  body: readonly string[];
};

/** Full scale, kept off zero while the supplies settle. */
const RANGE = "max(V(VDD,VSS),1u)";
const LEVELS = "pow(2,bits)";
const quantizer = [
  `BQ VOUT VSS V={${RANGE}/${LEVELS}*min(max(floor(V(VIN,VSS)*${LEVELS}/${RANGE}),0),${LEVELS}-1)}`,
];

const MODELS: Readonly<Record<string, SignalModel>> = {
  multiplier: {
    symbolId: "multiplier",
    ports: ["VDD", "VSS", "A", "B", "Y"],
    body: ["BY Y 0 V={gain*V(A)*V(B)}"],
  },
  adc: {
    symbolId: "adc",
    ports: ["VDD", "VSS", "VIN", "VOUT"],
    body: quantizer,
  },
  dac: {
    symbolId: "dac",
    ports: ["VDD", "VSS", "VIN", "VOUT"],
    body: quantizer,
  },
};

/** Every subcircuit target this module gives a body. */
export const IDEAL_SIGNAL_TARGETS: readonly string[] = Object.keys(MODELS);

/** The `.subckt` text of one block, ready for an ngspice file. */
export function spiceIdealSignalSubcircuit(target: string): string[] {
  const model = MODELS[target];
  if (!model) throw new Error(`No ideal signal model: ${target}`);
  const descriptor = subcircuitDescriptor(model.symbolId);
  if (
    !descriptor ||
    descriptor.target !== target ||
    descriptor.ports.map((port) => port.name).join(",") !==
      model.ports.join(",")
  )
    throw new Error(`Ideal signal model interface drifted: ${target}`);
  return [
    target === "multiplier"
      ? "* Ideal multiplier: V(Y) = gain*V(A)*V(B) from ground"
      : `* Ideal ${target.toUpperCase()}: 2^bits levels between VSS and VDD, no clock`,
    `.subckt ${target} ${model.ports.join(" ")} params: ${Object.entries(
      builtInModelDefaults(target),
    )
      .map(([name, value]) => `${name}=${value}`)
      .join(" ")}`,
    ...model.body,
    `.ends ${target}`,
  ];
}
