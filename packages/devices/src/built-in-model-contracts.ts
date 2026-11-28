import { ADDER_SIGN_PARAMETERS, ADDER_TARGET } from "./adder.js";
import type {
  BuiltInSubcircuitPort,
  DeviceParameterDefinition,
} from "./contract.js";
import { IDEAL_COMPARATOR_TARGET } from "./contract.js";
import {
  HIGH_LEVEL_PARAMETER,
  DIFFERENTIAL_COMPARATOR_TARGET,
  idealComparatorBodyPorts,
  idealComparatorModelTarget,
  idealComparatorReadsSupply,
  SUPPLY_HIGH_LEVEL,
  type IdealComparatorBody,
} from "./ideal-comparator.js";
import {
  OPAMP_GBW,
  OPAMP_GBW_DEFAULT,
  OPAMP_HIGH_LIMIT,
  OPAMP_LIMIT_SUPPLIES,
  OPAMP_LOW_LIMIT,
  OPAMP_ROUT,
  OPAMP_ROUT_DEFAULT,
  OPAMP_TARGET,
  UNPOWERED_OPAMP_LIMITS,
  idealOpampBodyReads,
  type IdealOpampBody,
} from "./ideal-opamp.js";
import { builtInSubcircuitDescriptors } from "./registry.js";

export type ModelBackend = "spice" | "spectre";
/** Implementation selectors contain no equations or backend syntax. */
export type BuiltInModelRecipe =
  | {
      readonly family: "linear";
      readonly implementation:
        | "opamp_differential"
        | "voltage_amplifier"
        | "single_to_diff_amplifier"
        | "differential_video_amplifier"
        | "transconductance"
        | "differential_transconductance"
        | "fully_differential_transconductance"
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
        | "delay"
        | "flip-flop";
    }
  | {
      readonly family: "signal";
      readonly implementation:
        | "multiplier"
        | "quantizer"
        | "differential-input-quantizer"
        | "differential-output-quantizer";
    }
  | { readonly family: "comparator"; readonly implementation: "comparator" }
  | {
      readonly family: "passive";
      readonly implementation:
        "crystal" | "potentiometer" | "transmission-line" | "relay";
    }
  | { readonly family: "opamp"; readonly implementation: "opamp" }
  | {
      readonly family: "amplifier";
      readonly implementation:
        | "opamp_compensated"
        | "opamp_enable"
        | "opamp_bias"
        | "differential_line_driver";
    }
  | {
      /** A box standing for a subcircuit the reader's libraries define. */
      readonly family: "generic";
      readonly implementation: "impedance" | "two-port";
    }
  | {
      readonly family: "semiconductor";
      readonly implementation:
        "ujt" | "put" | "shockley" | "scr" | "igbt" | "crd" | "schottky_npn";
    }
  | {
      readonly family: "board";
      readonly implementation:
        | "tl431"
        | "regulator"
        | "solar_cell"
        | "antenna"
        | "controlled_current_source"
        | "center_tap_xfmr";
    };

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

function optionalParameter(
  name: string,
  label: string,
  placeholder: string,
  unitHint: string,
  help: string,
): DeviceParameterDefinition {
  return {
    name,
    label,
    unitHint,
    help,
    placeholder,
    required: false,
    editor: "text",
    displayRole: "none",
  };
}

const OPAMP_DYNAMIC_PARAMETERS: readonly DeviceParameterDefinition[] = [
  optionalParameter(
    OPAMP_GBW,
    "Unity-gain bandwidth",
    OPAMP_GBW_DEFAULT,
    "Hz",
    "Optional dominant-pole unity-gain bandwidth (fp = gbw/gain). Leave blank for an ideal memoryless op-amp.",
  ),
  optionalParameter(
    OPAMP_ROUT,
    "Output resistance",
    OPAMP_ROUT_DEFAULT,
    "Ohm",
    "Optional series output resistance at VOUT (each output on differential op-amps). Leave blank for zero output impedance.",
  ),
];

