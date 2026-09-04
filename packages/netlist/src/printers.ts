import type {
  DesignNetlistCell,
  DesignNetlistIR,
  DesignNetlistInstance,
  DesignNetlistParameter,
} from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";

export type { NetlistFormat } from "./net-name-codec.js";

export interface NetlistFileDescriptor {
  extension: ".spi" | ".scs";
  mediaType: "application/x-spice" | "application/x-spectre";
  text: string;
}

function parameter(
  parameters: readonly DesignNetlistParameter[],
  name: string,
): string | undefined {
  return parameters.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.rawValue;
}

function assignments(
  parameters: readonly DesignNetlistParameter[],
  excluded: readonly string[] = [],
): string[] {
  const folded = new Set(excluded.map((name) => name.toLowerCase()));
  return parameters
    .filter((item) => !folded.has(item.name.toLowerCase()))
    .map((item) => `${item.name}=${item.rawValue}`);
}

const PULSE_PARAMETER_NAMES = [
  "low",
  "high",
  "delay",
  "rise",
  "fall",
  "width",
  "period",
] as const;
const DIGITAL_CLOCK_AUTHORING_PARAMETER_NAMES = [
  "dutyCycle",
  "initial",
] as const;
const ALL_CLOCK_PARAMETER_NAMES = [
  ...PULSE_PARAMETER_NAMES,
  ...DIGITAL_CLOCK_AUTHORING_PARAMETER_NAMES,
] as const;

function isPulseSource(instance: DesignNetlistInstance): boolean {
  return parameter(instance.parameters, "period") !== undefined;
}

/**
 * The small-signal stimulus of an independent source, authored as the formal
 * `acMagnitude`/`acPhase` parameters of its device descriptor
 * (`docs/specs/simulation.md`, "Sources and analyses"). The phase defaults
 * to 0 once a magnitude exists; a phase without a magnitude has no card to
 * ride on and is not printed, so the deck never carries a stimulus the
 * schematic does not.
 */
const AC_PARAMETER_NAMES = ["acMagnitude", "acPhase"] as const;

function acStimulus(
  instance: DesignNetlistInstance,
): { magnitude: string; phase: string } | null {
  const magnitude = parameter(instance.parameters, "acMagnitude");
  if (magnitude === undefined) return null;
  return {
    magnitude,
    phase: parameter(instance.parameters, "acPhase") ?? "0",
  };
}

/** `DC <dc> [AC <magnitude> <phase>]` plus every remaining assignment. */
function spiceDcSourceTokens(instance: DesignNetlistInstance): string[] {
  const ac = acStimulus(instance);
  return [
    "DC",
    parameter(instance.parameters, "dc")!,
    ...(ac ? ["AC", ac.magnitude, ac.phase] : []),
    ...assignments(instance.parameters, ["dc", ...AC_PARAMETER_NAMES]),
  ];
}

/** `dc=<dc> [mag=<magnitude> phase=<phase>]` plus every remaining assignment. */
function spectreDcSourceValues(instance: DesignNetlistInstance): string[] {
  const ac = acStimulus(instance);
  return [
    `dc=${parameter(instance.parameters, "dc")!}`,
    ...(ac ? [`mag=${ac.magnitude}`, `phase=${ac.phase}`] : []),
    ...assignments(instance.parameters, ["dc", ...AC_PARAMETER_NAMES]),
  ];
}

