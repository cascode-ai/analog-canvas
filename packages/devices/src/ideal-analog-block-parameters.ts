/** Authoring defaults shared with the ideal E/G-source subcircuit models. */
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
} as const;

export function idealAnalogBlockParameter(target: string) {
  return Object.hasOwn(parameters, target)
    ? parameters[target as keyof typeof parameters]
    : undefined;
}
