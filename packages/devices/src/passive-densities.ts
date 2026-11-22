import { parameterExpressionBody } from "./parameter-expression.js";
import {
  LIBRARY_PROCESS,
  reviewedExternalBindingForMaster,
  reviewedSize,
  type ReviewedExternalDeviceBinding,
} from "./reviewed-external.js";

/**
 * A reviewed PDK resistor's value from its drawn geometry: R = ρ·L/W ÷ the
 * device's parallel count. Contact and head resistance are left out, so a
 * converted value is approximate.
 */
export interface ResistorDensity {
  readonly kind: "resistor";
  /** Sheet resistance, Ω/□. */
  readonly sheetResistance: number;
  /** The width a part sized from a value takes, metres; else the device's default W. */
  readonly width?: number;
  /** Shortest and longest L, metres, where the device's sizeLimits give none. */
  readonly length?: readonly [shortest: number, longest: number];
  /**
   * A bend count the model reads as series segments:
   * L_eff = (b + 1)·L + (2·W/κ + spacing)·b.
   */
  readonly bends?: {
    readonly parameter: string;
    readonly kappa: number;
    readonly spacing: number;
    readonly max: number;
  };
}

/**
 * A reviewed PDK capacitor's value from its drawn geometry:
 * C = (area·W·L + perimeter·2·(W + L)) × the device's parallel count.
 */
export interface CapacitorDensity {
  readonly kind: "capacitor";
  /** F/m². */
  readonly area: number;
  /** F/m. */
  readonly perimeter: number;
  /** Side of one copy, metres, where tighter than the device's sizeLimits. */
  readonly side?: readonly [shortest: number, longest: number];
  /** The largest value one copy may have, F. */
  readonly maxValue?: number;
}

export type PassiveDensity = ResistorDensity | CapacitorDensity;

/** One Process's passive densities, by reviewed master name. */
export interface ProcessPassiveDensities {
  /** Layout grid, metres. */
  readonly grid: number;
  readonly devices: Readonly<Record<string, PassiveDensity>>;
}

/*
 * SKY130. Sheet resistance is the model's `rsheet` (google/skywater-pdk-libs-
 * sky130_fd_pr, cells/res_*_po/*.model.spice; the docs' device details give
 * 300 and 2000 Ω/□). MIM: device details CMIMA 2 fF/µm², CMIMP 0.19 fF/µm
 * (skywater-pdk.readthedocs.io/en/main/rules/device-details.html, cap_mim);
 * side 2–30 µm and L from 0.5 µm as open_pdks' generator draws them
 * (sky130/magic/sky130-cap.tcl, sky130-res.tcl). Width 0.35 µm: the narrowest
 * precision resistor (periphery rule rpm.1b). Grid 5 nm: rule x.1b.
 * res_generic_po is left out: the docs do not map it to a sheet resistance.
 */
const SKY130_PASSIVES: ProcessPassiveDensities = {
  grid: 5e-9,
  devices: {
    sky130_fd_pr__res_high_po: {
      kind: "resistor",
      sheetResistance: 317.3885,
      width: 0.35e-6,
      length: [0.5e-6, Number.POSITIVE_INFINITY],
    },
    sky130_fd_pr__res_xhigh_po: {
      kind: "resistor",
      sheetResistance: 2000,
      width: 0.35e-6,
      length: [0.5e-6, Number.POSITIVE_INFINITY],
    },
    sky130_fd_pr__cap_mim_m3_1: {
      kind: "capacitor",
      area: 2e-3,
      perimeter: 0.19e-9,
      side: [2e-6, 30e-6],
    },
    sky130_fd_pr__cap_mim_m3_2: {
      kind: "capacitor",
      area: 2e-3,
      perimeter: 0.19e-9,
      side: [2e-6, 30e-6],
    },
  },
};

/*
 * IHP SG13G2 (IHP-Open-PDK, ihp-sg13g2/libs.tech/ngspice/models): sheet
 * resistance `rsh_*` of cornerRES.lib's res_typ (rsil 7, rppd 260, rhigh
 * 1360 Ω/□); bends as resistors_mod.lib reads them (κ 1.85, ps 0.18 µm; b
 * at most 100 as the binding allows); cmim `cap_carea` 1.5 fF/µm² of
 * cornerCAP.lib's cap_typ and CJSW 0.04 fF/µm of capacitors_mod.lib, at most
 * 8 pF a copy (sg13g2_tech.json `cmim_maxC`). Grid 5 nm: klayout DRC 3.1
 * offgrid. cap_rfcmim is left out: its model is an RF network, not a density.
 */
const SG13G2_PASSIVES: ProcessPassiveDensities = {
  grid: 5e-9,
  devices: {
    rsil: { kind: "resistor", sheetResistance: 7 },
    rppd: {
      kind: "resistor",
      sheetResistance: 260,
      bends: { parameter: "b", kappa: 1.85, spacing: 0.18e-6, max: 100 },
    },
    rhigh: {
      kind: "resistor",
      sheetResistance: 1360,
      bends: { parameter: "b", kappa: 1.85, spacing: 0.18e-6, max: 100 },
    },
    cap_cmim: {
      kind: "capacitor",
      area: 1.5e-3,
      perimeter: 0.04e-9,
      maxValue: 8e-12,
    },
  },
};

