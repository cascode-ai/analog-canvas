import type { DeviceParameterDefinition } from "./contract.js";
import { IDEAL_COMPARATOR_TARGET } from "./contract.js";
import { builtInSubcircuitDescriptors } from "./registry.js";

export type ModelBackend = "spice" | "spectre" | "vacask";
export interface BuiltInModelContract {
  readonly target: string;
  readonly family: "linear" | "logic" | "signal" | "comparator";
  readonly parameters: readonly DeviceParameterDefinition[];
  /** A call-only export still needs the author's external definition. */
  readonly backends: Readonly<
    Record<ModelBackend, "included" | "external" | "unsupported">
  >;
}

function parameter(
  name: string,
  label: string,
  defaultValue: string,
  unitHint: string,
  help: string,
): DeviceParameterDefinition {
  return {
    name,
    label,
    defaultValue,
    unitHint,
    help,
    placeholder: defaultValue,
    required: false,
    editor: "text",
    displayRole: "none",
  };
}

const analog = {
  opamp: parameter(
    "gain",
    "Open-loop gain",
    "1e6",
    "V/V",
    "Ideal, frequency-independent open-loop voltage gain; output is not rail-limited.",
  ),
  opamp_differential: parameter(
    "gain",
    "Differential gain",
    "1e6",
    "V/V",
    "Ideal, frequency-independent differential voltage gain; outputs are not rail-limited.",
  ),
  voltage_amplifier: parameter(
    "gain",
    "Voltage gain",
    "1",
    "V/V",
    "Ideal, frequency-independent voltage gain; output is not rail-limited.",
  ),
  transconductance: parameter(
    "gm",
    "Transconductance",
    "1m",
    "S",
    "Ideal transconductance; positive input voltage drives output current into the load.",
  ),
  differential_transconductance: parameter(
    "gm",
    "Differential transconductance",
    "1m",
    "S",
    "Ideal transconductance driven by the differential input voltage.",
  ),
  multiplier: parameter(
    "gain",
    "Gain",
    "1",
    "1/V",
    "Ideal product V(Y) = gain·V(A)·V(B), from ground; output is not rail-limited.",
  ),
  adc: parameter(
    "bits",
    "Resolution",
    "8",
    "bits",
    "Ideal quantizer: the input maps onto 2^bits levels between VSS and VDD, without a clock.",
  ),
  dac: parameter(
    "bits",
    "Resolution",
    "8",
    "bits",
    "Ideal quantizer: the input code, as a voltage between VSS and VDD, maps onto 2^bits output levels.",
  ),
} as const;

/** A summing input's sign: `+` adds the input, `-` subtracts it. */
export type InputSign = "+" | "-";

/**
 * The adder's inputs, each with the parameter that signs it. The signs are
 * choices, not SPICE parameters: export reads them to pick the adder's body
 * and writes none of them on the call, and the drawing marks each input with
 * its sign once one subtracts.
 */
export const ADDER_SIGNED_INPUTS = [
  { pinName: "A", parameter: "signA" },
  { pinName: "B", parameter: "signB" },
] as const;

const adderSigns = ADDER_SIGNED_INPUTS.map(
  ({ pinName, parameter: name }): DeviceParameterDefinition => ({
    name,
    label: `Input ${pinName} sign`,
    defaultValue: "+",
    help: `+ adds input ${pinName} and - subtracts it: Y = ±A ± B.`,
    placeholder: "+",
    required: false,
    editor: "select",
    options: [
      { value: "+", label: "+" },
      { value: "-", label: "−" },
    ],
    displayRole: "none",
  }),
);

/**
 * The sign each adder input carries, in pin order, read as export reads it.
 * A missing parameter adds, as on every adder drawn before signs existed;
 * a value other than `+` or `-` reads as null, for the caller to refuse.
 */
export function adderInputSigns(
  parameters: Readonly<Record<string, string>> | undefined,
): readonly {
  readonly pinName: (typeof ADDER_SIGNED_INPUTS)[number]["pinName"];
  readonly parameter: string;
  readonly sign: InputSign | null;
}[] {
  return ADDER_SIGNED_INPUTS.map(({ pinName, parameter }) => {
    const authored = Object.entries(parameters ?? {}).find(
      ([name]) => name.toLowerCase() === parameter.toLowerCase(),
    );
    const value = authored?.[1].trim() ?? "+";
    return {
      pinName,
      parameter: authored?.[0] ?? parameter,
      sign: value === "+" || value === "-" ? value : null,
    };
  });
}

const logic = [
  parameter(
    "vt",
    "Transition width",
    "10m",
    "V",
    "Smooth logic threshold width about half the supply voltage.",
  ),
  parameter(
    "td",
    "Output time constant",
    "10p",
    "s",
    "One-pole output delay; not a digital event propagation delay.",
  ),
];
const comparator = [
  parameter(
    "vhigh",
    "High output",
    "1",
    "V",
    "Supply-independent high output level.",
  ),
  parameter(
    "vlow",
    "Low output",
    "0",
    "V",
    "Supply-independent low output level.",
  ),
  parameter(
    "vtransition",
    "Transition width",
    "1m",
    "V",
    "Positive smooth comparator transition width.",
  ),
];

function contract(target: string): BuiltInModelContract | undefined {
  const family =
    target === IDEAL_COMPARATOR_TARGET
      ? "comparator"
      : target === "multiplier" || target === "adc" || target === "dac"
        ? "signal"
        : target === "adder" || Object.hasOwn(analog, target)
          ? "linear"
          : /^(?:inverter|buffer|(?:and|nand|or|nor|xor|xnor)_gate(?:_[34])?|d_flip_flop(?:_q|_reset)?)$/u.test(
                target,
              )
            ? "logic"
            : undefined;
  if (!family) return undefined;
  return {
    target,
    family,
    parameters:
      family === "logic"
        ? logic
        : family === "comparator"
          ? comparator
          : target === "adder"
            ? adderSigns
            : Object.hasOwn(analog, target)
              ? [analog[target as keyof typeof analog]]
              : [],
    backends: {
      spice: "included",
      spectre:
        family === "linear" ||
        family === "comparator" ||
        (family === "logic" && !target.startsWith("d_flip_flop"))
          ? "included"
          : "external",
      vacask: "included",
    },
  };
}

/** Model facts, not artwork or Project state. Family factories consume these defaults. */
export const builtInModelContracts: readonly BuiltInModelContract[] = [
  ...new Set([
    ...builtInSubcircuitDescriptors.map((descriptor) => descriptor.target),
    IDEAL_COMPARATOR_TARGET,
  ]),
].flatMap((target) => {
  const model = contract(target);
  return model ? [model] : [];
});
const byTarget = new Map(
  builtInModelContracts.map((model) => [model.target, model]),
);
export function builtInModelContract(
  target: string,
): BuiltInModelContract | undefined {
  return byTarget.get(target);
}

export function builtInModelDefaults(target: string): Record<string, string> {
  return Object.fromEntries(
    (builtInModelContract(target)?.parameters ?? []).flatMap((p) =>
      p.defaultValue === undefined ? [] : [[p.name, p.defaultValue]],
    ),
  );
}