// An ideal CMFB holds the outputs about vocm, from ground: a single supply
// needs it where the outputs drive gates or a following stage.
const differentialOpamp: readonly DeviceParameterDefinition[] = [
  parameter(
    "gain",
    "Differential gain",
    "1e6",
    "V/V",
    "Ideal, frequency-independent differential voltage gain; outputs are not rail-limited.",
  ),
  parameter(
    "vocm",
    "Output common mode",
    "0",
    "V",
    "Output common-mode level from ground, held as an ideal CMFB holds it: OUT± = vocm ± gain·(IN+ − IN−)/2.",
  ),
  ...OPAMP_DYNAMIC_PARAMETERS,
];

const analog = {
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
  fully_differential_transconductance: parameter(
    "gm",
    "Differential transconductance",
    "1m",
    "S",
    "Ideal fully differential transconductance sourcing +gm/2·(IN+ − IN−) into OUT+ and sinking gm/2·(IN+ − IN−) from OUT−.",
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
  adc_differential: parameter(
    "bits",
    "Resolution",
    "8",
    "bits",
    "Ideal quantizer: IN+ − IN− from −(VDD−VSS)/2 to +(VDD−VSS)/2 maps onto 2^bits levels between VSS and VDD, without a clock.",
  ),
  dac_differential: parameter(
    "bits",
    "Resolution",
    "8",
    "bits",
    "Ideal quantizer: the input code, as a voltage between VSS and VDD, maps onto 2^bits levels of OUT+ − OUT−, centred on (VDD+VSS)/2.",
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
const delay = [
  logic[0]!,
  {
    ...parameter(
      "tpd",
      "Propagation delay",
      "10p",
      "s",
      "Nominal 50% propagation delay for a settled full-swing step. RC state with logic regeneration; narrow pulses may be suppressed, not pure transport delay.",
    ),
    expressions: false,
  },
].map((definition) => ({ ...definition, expressions: false }));
// A 10 MHz fundamental crystal's Butterworth-Van Dyke equivalent: series
// resonance fs = 1/(2π·√(lm·cm)) ≈ 10 MHz, Q = 2π·fs·lm/rm ≈ 32,000.
const crystal: readonly DeviceParameterDefinition[] = [
  parameter(
    "rm",
    "Motional resistance",
    "25",
    "Ohm",
    "Series loss of the motional branch; sets the resonance's Q = 2π·fs·Lm/Rm.",
  ),
  parameter(
    "lm",
    "Motional inductance",
    "12.7m",
    "H",
    "Mass of the vibrating quartz; with Cm it sets the series resonance fs = 1/(2π·√(Lm·Cm)).",
  ),
  parameter(
    "cm",
    "Motional capacitance",
    "20f",
    "F",
    "Compliance of the vibrating quartz; with Lm it sets the series resonance fs = 1/(2π·√(Lm·Cm)).",
  ),
  parameter(
    "c0",
    "Shunt capacitance",
    "5p",
    "F",
    "Electrode and holder capacitance across the pins; parallel resonance lies just above fs.",
  ),
];
// A potentiometer's track, end 1 to end 2, with the wiper W a fraction `pos`
// of the way from end 1.
// Its value is the track's, shown as a resistor's.
const potentiometer: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      "r",
      "Total resistance",
      "10k",
      "Ohm",
      "Resistance of the whole track, end 1 to end 2.",
    ),
    displayRole: "value",
  },
  parameter(
    "pos",
    "Wiper position",
    "0.5",
    "",
    "Wiper position from end 1 (0) to end 2 (1): end 1 to W is r·pos, W to end 2 is r·(1−pos), each at least 1 mΩ.",
  ),
];
// A lossless line between port 1 (P1, N1) and port 2 (P2, N2): a matched
// 50 Ω line one nanosecond long. A line given by frequency and electrical
// length takes td = nl/f.
const transmissionLine: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      "z0",
      "Characteristic impedance",
      "50",
      "Ohm",
      "Ratio of voltage to current of a wave on the line.",
    ),
    displayRole: "value",
  },
  parameter(
    "td",
    "Delay",
    "1n",
    "s",
    "Time a wave takes from one port to the other. A line of normalized electrical length nl at frequency f has td = nl/f: a quarter wave at 1 GHz is {0.25/1G}.",
  ),
];
const relay: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      "rcoil",
      "Coil resistance",
      "150",
      "Ohm",
      "DC resistance of the energizing coil between COIL+ and COIL−.",
    ),
    displayRole: "value",
    valueName: "RCOIL",
  },
  parameter(
    "von",
    "Pull-in voltage",
    "5",
    "V",
    "Coil voltage threshold |V(COIL+, COIL−)| above which COM switches from NC to NO.",
  ),
  parameter(
    "ron",
    "Closed resistance",
    "1",
    "Ohm",
    "On-state contact resistance between COM and the closed throw.",
  ),
  parameter(
    "roff",
    "Open resistance",
    "1e12",
    "Ohm",
    "Off-state isolation resistance between COM and the open throw.",
  ),
];
const singleToDiffAmplifier: readonly DeviceParameterDefinition[] = [
  parameter(
    "gain",
    "Differential gain",
    "10",
    "V/V",
    "Ideal single-ended-to-differential voltage gain: OUT± = vocm ± gain·IN/2.",
  ),
  parameter(
    "vocm",
    "Output common mode",
    "0",
    "V",
    "Output common-mode level from ground.",
  ),
];
const differentialVideoAmplifier: readonly DeviceParameterDefinition[] = [
  parameter(
    "gain",
    "Differential gain",
    "100",
    "V/V",
    "Ideal differential voltage gain (NE592 style): OUT± = vocm ± gain·(IN+ − IN−)/2.",
  ),
  parameter(
    "vocm",
    "Output common mode",
    "0",
    "V",
    "Output common-mode level from ground.",
  ),
];
const amplifierParameters: Readonly<
  Record<string, readonly DeviceParameterDefinition[]>
