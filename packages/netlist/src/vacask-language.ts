import {
  inspectVacaskSource,
  type VacaskSourceToken,
} from "./vacask-source.js";

export type NativeLanguageContext = "circuit" | "control";
export interface NativeParameterHint {
  label: string;
  key?: string;
  choices?: readonly string[];
  optional?: boolean;
  repeat?: boolean;
  symbols?: "node" | "instance" | "vector";
}
export interface NativeLanguageHelp {
  name: string;
  context: NativeLanguageContext;
  signature: string;
  summary: string;
  section: string;
  group: string;
  keywords?: string;
  parameters?: readonly NativeParameterHint[];
  analysisType?: string;
  primitive?: "vsource" | "isource" | "resistor" | "capacitor" | "inductor";
}
export const VACASK_LANGUAGE_REFERENCE =
  "https://codeberg.org/arpadbuermen/VACASK/src/commit/c1a1c84f1b2b9aa71c0cddf06e555441434db7b7/docs/";
const assignment: NativeParameterHint = {
  label: "name=expression",
  repeat: true,
};
const field = (
  key: string,
  detail: string,
  extra: Partial<NativeParameterHint> = {},
): NativeParameterHint => ({ key, label: `${key}=${detail}`, ...extra });
const frequencies = [
  field("from", "start Hz"),
  field("to", "stop Hz"),
  field("mode", '"dec"|"oct"|"lin"', { choices: ['"dec"', '"oct"', '"lin"'] }),
  field("points", "intervals (lin) / points per decade or octave"),
  field("step", "Hz", { optional: true }),
  field("values", "[Hz, ...]", { optional: true }),
];
const sourceFields = [
  field("type", '"dc"|"pulse"|"sine"|"pwl"', {
    choices: ['"dc"', '"pulse"', '"sine"', '"pwl"'],
    optional: true,
  }),
  field("dc", 'value (type="dc" only)'),
  field("mag", "AC magnitude", { optional: true }),
  field("phase", "AC degrees", { optional: true }),
];
const waves: Record<string, NativeParameterHint[]> = {
  pulse: [
    field("val0", "low"),
    field("val1", "high"),
    ...["delay", "rise", "fall", "width", "period"].map((k) =>
      field(k, "seconds"),
    ),
  ],
  sine: [
    field("sinedc", "offset"),
    field("ampl", "amplitude"),
    field("freq", "Hz"),
    field("delay", "seconds", { optional: true }),
    field("theta", "damping", { optional: true }),
    field("tdphase", "degrees", { optional: true }),
  ],
  pwl: [field("wave", "[time, value, ...]")],
};
function rule(
  name: string,
  context: NativeLanguageContext,
  signature: string,
  summary: string,
  section: string,
  group: string,
  parameters: NativeParameterHint[] = [],
  keywords = "",
): NativeLanguageHelp {
  return {
    name,
    context,
    signature,
    summary,
    section,
    group,
    parameters,
    keywords,
  };
}
/** Shared authoring catalogue, not an executor allow-list. Native commands not
 * described here remain editable and pass through to the selected runtime. */
