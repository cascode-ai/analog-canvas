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
  | "sky130-nfet-g5v0d16v0"
  | "sky130-nfet-20v0"
  | "sky130-nfet-20v0-nvt"
  | "sky130-nfet-20v0-zvt"
  | "sky130-pfet-01v8-hvt"
  | "sky130-pfet-g5v0d10v5"
  | "sky130-pfet-g5v0d16v0"
  | "sky130-pfet-20v0"
  | "sky130-res-high-po"
  | "sky130-res-xhigh-po"
  | "sky130-cap-mim-m3-1"
  | "sky130-cap-mim-m3-2"
  | "sky130-cap-var-lvt"
  | "sky130-ind-03-90"
  | "sky130-ind-05-125"
  | "sky130-ind-05-220"
  | "sky130-pnp-05v5-w0p68l0p68"
  | "sky130-npn-05v5-w1p00l1p00"
  | "sg13g2-lv-nmos"
  | "sg13g2-lv-pmos"
  | "sg13g2-hv-nmos"
  | "sg13g2-hv-pmos"
  | "sg13g2-npn13g2"
  | "sg13g2-npn13g2l"
  | "sg13g2-npn13g2v"
  | "sg13g2-pnpmpa"
  | "sg13g2-rsil"
  | "sg13g2-rppd"
  | "sg13g2-rhigh"
  | "sg13g2-cap-cmim"
  | "sg13g2-cap-rfcmim"
  | `std-cell-${string}`;

export interface ReviewedExternalTerminalBinding {
  /** Public target terminal spelling and order from the external wrapper. */
  readonly targetName: string;
  /** Stable local electrical terminal recorded in Net.terminals. */
  readonly pinName: string;
  /** Property terminals have no Symbol pin and cannot be routed on canvas. */
  readonly interaction: "canvas" | "property";
  /**
   * `substrate`: the PDK ties this terminal to the p-substrate, which belongs
   * on ground or the lowest supply; the export warns otherwise
   * (PDK_SUBSTRATE_TERMINAL). `floating`: may be left unconnected.
   */
  readonly role?: "substrate" | "floating";
  /**
   * A standard cell's rail: with no Net chosen it takes the Cell's drawn
   * supply of that domain, or the conventional one, as the Library gate it
   * replaces does. VPWR and VPB both read the gate's VDD, VGND and VNB its VSS.
   */
  readonly supply?: "VDD" | "VSS";
}

export interface ReviewedExternalParameterBinding extends DeviceParameterDefinition {
  readonly targetUnit?: "micrometre";
  readonly targetDefaultValue?: string;
  readonly spiceOrder: number;
}

/** The Library logic gates a standard cell can stand behind (#1450). */
export type StandardCellGateSymbolId =
  | "inverter"
  | "buffer"
  | "nand-gate"
  | "nand-gate-3"
  | "nand-gate-4"
  | "nor-gate"
  | "nor-gate-3"
  | "nor-gate-4"
  | "and-gate"
  | "and-gate-3"
  | "and-gate-4"
  | "or-gate"
  | "or-gate-3"
  | "or-gate-4"
  | "xor-gate"
  | "xor-gate-3"
  | "xor-gate-4"
  | "xnor-gate"
  | "xnor-gate-3"
  | "xnor-gate-4";

/** Standard-cell libraries whose gate cells a Library gate may take (#1450). */
export type StandardCellLibraryId =
  "sky130_fd_sc_hd" | "sg13g2_stdcell" | "tcbn28hpcplusbwp12t30p140";

