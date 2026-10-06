import type { DesignNetlistInstance, DesignNetlistParameter } from "./ir.js";
import type { PrintedNetlistField } from "./printed-netlist.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { normalizeIndependentSource } from "./source-waveform.js";
import { signedControlGain } from "./controlled-current.js";
import { printedParameterConversion } from "./parameter-projection.js";

type Field = Omit<PrintedNetlistField, "documentId" | "instanceId">;
interface Text {
  text: string;
  fields: Field[];
}
const plain = (text: string): Text => ({ text, fields: [] });
function join(parts: Text[], separator = ""): Text {
  const fields: Field[] = [];
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    if (index) offset += separator.length;
    for (const field of part.fields)
      fields.push({
        ...field,
        startOffset: field.startOffset + offset,
        endOffset: field.endOffset + offset,
      });
    offset += part.text.length;
  }
  return { text: parts.map((part) => part.text).join(separator), fields };
}

/** Single card emission: field provenance travels with the existing tokens,
 * through assignments, compound waveform tokens and SPICE line wrapping.
 * It is never inferred from equal-looking node/model/parameter strings. */
export function printInstanceCard(
  instance: DesignNetlistInstance,
  format: NetlistFormat,
  locations = false,
): { text: string; lines: string[]; fields: Field[] } {
  // Primitive scalar lookup has always used the first authored match; source
  // normalization uses the last. Assignment tokens retain their own value.
  const parameters = new Map<string, DesignNetlistParameter>();
  for (const p of instance.parameters)
    if (!parameters.has(p.name.toLowerCase()))
      parameters.set(p.name.toLowerCase(), p);
  const owned = (
    text: string,
    kind: Field["kind"],
    parameter?: string,
  ): Text => {
    const conversion = parameter
      ? printedParameterConversion(instance, parameter)
      : "identity";
    return {
      text,
      fields:
        locations && text.length
          ? [
              {
                kind,
                rawValue: text,
                ...(parameter ? { parameter } : {}),
                ...(conversion !== "identity" ? { conversion } : {}),
                startOffset: 0,
                endOffset: text.length,
              },
            ]
          : [],
    };
  };
  const parameterValue = (
    p: DesignNetlistParameter | undefined,
    rendered?: string,
  ): Text => {
    const text =
      rendered ?? p?.rawValue ?? (format === "spectre" ? "undefined" : "");
    return p && text === p.rawValue
      ? owned(text, "parameter", p.name)
      : plain(text);
  };
  const value = (name: string, rendered?: string): Text =>
    parameterValue(parameters.get(name.toLowerCase()), rendered);
  const assignment = (
    printedName: string,
    name = printedName,
    rendered?: string,
  ) => join([plain(`${printedName}=`), value(name, rendered)]);
  const assignments = (
    excluded: string[] = [],
    items: readonly DesignNetlistParameter[] = instance.parameters,
  ) => {
    const skip = new Set(excluded.map((name) => name.toLowerCase()));
    return items
      .filter((p) => !skip.has(p.name.toLowerCase()))
      .map((p) => join([plain(`${p.name}=`), parameterValue(p)]));
  };
  const sourceValues = () => {
    const source = normalizeIndependentSource(instance.parameters);
    const sourceParameters = new Map(
      instance.parameters.map((p) => [p.name.toLowerCase(), p]),
    );
    const value = (name: string, rendered?: string): Text =>
      parameterValue(sourceParameters.get(name.toLowerCase()), rendered);
    const assignment = (printedName: string, name: string, rendered?: string) =>
      join([plain(`${printedName}=`), value(name, rendered)]);
    const t = source.transient;
    const dc =
      source.dc === undefined
        ? []
        : format === "spice"
          ? [plain("DC"), value("dc", source.dc)]
          : [assignment("dc", "dc", source.dc)];
    const ac = source.ac
      ? format === "spice"
        ? [
            plain("AC"),
            value("acMagnitude", source.ac.magnitude),
            value("acPhase", source.ac.phase),
          ]
        : [
            assignment("mag", "acMagnitude", source.ac.magnitude),
            assignment("phase", "acPhase", source.ac.phase),
          ]
      : [];
    const extra = assignments([], source.extraParameters);
    if (format === "spice") {
      let transient: Text[] = [];
      if (t.kind === "pulse")
        transient = [
          join([
            plain("PULSE("),
            join(
              [
                value("low", t.low),
                value("high", t.high),
                value("delay", t.delay),
                value("rise", t.rise),
                value("fall", t.fall),
                value("width", t.width),
                value("period", t.period),
              ],
              " ",
            ),
            plain(")"),
          ]),
        ];
      if (t.kind === "sin")
        transient = [
          join([
            plain("SIN("),
            join(
              [
                value("offset", t.offset),
                value("amplitude", t.amplitude),
                value("frequency", t.frequency),
                value("delay", t.delay),
                value("damping", t.damping),
                value("phase", t.phase),
              ],
              " ",
            ),
            plain(")"),
          ]),
        ];
      // The comma-separated authored point list is transformed, not an exact
      // editable scalar span. Circuit's source-body editor still owns it.
      if (t.kind === "pwl")
        transient = [
          plain(`PWL(${t.points.flatMap((p) => [p.time, p.value]).join(" ")})`),
        ];
      return [...dc, ...ac, ...transient, ...extra];
    }
    if (t.kind === "pulse")
      return [
        plain("type=pulse"),
        assignment("val0", "low", t.low),
        assignment("val1", "high", t.high),
        assignment("delay", "delay", t.delay),
        assignment("rise", "rise", t.rise),
        assignment("fall", "fall", t.fall),
        assignment("width", "width", t.width),
        assignment("period", "period", t.period),
        ...dc,
        ...ac,
        ...extra,
      ];
    if (t.kind === "sin")
      return [
        plain("type=sine"),
        assignment("dc", "offset", t.offset),
        assignment("ampl", "amplitude", t.amplitude),
        assignment("freq", "frequency", t.frequency),
        assignment("delay", "delay", t.delay),
        assignment("damp", "damping", t.damping),
        assignment("sinephase", "phase", t.phase),
        ...ac,
        ...extra,
      ];
    if (t.kind === "pwl")
      return [
        plain("type=pwl"),
        plain(`wave=[${t.points.flatMap((p) => [p.time, p.value]).join(" ")}]`),
        ...dc,
        ...ac,
        ...extra,
      ];
    return [...dc, ...ac, ...extra];
  };
  const gain = (name: string) => {
    const raw = parameters.get(name.toLowerCase())!.rawValue;
    const rendered = signedControlGain(
      raw,
      instance.controlCurrentSign,
      format,
    );
    if (rendered === raw) return value(name);
    // Preserve the existing writable subset: stripping authored braces/quotes
    // or whitespace is a transformed expression, not a reversible scalar span.
    if (
      raw !== raw.trim() ||
      (raw.startsWith("{") && raw.endsWith("}")) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    )
      return plain(rendered);
    return join([
      plain(format === "spice" ? "{ -(" : "(-("),
      value(name),
      plain(format === "spice" ? ") }" : "))"),
    ]);
  };
  const reference = owned(instance.reference, "reference");
  const nodes = instance.nodes.map((n) => plain(n.netName));
  let master: Text | undefined;
  let values: Text[];
  switch (instance.deviceClass) {
    case "resistor":
    case "capacitor":
    case "inductor": {
      const letter =
        instance.deviceClass === "resistor"
          ? "r"
          : instance.deviceClass === "capacitor"
            ? "c"
            : "l";
      master = plain(instance.deviceClass);
      values = [
        format === "spice" ? value("value") : assignment(letter, "value"),
        ...assignments(["value"]),
      ];
      break;
    }
    case "voltage-source":
    case "current-source":
      master = plain(
        instance.deviceClass === "voltage-source" ? "vsource" : "isource",
      );
      values = sourceValues();
      break;
    case "vcvs":
    case "vccs": {
      const name = instance.deviceClass === "vccs" ? "gm" : "gain";
      master = plain(instance.deviceClass);
      values = [format === "spice" ? value(name) : assignment(name)];
      break;
    }
    case "cccs":
    case "ccvs": {
      master = plain(instance.deviceClass);
      const g = gain(instance.deviceClass === "ccvs" ? "rm" : "gain");
      values =
        format === "spice"
          ? [plain(instance.controlSourceReference!), g]
          : [
              join([plain("gain="), g]),
              plain(`probe=${instance.controlSourceReference!}`),
            ];
      break;
    }
    case "mos":
    case "diode":
    case "bjt":
    case "switch":
    case "hierarchical":
      master = owned(instance.target!, "target");
      values = assignments();
      break;
    case "net-marker":
      return { text: "", lines: [], fields: [] };
  }
  const tokens =
    format === "spectre"
      ? [
          reference,
          plain(`(${instance.nodes.map((n) => n.netName).join(" ")})`),
          master!,
          ...values,
        ]
      : [
          reference,
          ...nodes,
          ...(master?.fields.some((f) => f.kind === "target") ||
          ["mos", "diode", "bjt", "switch", "hierarchical"].includes(
            instance.deviceClass,
          )
            ? [master!]
            : []),
          ...values,
        ];
  const lines: Text[] = [];
  if (format === "spectre") lines.push(join(tokens, " "));
  else {
    let line: Text[] = [];
    let length = 0;
    for (const token of tokens) {
      const separator = line.length ? 1 : 0;
      if (line.length && length + separator + token.text.length > 100) {
        lines.push(join(line, " "));
        line = [plain("+"), token];
        length = token.text.length + 2;
      } else {
        line.push(token);
        length += separator + token.text.length;
      }
    }
    if (line.length) lines.push(join(line, " "));
  }
  const card = join(lines, "\n");
  return { ...card, lines: lines.map((line) => line.text) };
}
