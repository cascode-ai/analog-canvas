import type {
  DesignNetlistCell,
  DesignNetlistIR,
  DesignNetlistInstance,
  DesignNetlistMagneticSubcircuit,
} from "./ir.js";
import {
  definitionBody,
  generatedBehavioralModel,
  generatedBehavioralDefinition,
} from "./generated-models.js";
import { printSpectreBehavioralModel } from "./behavioral-model.js";
import { switchBehavioralDefinition } from "./ideal-switch-model.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { printInstanceCard } from "./printed-card.js";
import { spectreNumber } from "./parameter-projection.js";
import { printedCouplingValue } from "./extract-coupling.js";
import type {
  DesignNetlistLocations,
  PrintedNetlistInstance,
  ResolvePrintedNode,
  PrintedNetlistParameter,
  PrintedNetlistField,
} from "./printed-netlist.js";

export type { NetlistFormat } from "./net-name-codec.js";

export interface NetlistFileDescriptor {
  extension: ".spi" | ".scs";
  mediaType: "application/x-spice" | "application/x-spectre";
  text: string;
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
  return printInstanceCard(instance, "spice").lines;
}

/** A Cell's own model cards, each `.model NAME TYPE(PARAM=VALUE …)`. */
/** A model a Cell carries, as the SPICE card its body holds. */
export function spiceModelCard(
  model: NonNullable<DesignNetlistCell["models"]>[number],
): string {
  const values = model.parameters
    .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
    .join(" ");
  // A MOS stand-in reads as decks write one, `.model NMOS nmos level=54`.
  if (model.type === "nmos" || model.type === "pmos")
    return `.model ${model.name} ${model.type} ${values}`;
  return `.model ${model.name} ${model.type}(${values})`;
}

/**
 * A model a Cell carries, as Spectre's model statement: a MOS stand-in is
 * Spectre's own BSIM4, as SPICE's is level 54; the classic junction and
 * Gummel-Poon stand-ins, and the junction FETs' Spectre `jfet`, keep the
 * parameters the SPICE card states.
 * Extraction omits the latter from Spectre runs. Null for a switch's model,
 * which Spectre writes as a behavioral definition.
 */
export function spectreModelCard(
  model: NonNullable<DesignNetlistCell["models"]>[number],
): string | null {
  if (model.type === "nmos" || model.type === "pmos") {
    // Spectre's bsim4 is the level; any other parameter, a depletion
    // stand-in's vth0, follows as the SPICE card states it.
    const parameters = model.parameters
      .filter((p) => p.name.toLowerCase() !== "level")
      .map((p) => ` ${p.name.toLowerCase()}=${p.rawValue}`)
      .join("");
    return `model ${model.name} bsim4 type=${model.type === "nmos" ? "n" : "p"}${parameters}`;
  }
  if (!["D", "NPN", "PNP", "NJF", "PJF"].includes(model.type)) return null;
  const kind =
    model.type === "D"
      ? "diode"
      : model.type === "NJF" || model.type === "PJF"
        ? `jfet type=${model.type === "NJF" ? "n" : "p"}`
        : `bjt type=${model.type.toLowerCase()}`;
  const parameters = model.parameters
    .map((p) => `${p.name.toLowerCase()}=${p.rawValue}`)
    .join(" ");
  return `model ${model.name} ${kind}${parameters ? " " + parameters : ""}`;
}

function spiceModels(cell: DesignNetlistCell): string[] {
  return (cell.models ?? [])
    .filter((model) => model.scope !== "global")
    .map(spiceModelCard);
}

function globalModels(
  ir: DesignNetlistIR,
): NonNullable<DesignNetlistCell["models"]> {
  const models = new Map<
    string,
    NonNullable<DesignNetlistCell["models"]>[number]
  >();
  for (const cell of ir.cells)
    for (const model of cell.models ?? [])
      if (model.scope === "global") models.set(model.name, model);
  return [...models.values()];
}