export interface ReviewedExternalDeviceBinding {
  readonly id: ReviewedExternalBindingId;
  readonly libraryId: "sky130_fd_pr" | "sg13g2_pr" | StandardCellLibraryId;
  readonly masterName: string;
  readonly invocationKind: "external-subcircuit";
  readonly symbolId:
    | "nmos"
    | "pmos"
    | "ndmos"
    | "pdmos"
    | "resistor"
    | "capacitor"
    | "inductor"
    | "npn"
    | "pnp"
    | StandardCellGateSymbolId;
  readonly deviceClass:
    "mos" | "resistor" | "capacitor" | "inductor" | "bjt" | "logic";
  readonly terminals: readonly ReviewedExternalTerminalBinding[];
  readonly parameters: readonly ReviewedExternalParameterBinding[];
  /**
   * The MOS primitive's path inside the wrapper, for operating-point
   * vectors. A plain SKY130 MOS wrapper holds one `m<masterName>`; the
   * high-voltage ones nest it or name it otherwise.
   */
  readonly nativeElement?: string;
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
  symbolId: "nmos" | "pmos" | "ndmos" | "pdmos",
  width: string,
  length: string,
  nativeElement?: string,
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
  ...(nativeElement ? { nativeElement } : {}),
});

/**
 * The 20 V drain-extended wrappers fix their channel inside (the N devices
 * about 29.4 um by 2.95 um, the P device 30 um by 0.5 um) and ignore the W and
 * L they are called with, so only the parallel count is offered.
 */
const sky130FixedMosBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
  symbolId: "ndmos" | "pdmos",
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sky130_fd_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId,
  deviceClass: "mos",
  terminals: mosTerminals(),
  parameters: [count("m", "M", "ngspice X-line parallel multiplier", 0)],
  nativeElement: "m1",
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

/**
 * The SKY130 varactor is drawn with the plain capacitor, whose pins 1 and 2
 * its C0 and C1 take. The Variable Capacitor is not a varactor: it stands for
 * any tunable capacitance (a switched MOM or MIM bank, MOS capacitors, or a
 * varactor), so it stays an ideal capacitor and is offered no reviewed model
 * (#1298).
 */
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

/*
 * IHP SG13G2 (IHP-Open-PDK, ihp-sg13g2/libs.tech, checked at 5e6d592e of
 * 2026-09-01): every device is a subcircuit called on an X line, as the
 * PDK's own xschem symbols write it. Its geometry is in metres, the Project's
 * own unit, so values pass through unconverted (no `targetUnit`). Terminal
 * spelling and order follow each `.subckt` line of the ngspice models;
 * defaults and parameter order follow the xschem symbol templates.
 */
const sg13Length = (
  name: string,
  label: string,
  defaultValue: string,
  help: string,
  displayRole: "width" | "length" | "none",
  spiceOrder: number,
  unitHint = "m",
): ReviewedExternalParameterBinding => ({
  name,
  label,
  required: true,
  editor: "text",
  unitHint,
  placeholder: defaultValue,
  defaultValue,
  help,
  displayRole,
  targetDefaultValue: defaultValue,
  spiceOrder,
});

const sg13Count = (
  name: string,
  label: string,
  help: string,
  spiceOrder: number,
  displayRole: "finger-count" | "multiplier" | "none" = "multiplier",
  defaultValue = "1",
): ReviewedExternalParameterBinding => ({
  name,
  label,
  required: false,
  editor: "decimal",
  placeholder: defaultValue,
  defaultValue,
  help,
  displayRole,
  targetDefaultValue: defaultValue,
  spiceOrder,
});

const sg13Canvas = (
  names: readonly string[],
): ReviewedExternalTerminalBinding[] =>
  names.map((name) => ({
    targetName: name,
    pinName: name.toUpperCase(),
    interaction: "canvas" as const,
  }));

const sg13Substrate = (pinName: string): ReviewedExternalTerminalBinding => ({
  targetName: "bn",
  pinName,
  interaction: "property",
  role: "substrate",
});

