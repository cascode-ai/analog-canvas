import { isSimulationInputPath, type SourceSpan } from "@icm/model";
import { diagnostic, type SpiceDiagnostic } from "./diagnostics.js";
import { parseSpiceSource, splitSpiceFields } from "./syntax.js";
import type { SpiceSourceFile } from "./source-types.js";

export type SimulationLanguageContext =
  "deck" | "control" | "parameter" | "behavioral";
export interface SimulationLanguageHelp {
  name: string;
  context: SimulationLanguageContext;
  signature: string;
  summary: string;
  section: string;
  minimumArguments?: number;
  group?: string;
  keywords?: string;
  priority?: number;
  parameters?: readonly {
    label: string;
    choices?: readonly string[];
    optional?: boolean;
  }[];
}
export const NGSPICE_LANGUAGE_REFERENCE =
  "https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf";

const analyses: SimulationLanguageHelp[] = [
  {
    name: "op",
    context: "control",
    signature: "op",
    summary: "Compute the DC operating point.",
    section: "11.3",
    minimumArguments: 0,
  },
  {
    name: "ac",
    context: "control",
    signature: "ac dec|oct|lin points startHz stopHz",
    summary: "Small-signal frequency sweep; dec/oct points are per interval.",
    section: "11.3",
    minimumArguments: 4,
  },
  {
    name: "dc",
    context: "control",
    signature: "dc source start stop step [source2 start2 stop2 step2]",
    summary:
      "Sweep an independent source; step sign follows the sweep direction.",
    section: "11.3",
    minimumArguments: 4,
  },
  {
    name: "tran",
    context: "control",
    signature: "tran tstep tstop [tstart [tmax]] [uic]",
    summary:
      "Transient analysis, times in seconds. tstep does not guarantee uniform saved samples.",
    section: "11.3",
    minimumArguments: 2,
  },
  {
    name: "noise",
    context: "control",
    signature:
      "noise v(out[,ref]) inputSource dec|oct|lin points startHz stopHz [summary]",
    summary:
      "Small-signal device-model noise about the operating point; save density and integrated plots.",
    section: "11.3",
    minimumArguments: 6,
  },
];

/** Shared UI/MCP assistance, not an executor allow-list or universal grammar. */
const languageHelp: readonly SimulationLanguageHelp[] = [
  ...analyses,
  ...analyses.map((rule) => ({
    ...rule,
    name: `.${rule.name}`,
    signature: `.${rule.signature}`,
    context: "deck" as const,
  })),
  ...[
    [
      ".include",
      '.include "relative-file.spice"',
      "Include a virtual source file.",
      "2.8",
    ],
    [
      ".lib",
      '.lib "models.spice" section',
      "Select a library section; distinct from plain include.",
      "2.10",
    ],
    [
      ".subckt",
      ".subckt name pin1 pin2 ... [params: name=value]",
      "Ordered Cell interface and local parameters.",
      "2.6",
    ],
    [".ends", ".ends [name]", "End a subcircuit definition.", "2.6"],
    [
      ".param",
      ".param name=expression ...",
      "Circuit parameter context, not control let syntax.",
      "2.11",
    ],
    [
      ".func",
      ".func name(args) {expression}",
      "Define a parameter expression function.",
      "2.12",
    ],
    [
      ".temp",
      ".temp temperatureC",
      "Nominal circuit temperature in degrees Celsius.",
      "11.2",
    ],
    [
      ".save",
      ".save vector ...",
      "Select native vectors to retain during analysis.",
      "11.6",
    ],
    [".control", ".control", "Begin native ngspice commands.", "13.4"],
    [".endc", ".endc", "End native control commands.", "13.4"],
    [
      ".meas",
      ".meas analysis name ...",
      "Native measurement; not the saved-output evaluator.",
      "11.4",
    ],
    [
      "R",
      "Rname n+ n- value",
      "Ideal resistance in ohms; model-backed forms have separate signatures.",
      "3.1",
    ],
    ["C", "Cname n+ n- value", "Ideal capacitance in farads.", "3.2"],
    ["L", "Lname n+ n- value", "Ideal inductance in henries.", "3.3"],
    [
      "V",
      "Vname n+ n- [DC value] [AC magnitude phase] [waveform]",
      "Independent voltage source. AC and transient excitation may coexist.",
      "4.1",
    ],
    [
      "I",
      "Iname n+ n- [DC value] [AC magnitude phase] [waveform]",
      "Independent current source, positive from n+ to n-.",
      "4.1",
    ],
    [
      "PULSE",
      "PULSE(low high delay rise fall width period)",
      "Pulse waveform for a voltage or current source.",
      "4.1",
    ],
    [
      "SIN",
      "SIN(offset amplitude frequency [delay damping phase])",
      "Sinusoidal transient stimulus.",
      "4.1",
    ],
    [
      "PWL",
      "PWL(time value ...)",
      "Piecewise-linear transient stimulus; time in seconds.",
      "4.1",
    ],
  ].map(([name, signature, summary, section]) => ({
    name: name!,
    signature: signature!,
    summary: summary!,
    section: section!,
    context: "deck" as const,
  })),
  ...[
    ["save", "save vector ...", "Select vectors for subsequent analyses."],
    [
      "write",
      "write file [vector ...]",
      "Write the current plot; appendwrite retains earlier plots.",
    ],
    [
      "set",
      "set variable[=value]",
      "Set a control/environment variable, such as filetype=ascii.",
    ],
    [
      "let",
      "let vector = expression",
      "Control-vector expression, distinct from .param.",
    ],
    [
      "alter",
      "alter device parameter = value",
      "Change a device parameter for subsequent analysis.",
    ],
    [
      "alterparam",
      "alterparam name=value",
      "Change a circuit parameter; reset is required for re-evaluation.",
    ],
    [
      "reset",
      "reset",
      "Reload the current circuit and re-evaluate circuit parameters.",
    ],
    [
      "foreach",
      "foreach variable value ...",
      "Native loop; all iterations belong to one Run.",
    ],
    ["repeat", "repeat [count]", "Repeat a native command block."],
    ["while", "while condition", "Loop while a control expression is true."],
    ["if", "if condition", "Conditionally evaluate commands."],
    ["else", "else", "Alternative branch of a native if."],
    ["end", "end", "Close a native control block."],
    [
      "meas",
      "meas analysis name ...",
      "Native measurements; preserve raw evidence.",
    ],
    [
      "setplot",
      "setplot [plotname]",
      "Choose an existing plot before reading or writing vectors.",
    ],
    ["run", "run", "Execute the analyses declared by the loaded deck."],
  ].map(([name, signature, summary]) => ({
    name: name!,
    signature: signature!,
    summary: summary!,
    section: "13.5",
    context: "control" as const,
  })),
];

