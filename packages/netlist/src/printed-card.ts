import type { DesignNetlistInstance, DesignNetlistParameter } from "./ir.js";
import type { PrintedNetlistField } from "./printed-netlist.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { parseNgspiceSourceParameters } from "./simulation-ngspice-source-parameters.js";
import {
  normalizeIndependentSource,
  type IndependentSourceWaveform,
} from "./source-waveform.js";
import { signedControlGain } from "./controlled-current.js";
import {
  printedParameterConversion,
  spectreNumber,
} from "./parameter-projection.js";

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

/**
 * The fields of an independent source whose dc text carries the rest of its
 * SPICE value (AC, PULSE, SIN or PWL), as the SPICE import keeps it; null for
 * a source authored in fields or a text this reading does not cover.
 */
function sourceFieldsFromText(
  parameters: readonly DesignNetlistParameter[],
): DesignNetlistParameter[] | null {
  // Extraction names a source with no waveform of its own dc.
  if (
    parameters.some(
      (p) =>
        p.name.toLowerCase() === "waveform" &&
        p.rawValue.trim().toLowerCase() !== "dc",
    )
  )
    return null;
  const dc = parameters.find((p) => p.name.toLowerCase() === "dc");
  if (!dc || !/\b(?:AC|PULSE|SIN|PWL)\b/iu.test(dc.rawValue)) return null;
  const text = dc.rawValue.trim();
  const parsed = parseNgspiceSourceParameters(
    /^(?:PULSE|SIN|PWL)\s*\(/iu.test(text) ? text : `DC ${text}`,
    { requireDc: false },
  );
  if (!parsed.ok) return null;
  return [
    ...Object.entries(parsed.parameters).map(([name, rawValue]) => ({
      name,
      rawValue,
    })),
    ...parameters.filter(
      (p) => !["dc", "waveform"].includes(p.name.toLowerCase()),
    ),
  ];
}

/**
 * The name a Spectre card prints each field of an independent source under,
 * by the waveform it is set to: the waveform's own fields and its dc, where
 * a sine's offset takes that name. A PWL's points print as one `wave`, which
 * no field owns. AC's fields print under every waveform.
 */
const SPECTRE_SOURCE_NAMES = {
  dc: { dc: "dc" },
  pulse: {
    low: "val0",
    high: "val1",
    delay: "delay",
    rise: "rise",
    fall: "fall",
    width: "width",
    period: "period",
    dc: "dc",
  },
  sin: {
    offset: "dc",
    amplitude: "ampl",
    frequency: "freq",
    delay: "delay",
    damping: "damp",
    phase: "sinephase",
  },
  pwl: { dc: "dc" },
} as const satisfies Record<
  IndependentSourceWaveform,
  Readonly<Record<string, string>>
>;
const SPECTRE_AC_NAMES = { acMagnitude: "mag", acPhase: "phase" } as const;

/** Each waveform's printed names by field, folded to lower case, AC's among them. */
const printedNames = (waveform: IndependentSourceWaveform) =>
  new Map(
    Object.entries({
      ...SPECTRE_SOURCE_NAMES[waveform],
      ...SPECTRE_AC_NAMES,
    }).map(([field, printed]) => [field.toLowerCase(), printed]),
  );
const WAVEFORMS = Object.keys(
  SPECTRE_SOURCE_NAMES,
) as IndependentSourceWaveform[];

/**
 * The name a Spectre card prints an independent source's field under, the
 * source set to `waveform`; null for a field of another waveform, which the
 * card does not print; undefined for a parameter that is no waveform's field
 * (an extra assignment, which prints under its own name).
 */
export function spectreSourceFieldName(
  field: string,
  waveform: IndependentSourceWaveform,
): string | null | undefined {
  const folded = field.toLowerCase();
  const printed = printedNames(waveform).get(folded);
  if (printed !== undefined) return printed;
  return WAVEFORMS.some((other) => printedNames(other).has(folded))
    ? null
    : undefined;
}

/**
 * The field of an independent source a Spectre card's name stands for, the
 * source set to `waveform` (as the editor keeps it, any case): its own
 * waveform's first, then another's, `mag` and `phase` AC's under every
 * waveform; undefined for a name no field prints under.
 */
export function spectreSourceField(
  printed: string,
  waveform: string | undefined,
): string | undefined {
  const folded = printed.toLowerCase();
  const own = WAVEFORMS.find((item) => item === waveform);
  for (const candidate of own ? [own, ...WAVEFORMS] : WAVEFORMS)
    for (const [field, name] of Object.entries({
      ...SPECTRE_SOURCE_NAMES[candidate],
      ...SPECTRE_AC_NAMES,
    }))
      if (name === folded) return field;
  return undefined;
}

/**
 * Whether a Spectre card prints an independent source from the SPICE text
 * its dc keeps (AC, PULSE, SIN or PWL after its value), as plain text that
 * no authored parameter owns.
 */
export function spectreSourceFromText(
  parameters: readonly DesignNetlistParameter[],
): boolean {
  return sourceFieldsFromText(parameters) !== null;
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
    converted?: "spectre-number",
  ): Text => {
    const conversion =
      converted ??
      (parameter
        ? printedParameterConversion(instance, parameter)
        : "identity");
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
    if (format === "spectre") {
      // Spectre reads its own numbers: 100fF is written 100f. Every value
      // the author owns reads back as Spectre means it, so an M typed here
      // is mega whether or not the value was respelled.
      const number = spectreNumber(text);
      if (
        p &&
        text === p.rawValue &&
        printedParameterConversion(instance, p.name) === "identity"
      )
        return owned(number, "parameter", p.name, "spectre-number");
      if (number !== text && !(p && text === p.rawValue)) return plain(number);
    }
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
    // A source the SPICE import kept as written has its AC and waveform in
    // its dc text (`0.9 AC 1 0 PULSE(...)`). Spectre has no such tail, so it
    // is read into fields as the VACASK projection reads it, and printed as
    // plain text: no authored parameter owns those fields.
    const read =
      format === "spectre" ? sourceFieldsFromText(instance.parameters) : null;
    const sourceList = read ?? instance.parameters;
    const source = normalizeIndependentSource(sourceList);
    const sourceParameters = new Map(
      sourceList.map((p) => [p.name.toLowerCase(), p]),
    );
    const value = (name: string, rendered?: string): Text => {
      const p = sourceParameters.get(name.toLowerCase());
      return read
        ? plain(spectreNumber(rendered ?? p?.rawValue ?? "undefined"))
        : parameterValue(p, rendered);
    };
    const assignment = (printedName: string, name: string, rendered?: string) =>
      join([plain(`${printedName}=`), value(name, rendered)]);
    const t = source.transient;
    const dc =
      source.dc === undefined
        ? []
        : format === "spice"
          ? [plain("DC"), value("dc", source.dc)]
          : [assignment(SPECTRE_SOURCE_NAMES.dc.dc, "dc", source.dc)];
    const ac = source.ac
      ? format === "spice"
        ? [
            plain("AC"),
            value("acMagnitude", source.ac.magnitude),
            value("acPhase", source.ac.phase),
          ]
        : [
            assignment(
              SPECTRE_AC_NAMES.acMagnitude,
              "acMagnitude",
              source.ac.magnitude,
            ),
            assignment(SPECTRE_AC_NAMES.acPhase, "acPhase", source.ac.phase),
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
        assignment(SPECTRE_SOURCE_NAMES.pulse.low, "low", t.low),
        assignment(SPECTRE_SOURCE_NAMES.pulse.high, "high", t.high),
        assignment(SPECTRE_SOURCE_NAMES.pulse.delay, "delay", t.delay),
        assignment(SPECTRE_SOURCE_NAMES.pulse.rise, "rise", t.rise),
        assignment(SPECTRE_SOURCE_NAMES.pulse.fall, "fall", t.fall),
        assignment(SPECTRE_SOURCE_NAMES.pulse.width, "width", t.width),
        assignment(SPECTRE_SOURCE_NAMES.pulse.period, "period", t.period),
        ...dc,
        ...ac,
        ...extra,
      ];
    if (t.kind === "sin")
      return [
        plain("type=sine"),
        assignment(SPECTRE_SOURCE_NAMES.sin.offset, "offset", t.offset),
        assignment(
          SPECTRE_SOURCE_NAMES.sin.amplitude,
          "amplitude",
          t.amplitude,
        ),
        assignment(
          SPECTRE_SOURCE_NAMES.sin.frequency,
          "frequency",
          t.frequency,
        ),
        assignment(SPECTRE_SOURCE_NAMES.sin.delay, "delay", t.delay),
        assignment(SPECTRE_SOURCE_NAMES.sin.damping, "damping", t.damping),
        assignment(SPECTRE_SOURCE_NAMES.sin.phase, "phase", t.phase),
        ...ac,
        ...extra,
      ];
    if (t.kind === "pwl")
      return [
        plain("type=pwl"),
        plain(
          `wave=[${t.points.flatMap((p) => [spectreNumber(p.time), spectreNumber(p.value)]).join(" ")}]`,
        ),
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
    case "jfet":
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
          ["mos", "diode", "bjt", "jfet", "switch", "hierarchical"].includes(
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