/** `.subckt sg13_{lv,hv}_{n,p}mos d g s b`: w l ng m (the PSP103 core). */
const sg13MosBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
  symbolId: "nmos" | "pmos",
  width: string,
  length: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sg13g2_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId,
  deviceClass: "mos",
  terminals: sg13Canvas(["d", "g", "s", "b"]),
  parameters: [
    sg13Length("w", "W", width, "Width in metres", "width", 0),
    sg13Length("l", "L", length, "Length in metres", "length", 1),
    sg13Count("ng", "NG", "Gate finger count", 2, "finger-count"),
    sg13Count("m", "M", "Parallel device count", 3),
  ],
});

/** `.subckt npn13G2* c b e bn`: the SiGe HBTs (VBIC), substrate as a
 * property terminal, with the emitter geometry xschem writes. */
const sg13NpnBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
  emitterLength: string,
  emitterWidth: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sg13g2_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId: "npn",
  deviceClass: "bjt",
  terminals: [...sg13Canvas(["c", "b", "e"]), sg13Substrate("S")],
  parameters: [
    sg13Length(
      "le",
      "LE",
      emitterLength,
      "Emitter length in metres",
      "none",
      0,
    ),
    sg13Length("we", "WE", emitterWidth, "Emitter width in metres", "none", 1),
    sg13Count("Nx", "NX", "Emitter count, 1 to 10", 2),
  ],
});

/** `.subckt rsil|rppd|rhigh 1 2 bn`: w l (b bends) m. */
const sg13ResistorBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
  length: string,
  bends: boolean,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sg13g2_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId: "resistor",
  deviceClass: "resistor",
  terminals: [
    { targetName: "1", pinName: "1", interaction: "canvas" },
    { targetName: "2", pinName: "2", interaction: "canvas" },
    sg13Substrate("B"),
  ],
  parameters: [
    sg13Length("w", "W", "500n", "Width in metres", "width", 0),
    sg13Length("l", "L", length, "Length in metres", "length", 1),
    ...(bends ? [sg13Count("b", "B", "Number of bends", 2, "none", "0")] : []),
    sg13Count("m", "M", "Parallel resistor count", 3),
  ],
});