> = {
  opamp_compensated: [
    parameter(
      "gain",
      "Open-loop gain",
      "1e6",
      "V/V",
      "Ideal open-loop voltage gain between the output limits.",
    ),
    parameter("vhigh", "Output high limit", "5", "V", "High output limit."),
    parameter("vlow", "Output low limit", "-5", "V", "Low output limit."),
  ],
  opamp_enable: [
    parameter(
      "gain",
      "Open-loop gain",
      "1e6",
      "V/V",
      "Ideal open-loop voltage gain when enabled.",
    ),
    parameter("vhigh", "Output high limit", "5", "V", "High output limit."),
    parameter("vlow", "Output low limit", "-5", "V", "Low output limit."),
    parameter(
      "vt",
      "Enable threshold",
      "0.5",
      "V",
      "Input voltage on EN above which the output stage is active.",
    ),
    parameter(
      "ron",
      "Enabled output resistance",
      "10",
      "Ohm",
      "Series output resistance while enabled.",
    ),
    parameter(
      "roff",
      "Muted output resistance",
      "1e9",
      "Ohm",
      "High-impedance output resistance while muted/disabled.",
    ),
  ],
  opamp_bias: [
    parameter(
      "gain",
      "Open-loop gain",
      "1e6",
      "V/V",
      "Ideal open-loop voltage gain between the output limits.",
    ),
    parameter("vhigh", "Output high limit", "5", "V", "High output limit."),
    parameter("vlow", "Output low limit", "-5", "V", "Low output limit."),
    parameter(
      "vbias",
      "Bias output voltage",
      "0.7",
      "V",
      "DC voltage driven on VBIAS through a 100 Ω source impedance.",
    ),
    parameter(
      "vt",
      "Enable threshold",
      "0.5",
      "V",
      "Input voltage on optional EN above which the output stage is active.",
    ),
  ],
  differential_line_driver: [
    parameter("vhigh", "High output", "3.3", "V", "Logic-high output level."),
    parameter("vlow", "Low output", "0", "V", "Logic-low output level."),
    parameter(
      "vt",
      "Input threshold",
      "1.5",
      "V",
      "Input switching threshold on IN.",
    ),
    parameter(
      "ven",
      "Enable threshold",
      "0.5",
      "V",
      "Enable threshold on EN above which OUT+ and OUT− drive the line.",
    ),
    parameter(
      "ron",
      "Driver impedance",
      "50",
      "Ohm",
      "Output impedance of OUT+ and OUT− while enabled.",
    ),
    parameter(
      "roff",
      "Tri-state impedance",
      "1e12",
      "Ohm",
      "High-impedance off resistance while disabled.",
    ),
  ],
};
// A unijunction's base bar, B2 to B1, with the emitter junction meeting it
// a fraction `eta` of the way up from B1.
// Its value is R_BB.
const ujt: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      "rbb",
      "Interbase resistance",
      "7k",
      "Ohm",
      "Resistance of the base bar from B2 to B1 with the emitter open.",
    ),
    displayRole: "value",
    valueName: "RBB",
  },
  parameter(
    "eta",
    "Intrinsic standoff ratio",
    "0.65",
    "",
    "Fraction of rbb between the emitter junction and B1: the emitter conducts once it is about eta·V(B2, B1) plus a diode drop above B1.",
  ),
];
// A four-layer diode blocks forward until its breakover voltage, its value
// V_BO.
const shockley: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      "vbo",
      "Breakover voltage",
      "10",
      "V",
      "Forward voltage at which the diode switches on, at about 0.65 mA (1 V or more); it then holds at about 0.8 V until its current falls below about 0.8 mA.",
    ),
    displayRole: "value",
    valueName: "VBO",
  },
];
// A current-regulative diode passes about its rated current from A to K
// once a few volts are across it, its value I_DSS.
const crd: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      "idss",
      "Regulated current",
      "5m",
      "A",
      "Current from A to K once about 2 V or more is across it, rising 0.2 %/V; it is the JFET's saturation current.",
    ),
    displayRole: "value",
    valueName: "IDSS",
  },
];
// Regulators and board parts whose body is a few primitive cards. A
// regulator's or reference's value is the level it holds OUT at, a solar
// cell's its short-circuit current, a controlled source's its gain.
const level = (defaultValue: string): DeviceParameterDefinition => ({
  ...parameter(
    "vout",
    "Output voltage",
    defaultValue,
    "V",
    "Level OUT is held at above GND while IN is above it; below that OUT follows IN.",
  ),
  displayRole: "value",
  valueName: "VOUT",
});
const boardParameters: Readonly<
  Record<string, readonly DeviceParameterDefinition[]>