// One catalogue feeds the editor, hover and Agent help. These are authoring hints,
// never an execution allow-list or values silently inserted into the document.
const parameterHints: Record<
  string,
  NonNullable<SimulationLanguageHelp["parameters"]>
> = {
  ac: [
    { label: "sweep", choices: ["dec", "oct", "lin"] },
    { label: "points" },
    { label: "startHz" },
    { label: "stopHz" },
  ],
  dc: [
    { label: "source" },
    { label: "start" },
    { label: "stop" },
    { label: "step" },
  ],
  tran: [
    { label: "tstep / s" },
    { label: "tstop / s" },
    { label: "tstart / s", optional: true },
    { label: "tmax / s", optional: true },
  ],
  noise: [
    { label: "v(out[,ref])" },
    { label: "inputSource" },
    { label: "sweep", choices: ["dec", "oct", "lin"] },
    { label: "points" },
    { label: "startHz" },
    { label: "stopHz" },
  ],
  save: [{ label: "vector" }],
  write: [{ label: "file" }, { label: "vector", optional: true }],
  param: [{ label: "name=expression" }],
  temp: [{ label: "temperature / °C" }],
  include: [{ label: '"relative-file.spice"' }],
  lib: [{ label: '"models.spice"' }, { label: "section" }],
  R: [{ label: "n+" }, { label: "n-" }, { label: "resistance / Ω" }],
  C: [{ label: "n+" }, { label: "n-" }, { label: "capacitance / F" }],
  L: [{ label: "n+" }, { label: "n-" }, { label: "inductance / H" }],
  V: [
    { label: "n+" },
    { label: "n-" },
    { label: "excitation", choices: ["DC", "AC", "PULSE", "SIN", "PWL"] },
    { label: "value" },
  ],
  I: [
    { label: "n+" },
    { label: "n-" },
    { label: "excitation", choices: ["DC", "AC", "PULSE", "SIN", "PWL"] },
    { label: "value" },
  ],
  PULSE: [
    { label: "low" },
    { label: "high" },
    { label: "delay / s" },
    { label: "rise / s" },
    { label: "fall / s" },
    { label: "width / s" },
    { label: "period / s" },
  ],
  SIN: [
    { label: "offset" },
    { label: "amplitude" },
    { label: "frequency / Hz" },
    { label: "delay / s", optional: true },
    { label: "damping", optional: true },
    { label: "phase / deg", optional: true },
  ],
  PWL: [{ label: "time / s" }, { label: "value" }],
};
const taskHints: Record<string, [string, string, number]> = {
  save: [
    "Observe",
    "probe voltage current signal 观测 电压 电流 信号 看输出",
    5,
  ],
  op: ["Analysis", "operating point bias 工作点 偏置", 10],
  dc: ["Analysis", "直流 扫描 sweep", 11],
  ac: ["Analysis", "交流 频响 频率 frequency response", 12],
  tran: ["Analysis", "瞬态 时域 transient 时间", 13],
  noise: ["Analysis", "噪声 noise", 14],
  V: ["Sources & loads", "电压 激励 voltage source", 20],
  I: ["Sources & loads", "电流 激励 current source", 21],
  PULSE: ["Sources & loads", "脉冲 pulse", 22],
  SIN: ["Sources & loads", "正弦 sine", 23],
  R: ["Sources & loads", "电阻 resistor load", 24],
  C: ["Sources & loads", "电容 capacitor load", 25],
  L: ["Sources & loads", "电感 inductor", 26],
  param: ["Parameters & sweeps", "参数 variable", 30],
  temp: ["Parameters & sweeps", "温度 temperature", 31],
  foreach: ["Parameters & sweeps", "循环 扫描 loop sweep", 32],
  write: ["Results", "保存 导出 采集 export capture", 40],
  meas: ["Results", "测量 measurement", 41],
};
export const simulationLanguageHelp: readonly SimulationLanguageHelp[] =
  languageHelp.map((rule) => {
    const name = rule.name.replace(/^\./u, "");
    const task = taskHints[name];
    return {
      ...rule,
      group: task?.[0] ?? "More syntax",
      keywords: task?.[1] ?? "",
      priority: task?.[2] ?? 90,
      ...(parameterHints[name] ? { parameters: parameterHints[name] } : {}),
    };
  });

