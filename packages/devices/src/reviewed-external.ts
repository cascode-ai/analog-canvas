import type { DeviceParameterDefinition } from "./contract.js";
import { parameterExpressionBody } from "./parameter-expression.js";

export type ReviewedExternalBindingId =
  | "sky130-nfet-01v8"
  | "sky130-pfet-01v8"
  | "sky130-nfet-01v8-lvt"
  | "sky130-pfet-01v8-lvt"
  | "sky130-nfet-03v3-nvt"
  | "sky130-nfet-05v0-nvt"
  | "sky130-nfet-g5v0d10v5"
  | "sky130-pfet-01v8-hvt"
  | "sky130-pfet-g5v0d10v5"
  | "sky130-res-high-po"
  | "sky130-res-xhigh-po"
  | "sky130-cap-mim-m3-1"
  | "sky130-cap-mim-m3-2"
  | "sky130-cap-var-lvt"
  | "sky130-ind-03-90"
  | "sky130-ind-05-125"
  | "sky130-ind-05-220"
  | "sky130-pnp-05v5-w0p68l0p68"
  | "sky130-npn-05v5-w1p00l1p00";

export interface ReviewedExternalTerminalBinding {
  /** Public target terminal spelling and order from the external wrapper. */
  readonly targetName: string;
  /** Stable local electrical terminal recorded in Net.terminals. */
  readonly pinName: string;
  /** Property terminals have no Symbol pin and cannot be routed on canvas. */
  readonly interaction: "canvas" | "property";
  readonly role?: "substrate" | "floating";
}

export interface ReviewedExternalParameterBinding extends DeviceParameterDefinition {
  readonly targetUnit?: "micrometre";
  readonly targetDefaultValue?: string;
  readonly spiceOrder: number;
}

export interface ReviewedExternalDeviceBinding {
  readonly id: ReviewedExternalBindingId;
  readonly libraryId: "sky130_fd_pr";
  readonly masterName: string;
  readonly invocationKind: "external-subcircuit";
  readonly symbolId:
    "nmos" | "pmos" | "resistor" | "capacitor" | "inductor" | "npn" | "pnp";
  readonly deviceClass: "mos" | "resistor" | "capacitor" | "inductor" | "bjt";
  readonly terminals: readonly ReviewedExternalTerminalBinding[];
  readonly parameters: readonly ReviewedExternalParameterBinding[];
}

const geometry = (
  name: "w" | "l",
  label: "W" | "L",
  defaultValue: string,
  targetDefaultValue: string,
  spiceOrder: number,
): ReviewedExternalParameterBinding => ({
  name,
  label,
  required: true,
  editor: "text",
  unitHint: "m",
  placeholder: defaultValue,
  defaultValue,
  help: `${label === "W" ? "Width" : "Length"} stored canonically in metres`,
  displayRole: label === "W" ? "width" : "length",
  targetUnit: "micrometre",
  targetDefaultValue,
  spiceOrder,
});

const count = (
  name: "nf" | "m" | "mult" | "mf" | "vm",
  label: string,
  help: string,
  spiceOrder: number,
): ReviewedExternalParameterBinding => ({
  name,
  label,
  required: false,
  editor: "decimal",
  placeholder: "1",
  defaultValue: "1",
  help,
  displayRole: name === "nf" ? "finger-count" : "multiplier",
  targetDefaultValue: "1",
  spiceOrder,
});

const SPICE_SUFFIX: Readonly<Record<string, number>> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
};

function parseSpiceNumber(value: string): number {
  const text = value.trim().toLowerCase();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)$/u.exec(
    text,
  );
  if (!match) throw new Error(`Geometry is not a SPICE number: ${value}`);
  const magnitude = Number(match[1]);
  const suffix = match[2] ?? "";
  if (!Number.isFinite(magnitude)) {
    throw new Error(`Geometry is not a SPICE number: ${value}`);
  }
  if (!suffix) return magnitude;
  const known = suffix.startsWith("meg") ? "meg" : suffix[0]!;
  const factor = SPICE_SUFFIX[known];
  if (factor === undefined) {
    throw new Error(`Geometry has an unknown SPICE suffix: ${value}`);
  }
  return magnitude * factor;
}

/** Canonical Project length (metres) to the reviewed SKY130 plain-um form. */
export function projectLengthToSky130Micrometres(value: string): string {
  const expression = parameterExpressionBody(value);
  if (expression !== undefined) {
    const inverse = /^\((.*)\) \* 1u$/u.exec(expression);
    return inverse ? `{${inverse[1]}}` : `{(${expression}) / 1u}`;
  }
  return `${Number((parseSpiceNumber(value) / 1e-6).toPrecision(12))}`;
}