/** `.subckt cap_cmim PLUS MINUS` and `cap_rfcmim PLUS MINUS bn`. */
const sg13MimBinding = (
  id: ReviewedExternalBindingId,
  masterName: string,
  side: string,
  feed?: string,
): ReviewedExternalDeviceBinding => ({
  id,
  libraryId: "sg13g2_pr",
  masterName,
  invocationKind: "external-subcircuit",
  symbolId: "capacitor",
  deviceClass: "capacitor",
  terminals: [
    { targetName: "PLUS", pinName: "1", interaction: "canvas" },
    { targetName: "MINUS", pinName: "2", interaction: "canvas" },
    ...(feed ? [sg13Substrate("B")] : []),
  ],
  parameters: [
    sg13Length("w", "W", side, "Width in metres", "width", 0),
    sg13Length("l", "L", side, "Length in metres", "length", 1),
    ...(feed
      ? [sg13Length("wfeed", "WFEED", feed, "Feed width in metres", "none", 2)]
      : []),
    sg13Count("m", "M", "Parallel capacitor count", 3),
  ],
});

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
    // Drain-extended devices are drawn with the DMOS symbols. The 16 V pair
    // keeps binned geometry: N at L 0.7 or 2.2 um, P at L 0.66 or 2.16 um.
    sky130MosBinding(
      "sky130-nfet-g5v0d16v0",
      "sky130_fd_pr__nfet_g5v0d16v0",
      "ndmos",
      "5u",
      "700n",
      "xmain1.msky130_fd_pr__nfet_g5v0d16v0__base",
    ),
    sky130MosBinding(
      "sky130-pfet-g5v0d16v0",
      "sky130_fd_pr__pfet_g5v0d16v0",
      "pdmos",
      "5u",
      "660n",
      "xmain1.msky130_fd_pr__pfet_g5v0d16v0__base",
    ),
    sky130FixedMosBinding(
      "sky130-nfet-20v0",
      "sky130_fd_pr__nfet_20v0",
      "ndmos",
    ),
    sky130FixedMosBinding(
      "sky130-nfet-20v0-nvt",
      "sky130_fd_pr__nfet_20v0_nvt",
      "ndmos",
    ),
    sky130FixedMosBinding(
      "sky130-nfet-20v0-zvt",
      "sky130_fd_pr__nfet_20v0_zvt",
      "ndmos",
    ),
    sky130FixedMosBinding(
      "sky130-pfet-20v0",
      "sky130_fd_pr__pfet_20v0",
      "pdmos",
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
      // This wrapper exposes C/B/E only; its internal Q card ties substrate to
      // C. The vertical PNP's collector is the p-substrate, so C carries the
      // substrate role and belongs on ground (#1314).
      terminals: bjtCanvasTerminals().map((terminal) =>
        terminal.pinName === "C"
          ? { ...terminal, role: "substrate" as const }
          : terminal,
      ),
      // The emitter area is fixed inside; parallel devices are the X-line
      // multiplier, which ngspice 46 scales exactly (m=8 carries 8x the
      // current of m=1). A bandgap's 1:8 ratio is this count.
      parameters: [count("m", "M", "ngspice X-line parallel multiplier", 0)],
    },
    {
      id: "sky130-npn-05v5-w1p00l1p00",
      libraryId: "sky130_fd_pr",
      masterName: "sky130_fd_pr__npn_05v5_W1p00L1p00",
      invocationKind: "external-subcircuit",
      symbolId: "npn",
      deviceClass: "bjt",
      terminals: bjtTerminalsWithSubstrate(),
      parameters: [count("m", "M", "ngspice X-line parallel multiplier", 0)],
    },
    sg13MosBinding("sg13g2-lv-nmos", "sg13_lv_nmos", "nmos", "150n", "130n"),
    sg13MosBinding("sg13g2-lv-pmos", "sg13_lv_pmos", "pmos", "150n", "130n"),
    sg13MosBinding("sg13g2-hv-nmos", "sg13_hv_nmos", "nmos", "300n", "450n"),
    sg13MosBinding("sg13g2-hv-pmos", "sg13_hv_pmos", "pmos", "300n", "400n"),
    sg13NpnBinding("sg13g2-npn13g2", "npn13G2", "900n", "70n"),
    sg13NpnBinding("sg13g2-npn13g2l", "npn13G2l", "1u", "70n"),
    sg13NpnBinding("sg13g2-npn13g2v", "npn13G2v", "1u", "120n"),
    {
      // `.subckt pnpMPA c b e`; xschem writes its area and perimeter from a
      // 0.7 um by 2 um emitter.
      id: "sg13g2-pnpmpa",
      libraryId: "sg13g2_pr",
      masterName: "pnpMPA",
      invocationKind: "external-subcircuit",
      symbolId: "pnp",
      deviceClass: "bjt",
      terminals: sg13Canvas(["c", "b", "e"]),
      parameters: [
        sg13Length(
          "a",
          "A",
          "1.4p",
          "Emitter area in square metres",
          "none",
          0,
          "m²",
        ),
        sg13Length("p", "P", "5.4u", "Emitter perimeter in metres", "none", 1),
        sg13Count("m", "M", "Parallel device count", 2),
      ],
    },
    sg13ResistorBinding("sg13g2-rsil", "rsil", "500n", false),
    sg13ResistorBinding("sg13g2-rppd", "rppd", "500n", true),
    sg13ResistorBinding("sg13g2-rhigh", "rhigh", "960n", true),
    sg13MimBinding("sg13g2-cap-cmim", "cap_cmim", "7u"),
    sg13MimBinding("sg13g2-cap-rfcmim", "cap_rfcmim", "10u", "5u"),
  ];

type GateFunction =
  "inv" | "buf" | "nand" | "nor" | "and" | "or" | "xor" | "xnor";

/** The Library gate drawn for a cell function, by input count (#1450). */
const GATE_SYMBOLS: Readonly<
  Record<GateFunction, readonly (StandardCellGateSymbolId | undefined)[]>
