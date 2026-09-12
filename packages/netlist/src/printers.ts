import type {
  DesignNetlistCell,
  DesignNetlistIR,
  DesignNetlistInstance,
  DesignNetlistParameter,
} from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { normalizeIndependentSource } from "./source-waveform.js";

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

function spiceSourceTokens(instance: DesignNetlistInstance): string[] {
  const source = normalizeIndependentSource(instance.parameters);
  const transient = source.transient;
  return [
    ...(source.dc === undefined ? [] : ["DC", source.dc]),
    ...(source.ac ? ["AC", source.ac.magnitude, source.ac.phase] : []),
    ...(transient.kind === "pulse"
      ? [
          `PULSE(${[
            transient.low,
            transient.high,
            transient.delay,
            transient.rise,
            transient.fall,
            transient.width,
            transient.period,
          ].join(" ")})`,
        ]
      : transient.kind === "sin"
        ? [
            `SIN(${[
              transient.offset,
              transient.amplitude,
              transient.frequency,
              transient.delay,
              transient.damping,
              transient.phase,
            ].join(" ")})`,
          ]
        : transient.kind === "pwl"
          ? [
              `PWL(${transient.points
                .flatMap((point) => [point.time, point.value])
                .join(" ")})`,
            ]
          : []),
    ...assignments(source.extraParameters),
  ];
}

function spectreSourceValues(instance: DesignNetlistInstance): string[] {
  const source = normalizeIndependentSource(instance.parameters);
  const transient = source.transient;
  const ac = source.ac
    ? [`mag=${source.ac.magnitude}`, `phase=${source.ac.phase}`]
    : [];
  if (transient.kind === "pulse") {
    return [
      "type=pulse",
      `val0=${transient.low}`,
      `val1=${transient.high}`,
      `delay=${transient.delay}`,
      `rise=${transient.rise}`,
      `fall=${transient.fall}`,
      `width=${transient.width}`,
      `period=${transient.period}`,
      ...(source.dc === undefined ? [] : [`dc=${source.dc}`]),
      ...ac,
      ...assignments(source.extraParameters),
    ];
  }
  if (transient.kind === "sin") {
    return [
      "type=sine",
      `dc=${transient.offset}`,
      `ampl=${transient.amplitude}`,
      `freq=${transient.frequency}`,
      `delay=${transient.delay}`,
      `damp=${transient.damping}`,
      `sinephase=${transient.phase}`,
      ...ac,
      ...assignments(source.extraParameters),
    ];
  }
  if (transient.kind === "pwl") {
    return [
      "type=pwl",
      `wave=[${transient.points
        .flatMap((point) => [point.time, point.value])
        .join(" ")}]`,
      ...(source.dc === undefined ? [] : [`dc=${source.dc}`]),
      ...ac,
      ...assignments(source.extraParameters),
    ];
  }
  return [
    ...(source.dc === undefined ? [] : [`dc=${source.dc}`]),
    ...ac,
    ...assignments(source.extraParameters),
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
    case "current-source":
      tokens = [reference, ...nodes, ...spiceSourceTokens(instance)];
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

function spiceCell(
  cell: DesignNetlistCell,
  onInstance?: (instance: DesignNetlistInstance, offset: number) => void,
): string[] {
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
  let offset = lines.join("\n").length + 1;
  for (const instance of cell.instances) {
    onInstance?.(instance, offset);
    const cards = spiceInstance(instance);
    lines.push(...cards);
    offset += cards.reduce((total, line) => total + line.length + 1, 0);
  }
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

export interface PrintedSpiceInstance {
  documentId: string;
  instanceId: string;
  startOffset: number;
  endOffset: number;
}

export interface PrintedSpiceParameter {
  documentId: string;
  instanceId: string;
  parameter: string;
  rawValue: string;
  startOffset: number;
  endOffset: number;
}

/** The same printer supplies locations; no parser guesses IDs from printed refs. */
export function printSpiceWithLocations(
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
): {
  text: string;
  parameters: PrintedSpiceParameter[];
  instances: PrintedSpiceInstance[];
} {
  return renderSpice(ir, rootAsTopLevel, true);
}

function renderSpice(
  ir: DesignNetlistIR,
  rootAsTopLevel: boolean,
  locations: boolean,
): {
  text: string;
  parameters: PrintedSpiceParameter[];
  instances: PrintedSpiceInstance[];
} {
  const lines = ["* Generated by Interactive Circuit Maker netlist-export/1.0"];
  const parameters: PrintedSpiceParameter[] = [];
  const instances: PrintedSpiceInstance[] = [];
  let length = lines[0]!.length;
  const append = (...next: string[]) => {
    for (const line of next) {
      lines.push(line);
      length += line.length + 1;
    }
  };
  const locate = (
    documentId: string,
    instance: DesignNetlistInstance,
    offset: number,
  ) => {
    if (!locations) return;
    const original = spiceInstance(instance).join("\n");
    if (original.length)
      instances.push({
        documentId,
        instanceId: instance.id,
        startOffset: offset,
        endOffset: offset + original.length,
      });
    for (const parameter of instance.parameters) {
      if (!parameter.rawValue.length) continue;
      // A same-length marker leaves wrapping intact. Prove the mapping by
      // round-tripping through the real printer, including waveform fields.
      const marker = "\ue000".repeat(parameter.rawValue.length);
      if (original.includes(marker)) continue;
      let marked: string;
      try {
        marked = spiceInstance({
          ...instance,
          parameters: instance.parameters.map((p) =>
            p === parameter ? { ...p, rawValue: marker } : p,
          ),
        }).join("\n");
      } catch {
        continue;
      }
      if (marked.replaceAll(marker, parameter.rawValue) !== original) continue;
      for (
        let at = marked.indexOf(marker);
        at >= 0;
        at = marked.indexOf(marker, at + marker.length)
      )
        parameters.push({
          documentId,
          instanceId: instance.id,
          parameter: parameter.name,
          rawValue: parameter.rawValue,
          startOffset: offset + at,
          endOffset: offset + at + marker.length,
        });
    }
  };
  const globals = ir.globals.filter((name) => name !== "0");
  if (globals.length) append(...wrapSpice([".global", ...globals]));
  for (const cell of ir.cells) {
    if (rootAsTopLevel && cell.id === ir.topCellId) continue;
    append("");
    const offset = length + 1;
    append(
      ...spiceCell(
        cell,
        locations
          ? (instance, relative) => locate(cell.id, instance, offset + relative)
          : undefined,
      ),
    );
  }
  if (rootAsTopLevel) {
    const root = ir.cells.find((cell) => cell.id === ir.topCellId);
    const defaults =
      root?.formalParameters?.filter(
        (parameter) => parameter.defaultValue !== undefined,
      ) ?? [];
    if (defaults.length)
      append(
        ...wrapSpice([
          ".param",
          ...defaults.map(
            (parameter) => `${parameter.name}=${parameter.defaultValue}`,
          ),
        ]),
      );
    if (root)
      for (const instance of root.instances) {
        locate(root.id, instance, length + 1);
        append(...spiceInstance(instance));
      }
  }
  return { text: `${lines.join("\n")}\n`, parameters, instances };
}

export function printSpiceNetlist(ir: DesignNetlistIR): string {
  return renderSpice(ir, false, false).text;
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
      values = spectreSourceValues(instance);
      break;
    case "current-source":
      master = "isource";
      values = spectreSourceValues(instance);
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
