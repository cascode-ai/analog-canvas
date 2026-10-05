import { ADDER_SIGN_PARAMETERS, ADDER_TARGET } from "./adder.js";
import type {
  BuiltInSubcircuitPort,
  DeviceParameterDefinition,
} from "./contract.js";
import { IDEAL_COMPARATOR_TARGET } from "./contract.js";
import { builtInSubcircuitDescriptors } from "./registry.js";

export type ModelBackend = "spice" | "spectre" | "vacask";
/** Implementation selectors contain no equations or backend syntax. */
export type BuiltInModelRecipe =
  | {
      readonly family: "linear";
      readonly implementation:
        | "opamp"
        | "opamp_differential"
        | "voltage_amplifier"
        | "transconductance"
        | "differential_transconductance"
        | "adder";
    }
  | {
      readonly family: "logic";
      readonly implementation:
        | "inverter"
        | "buffer"
        | "and"
        | "nand"
        | "or"
        | "nor"
        | "xor"
        | "xnor"
        | "flip-flop";
    }
  | {
      readonly family: "signal";
      readonly implementation: "multiplier" | "quantizer";
    }
  | { readonly family: "comparator"; readonly implementation: "comparator" };

export type BuiltInModelContract = BuiltInModelRecipe & {
  readonly target: string;
  /** Canonical built-in interface, not a Project-local replacement. */
  readonly symbolId: string;
  readonly ports: readonly BuiltInSubcircuitPort[];
  readonly parameters: readonly DeviceParameterDefinition[];
  /** A call-only export still needs the author's external definition. */
  readonly backends: Readonly<
    Record<ModelBackend, "included" | "external" | "unsupported">
  >;
};

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

const recipes: Readonly<Record<string, BuiltInModelRecipe>> = {
  opamp: { family: "linear", implementation: "opamp" },
  opamp_differential: {
    family: "linear",
    implementation: "opamp_differential",
  },
  voltage_amplifier: { family: "linear", implementation: "voltage_amplifier" },
  transconductance: { family: "linear", implementation: "transconductance" },
  differential_transconductance: {
    family: "linear",
    implementation: "differential_transconductance",
  },
  [ADDER_TARGET]: { family: "linear", implementation: "adder" },
  multiplier: { family: "signal", implementation: "multiplier" },
  adc: { family: "signal", implementation: "quantizer" },
  dac: { family: "signal", implementation: "quantizer" },
  inverter: { family: "logic", implementation: "inverter" },
  buffer: { family: "logic", implementation: "buffer" },
  ...Object.fromEntries(
    (["and", "nand", "or", "nor", "xor", "xnor"] as const).flatMap(
      (implementation) =>
        ["", "_3", "_4"].map((suffix) => [
          `${implementation}_gate${suffix}`,
          { family: "logic", implementation } satisfies BuiltInModelRecipe,
        ]),
    ),
  ),
  d_flip_flop: { family: "logic", implementation: "flip-flop" },
  d_flip_flop_q: { family: "logic", implementation: "flip-flop" },
  d_flip_flop_reset: { family: "logic", implementation: "flip-flop" },
  [IDEAL_COMPARATOR_TARGET]: {
    family: "comparator",
    implementation: "comparator",
  },
};

function contract(target: string): BuiltInModelContract | undefined {
  const recipe = Object.hasOwn(recipes, target) ? recipes[target] : undefined;
  if (!recipe) return undefined;
  const { family, implementation } = recipe;
  const descriptor = builtInSubcircuitDescriptors.find((descriptor) =>
    target === IDEAL_COMPARATOR_TARGET
      ? descriptor.symbolId === "comparator"
      : descriptor.target === target,
  )!;
  return {
    ...recipe,
    target,
    symbolId: descriptor.symbolId,
    // The isolated comparator deliberately lowers only signal ports. Its
    // historical five-port external master is not a generated model.
    ports:
      target === IDEAL_COMPARATOR_TARGET
        ? descriptor.ports.filter((port) => !port.supply)
        : descriptor.ports,
    parameters:
      family === "logic"
        ? logic
        : family === "comparator"
          ? comparator
          : target === ADDER_TARGET
            ? ADDER_SIGN_PARAMETERS
            : Object.hasOwn(analog, target)
              ? [analog[target as keyof typeof analog]]
              : [],
    backends: {
      spice: "included",
      spectre:
        family === "linear" ||
        family === "comparator" ||
        (family === "logic" && implementation !== "flip-flop")
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