/**
 * Each Process's passive densities, by the Process `LIBRARY_PROCESS` names.
 * A Process with ideal passives only declares none. A device missing here is
 * never converted by value.
 */
export const PROCESS_PASSIVE_DENSITIES: Readonly<
  Record<string, ProcessPassiveDensities>
> = {
  sky130: SKY130_PASSIVES,
  sg13g2: SG13G2_PASSIVES,
};

/** A reviewed passive whose value its geometry gives. */
export interface ReviewedPassive {
  readonly binding: ReviewedExternalDeviceBinding;
  readonly density: PassiveDensity;
  readonly grid: number;
}

export function reviewedPassive(
  masterName: string,
): ReviewedPassive | undefined {
  const binding = reviewedExternalBindingForMaster(masterName);
  if (!binding) return undefined;
  const process = PROCESS_PASSIVE_DENSITIES[LIBRARY_PROCESS[binding.libraryId]];
  const density = process?.devices[binding.masterName];
  return density && density.kind === binding.deviceClass
    ? { binding, density, grid: process.grid }
    : undefined;
}

const SCALE: Readonly<Record<string, number>> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  mil: 25.4e-6,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
};
const VALUE =
  /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?([\p{L}°]*)\s*$/iu;

/**
 * A positive literal as SPICE reads it (20pF, 10kΩ, 1MegΩ; M is milli), or
 * undefined: an expression, a micro sign readers disagree on, or text.
 */
export function passiveNumber(text: string): number | undefined {
  if (parameterExpressionBody(text) !== undefined) return undefined;
  const match = VALUE.exec(text);
  if (!match || /^[µμ]/u.test(match[3] ?? "")) return undefined;
  const value =
    Number(match[1]) * (match[2] ? SCALE[match[2].toLowerCase()]! : 1);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const PREFIXES: readonly (readonly [number, string])[] = [
  [1e9, "G"],
  [1e6, "Meg"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "u"],
  [1e-9, "n"],
  [1e-12, "p"],
  [1e-15, "f"],
  [1e-18, "a"],
];

/** A value in three significant digits with its unit: 25.4pF, 232kΩ, 1.2MegΩ. */
export function formatPassiveValue(
  value: number,
  kind: PassiveDensity["kind"],
): string {
  const unit = kind === "resistor" ? "Ω" : "F";
  for (const [scale, prefix] of PREFIXES) {
    const digits = Number((value / scale).toPrecision(3));
    if (digits >= 1 || scale === 1e-18) return `${digits}${prefix}${unit}`;
  }
  return `${value}${unit}`;
}

/** Metres on the grid, as the Project writes a length: 12.345u. */
function lengthText(metres: number): string {
  return `${Number((metres / 1e-6).toFixed(4))}u`;
}

const roleParameter = (
  binding: ReviewedExternalDeviceBinding,
  role: "width" | "length" | "multiplier",
) => binding.parameters.find((parameter) => parameter.displayRole === role);

const partValue = (
  parameters: Readonly<Record<string, string>>,
  name: string,
  fallback: string | undefined,
) =>
  Object.entries(parameters).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1] ?? fallback;