export const nativeLanguageHelp: readonly NativeLanguageHelp[] = [
  ...(
    [
      [
        "voltage source",
        "vsource",
        "Voltage source; type selects dc/pulse/sine/pwl, while mag/phase set AC. 电压 激励 脉冲 正弦",
      ],
      [
        "current source",
        "isource",
        "Current source; type selects its large-signal waveform, mag/phase its AC excitation. 电流 激励",
      ],
      ["resistor", "resistor", "Ideal resistance in ohms. 电阻 负载"],
      ["capacitor", "capacitor", "Ideal capacitance in farads. 电容"],
      ["inductor", "inductor", "Ideal inductance in henries. 电感"],
    ] as const
  ).map(([name, primitive, summary]) => ({
    ...rule(
      name,
      "circuit",
      "model name device-type; instance (nodes) name name=value",
      summary,
      "cir-instance",
      "Sources & loads",
    ),
    primitive,
  })),
  rule(
    "parameters",
    "circuit",
    "parameters name=expression ...",
    "Circuit parameters are source-owned and case-sensitive. M=mega, m=milli.",
    "input-identifiers",
    "Parameters",
    [assignment],
    "design variable 参数 变量",
  ),
  rule(
    "include",
    "circuit",
    'include "file" [section=name]',
    "Include native source or one explicit library section.",
    "input-include",
    "Files",
    [
      { label: '"relative-file"' },
      field("section", "name", { optional: true }),
    ],
  ),
  rule(
    "load",
    "circuit",
    'load "module.osdi"',
    "Load a device module available in the qualified environment.",
    "cir-loading",
    "Models",
    [{ label: '"module.osdi"' }],
  ),
  rule(
    "model",
    "circuit",
    "model name device-type name=value ...",
    "Bind a model name to a loaded device type; independent sources use vsource/isource.",
    "cir-masters",
    "Models",
    [
      { label: "name" },
      { label: "device-type" },
      { ...assignment, optional: true },
    ],
  ),
  rule(
    "subckt",
    "circuit",
    "subckt name (pin1 pin2 ...)",
    "Declare an ordered subcircuit interface; use parameters inside it.",
    "cir-subckt",
    "Hierarchy",
    [{ label: "name" }, { label: "(ordered pins)" }],
  ),
  rule(
    "ends",
    "circuit",
    "ends",
    "End the current subcircuit.",
    "cir-subckt",
    "Hierarchy",
  ),
  rule(
    "ground",
    "circuit",
    "ground node ...",
    "Declare ground nodes.",
    "cir-nodes",
    "Connectivity",
    [{ label: "node", symbols: "node", repeat: true }],
  ),
  rule(
    "global",
    "circuit",
    "global node ...",
    "Declare nodes shared across hierarchy.",
    "cir-nodes",
    "Connectivity",
    [{ label: "node", symbols: "node", repeat: true }],
  ),
  rule(
    "control",
    "circuit",
    "control",
    "Begin native execution commands.",
    "cir-overview",
    "Execution",
  ),
  rule(
    "endc",
    "control",
    "endc",
    "End native execution commands.",
    "cir-overview",
    "Execution",
  ),
  rule(
    "analysis",
    "control",
    "analysis name type name=value ...",
    "Run a named analysis; results use the analysis name, not out.raw.",
    "cmd-analysis",
    "Analysis",
    [
      { label: "name" },
      { label: "type", choices: ["op", "ac", "tran", "noise"] },
      { ...assignment, optional: true },
    ],
  ),
  ...(
    [
      ["op", "DC operating point. 工作点 偏置", []],
      [
        "ac",
        "Complex frequency response; lin points counts intervals, not samples. 频响 交流",
        frequencies,
      ],
      [
        "tran",
        "Adaptive time-domain response; step is not a uniform output grid. 瞬态 时域",
        [
          field("stop", "seconds"),
          field("step", "initial seconds"),
          field("start", "recording start seconds", { optional: true }),
          field("maxstep", "seconds", { optional: true }),
          field("icmode", '"op"|"uic"', {
            optional: true,
            choices: ['"op"', '"uic"'],
          }),
        ],
      ],
      [
        "noise",
        "Output noise PSD and power gain; specify output and input source. 噪声",
        [
          field("out", '"node" or ["p", "n"]', { symbols: "node" }),
          field("in", '"source"', { symbols: "instance" }),
          ...frequencies,
        ],
      ],
    ] as const
  ).map(([type, summary, parameters]) => ({
    ...rule(
      `analysis ${type}`,
      "control",
      `analysis name ${type} ${parameters.map((p) => p.label).join(" ")}`.trim(),
      summary,
      `cmd-analysis-${type}`,
      "Analysis",
      [...parameters],
    ),
    analysisType: type,
  })),
  rule(
    "sweep",
    "control",
    'sweep name instance="name" parameter="dc" from=... to=... step=...',
    "Place immediately before analysis (use op for a DC sweep). Other native targets: model, option or variable. 直流 扫描 DC",
    "cmd-sweep",
    "Parameters",
    [
      { label: "name" },
      field("instance", '"name"', { symbols: "instance" }),
      field("parameter", '"name"'),
      field("from", "start"),
      field("to", "stop"),
      field("step", "increment"),
      field("values", "[value, ...]", { optional: true }),
    ],
  ),
  rule(
    "save",
    "control",
    "save selector ...",
    "v/i/p acquire OP or TRAN; dv/di acquire AC. i/di require a branch unknown, not an arbitrary pin current.",
    "cmd-save",
    "Observe",
    [{ label: "selector", symbols: "vector", repeat: true }],
    "probe 电压 电流 信号 观测",
  ),
  rule(
    "options",
    "control",
    "options name=value ...",
    'Set native options, e.g. rawfile="ascii" or temperature in degrees Celsius.',
    "cmd-options-params",
    "Execution",
    [{ ...assignment, choices: ['rawfile="ascii"', "strictsave=2", "temp="] }],
  ),
  rule(
    "alter",
    "control",
    'alter instance("name") name=value ...',
    "Change instance or model parameters before the next analysis; no SPICE reset command.",
    "cmd-alter",
    "Parameters",
    [{ label: 'instance("name") or model("name")' }, assignment],
  ),
  rule(
    "var",
    "control",
    "var name=expression ...",
    "Native control variables; not a second persisted circuit parameter table.",
    "cmd-sweep",
    "Parameters",
    [assignment],
  ),
  rule(
    "clear",
    "control",
    "clear saves",
    "Clear accumulated save directives; bare clear also clears other state.",
    "cmd-save",
    "Observe",
    [{ label: "saves", choices: ["saves"] }],
  ),
  rule(
    "abort",
    "control",
    "abort always",
    "Stop this native run on an error, not the GUI or Agent session.",
    "cmd-errorhandling",
    "Execution",
    [{ label: "policy", choices: ["always"] }],
  ),
];

