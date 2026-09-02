import type { DeviceParameterDefinition } from "./contract.js";

export type ReviewedExternalBindingId =
  | "sky130-nfet-01v8"
  | "sky130-pfet-01v8"
  | "sky130-res-high-po"
  | "sky130-cap-mim-m3-1";

export interface ReviewedExternalTerminalBinding {
  /** Public target terminal spelling and order from the external wrapper. */
  readonly targetName: string;
  /** Stable local electrical terminal recorded in Net.terminals. */
  readonly pinName: string;
  /** Property terminals have no Symbol pin and cannot be routed on canvas. */
  readonly interaction: "canvas" | "property";
  readonly role?: "substrate";
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
  readonly symbolId: "nmos" | "pmos" | "resistor" | "capacitor";
  readonly deviceClass: "mos" | "resistor" | "capacitor";
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
  name: "nf" | "m" | "mult" | "mf",
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

export const reviewedExternalDeviceBindings: readonly ReviewedExternalDeviceBinding[] =
  [
    {
      id: "sky130-nfet-01v8",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__nfet_01v8",
      invocationKind: "external-subcircuit",
      symbolId: "nmos",
      deviceClass: "mos",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        targetName: name,
        pinName: name,
        interaction: "canvas" as const,
      })),
      parameters: [
        geometry("w", "W", "1u", "1", 1),
        geometry("l", "L", "150n", "0.15", 0),
        count("nf", "NF", "Finger count", 2),
        count("m", "M", "ngspice X-line parallel multiplier", 3),
      ],
    },
    {
      id: "sky130-pfet-01v8",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__pfet_01v8",
      invocationKind: "external-subcircuit",
      symbolId: "pmos",
      deviceClass: "mos",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        targetName: name,
        pinName: name,
        interaction: "canvas" as const,
      })),
      parameters: [
        geometry("w", "W", "1u", "1", 1),
        geometry("l", "L", "150n", "0.15", 0),
        count("nf", "NF", "Finger count", 2),
        count("m", "M", "ngspice X-line parallel multiplier", 3),
      ],
    },
    {
      id: "sky130-res-high-po",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__res_high_po",
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
    },
    {
      id: "sky130-cap-mim-m3-1",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__cap_mim_m3_1",
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
  return `${Number((parseSpiceNumber(value) / 1e-6).toPrecision(12))}`;
}

/** Reviewed SKY130 plain-um input to the canonical Project length spelling. */
export function sky130MicrometresToProjectLength(value: string): string {
  const text = value.trim();
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