> = {
  inv: [undefined, "inverter"],
  buf: [undefined, "buffer"],
  nand: [undefined, undefined, "nand-gate", "nand-gate-3", "nand-gate-4"],
  nor: [undefined, undefined, "nor-gate", "nor-gate-3", "nor-gate-4"],
  and: [undefined, undefined, "and-gate", "and-gate-3", "and-gate-4"],
  or: [undefined, undefined, "or-gate", "or-gate-3", "or-gate-4"],
  xor: [undefined, undefined, "xor-gate", "xor-gate-3", "xor-gate-4"],
  xnor: [undefined, undefined, "xnor-gate", "xnor-gate-3", "xnor-gate-4"],
};
const GATE_OF_SYMBOL = new Map<
  string,
  { readonly fn: GateFunction; readonly inputs: number }
>(
  Object.entries(GATE_SYMBOLS).flatMap(([fn, symbols]) =>
    symbols.flatMap((symbolId, inputs) =>
      symbolId ? [[symbolId, { fn: fn as GateFunction, inputs }] as const] : [],
    ),
  ),
);
const GATE_INPUTS = ["A", "B", "C", "D"] as const;
const INVERTING: ReadonlySet<GateFunction> = new Set([
  "inv",
  "nand",
  "nor",
  "xnor",
]);

/** One cell pin and the gate pin or rail it stands for. */
type CellPin = readonly [
  targetName: string,
  pinName: string,
  supply?: "VDD" | "VSS",
];

interface GateCell {
  readonly masterName: string;
  readonly fn: GateFunction;
  readonly inputs: number;
}

/**
 * How one standard-cell library names and orders the cells of a Library
 * gate's function (#1450). A cell is read from its name alone, at any drive
 * strength or variant, so no cell list ships; the drive strength is the
 * library's to resolve. Each rule was checked against its library's full
 * SPICE netlist (standard-cells.test.ts, with ICM_STD_CELL_SPICE).
 */
interface StandardCellRule {
  readonly libraryId: StandardCellLibraryId;
  /** The cell's function, inputs and canonical spelling; undefined when the name is not one of this library's gate cells. */
  readonly read: (name: string) => GateCell | undefined;
  /** The cell's public pins, in the library's order. */
  readonly pins: (fn: GateFunction, inputs: number) => readonly CellPin[];
  /** The function's weakest common cell, offered as a suggestion. */
  readonly example: (fn: GateFunction, inputs: number) => string;
  /** The most inputs the library builds a function with, where fewer than four. */
  readonly widest: Partial<Record<GateFunction, number>>;
}

/** Inverters and buffers take one input and name no count; the others name two to four. */
const gateCell = (
  masterName: string,
  fn: GateFunction,
  count: string,
): GateCell | undefined => {
  const single = fn === "inv" || fn === "buf";
  return single === (count === "")
    ? { masterName, fn, inputs: single ? 1 : Number(count) }
    : undefined;
};

/** <prefix><function><inputs>_<drive>, as SKY130 and IHP spell their cells. */
const readLowerCaseGate = (prefix: string) => {
  const pattern = new RegExp(
    `^${prefix}(inv|buf|nand|nor|and|or|xor|xnor)([234]?)_\\d+$`,
    "u",
  );
  return (name: string) => {
    const masterName = name.toLowerCase();
    const match = pattern.exec(masterName);
    return match
      ? gateCell(masterName, match[1] as GateFunction, match[2]!)
      : undefined;
  };
};
const lowerCaseExample =
  (prefix: string) => (fn: GateFunction, inputs: number) =>
    `${prefix}${fn}${inputs > 1 ? inputs : ""}_1`;