export function lookupNativeHelp(name: string, context: NativeLanguageContext) {
  return nativeLanguageHelp.find(
    (h) => h.name === name && h.context === context,
  );
}

/** Map a native voltage acquisition selector back to its raw node identity.
 * Quoting is syntax, case is identity; never lowercase hierarchical names. */
export function nativeVoltageSelectorNode(
  selector: string,
): string | undefined {
  const parsed = inspectVacaskSource("selector", `save ${selector}`);
  const t = parsed.statements[0]?.tokens;
  return !parsed.diagnostics.length &&
    parsed.statements.length === 1 &&
    t?.length === 5 &&
    ["v", "dv"].includes(t[1]!.value) &&
    t[2]!.value === "(" &&
    t[3]!.kind === "word" &&
    t[4]!.value === ")"
    ? t[3]!.value
    : undefined;
}

/** Small proven authoring errors only; never a whitelist for native programs. */
export function inspectNativeLanguage(
  path: string,
  text: string,
  entry = false,
) {
  const parsed = inspectVacaskSource(path, text, entry);
  let control = false;
  for (const s of parsed.statements) {
    if (s.rawText === "control") control = true;
    else if (s.rawText === "endc") control = false;
    else if (
      control &&
      s.tokens[0]?.value === "analysis" &&
      s.rawText.startsWith("analysis")
    ) {
      if (nativeArgumentFields(text, s.tokens).length < 3)
        parsed.diagnostics.push({
          code: "VACASK_COMMAND_ARGUMENTS",
          severity: "error",
          message:
            "An analysis needs both a name and a type: analysis name type [name=value ...].",
          sourceRef: s.sourceRef,
        });
    }
  }
  return parsed;
}
export function nativeControlContext(text: string, entry = true): boolean {
  let control = false;
  for (const s of inspectVacaskSource("context", text, entry).statements) {
    if (s.tokens.length !== 1) continue;
    if (s.rawText === "control") control = true;
    if (s.rawText === "endc") control = false;
  }
  return control;
}

/** Balanced native fields; whitespace surrounding '=' does not split an
 * assignment, and quoted nodes, vectors and expressions keep exact spelling. */