function wrapSpice(tokens: readonly string[], width = 100): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const separator = line ? " " : "";
    if (line && line.length + separator.length + token.length > width) {
      lines.push(line);
      line = `+ ${token}`;
    } else {
      line += `${separator}${token}`;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function spiceInstance(instance: DesignNetlistInstance): string[] {
  const nodes = instance.nodes.map((node) => node.netName);
  const reference = instance.reference;
  let tokens: string[];
  switch (instance.deviceClass) {
    case "resistor":
    case "capacitor":
    case "inductor":
      tokens = [
        reference,
        ...nodes,
        parameter(instance.parameters, "value")!,
        ...assignments(instance.parameters, ["value"]),
      ];
      break;
    case "voltage-source":
      tokens = isPulseSource(instance)
        ? [
            reference,
            ...nodes,
            `PULSE(${PULSE_PARAMETER_NAMES.map((name) =>
              parameter(instance.parameters, name)!,
            ).join(" ")})`,
            ...assignments(instance.parameters, ALL_CLOCK_PARAMETER_NAMES),
          ]
        : [reference, ...nodes, ...spiceDcSourceTokens(instance)];
      break;
    case "current-source":
      tokens = [reference, ...nodes, ...spiceDcSourceTokens(instance)];
      break;
    case "mos":
    case "diode":
    case "bjt":
    // `S<ref> n+ n- nc+ nc- MODEL`: nodes then the model card, the same shape
    // as every other model-bearing primitive.
    case "switch":
      tokens = [
        reference,
        ...nodes,
        instance.target!,
        ...assignments(instance.parameters),
      ];
      break;
    case "hierarchical":
      tokens = [
        reference,
        ...nodes,
        instance.target!,
        ...assignments(instance.parameters),
      ];
      break;
    case "net-marker":
      return [];
  }
  return wrapSpice(tokens);
}

function spiceCell(cell: DesignNetlistCell): string[] {
  const lines = wrapSpice([
    ".subckt",
    cell.name,
    ...cell.ports.map((port) => port.name),
    ...(cell.formalParameters?.length
      ? [
          "params:",
          ...cell.formalParameters.map(
            (parameter) => `${parameter.name}=${parameter.defaultValue!}`,
          ),
        ]
      : []),
  ]);
  for (const instance of cell.instances) lines.push(...spiceInstance(instance));
  lines.push(`.ends ${cell.name}`);
  return lines;
}

/**
 * One Cell's instances as top-level SPICE cards, without a `.subckt` wrapper.
 *
 * A simulation root is instantiated rather than defined: its devices are the
 * deck's own cards. This shares `spiceInstance` with `spiceCell` so a
 * testbench card can never drift from the `.subckt` card the structural
 * export writes for the same Instance — same tokens, same wrapping, same
 * order. Net markers still print nothing.
 */
export function printSpiceCellInstances(cell: DesignNetlistCell): string[] {
  return cell.instances.flatMap((instance) => spiceInstance(instance));
}

export function printSpiceNetlist(ir: DesignNetlistIR): string {
  const lines = ["* Generated by Interactive Circuit Maker netlist-export/1.0"];
  const globals = ir.globals.filter((name) => name !== "0");
  if (globals.length) lines.push(...wrapSpice([".global", ...globals]));
  for (const cell of ir.cells) {
    lines.push("", ...spiceCell(cell));
  }
  return `${lines.join("\n")}\n`;
}

function spectreInstance(instance: DesignNetlistInstance): string {
  const prefix = `${instance.reference} (${instance.nodes
    .map((node) => node.netName)
    .join(" ")})`;
  let master: string;
  let values: string[];
  switch (instance.deviceClass) {
    case "resistor":
      master = "resistor";
      values = [
        `r=${parameter(instance.parameters, "value")!}`,
        ...assignments(instance.parameters, ["value"]),
      ];
      break;
    case "capacitor":
      master = "capacitor";
      values = [
        `c=${parameter(instance.parameters, "value")!}`,
        ...assignments(instance.parameters, ["value"]),
      ];
      break;
    case "inductor":
      master = "inductor";
      values = [
        `l=${parameter(instance.parameters, "value")!}`,
        ...assignments(instance.parameters, ["value"]),
      ];
      break;
    case "voltage-source":
      master = "vsource";
      values = isPulseSource(instance)
        ? [
            "type=pulse",
            `val0=${parameter(instance.parameters, "low")!}`,
            `val1=${parameter(instance.parameters, "high")!}`,
            ...PULSE_PARAMETER_NAMES.slice(2).map(
              (name) => `${name}=${parameter(instance.parameters, name)!}`,
            ),
            ...assignments(instance.parameters, ALL_CLOCK_PARAMETER_NAMES),
          ]
        : spectreDcSourceValues(instance);
      break;
    case "current-source":
      master = "isource";
      values = spectreDcSourceValues(instance);
      break;
    case "mos":
    case "diode":
    case "bjt":
    case "switch":
    case "hierarchical":
      master = instance.target!;
      values = assignments(instance.parameters);
      break;
    case "net-marker":
      return "";
  }
  return [prefix, master, ...values].join(" ");
}

function spectreCell(cell: DesignNetlistCell): string[] {
  const portNames = cell.ports.map((port) => port.name);
  const lines = [
    `subckt ${cell.name}${portNames.length ? ` (${portNames.join(" ")})` : ""}`,
  ];
  if (cell.formalParameters?.length) {
    lines.push(
      `parameters ${cell.formalParameters
        .map((parameter) => `${parameter.name}=${parameter.defaultValue!}`)
        .join(" ")}`,
    );
  }
  for (const instance of cell.instances) {
    const line = spectreInstance(instance);
    if (line) lines.push(line);
  }
  lines.push(`ends ${cell.name}`);
  return lines;
}

export function printSpectreNetlist(ir: DesignNetlistIR): string {
  const lines = [
    "// Generated by Interactive Circuit Maker netlist-export/1.0",
    "simulator lang=spectre",
  ];
  const globals = ir.globals.filter((name) => name !== "0");
  if (globals.length) lines.push(`global ${globals.join(" ")}`);
  for (const cell of ir.cells) {
    lines.push("", ...spectreCell(cell));
  }
  return `${lines.join("\n")}\n`;
}

export function printDesignNetlist(
  format: NetlistFormat,
  ir: DesignNetlistIR,
): NetlistFileDescriptor {
  return format === "spice"
    ? {
        extension: ".spi",
        mediaType: "application/x-spice",
        text: printSpiceNetlist(ir),
      }
    : {
        extension: ".scs",
        mediaType: "application/x-spectre",
        text: printSpectreNetlist(ir),
      };
}