function count(text: string | undefined): number | undefined {
  if (text === undefined) return 1;
  if (parameterExpressionBody(text) !== undefined) return undefined;
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 1 mm: a size past it on a micrometre library is a unit slip (#1474). */
const SLIP = 1e-3;

function capacitance(
  density: CapacitorDensity,
  width: number,
  length: number,
): number {
  return (
    density.area * width * length + density.perimeter * 2 * (width + length)
  );
}

function effectiveLength(
  density: ResistorDensity,
  width: number,
  length: number,
  bends: number,
): number {
  return density.bends
    ? (bends + 1) * length +
        ((2 * width) / density.bends.kappa + density.bends.spacing) * bends
    : length;
}

/**
 * The resistance (Ω) or capacitance (F) a reviewed passive's parameters give,
 * or undefined: its density is not known, or a size is an expression, a unit
 * slip or unreadable.
 */
export function reviewedPassiveValue(
  masterName: string,
  parameters: Readonly<Record<string, string>>,
): number | undefined {
  const passive = reviewedPassive(masterName);
  if (!passive) return undefined;
  const { binding, density } = passive;
  const size = reviewedSize(binding, parameters);
  const width = size.width?.metres;
  const length = size.length?.metres;
  if (!width || !length || width > SLIP || length > SLIP) return undefined;
  const multiplierParameter = roleParameter(binding, "multiplier");
  const copies = multiplierParameter
    ? count(
        partValue(
          parameters,
          multiplierParameter.name,
          multiplierParameter.defaultValue,
        ),
      )
    : 1;
  if (!copies) return undefined;
  if (density.kind === "capacitor")
    return capacitance(density, width, length) * copies;
  const bends = density.bends
    ? count(partValue(parameters, density.bends.parameter, "0"))
    : 0;
  if (bends === undefined) return undefined;
  return (
    (density.sheetResistance * effectiveLength(density, width, length, bends)) /
    width /
    copies
  );
}

/** More parallel copies than this says the value is wrong, not the size. */
const MAX_COPIES = 100;

/** A reviewed passive sized for a value. */
export interface SizedPassive {
  /** The device's parameters, under the binding's names. */
  readonly parameters: Readonly<Record<string, string>>;
  /** The value those parameters give. */
  readonly value: number;
  /** Set when the value is out of the device's reach: the size stops at this bound. */
  readonly clamped?: "minimum" | "maximum";
}

/**
 * Parameters that give a reviewed passive this value, or undefined when its
 * density is not known. A resistor keeps the Process's width and solves L;
 * a value too small for the shortest L takes parallel copies, one too large
 * for the longest takes series bends where the model has them, else stops
 * there. A capacitor is square; past its largest side or value it is split
 * into parallel copies, at most 100. Sizes fall on the Process's grid.
 */
export function sizeReviewedPassive(
  masterName: string,
  value: number,
): SizedPassive | undefined {
  const passive = reviewedPassive(masterName);
  if (!passive || !(value > 0)) return undefined;
  const { binding, density, grid } = passive;
  const widthParameter = roleParameter(binding, "width");
  const lengthParameter = roleParameter(binding, "length");
  const multiplierParameter = roleParameter(binding, "multiplier");
  if (!widthParameter || !lengthParameter) return undefined;
  // In grid steps, a bound already on the grid (1.14 µm) staying put.
  const snap = (metres: number, low: number, high: number) =>
    Math.min(
      Math.max(Math.round(metres / grid), Math.ceil(low / grid - 1e-6)),
      Math.floor(high / grid + 1e-6),
    ) * grid;
  let clamped: SizedPassive["clamped"];
  let copies = 1;
  const parameters: Record<string, string> = {};
  if (density.kind === "capacitor") {
    const limits = binding.sizeLimits;
    const sideFor = (target: number) =>
      (-4 * density.perimeter +
        Math.sqrt(16 * density.perimeter ** 2 + 4 * density.area * target)) /
      (2 * density.area);
    const shortest = Math.max(
      density.side?.[0] ?? 0,
      limits?.length[0] ?? 0,
      limits?.widthPerFinger ?? 0,
      grid,
    );
    const longest = Math.min(
      density.side?.[1] ?? Number.POSITIVE_INFINITY,
      limits?.length[1] ?? Number.POSITIVE_INFINITY,
      density.maxValue === undefined
        ? Number.POSITIVE_INFINITY
        : sideFor(density.maxValue),
    );
    let side = sideFor(value);
    if (side > longest) {
      if (multiplierParameter) {
        const needed = Math.ceil(
          value / capacitance(density, longest, longest),
        );
        copies = Math.min(needed, MAX_COPIES);
        if (needed > MAX_COPIES) clamped = "maximum";
        side = Math.min(sideFor(value / copies), longest);
      } else {
        side = longest;
        clamped = "maximum";
      }
    }
    if (side < shortest) clamped = "minimum";
    side = snap(side, shortest, longest);
    parameters[widthParameter.name] = lengthText(side);
    parameters[lengthParameter.name] = lengthText(side);
  } else {
    const width =
      density.width ??
      reviewedSize(binding, {}).width?.metres ??
      binding.sizeLimits?.widthPerFinger;
    if (!width) return undefined;
    const [shortest, longest] = binding.sizeLimits?.length ??
      density.length ?? [grid, Number.POSITIVE_INFINITY];
    const squares = value / density.sheetResistance;
    let total = squares * width;
    if (total < shortest) {
      const needed = Math.ceil(shortest / total);
      if (multiplierParameter) {
        copies = Math.min(needed, MAX_COPIES);
        total *= copies;
      }
      if (!multiplierParameter || needed > MAX_COPIES) clamped = "minimum";
    }
    let bends = 0;
    let length = total;
    if (total > longest) {
      const step = density.bends
        ? (2 * width) / density.bends.kappa + density.bends.spacing
        : 0;
      bends = density.bends
        ? Math.ceil((total - longest) / (longest + step))
        : 0;
      if (density.bends && bends <= density.bends.max)
        length = (total - step * bends) / (bends + 1);
      else {
        bends = density.bends?.max ?? 0;
        length = longest;
        clamped = "maximum";
      }
    }
    length = snap(length, shortest, longest);
    parameters[widthParameter.name] = lengthText(width);
    parameters[lengthParameter.name] = lengthText(length);
    if (density.bends) parameters[density.bends.parameter] = String(bends);
  }
  if (multiplierParameter)
    parameters[multiplierParameter.name] = String(copies);
  return {
    parameters,
    value: reviewedPassiveValue(masterName, parameters)!,
    ...(clamped ? { clamped } : {}),
  };
}