const TSMC28_FUNCTIONS: Readonly<Record<string, GateFunction>> = {
  INV: "inv",
  N: "inv",
  BUFF: "buf",
  B: "buf",
  ND: "nand",
  NR: "nor",
  AN: "and",
  OR: "or",
  XOR: "xor",
  XNR: "xnor",
};
const TSMC28_STEMS: Readonly<Record<GateFunction, string>> = {
  inv: "INV",
  buf: "BUFF",
  nand: "ND",
  nor: "NR",
  and: "AN",
  or: "OR",
  xor: "XOR",
  xnor: "XNR",
};

const STANDARD_CELL_RULES: readonly StandardCellRule[] = [
  {
    // sky130_fd_sc_hd__nand2_1: inputs A–D, VGND VNB VPB VPWR, then the output.
    libraryId: "sky130_fd_sc_hd",
    read: readLowerCaseGate("sky130_fd_sc_hd__"),
    pins: (fn, inputs) => [
      ...GATE_INPUTS.slice(0, inputs).map((pin): CellPin => [pin, pin]),
      ["VGND", "VSS", "VSS"],
      ["VNB", "VSS", "VSS"],
      ["VPB", "VDD", "VDD"],
      ["VPWR", "VDD", "VDD"],
      // Y when the function inverts, X otherwise, except that the library
      // names xnor3's output X.
      [INVERTING.has(fn) && !(fn === "xnor" && inputs === 3) ? "Y" : "X", "Y"],
    ],
    example: lowerCaseExample("sky130_fd_sc_hd__"),
    widest: { xor: 3, xnor: 3 },
  },
  {
    // sg13g2_nand2_1: the output first (Y inverting, X not), inputs A–D, VDD VSS.
    libraryId: "sg13g2_stdcell",
    read: readLowerCaseGate("sg13g2_"),
    pins: (fn, inputs) => [
      [INVERTING.has(fn) ? "Y" : "X", "Y"],
      ...GATE_INPUTS.slice(0, inputs).map((pin): CellPin => [pin, pin]),
      ["VDD", "VDD", "VDD"],
      ["VSS", "VSS", "VSS"],
    ],
    example: lowerCaseExample("sg13g2_"),
    widest: { xor: 2, xnor: 2 },
  },
  {
    // ND2D1BWP12T30P140[LVT]: [CK]<function><inputs>[X|OPT…]D<drive>, with
    // the clock inverter and buffer CKN and CKB; input I or A1–A4, output ZN
    // inverting and Z not, then VDD VSS.
    libraryId: "tcbn28hpcplusbwp12t30p140",
    read: (name) => {
      const masterName = name.toUpperCase();
      const match =
        /^(?:CK(N|B)|(?:CK)?(INV|BUFF|ND|NR|AN|OR|XOR|XNR))([234]?)(?:X|OPT[A-Z]*)?D\d+(?:P\d+)?BWP12T30P140(?:LVT)?$/u.exec(
          masterName,
        );
      const fn = match && TSMC28_FUNCTIONS[match[1] ?? match[2]!];
      return fn ? gateCell(masterName, fn, match[3]!) : undefined;
    },
    pins: (fn, inputs) => [
      ...(inputs === 1
        ? [["I", "A"] as const]
        : GATE_INPUTS.slice(0, inputs).map((pin, index): CellPin => [
            `A${index + 1}`,
            pin,
          ])),
      [INVERTING.has(fn) ? "ZN" : "Z", "Y"],
      ["VDD", "VDD", "VDD"],
      ["VSS", "VSS", "VSS"],
    ],
    example: (fn, inputs) =>
      `${TSMC28_STEMS[fn]}${inputs > 1 ? inputs : ""}D1BWP12T30P140`,
    widest: {},
  },
];

const STANDARD_CELL_ID = "std-cell-";
const standardCellBindings = new Map<string, ReviewedExternalDeviceBinding>();

/**
 * A standard cell behind a Library gate (#1450), read from its name: the gate
 * keeps its pins, and its VDD/VSS property terminals feed each domain's rails.
 */