/**
 * A drawn T-coil's or transformer's coupled windings, as the subcircuit its
 * `X` calls name. Each inductor is written from its dotted node, which is how
 * the `K` card reads polarity.
 */
function spiceMagneticSubcircuit(
  subcircuit: DesignNetlistMagneticSubcircuit,
): string[] {
  return [
    ...wrapSpice([
      ".subckt",
      subcircuit.name,
      ...subcircuit.ports,
      "params:",
      ...subcircuit.formalParameters.map(
        (parameter) => `${parameter.name}=${parameter.defaultValue}`,
      ),
    ]),
    ...subcircuit.inductors.map(
      (inductor) =>
        `${inductor.name} ${inductor.nodes.join(" ")} {${inductor.parameter}}`,
    ),
    `${subcircuit.coupling.name} ${subcircuit.coupling.inductors.join(" ")} {${subcircuit.coupling.parameter}}`,
    ...subcircuit.capacitors.map(
      (capacitor) =>
        `${capacitor.name} ${capacitor.nodes.join(" ")} {${capacitor.parameter}}`,
    ),
    `.ends ${subcircuit.name}`,
  ];
}

/** Each `K` over two of the Cell's inductor cards, by their printed names. */
function couplingCards(
  cell: DesignNetlistCell,
  format: NetlistFormat,
): string[] {
  const references = new Map(
    cell.instances.map((instance) => [instance.id, instance.reference]),
  );
  return (cell.couplings ?? []).map((coupling) => {
    const [first, second] = coupling.inductorIds.map(
      (id) => references.get(id) ?? id,
    );
    const k = printedCouplingValue(coupling, format);
    return format === "spice"
      ? `${coupling.reference} ${first} ${second} ${k}`
      : `${coupling.reference} mutual_inductor coupling=${k} ind1=${first} ind2=${second}`;
  });
}

function spiceCell(
  cell: DesignNetlistCell,
  onInstance?: (
    instance: DesignNetlistInstance,
    offset: number,
    card: ReturnType<typeof printInstanceCard>,
  ) => void,
  nodeLocations = false,
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
  // Inside the body, so each Cell stays whole wherever it is included.
  lines.push(...spiceModels(cell));
  let offset = lines.join("\n").length + 1;
  for (const instance of cell.instances) {
    const card = printInstanceCard(
      instance,
      "spice",
      Boolean(onInstance),
      nodeLocations,
    );
    onInstance?.(instance, offset, card);
    lines.push(...card.lines);
    offset += card.lines.reduce((total, line) => total + line.length + 1, 0);
  }
  lines.push(...couplingCards(cell, "spice"));
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
  return [
    ...cell.instances.flatMap((instance) => spiceInstance(instance)),
    ...couplingCards(cell, "spice"),
  ];
}

/** The same printer supplies locations; no parser guesses IDs from printed refs. */
export function printSpiceWithLocations(
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
): {
  text: string;
  parameters: PrintedNetlistParameter[];
  instances: PrintedNetlistInstance[];
} {
  const { text, parameters, instances } = renderSpice(ir, rootAsTopLevel, true);
  return { text, parameters, instances };
}