> = {
  voltage_regulator: [level("5")],
  voltage_reference: [level("2.5")],
  solar_cell: [
    {
      ...parameter(
        "isc",
        "Short-circuit current",
        "10m",
        "A",
        "Photocurrent at the light the figure means: the current into a short; open, the cell sits at about 0.7 V.",
      ),
      displayRole: "value",
      valueName: "ISC",
    },
  ],
  controlled_current_source: [
    {
      ...parameter(
        "gm",
        "Transconductance",
        "1m",
        "S",
        "Current gm·V(CTRL) from + to − through the source, CTRL read from ground.",
      ),
      displayRole: "value",
    },
  ],
  center_tap_xfmr: [
    parameter(
      "lp",
      "Primary inductance",
      "1m",
      "H",
      "Total primary inductance from P+ to P− (split into lp/4 halves when PC is wired).",
    ),
    parameter(
      "ls",
      "Secondary inductance",
      "1m",
      "H",
      "Total secondary inductance from S+ to S− (each half S+–SC and SC–S− is ls/4).",
    ),
    parameter(
      "k",
      "Coupling",
      "0.99",
      "",
      "Magnetic coupling between primary and secondary windings (-1 < k < 1).",
    ),
  ],
};
// The ideal comparator's export checks that each level is a number, so none
// takes an expression in braces.
const comparator: readonly DeviceParameterDefinition[] = [
  {
    ...parameter(
      HIGH_LEVEL_PARAMETER,
      "High output",
      SUPPLY_HIGH_LEVEL,
      "V",
      "VDD, the comparator's own supply, or a level in volts from ground. The logic it drives reads a high above half its supply.",
    ),
    keywords: [SUPPLY_HIGH_LEVEL],
  },
  parameter("vlow", "Low output", "0", "V", "Low output level from ground."),
  parameter(
    "vtransition",
    "Transition width",
    "1m",
    "V",
    "Positive smooth comparator transition width.",
  ),
].map((definition) => ({ ...definition, expressions: false }));
// The op-amp's limits are each a number or its supply (ideal-opamp.ts), which
// export checks, so neither takes an expression in braces.
const opamp: readonly DeviceParameterDefinition[] = [
  parameter(
    "gain",
    "Open-loop gain",
    "1e6",
    "V/V",
    "Ideal, frequency-independent open-loop voltage gain, exact between the output limits.",
  ),
  {
    ...parameter(
      OPAMP_HIGH_LIMIT,
      "Output high limit",
      OPAMP_LIMIT_SUPPLIES[OPAMP_HIGH_LIMIT],
      "V",
      `VDD, the op-amp's own supply, or a level in volts from ground. An op-amp with no supply drawn reads ${UNPOWERED_OPAMP_LIMITS[OPAMP_HIGH_LIMIT]} V.`,
    ),
    keywords: [OPAMP_LIMIT_SUPPLIES[OPAMP_HIGH_LIMIT]],
    expressions: false,
  },
  {
    ...parameter(
      OPAMP_LOW_LIMIT,
      "Output low limit",
      OPAMP_LIMIT_SUPPLIES[OPAMP_LOW_LIMIT],
      "V",
      `VSS, the op-amp's own negative supply or ground, or a level in volts from ground. An op-amp with no supply drawn reads ${UNPOWERED_OPAMP_LIMITS[OPAMP_LOW_LIMIT]} V.`,
    ),
    keywords: [OPAMP_LIMIT_SUPPLIES[OPAMP_LOW_LIMIT]],
    expressions: false,
  },
  ...OPAMP_DYNAMIC_PARAMETERS,
];

