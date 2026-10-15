import type { NetlistFormat } from "@icm/netlist";

/**
 * What the Netlist panel shows: a dialect's netlist, alone or with the
 * drawing written into it as RNL (docs/specs/rnl-interchange.md).
 */
export type NetlistMode = NetlistFormat | `${NetlistFormat}+rnl`;

export const netlistModeOptions = [
  { value: "spice", label: "SPICE" },
  { value: "spectre", label: "SCS" },
  { value: "spice+rnl", label: "SPICE+RNL" },
  { value: "spectre+rnl", label: "Spectre+RNL" },
] as const satisfies readonly { value: NetlistMode; label: string }[];

export function netlistMode(format: NetlistFormat, rnl: boolean): NetlistMode {
  return rnl ? `${format}+rnl` : format;
}

export function netlistModeParts(mode: NetlistMode): {
  format: NetlistFormat;
  rnl: boolean;
} {
  return mode.endsWith("+rnl")
    ? { format: mode.slice(0, -"+rnl".length) as NetlistFormat, rnl: true }
    : { format: mode as NetlistFormat, rnl: false };
}

/** The name a status line gives a mode's netlist. */
export function netlistModeLabel(mode: NetlistMode): string {
  return netlistModeOptions.find((option) => option.value === mode)!.label;
}