function renderSpice(
  ir: DesignNetlistIR,
  rootAsTopLevel: boolean,
  locations: boolean,
  resolveNode?: ResolvePrintedNode,
): DesignNetlistLocations & {
  text: string;
  parameters: PrintedNetlistParameter[];
} {
  const lines = ["* Generated by Analog Canvas netlist-export/1.0"];
  const parameters: PrintedNetlistParameter[] = [];
  const instances: PrintedNetlistInstance[] = [];
  let length = lines[0]!.length;
  const append = (...next: string[]) => {
    for (const line of next) {
      lines.push(line);
      length += line.length + 1;
    }
  };
  const fields: PrintedNetlistField[] = [];
  const spans: DesignNetlistLocations = {
    instances,
    fields,
    ...(resolveNode ? { nodes: [] } : {}),
  };
  const locate = cardRecorder(ir, spans, parameters, resolveNode);
  const globals = ir.globals.filter((name) => name !== "0");
  if (globals.length) append(...wrapSpice([".global", ...globals]));
  append(...globalModels(ir).map(spiceModelCard));
  for (const definition of ir.generatedDefinitions ?? []) {
    append("");
    append(
      ...(definition.kind === "magnetic"
        ? spiceMagneticSubcircuit(definition)
        : generatedBehavioralModel(
            definitionBody(definition),
            definition.ports,
            definition.name,
          )),
    );
  }
  for (const cell of ir.cells) {
    if (rootAsTopLevel && cell.id === ir.topCellId) continue;
    append("");
    const offset = length + 1;
    append(
      ...spiceCell(
        cell,
        locations
          ? (instance, relative, card) =>
              locate(cell, instance, offset + relative, card)
          : undefined,
        Boolean(resolveNode),
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
    if (root) {
      append(...spiceModels(root));
      for (const instance of root.instances) {
        const card = printInstanceCard(
          instance,
          "spice",
          locations,
          Boolean(resolveNode),
        );
        if (locations) locate(root, instance, length + 1, card);
        append(...card.lines);
      }
      append(...couplingCards(root, "spice"));
    }
  }
  return { text: `${lines.join("\n")}\n`, parameters, ...spans };
}

export function printSpiceNetlist(
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
): string {
  return renderSpice(ir, rootAsTopLevel, false).text;
}

/** The Spectre form of a drawn magnetic device's coupled windings. */
function spectreMagneticSubcircuit(
  subcircuit: DesignNetlistMagneticSubcircuit,
): string[] {
  const [first, second] = subcircuit.coupling.inductors;
  return [
    `subckt ${subcircuit.name} (${subcircuit.ports.join(" ")})`,
    `parameters ${subcircuit.formalParameters
      .map(
        (parameter) =>
          `${parameter.name}=${spectreNumber(parameter.defaultValue)}`,
      )
      .join(" ")}`,
    ...subcircuit.inductors.map(
      (inductor) =>
        `${inductor.name} (${inductor.nodes.join(" ")}) inductor l=${inductor.parameter}`,
    ),
    `${subcircuit.coupling.name} mutual_inductor coupling=${subcircuit.coupling.parameter} ind1=${first} ind2=${second}`,
    ...subcircuit.capacitors.map(
      (capacitor) =>
        `${capacitor.name} (${capacitor.nodes.join(" ")}) capacitor c=${capacitor.parameter}`,
    ),
    `ends ${subcircuit.name}`,
  ];
}

function spectreCell(
  cell: DesignNetlistCell,
  onInstance?: (
    instance: DesignNetlistInstance,
    offset: number,
    card: ReturnType<typeof printInstanceCard>,
  ) => void,
  asTopLevel = false,
  nodeLocations = false,
): string[] {
  const portNames = cell.ports.map((port) => port.name);
  // The root printed as the file's own cards has no `subckt` around them.
  const lines = asTopLevel
    ? []
    : [
        `subckt ${cell.name}${portNames.length ? ` (${portNames.join(" ")})` : ""}`,
      ];
  if (cell.formalParameters?.length) {
    lines.push(
      `parameters ${cell.formalParameters
        .map(
          (parameter) =>
            `${parameter.name}=${spectreNumber(parameter.defaultValue!)}`,
        )
        .join(" ")}`,
    );
  }
  for (const model of cell.models ?? []) {
    if (model.scope === "global") continue;
    if (model.type === "SW")
      lines.push(
        ...printSpectreBehavioralModel(switchBehavioralDefinition(model)),
      );
    const card = spectreModelCard(model);
    if (card) lines.push(card);
  }
  let offset = lines.length ? lines.join("\n").length + 1 : 0;
  for (const instance of cell.instances) {
    const card = printInstanceCard(
      instance,
      "spectre",
      Boolean(onInstance),
      nodeLocations,
    );
    if (card.text) {
      onInstance?.(instance, offset, card);
      lines.push(card.text);
      offset += card.text.length + 1;
    }
  }
  lines.push(...couplingCards(cell, "spectre"));
  if (!asTopLevel) lines.push(`ends ${cell.name}`);
  return lines;
}

/** A drawn magnetic device's coupled windings, as a file holds them. */
export function printMagneticSubcircuit(
  subcircuit: DesignNetlistMagneticSubcircuit,
  format: NetlistFormat,
): string[] {
  return format === "spice"
    ? spiceMagneticSubcircuit(subcircuit)
    : spectreMagneticSubcircuit(subcircuit);
}

/** A Cell the netlist generates, an ideal block's body, as a file holds it. */
export function printGeneratedCell(
  cell: DesignNetlistCell,
  format: NetlistFormat,
): string[] {
  return format === "spice" ? spiceCell(cell) : spectreCell(cell);
}

function renderSpectre(
  ir: DesignNetlistIR,
  locations = false,
  rootAsTopLevel = false,
  resolveNode?: ResolvePrintedNode,
): DesignNetlistLocations & {
  text: string;
} {
  const lines = [
    "// Generated by Analog Canvas netlist-export/1.0",
    "simulator lang=spectre",
  ];
  const instances: PrintedNetlistInstance[] = [];
  const fields: PrintedNetlistField[] = [];
  const spans: DesignNetlistLocations = {
    instances,
    fields,
    ...(resolveNode ? { nodes: [] } : {}),
  };
  const locate = cardRecorder(ir, spans, undefined, resolveNode);
  const globals = ir.globals.filter((name) => name !== "0");
  if (globals.length) lines.push(`global ${globals.join(" ")}`);
  for (const model of globalModels(ir)) {
    const card = spectreModelCard(model);
    if (card) lines.push(card);
  }
  for (const definition of ir.generatedDefinitions ?? [])
    lines.push(
      "",
      ...(definition.kind === "magnetic"
        ? spectreMagneticSubcircuit(definition)
        : printSpectreBehavioralModel(
            generatedBehavioralDefinition(
              definitionBody(definition),
              definition.ports,
              definition.name,
            ),
          )),
    );
  let length = lines.join("\n").length;
  // The root printed as the file's own cards comes last, as in SPICE.
  const root = rootAsTopLevel
    ? ir.cells.find((cell) => cell.id === ir.topCellId)
    : undefined;
  for (const cell of [
    ...ir.cells.filter((item) => item !== root),
    ...(root ? [root] : []),
  ]) {
    const offset = length + 2;
    const cellLines = spectreCell(
      cell,
      locations
        ? (instance, relative, card) =>
            locate(cell, instance, offset + relative, card)
        : undefined,
      cell === root,
      Boolean(resolveNode),
    );
    if (!cellLines.length) continue;
    lines.push("", ...cellLines);
    length += 2 + cellLines.join("\n").length;
  }
  return { text: `${lines.join("\n")}\n`, ...spans };
}

export function printSpectreNetlist(
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
): string {
  return renderSpectre(ir, false, rootAsTopLevel).text;
}

/**
 * A design netlist file. `rootAsTopLevel` prints the root Cell as the file's
 * own cards rather than as a subcircuit, as the file it was read from held
 * them.
 */
export function printDesignNetlist(
  format: NetlistFormat,
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
): NetlistFileDescriptor {
  return format === "spice"
    ? {
        extension: ".spi",
        mediaType: "application/x-spice",
        text: printSpiceNetlist(ir, rootAsTopLevel),
      }
    : {
        extension: ".scs",
        mediaType: "application/x-spectre",
        text: printSpectreNetlist(ir, rootAsTopLevel),
      };
}

/** Record a card at its final file offset. Compiler-owned targets stay locked. */
function cardRecorder(
  ir: DesignNetlistIR,
  result: DesignNetlistLocations,
  parameters?: PrintedNetlistParameter[],
  resolveNode?: ResolvePrintedNode,
) {
  const generated = new Set((ir.generatedDefinitions ?? []).map((d) => d.name));
  const ownModels = new Map(
    ir.cells.map((cell) => [
      cell.id,
      new Set(
        (cell.models ?? []).filter((m) => !m.authoredName).map((m) => m.name),
      ),
    ]),
  );
  return (
    cell: DesignNetlistCell,
    instance: DesignNetlistInstance,
    offset: number,
    card: ReturnType<typeof printInstanceCard>,
  ) => {
    if (!card.text) return;
    const owner = { documentId: cell.id, instanceId: instance.id };
    result.instances.push({
      ...owner,
      startOffset: offset,
      endOffset: offset + card.text.length,
    });
    const byParameter = new Map<string, PrintedNetlistParameter[]>();
    for (const field of card.fields) {
      if (field.kind === "node") {
        const origin = resolveNode?.(cell, instance, field.node);
        if (origin)
          result.nodes?.push({
            ...owner,
            ...origin,
            startOffset: offset + field.startOffset,
            endOffset: offset + field.endOffset,
          });
        continue;
      }
      const span = {
        ...owner,
        ...field,
        startOffset: offset + field.startOffset,
        endOffset: offset + field.endOffset,
      };
      if (
        field.kind !== "target" ||
        !(
          generated.has(field.rawValue) ||
          ownModels.get(cell.id)!.has(field.rawValue)
        )
      )
        result.fields.push(span);
      if (parameters && field.kind === "parameter") {
        const parameter = {
          ...owner,
          parameter: field.parameter!,
          rawValue: field.rawValue,
          startOffset: span.startOffset,
          endOffset: span.endOffset,
        };
        const existing = byParameter.get(parameter.parameter);
        if (existing) existing.push(parameter);
        else byParameter.set(parameter.parameter, [parameter]);
      }
    }
    if (parameters)
      for (const p of instance.parameters)
        parameters.push(...(byParameter.get(p.name) ?? []));
  };
}

/** Both dialects emit their text and field provenance in the same pass. */
export function printDesignNetlistWithLocations(
  format: NetlistFormat,
  ir: DesignNetlistIR,
  rootAsTopLevel = false,
  resolveNode?: ResolvePrintedNode,
): { file: NetlistFileDescriptor; locations: DesignNetlistLocations } {
  const printed =
    format === "spice"
      ? renderSpice(ir, rootAsTopLevel, true, resolveNode)
      : renderSpectre(ir, true, rootAsTopLevel, resolveNode);
  return {
    file: {
      extension: format === "spice" ? ".spi" : ".scs",
      mediaType:
        format === "spice" ? "application/x-spice" : "application/x-spectre",
      text: printed.text,
    },
    locations: {
      instances: printed.instances,
      fields: printed.fields.toSorted((a, b) => a.startOffset - b.startOffset),
      ...(printed.nodes ? { nodes: printed.nodes } : {}),
    },
  };
}

/** Presentation adds/removes only a leading title; coordinates remain UTF-16
 * string offsets, matching CodeMirror and every existing source consumer. */
export function shiftDesignNetlistLocations(
  locations: DesignNetlistLocations,
  offset: number,
): DesignNetlistLocations {
  const shift = <T extends PrintedNetlistInstance>(span: T): T => ({
    ...span,
    startOffset: span.startOffset + offset,
    endOffset: span.endOffset + offset,
  });
  return {
    instances: locations.instances.map(shift),
    fields: locations.fields.map(shift),
    ...(locations.nodes ? { nodes: locations.nodes.map(shift) } : {}),
  };
}