const mosTerminals = (): readonly ReviewedExternalTerminalBinding[] =>
  ["D", "G", "S", "B"].map((name) => ({
    targetName: name,
    pinName: name,
    interaction: "canvas" as const,
  }));

const sky130MosBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
  symbolId: "nmos" | "pmos",
  width: string,
  length: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sky130_fd_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId,
  deviceClass: "mos",
  terminals: mosTerminals(),
  parameters: [
    geometry("w", "W", width, projectLengthToSky130Micrometres(width), 1),
    geometry("l", "L", length, projectLengthToSky130Micrometres(length), 0),
    count("nf", "NF", "Finger count", 2),
    count("m", "M", "ngspice X-line parallel multiplier", 3),
  ],
});

const sky130ResistorBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sky130_fd_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId: "resistor",
  deviceClass: "resistor",
  terminals: [
    { targetName: "R0", pinName: "1", interaction: "canvas" },
    { targetName: "R1", pinName: "2", interaction: "canvas" },
    {
      targetName: "B",
      pinName: "B",
      interaction: "property",
      role: "substrate",
    },
  ],
  parameters: [
    geometry("w", "W", "1u", "1", 0),
    geometry("l", "L", "5.5u", "5.5", 1),
    count("mult", "MULT", "SKY130 resistor wrapper multiplier", 2),
  ],
});

const sky130MimCapBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sky130_fd_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId: "capacitor",
  deviceClass: "capacitor",
  terminals: [
    { targetName: "C0", pinName: "1", interaction: "canvas" },
    { targetName: "C1", pinName: "2", interaction: "canvas" },
  ],
  parameters: [
    geometry("w", "W", "5u", "5", 0),
    geometry("l", "L", "5u", "5", 1),
    count("mf", "MF", "SKY130 MIM wrapper multiplicity", 2),
  ],
});

const sky130VaractorBinding = (): ReviewedExternalDeviceBinding => ({
  id: "sky130-cap-var-lvt",
  libraryId: "sky130_fd_pr",
  masterName: "sky130_fd_pr__cap_var_lvt",
  invocationKind: "external-subcircuit",
  symbolId: "capacitor",
  deviceClass: "capacitor",
  terminals: [
    { targetName: "C0", pinName: "1", interaction: "canvas" },
    { targetName: "C1", pinName: "2", interaction: "canvas" },
    {
      targetName: "B",
      pinName: "B",
      interaction: "property",
      role: "substrate",
    },
  ],
  parameters: [
    geometry("w", "W", "5u", "5", 0),
    geometry("l", "L", "500n", "0.5", 1),
    count("vm", "VM", "SKY130 varactor multiplicity", 2),
  ],
});

const sky130InductorBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sky130_fd_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId: "inductor",
  deviceClass: "inductor",
  terminals: [
    { targetName: "A", pinName: "1", interaction: "canvas" },
    { targetName: "B", pinName: "2", interaction: "canvas" },
    {
      targetName: "CT",
      pinName: "CT",
      interaction: "property",
      role: "floating",
    },
    {
      targetName: "SUB",
      pinName: "SUB",
      interaction: "property",
      role: "substrate",
    },
  ],
  parameters: [],
});

const bjtCanvasTerminals = (): readonly ReviewedExternalTerminalBinding[] =>
  ["C", "B", "E"].map((name) => ({
    targetName: name,
    pinName: name,
    interaction: "canvas" as const,
  }));

const bjtTerminalsWithSubstrate =
  (): readonly ReviewedExternalTerminalBinding[] => [
    ...bjtCanvasTerminals(),
    {
      targetName: "S",
      pinName: "S",
      interaction: "property",
      role: "substrate",
    },
  ];