export function lookupSimulationHelp(
  name: string,
  context: SimulationLanguageContext,
): SimulationLanguageHelp | undefined {
  return simulationLanguageHelp.find(
    (entry) =>
      entry.context === context &&
      entry.name.toLowerCase() === name.toLowerCase(),
  );
}

/** Only proven local errors block; opaque input is retained for the simulator. */
export function inspectSimulationSource(file: SpiceSourceFile, entry = false) {
  const syntax = parseSpiceSource(file, { titleLine: entry });
  const diagnostics: SpiceDiagnostic[] = syntax.diagnostics.map((item) =>
    item.code === "SPICE_SYNTAX_UNMATCHED_ENDC" ||
    item.code === "SPICE_SYNTAX_UNTERMINATED_CONTROL"
      ? item
      : { ...item, severity: "warning" as const },
  );
  const commands: Array<{
    name: string;
    arguments: string[];
    sourceRef: SourceSpan;
  }> = [];
  for (const statement of syntax.statements) {
    if (statement.kind !== "control_command" && statement.kind !== "directive")
      continue;
    const context = statement.kind === "control_command" ? "control" : "deck";
    const name =
      statement.kind === "control_command"
        ? statement.command
        : `.${statement.name}`;
    commands.push({
      name: name.toLowerCase(),
      arguments: statement.arguments,
      sourceRef: statement.sourceRef,
    });
    const rule = lookupSimulationHelp(name, context);
    if (
      rule?.minimumArguments !== undefined &&
      statement.arguments.length < rule.minimumArguments &&
      !/[$`]/u.test(statement.rawText)
    )
      diagnostics.push(
        diagnostic(
          "SIMULATION_COMMAND_ARGUMENTS",
          "error",
          "syntax",
          `Expected ${rule.signature}`,
          statement.sourceRef,
        ),
      );
  }
  return { ...syntax, diagnostics, commands };
}

/** Virtual-root normalization; source resolution performs no filesystem/network IO. */
export function resolveSimulationInclude(
  sourcePath: string,
  requested: string,
): string | null {
  const path = unquoteSimulationToken(requested);
  if (
    !path ||
    /^[/\\]|^[a-z]:|:\/\//iu.test(path) ||
    /[\\\u0000-\u001f]/u.test(path)
  )
    return null;
  const parts = sourcePath.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  const result = parts.join("/");
  return isSimulationInputPath(result) ? result : null;
}

export function unquoteSimulationToken(value: string): string {
  return /^(["'])[\s\S]*\1$/u.test(value) ? value.slice(1, -1) : value;
}

/** Small helper templates remain ordinary source, not a new simulation DSL. */
export function simulationAnalysisTemplate(
  kind: "op" | "dc" | "ac" | "tran" | "noise",
): string {
  const defaults = {
    op: "op",
    dc: "dc V1 0 1.8 0.01",
    ac: "ac dec 100 1 1e9",
    tran: "tran 1n 10u",
    noise: "noise v(out) V1 dec 100 1 1e9",
  };
  return `${defaults[kind]}\n${kind === "noise" ? "write out.raw noise1.all noise2.all" : "write out.raw"}\n`;
}

export { splitSpiceFields };