export function nativeArgumentFields(
  text: string,
  tokens: readonly VacaskSourceToken[],
) {
  const fields: { from: number; to: number; value: string }[] = [];
  let depth = 0;
  for (const [i, token] of tokens.entries()) {
    const previous = tokens[i - 1];
    const split =
      !previous ||
      (!depth &&
        token.start > previous.end &&
        token.value !== "=" &&
        previous.value !== "=");
    if (split) fields.push({ from: token.start, to: token.end, value: "" });
    else fields.at(-1)!.to = token.end;
    if (token.kind === "symbol") {
      if (["(", "[", "{"].includes(token.value)) depth++;
      if ([")", "]", "}"].includes(token.value)) depth--;
    }
  }
  return fields.map((f) => ({ ...f, value: text.slice(f.from, f.to) }));
}

export function nativeSourceHints(
  module: string | undefined,
  type: string | undefined,
): readonly NativeParameterHint[] {
  if (module === "resistor") return [field("r", "ohms")];
  if (module === "capacitor") return [field("c", "farads")];
  if (module === "inductor") return [field("l", "henries")];
  if (module !== "vsource" && module !== "isource")
    return [{ ...assignment, optional: true }];
  return [...sourceFields, ...(waves[type ?? "dc"] ?? [])];
}

/** Conservative root-only suggestions, not circuit connectivity or elaboration.
 * Conditional/local definitions are not advertised as available root symbols. */
export function nativeLanguageSymbols(
  sources: readonly { text: string; entry: boolean }[],
) {
  const nodes = new Set<string>();
  const models = new Map<string, string | undefined>();
  const instances = new Map<string, string | undefined>();
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.text)) continue;
    seen.add(source.text);
    let local = 0,
      conditional = 0;
    for (const statement of inspectVacaskSource(
      "symbols",
      source.text,
      source.entry,
    ).statements) {
      const t = statement.tokens,
        head = t[0]?.value;
      if (head === "subckt") {
        local++;
        continue;
      }
      if (head === "ends") {
        local--;
        continue;
      }
      if (head === "@if") {
        conditional++;
        continue;
      }
      if (head === "@end") {
        conditional--;
        continue;
      }
      if (local || conditional) continue;
      if (head === "model" && t[1] && t[2]) {
        const name = t[1].value;
        models.set(name, models.has(name) ? undefined : t[2].value);
      }
      if (t[1]?.value !== "(") continue;
      const close = t.findIndex((token, i) => i > 1 && token.value === ")");
      if (close < 0 || !head || !t[close + 1]) continue;
      for (const node of t.slice(2, close))
        if (node.kind === "word") nodes.add(node.value);
      instances.set(
        head,
        instances.has(head) ? undefined : t[close + 1]!.value,
      );
    }
  }
  return { nodes, instances, models };
}

/** Deterministic skeleton. Only the new analysis identity is supplied; no
 * bias, frequency, temperature or timestep is silently selected. */
export function nativeHelpInsertion(
  help: NativeLanguageHelp,
  text: string,
  entry = true,
) {
  if (help.primitive) {
    const tokens = inspectVacaskSource("names", text, entry).statements.flatMap(
      (s) => s.tokens.map((t) => t.value),
    );
    const unique = (base: string) => {
      let n = 1;
      while (tokens.includes(`${base}${n}`)) n++;
      return `${base}${n}`;
    };
    const [prefix, key] = (
      {
        vsource: ["V", "dc"],
        isource: ["I", "dc"],
        resistor: ["R", "r"],
        capacitor: ["C", "c"],
        inductor: ["L", "l"],
      } as const
    )[help.primitive];
    const master = unique(`__${help.primitive}`);
    const load = ["vsource", "isource"].includes(help.primitive)
      ? ""
      : `load "${help.primitive}.osdi"\n`;
    return `${load}model ${master} ${help.primitive}\n${unique(prefix)} () ${master} ${key}=`;
  }
  if (!help.analysisType)
    return help.name + (help.parameters?.length ? " " : "");
  const names = new Set(
    inspectVacaskSource("names", text, entry)
      .statements.filter((s) => s.tokens[0]?.value === "analysis")
      .map((s) => s.tokens[1]?.value),
  );
  let n = 1;
  while (names.has(`${help.analysisType}${n}`)) n++;
  return `analysis ${help.analysisType}${n} ${help.analysisType}${help.parameters?.length ? " " : ""}`;
}