const recipes: Readonly<Record<string, BuiltInModelRecipe>> = {
  [OPAMP_TARGET]: { family: "opamp", implementation: "opamp" },
  opamp_differential: {
    family: "linear",
    implementation: "opamp_differential",
  },
  voltage_amplifier: { family: "linear", implementation: "voltage_amplifier" },
  single_to_diff_amplifier: {
    family: "linear",
    implementation: "single_to_diff_amplifier",
  },
  differential_video_amplifier: {
    family: "linear",
    implementation: "differential_video_amplifier",
  },
  transconductance: { family: "linear", implementation: "transconductance" },
  differential_transconductance: {
    family: "linear",
    implementation: "differential_transconductance",
  },
  fully_differential_transconductance: {
    family: "linear",
    implementation: "fully_differential_transconductance",
  },
  opamp_compensated: {
    family: "amplifier",
    implementation: "opamp_compensated",
  },
  opamp_enable: {
    family: "amplifier",
    implementation: "opamp_enable",
  },
  opamp_bias: {
    family: "amplifier",
    implementation: "opamp_bias",
  },
  differential_line_driver: {
    family: "amplifier",
    implementation: "differential_line_driver",
  },
  [ADDER_TARGET]: { family: "linear", implementation: "adder" },
  multiplier: { family: "signal", implementation: "multiplier" },
  adc: { family: "signal", implementation: "quantizer" },
  dac: { family: "signal", implementation: "quantizer" },
  adc_differential: {
    family: "signal",
    implementation: "differential-input-quantizer",
  },
  dac_differential: {
    family: "signal",
    implementation: "differential-output-quantizer",
  },
  inverter: { family: "logic", implementation: "inverter" },
  buffer: { family: "logic", implementation: "buffer" },
  delay_cell: { family: "logic", implementation: "delay" },
  ...Object.fromEntries(
    (["and", "nand", "or", "nor", "xor", "xnor"] as const).flatMap(
      (implementation) =>
        ["", "_3", "_4"].map((suffix) => [
          `${implementation}_gate${suffix}`,
          { family: "logic", implementation } satisfies BuiltInModelRecipe,
        ]),
    ),
  ),
  crystal: { family: "passive", implementation: "crystal" },
  potentiometer: { family: "passive", implementation: "potentiometer" },
  transmission_line: {
    family: "passive",
    implementation: "transmission-line",
  },
  spdt_relay: { family: "passive", implementation: "relay" },
  impedance: { family: "generic", implementation: "impedance" },
  two_port: { family: "generic", implementation: "two-port" },
  ujt: { family: "semiconductor", implementation: "ujt" },
  put: { family: "semiconductor", implementation: "put" },
  shockley: { family: "semiconductor", implementation: "shockley" },
  scr: { family: "semiconductor", implementation: "scr" },
  igbt: { family: "semiconductor", implementation: "igbt" },
  crd: { family: "semiconductor", implementation: "crd" },
  schottky_npn: { family: "semiconductor", implementation: "schottky_npn" },
  tl431: { family: "board", implementation: "tl431" },
  voltage_regulator: { family: "board", implementation: "regulator" },
  voltage_reference: { family: "board", implementation: "regulator" },
  solar_cell: { family: "board", implementation: "solar_cell" },
  antenna: { family: "board", implementation: "antenna" },
  controlled_current_source: {
    family: "board",
    implementation: "controlled_current_source",
  },
  center_tap_xfmr: {
    family: "board",
    implementation: "center_tap_xfmr",
  },
  d_flip_flop: { family: "logic", implementation: "flip-flop" },
  d_flip_flop_q: { family: "logic", implementation: "flip-flop" },
  d_flip_flop_reset: { family: "logic", implementation: "flip-flop" },
  [IDEAL_COMPARATOR_TARGET]: {
    family: "comparator",
    implementation: "comparator",
  },
  [DIFFERENTIAL_COMPARATOR_TARGET]: {
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
    // The ideal comparator's numeric body lowers only signal ports; the body
    // its VDD high level chooses adds VDD (ideal-comparator.ts). Its
    // historical five-port external master is not a generated model. An
    // optional port has a body of its own (differential-opamp.ts).
    ports:
      family === "comparator"
        ? idealComparatorBodyPorts(
            target as IdealComparatorBody,
            descriptor.ports,
          )
        : descriptor.ports.filter((port) => !port.optional),
    parameters:
      family === "logic"
        ? implementation === "delay"
          ? delay
          : logic
        : family === "comparator"
          ? comparator
          : family === "opamp"
            ? opamp
            : family === "passive"
              ? implementation === "crystal"
                ? crystal
                : implementation === "transmission-line"
                  ? transmissionLine
                  : implementation === "relay"
                    ? relay
                    : potentiometer
              : family === "amplifier"
                ? (amplifierParameters[target] ?? [])
                : family === "semiconductor"
                  ? implementation === "ujt"
                    ? ujt
                    : implementation === "shockley"
                      ? shockley
                      : implementation === "crd"
                        ? crd
                        : // A PUT's peak point is its gate's, set by the
                          // circuit; a thyristor, IGBT or clamped NPN has
                          // its generic transistors' own.
                          []
                  : family === "board"
                    ? (boardParameters[target] ?? [])
                    : target === ADDER_TARGET
                      ? ADDER_SIGN_PARAMETERS
                      : target === "opamp_differential"
                        ? differentialOpamp
                        : target === "single_to_diff_amplifier"
                          ? singleToDiffAmplifier
                          : target === "differential_video_amplifier"
                            ? differentialVideoAmplifier
                            : Object.hasOwn(analog, target)
                              ? [analog[target as keyof typeof analog]]
                              : [],
    // A generic block is only ever a call: the reader's libraries define it.
    backends:
      family === "generic"
        ? { spice: "external", spectre: "external" }
        : {
            spice: "included",
            spectre:
              family === "linear" ||
              family === "opamp" ||
              family === "amplifier" ||
              family === "comparator" ||
              family === "passive" ||
              family === "semiconductor" ||
              family === "board" ||
              (family === "logic" && implementation !== "flip-flop")
                ? "included"
                : "external",
          },
  };
}