function standardCellBinding(
  name: string,
): ReviewedExternalDeviceBinding | undefined {
  const key = name.toLowerCase();
  const known = standardCellBindings.get(key);
  if (known) return known;
  for (const rule of STANDARD_CELL_RULES) {
    const cell = rule.read(name);
    const symbolId =
      cell && cell.inputs <= (rule.widest[cell.fn] ?? 4)
        ? GATE_SYMBOLS[cell.fn][cell.inputs]
        : undefined;
    if (!cell || !symbolId) continue;
    const binding: ReviewedExternalDeviceBinding = {
      id: `${STANDARD_CELL_ID}${cell.masterName}`,
      libraryId: rule.libraryId,
      masterName: cell.masterName,
      invocationKind: "external-subcircuit",
      symbolId,
      deviceClass: "logic",
      terminals: rule
        .pins(cell.fn, cell.inputs)
        .map(
          ([targetName, pinName, supply]): ReviewedExternalTerminalBinding =>
            supply
              ? { targetName, pinName, interaction: "property", supply }
              : { targetName, pinName, interaction: "canvas" },
        ),
      parameters: [],
    };
    standardCellBindings.set(key, binding);
    return binding;
  }
  return undefined;
}

const reviewedById = new Map(
  reviewedExternalDeviceBindings.map((binding) => [
    binding.id as string,
    binding,
  ]),
);

export function reviewedExternalBindingForMaster(
  masterName: string,
): ReviewedExternalDeviceBinding | undefined {
  const normalized = masterName.toLowerCase();
  return (
    reviewedExternalDeviceBindings.find(
      (binding) => binding.masterName.toLowerCase() === normalized,
    ) ?? standardCellBinding(masterName)
  );
}

/** The binding a netlisted Instance recorded, standard cells included. */
export function reviewedExternalBindingById(
  id: string | undefined,
): ReviewedExternalDeviceBinding | undefined {
  if (!id) return undefined;
  return (
    reviewedById.get(id) ??
    (id.startsWith(STANDARD_CELL_ID)
      ? standardCellBinding(id.slice(STANDARD_CELL_ID.length))
      : undefined)
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

/** The process a reviewed library belongs to: a PDK's standard cells ride with its primitives. */
const libraryProcess = (
  libraryId: ReviewedExternalDeviceBinding["libraryId"],
) =>
  libraryId.startsWith("sky130")
    ? "sky130"
    : libraryId.startsWith("sg13g2")
      ? "sg13g2"
      : libraryId;

/** Reviewed masters a part may take, from one PDK's libraries or all of them. */
export function reviewedExternalModelSuggestions(
  symbolId: string,
  libraryId?: ReviewedExternalDeviceBinding["libraryId"],
): readonly string[] {
  const sameProcess = (id: ReviewedExternalDeviceBinding["libraryId"]) =>
    !libraryId || libraryProcess(id) === libraryProcess(libraryId);
  // A gate is offered each library's weakest cell of its function; any other
  // drive strength or variant of the library is accepted as well.
  const gate = GATE_OF_SYMBOL.get(symbolId);
  if (gate)
    return STANDARD_CELL_RULES.filter(
      (rule) =>
        sameProcess(rule.libraryId) &&
        gate.inputs <= (rule.widest[gate.fn] ?? 4),
    ).map((rule) => rule.example(gate.fn, gate.inputs));
  return reviewedExternalDeviceBindings
    .filter(
      (binding) =>
        reviewedExternalBindingSupportsSymbol(binding, symbolId) &&
        sameProcess(binding.libraryId),
    )
    .map((binding) => binding.masterName);
}

/**
 * Whether a part drawn with this symbol may take the reviewed device. Only its
 * own symbol may: the binding's terminals name that symbol's pins, so on any
 * other drawing they are pins the part does not have, and it can be neither
 * wired nor exported.
 */
export function reviewedExternalBindingSupportsSymbol(
  binding: ReviewedExternalDeviceBinding,
  symbolId: string,
): boolean {
  return binding.symbolId === symbolId;
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