export const reviewedExternalDeviceBindings: readonly ReviewedExternalDeviceBinding[] =
  [
    sky130MosBinding(
      "sky130-nfet-01v8",
      "sky130_fd_pr__nfet_01v8",
      "nmos",
      "1u",
      "150n",
    ),
    sky130MosBinding(
      "sky130-pfet-01v8",
      "sky130_fd_pr__pfet_01v8",
      "pmos",
      "1u",
      "150n",
    ),
    sky130MosBinding(
      "sky130-nfet-01v8-lvt",
      "sky130_fd_pr__nfet_01v8_lvt",
      "nmos",
      "1.65u",
      "150n",
    ),
    sky130MosBinding(
      "sky130-pfet-01v8-lvt",
      "sky130_fd_pr__pfet_01v8_lvt",
      "pmos",
      "3u",
      "350n",
    ),
    sky130MosBinding(
      "sky130-nfet-03v3-nvt",
      "sky130_fd_pr__nfet_03v3_nvt",
      "nmos",
      "1u",
      "500n",
    ),
    sky130MosBinding(
      "sky130-nfet-05v0-nvt",
      "sky130_fd_pr__nfet_05v0_nvt",
      "nmos",
      "1u",
      "900n",
    ),
    sky130MosBinding(
      "sky130-nfet-g5v0d10v5",
      "sky130_fd_pr__nfet_g5v0d10v5",
      "nmos",
      "10u",
      "500n",
    ),
    sky130MosBinding(
      "sky130-pfet-01v8-hvt",
      "sky130_fd_pr__pfet_01v8_hvt",
      "pmos",
      "1u",
      "150n",
    ),
    sky130MosBinding(
      "sky130-pfet-g5v0d10v5",
      "sky130_fd_pr__pfet_g5v0d10v5",
      "pmos",
      "20u",
      "500n",
    ),
    sky130ResistorBinding("sky130-res-high-po", "sky130_fd_pr__res_high_po"),
    sky130ResistorBinding("sky130-res-xhigh-po", "sky130_fd_pr__res_xhigh_po"),
    sky130MimCapBinding("sky130-cap-mim-m3-1", "sky130_fd_pr__cap_mim_m3_1"),
    sky130MimCapBinding("sky130-cap-mim-m3-2", "sky130_fd_pr__cap_mim_m3_2"),
    sky130VaractorBinding(),
    sky130InductorBinding("sky130-ind-03-90", "sky130_fd_pr__ind_03_90"),
    sky130InductorBinding("sky130-ind-05-125", "sky130_fd_pr__ind_05_125"),
    sky130InductorBinding("sky130-ind-05-220", "sky130_fd_pr__ind_05_220"),
    {
      id: "sky130-pnp-05v5-w0p68l0p68",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
      invocationKind: "external-subcircuit",
      symbolId: "pnp",
      deviceClass: "bjt",
      // This wrapper exposes C/B/E only; its internal Q card ties substrate to C.
      terminals: bjtCanvasTerminals(),
      parameters: [],
    },
    {
      id: "sky130-npn-05v5-w1p00l1p00",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__npn_05v5_W1p00L1p00",
      invocationKind: "external-subcircuit",
      symbolId: "npn",
      deviceClass: "bjt",
      terminals: bjtTerminalsWithSubstrate(),
      parameters: [],
    },
  ];

export function reviewedExternalBindingForMaster(
  masterName: string,
): ReviewedExternalDeviceBinding | undefined {
  const normalized = masterName.toLowerCase();
  return reviewedExternalDeviceBindings.find(
    (binding) => binding.masterName.toLowerCase() === normalized,
  );
}

export function reviewedExternalBindingForTerminalCount(
  masterName: string,
  terminalCount: number,
): ReviewedExternalDeviceBinding | undefined {
  const binding = reviewedExternalBindingForMaster(masterName);
  return binding?.terminals.length === terminalCount ? binding : undefined;
}

/** Exact master and exact public terminal order are both required. */
export function resolveReviewedExternalBinding(
  masterName: string,
  terminalNames: readonly string[],
): ReviewedExternalDeviceBinding | undefined {
  const binding = reviewedExternalBindingForMaster(masterName);
  return binding &&
    binding.terminals.length === terminalNames.length &&
    binding.terminals.every(
      (terminal, index) =>
        terminal.targetName.toLowerCase() ===
        terminalNames[index]?.toLowerCase(),
    )
    ? binding
    : undefined;
}

export function reviewedExternalModelSuggestions(
  symbolId: string,
): readonly string[] {
  return reviewedExternalDeviceBindings
    .filter((binding) => binding.symbolId === symbolId)
    .map((binding) => binding.masterName);
}

/** Reviewed SKY130 plain-um input to the canonical Project length spelling. */
export function sky130MicrometresToProjectLength(value: string): string {
  const text = value.trim();
  const expression = parameterExpressionBody(text);
  if (expression !== undefined) {
    const inverse = /^\((.*)\) \/ 1u$/u.exec(expression);
    return inverse ? `{${inverse[1]}}` : `{(${expression}) * 1u}`;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) {
    throw new Error(
      `Reviewed SKY130 geometry must be a plain micrometre number: ${value}`,
    );
  }
  const micrometres = Number(text);
  if (!Number.isFinite(micrometres)) {
    throw new Error(`Geometry is not a finite number: ${value}`);
  }
  if (Math.abs(micrometres) >= 1 || micrometres === 0) {
    return `${Number(micrometres.toPrecision(12))}u`;
  }
  return `${Number((micrometres * 1000).toPrecision(12))}n`;
}