/**
 * Whether a target is a generic block's (#2445): a box that stands for a
 * subcircuit of the reader's own, which no netlist here defines.
 */
export function isGenericBlockTarget(target: string): boolean {
  return builtInModelContract(target)?.family === "generic";
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

/** One generated ideal comparator body: what its equation reads and declares. */
export interface IdealComparatorBodyContract {
  readonly name: IdealComparatorBody;
  /** Its high level is V(VDD), in place of a `vhigh` parameter. */
  readonly readsSupply: boolean;
  /** The comparator interface's ports the body takes, in order. */
  readonly ports: readonly BuiltInSubcircuitPort[];
  /** The parameters the body declares, with the defaults it prints. */
  readonly parameters: readonly {
    readonly name: string;
    readonly defaultValue: string;
  }[];
}

/**
 * The numeric body's own `vhigh` default: the level every comparator placed
 * before VDD became the catalog default stores, so that body prints as it
 * always has.
 */
const NUMERIC_BODY_HIGH_LEVEL = "1";

/** The ideal comparator's model facts as one of its bodies takes them. */
export function idealComparatorBodyContract(
  body: IdealComparatorBody,
): IdealComparatorBodyContract {
  const model = builtInModelContract(idealComparatorModelTarget(body))!;
  const readsSupply = idealComparatorReadsSupply(body);
  const descriptor = builtInSubcircuitDescriptors.find(
    (candidate) => candidate.symbolId === model.symbolId,
  )!;
  return {
    name: body,
    readsSupply,
    ports: idealComparatorBodyPorts(body, descriptor.ports),
    parameters: model.parameters.flatMap((p) =>
      p.name !== HIGH_LEVEL_PARAMETER
        ? [{ name: p.name, defaultValue: p.defaultValue! }]
        : readsSupply
          ? []
          : [{ name: p.name, defaultValue: NUMERIC_BODY_HIGH_LEVEL }],
    ),
  };
}

/** One generated ideal op-amp body: what its equation reads and declares. */
export interface IdealOpampBodyContract {
  readonly name: IdealOpampBody;
  /** Its high limit is V(VDD), in place of a `vhigh` parameter. */
  readonly readsVdd: boolean;
  /** Its low limit is V(VSS), in place of a `vlow` parameter. */
  readonly readsVss: boolean;
  /** Includes a single-pole dominant bandwidth stage controlled by `gbw`. */
  readonly readsGbw: boolean;
  /** Includes a series output resistance controlled by `rout`. */
  readonly readsRout: boolean;
  /** Every body takes the op-amp's whole interface, in order. */
  readonly ports: readonly BuiltInSubcircuitPort[];
  /** The parameters the body declares, with the defaults it prints. */
  readonly parameters: readonly {
    readonly name: string;
    readonly defaultValue: string;
  }[];
}

/**
 * The ideal op-amp's model facts as one of its bodies takes them. A numeric
 * limit's default is the level an op-amp with no supply of its own reads.
 */
export function idealOpampBodyContract(
  body: IdealOpampBody,
): IdealOpampBodyContract {
  const model = builtInModelContract(OPAMP_TARGET)!;
  const reads = idealOpampBodyReads(body);
  return {
    name: body,
    readsVdd: reads.vdd,
    readsVss: reads.vss,
    readsGbw: reads.gbw,
    readsRout: reads.rout,
    ports: model.ports,
    parameters: model.parameters.flatMap((p) => {
      if (p.name === OPAMP_HIGH_LIMIT || p.name === OPAMP_LOW_LIMIT) {
        return reads[p.name === OPAMP_HIGH_LIMIT ? "vdd" : "vss"]
          ? []
          : [{ name: p.name, defaultValue: UNPOWERED_OPAMP_LIMITS[p.name] }];
      }
      if (p.name === OPAMP_GBW) {
        return reads.gbw
          ? [{ name: OPAMP_GBW, defaultValue: OPAMP_GBW_DEFAULT }]
          : [];
      }
      if (p.name === OPAMP_ROUT) {
        return reads.rout
          ? [{ name: OPAMP_ROUT, defaultValue: OPAMP_ROUT_DEFAULT }]
          : [];
      }
      return [{ name: p.name, defaultValue: p.defaultValue! }];
    }),
  };
}
