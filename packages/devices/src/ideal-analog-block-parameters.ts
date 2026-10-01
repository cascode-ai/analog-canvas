/**
 * Authoring defaults shared with the ideal subcircuit models: the E/G-source
 * amplifiers, and the ngspice bodies of the multiplier and the converters.
 */
const parameters = {
  opamp: {
    name: "gain",
    label: "Open-loop gain",
    defaultValue: "1e6",
    unitHint: "V/V",
    help: "Ideal, frequency-independent open-loop voltage gain; output is not rail-limited.",
  },
  opamp_differential: {
    name: "gain",
    label: "Differential gain",
    defaultValue: "1e6",
    unitHint: "V/V",
    help: "Ideal, frequency-independent differential voltage gain; outputs are not rail-limited.",
  },
  voltage_amplifier: {
    name: "gain",
    label: "Voltage gain",
    defaultValue: "1",
    unitHint: "V/V",
    help: "Ideal, frequency-independent voltage gain; output is not rail-limited.",
  },
  transconductance: {
    name: "gm",
    label: "Transconductance",
    defaultValue: "1m",
    unitHint: "S",
    help: "Ideal transconductance; positive input voltage drives output current into the load.",
  },
  differential_transconductance: {
    name: "gm",
    label: "Differential transconductance",
    defaultValue: "1m",
    unitHint: "S",
    help: "Ideal transconductance driven by the differential input voltage.",
  },
  multiplier: {
    name: "gain",
    label: "Gain",
    defaultValue: "1",
    unitHint: "1/V",
    help: "Ideal product V(Y) = gain·V(A)·V(B), from ground; output is not rail-limited.",
  },
  adc: {
    name: "bits",
    label: "Resolution",
    defaultValue: "8",
    unitHint: "bits",
    help: "Ideal quantizer: the input maps onto 2^bits levels between VSS and VDD, without a clock.",
  },
  dac: {
    name: "bits",
    label: "Resolution",
    defaultValue: "8",
    unitHint: "bits",
    help: "Ideal quantizer: the input code, as a voltage between VSS and VDD, maps onto 2^bits output levels.",
  },
} as const;

export function idealAnalogBlockParameter(target: string) {
  return Object.hasOwn(parameters, target)
    ? parameters[target as keyof typeof parameters]
    : undefined;
}
