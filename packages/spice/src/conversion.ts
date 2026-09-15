/*! @license
MIT License

Copyright (c) 2026 Token Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/**
 * Adapted from netlist-crawler (MIT, Copyright 2026 Token Zhang).
 * See ../third-party/netlist-crawler/LICENSE and README.md.
 * Pure strict-subset translation: no file access, model discovery or execution.
 */
import { reviewedExternalBindingForMaster } from "@icm/devices";

export type NetlistDialect = "spice" | "ngspice" | "spectre";
export interface NetlistConversionIssue {
  line: number;
  code: string;
  message: string;
  statement: string;
}
export interface NetlistConversionOptions {
  text: string;
  source: NetlistDialect;
  target: NetlistDialect;
  /** A structural include does not acquire a SPICE .end deck terminator. */
  fragment?: boolean;
}
export type NetlistConversionResult =
  | {
      status: "converted";
      text: string;
      source: NetlistDialect;
      target: NetlistDialect;
      issues: NetlistConversionIssue[];
    }
  | { status: "blocked"; issues: NetlistConversionIssue[] };
export const MAX_CONVERSION_BYTES = 512 * 1024;
export const isNetlistDialect = (value: unknown): value is NetlistDialect =>
  value === "spice" || value === "ngspice" || value === "spectre";

class ConversionError extends Error {
  constructor(readonly issue: NetlistConversionIssue) {
    super(issue.message);
  }
}
interface Statement {
  line: number;
  text: string;
  dialect: "spice" | "spectre";
}
function refuse(
  s: Statement,
  message: string,
  code = "UNSUPPORTED_SYNTAX",
): never {
  throw new ConversionError({ line: s.line, code, message, statement: s.text });
}

/** Keep nested expressions and quoted paths together; malformed grouping is fatal. */
function fields(text: string, s: Statement): string[] {
  const result: string[] = [];
  let buffer = "",
    quote = "",
    escaped = false;
  const stack: string[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (const char of text.trim()) {
    if (quote) {
      buffer += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
    } else if (pairs[char]) {
      stack.push(pairs[char]!);
      buffer += char;
    } else if (")]}".includes(char)) {
      if (stack.pop() !== char)
        refuse(s, "Unbalanced expression or node list.");
      buffer += char;
    } else if (/\s/u.test(char) && !stack.length) {
      if (buffer) {
        result.push(buffer);
        buffer = "";
      }
    } else buffer += char;
  }
  if (stack.length || quote) refuse(s, "Unclosed expression or quoted value.");
  if (buffer) result.push(buffer);
  return result;
}
function uncomment(text: string, dialect: Statement["dialect"]): string {
  let quote = "",
    depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if ("({[".includes(c)) depth++;
    if (")}]".includes(c)) depth--;
    if (
      depth === 0 &&
      (dialect === "spectre"
        ? text.slice(i, i + 2) === "//"
        : c === ";" || c === "$")
    )
      return text.slice(0, i).trimEnd();
  }
  return text;
}
function statements(text: string, source: NetlistDialect): Statement[] {
  const result: Statement[] = [];
  let dialect: Statement["dialect"] =
    source === "spectre" ? "spectre" : "spice";
  let pending: Statement | undefined;
  for (const [index, raw] of text
    .replace(/^\uFEFF/u, "")
    .split(/\r\n?|\n/u)
    .entries()) {
    const line = index + 1,
      trimmed = raw.trim();
    const language = /^simulator\s+lang\s*=\s*(\w+)$/iu.exec(trimmed);
    if (language) {
      if (source !== "spectre" || pending)
        refuse(
          { line, text: raw, dialect },
          "Unexpected simulator language declaration.",
        );
      if (!["spice", "spectre"].includes(language[1]!.toLowerCase()))
        refuse({ line, text: raw, dialect }, "Unsupported simulator language.");
      dialect = language[1]!.toLowerCase() as Statement["dialect"];
      continue;
    }
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      (dialect === "spice" && trimmed.startsWith("*"))
    )
      continue;
    const code = uncomment(trimmed, dialect);
    if (!code) continue;
    if (dialect === "spice" && code.startsWith("+")) {
      const previous = result.at(-1);
      if (!previous || previous.dialect !== "spice")
        refuse({ line, text: raw, dialect }, "Orphan continuation line.");
      previous.text += " " + code.slice(1).trim();
      continue;
    }
    const continued = dialect === "spectre" && code.endsWith("\\");
    const next = continued ? code.slice(0, -1).trimEnd() : code;
    if (pending) pending.text += " " + next;
    else pending = { line, text: next, dialect };
    if (!continued) {
      result.push(pending);
      pending = undefined;
    }
  }
  if (pending) refuse(pending, "Unfinished continuation line.");
  if (result.length > 10000)
    refuse(
      result[10000]!,
      "Conversion is limited to 10,000 statements.",
      "RESOURCE_LIMIT",
    );
  return result;
}
function value(
  raw: string,
  source: Statement["dialect"],
  s: Statement,
): string {
  const body = raw
    .trim()
    .replace(/^\{([\s\S]*)\}$/u, "$1")
    .replace(/^'([\s\S]*)'$/u, "$1");
  const number =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([A-Za-z]*)$/iu.exec(body);
  const numeric = (base: string, suffix: string) => {
    const factors: Record<string, number> =
      source === "spice"
        ? {
            "": 1,
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
          }
        : {
            "": 1,
            T: 1e12,
            G: 1e9,
            M: 1e6,
            K: 1e3,
            k: 1e3,
            m: 1e-3,
            u: 1e-6,
            n: 1e-9,
            p: 1e-12,
            f: 1e-15,
            a: 1e-18,
          };
    const factor = factors[source === "spice" ? suffix.toLowerCase() : suffix];
    if (factor === undefined)
      refuse(s, `Unsupported numeric suffix in ${raw}.`, "UNSUPPORTED_VALUE");
    const n = Number(base) * factor;
    if (!Number.isFinite(n)) refuse(s, `Non-finite numeric value ${raw}.`);
    return Number(n.toPrecision(15)).toString();
  };
  if (number) return numeric(number[1]!, number[2]!);
  // This common arithmetic subset has the same meaning in both dialects.
  // Function calls, vectors, strings and simulator-specific expressions require
  // an explicit extension instead of being passed through as apparently valid.
  if (
    !body ||
    !/^[A-Za-z0-9_+*/().\s-]+$/u.test(body) ||
    /[A-Za-z_]\w*\s*\(/u.test(body)
  )
    refuse(s, `Unsupported expression ${raw}.`, "UNSUPPORTED_VALUE");
  const converted = body.replace(
    /(?<![A-Za-z0-9_.])((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([A-Za-z]*)/giu,
    (_match, base: string, suffix: string) => numeric(base, suffix),
  );
  fields(converted, s);
  return source === "spectre" ? `{${converted}}` : `(${converted})`;
}
type Parameters = Map<string, { name: string; raw: string }>;
function parameters(tokens: string[], s: Statement): Parameters {
  const result: Parameters = new Map();
  for (const token of tokens) {
    const match = /^([A-Za-z_]\w*)=(.+)$/u.exec(token);
    if (!match)
      refuse(
        s,
        `Expected name=value; received ${token}.`,
        "UNSUPPORTED_PARAMETER",
      );
    const key = match[1]!.toLowerCase();
    if (result.has(key))
      refuse(s, `Duplicate parameter ${match[1]}.`, "DUPLICATE_PARAMETER");
    result.set(key, { name: match[1]!, raw: match[2]! });
  }
  return result;
}
function emitParameters(p: Parameters, s: Statement): string {
  return [...p.values()]
    .map(({ name, raw }) => `${name}=${value(raw, s.dialect, s)}`)
    .join(" ");
}
function take(
  p: Parameters,
  key: string,
  s: Statement,
  fallback?: string,
): string {
  const entry = p.get(key);
  p.delete(key);
  if (!entry && fallback === undefined)
    refuse(s, `Missing required parameter ${key}.`, "MISSING_PARAMETER");
  return entry?.raw ?? fallback!;
}
function noParameters(p: Parameters, s: Statement) {
  if (p.size)
    refuse(
      s,
      `Unsupported parameters: ${[...p.values()].map((p) => p.name).join(", ")}.`,
      "UNSUPPORTED_PARAMETER",
    );
}
function prefix(name: string, wanted: string) {
  return name.toUpperCase().startsWith(wanted) ? name : wanted + name;
}
interface Context {
  subckts: Set<string>;
  models: Map<string, string>;
}
function spectreInstance(s: Statement, ctx: Context): string {
  const match = /^(\S+)\s*\(([^()]*)\)\s+(\S+)(?:\s+(.*))?$/u.exec(s.text);
  if (!match) refuse(s, "Expected an instance with a parenthesized node list.");
  const [, name, nodeText, master, rest] = match;
  const nodes = fields(nodeText!, s),
    kind = master!.toLowerCase();
  const p = parameters(fields(rest ?? "", s), s);
  const arity = (n: number) => {
    if (nodes.length !== n)
      refuse(s, `${master} requires ${n} nodes.`, "PIN_ARITY");
  };
  const output = (designator: string, tail: string) =>
    `${prefix(name!, designator)} ${nodes.join(" ")} ${tail}`.trim();
  if (["resistor", "capacitor", "inductor"].includes(kind)) {
    arity(2);
    const key = kind[0]!;
    const raw = take(p, key, s);
    noParameters(p, s);
    return output(key.toUpperCase(), value(raw, "spectre", s));
  }
  if (["vcvs", "vccs"].includes(kind)) {
    arity(4);
    const gain = take(p, kind === "vcvs" ? "gain" : "gm", s);
    noParameters(p, s);
    return output(kind === "vcvs" ? "E" : "G", value(gain, "spectre", s));
  }
  if (kind === "vsource" || kind === "isource") {
    arity(2);
    const type = take(p, "type", s, "dc").toLowerCase();
    if (!["dc", "pulse", "sine", "pwl"].includes(type))
      refuse(s, `Unsupported source type ${type}.`);
    const pieces: string[] = [];
    const sineOffset = p.get("dc")?.raw ?? "0";
    if (p.has("dc")) pieces.push("DC", value(take(p, "dc", s), "spectre", s));
    if (p.has("mag")) {
      pieces.push("AC", value(take(p, "mag", s), "spectre", s));
      if (p.has("phase")) pieces.push(value(take(p, "phase", s), "spectre", s));
    }
    if (type === "pulse" || type === "sine") {
      const keys =
        type === "pulse"
          ? ["val0", "val1", "delay", "rise", "fall", "width", "period"]
          : ["sinedc", "ampl", "freq", "delay", "damp", "sinephase"];
      const defaults =
        type === "pulse"
          ? [
              undefined,
              undefined,
              "0",
              undefined,
              undefined,
              undefined,
              undefined,
            ]
          : [sineOffset, undefined, undefined, "0", "0", "0"];
      const vals = keys.map((key, i) =>
        value(take(p, key, s, defaults[i]), "spectre", s),
      );
      pieces.push(`${type === "pulse" ? "PULSE" : "SIN"}(${vals.join(" ")})`);
    } else if (type === "pwl") {
      const wave = take(p, "wave", s);
      if (!wave.startsWith("[") || !wave.endsWith("]"))
        refuse(s, "PWL wave must be a bracketed time/value list.");
      const vals = fields(wave.slice(1, -1), s);
      if (vals.length < 4 || vals.length % 2)
        refuse(s, "PWL requires complete time/value pairs.");
      pieces.push(`PWL(${vals.map((v) => value(v, "spectre", s)).join(" ")})`);
    }
    noParameters(p, s);
    if (!pieces.length)
      refuse(
        s,
        "A source needs an explicit DC, AC or waveform value.",
        "MISSING_PARAMETER",
      );
    return output(kind === "vsource" ? "V" : "I", pieces.join(" "));
  }
  if (
    [
      "bsource",
      "cccs",
      "ccvs",
      "iprobe",
      "port",
      "nport",
      "tline",
      "switch",
      "relay",
      "transformer",
      "mutual_inductor",
    ].includes(kind)
  )
    refuse(s, `Unsupported native Spectre primitive ${master}.`);
  const declared = ctx.models.get(kind);
  const isSubckt =
    ctx.subckts.has(kind) || !!reviewedExternalBindingForMaster(master!);
  const conventional = /^[MDQ]/iu.test(name!) ? name![0]!.toUpperCase() : "X";
  if (!isSubckt && !declared && !/^[MDQX]/iu.test(name!))
    refuse(
      s,
      `Declare the external subcircuit ${master} or use an explicit X reference before conversion.`,
      "TARGET_KIND_REQUIRED",
    );
  const designator = isSubckt ? "X" : (declared ?? conventional);
  if (designator === "M") arity(4);
  else if (designator === "D") arity(2);
  else if (designator === "Q" && ![3, 4].includes(nodes.length))
    refuse(s, "BJT requires three or four nodes.", "PIN_ARITY");
  return output(designator, `${master} ${emitParameters(p, s)}`);
}
function spiceInstance(s: Statement): string {
  const f = fields(s.text, s),
    name = f[0]!,
    kind = name[0]!.toUpperCase();
  const output = (nodes: string[], master: string, params: string) =>
    `${name} (${nodes.join(" ")}) ${master}${params ? " " + params : ""}`;
  if (["R", "C", "L"].includes(kind)) {
    if (f.length !== 4)
      refuse(
        s,
        "Only two-terminal ideal R/C/L values are supported; extra parameters are not dropped.",
        "UNSUPPORTED_PARAMETER",
      );
    const masters: Record<string, string> = {
      R: "resistor",
      C: "capacitor",
      L: "inductor",
    };
    return output(
      f.slice(1, 3),
      masters[kind]!,
      `${kind.toLowerCase()}=${value(f[3]!, "spice", s)}`,
    );
  }
  if (kind === "E" || kind === "G") {
    if (f.length !== 6)
      refuse(s, "Only linear four-node controlled sources are supported.");
    return output(
      f.slice(1, 5),
      kind === "E" ? "vcvs" : "vccs",
      `${kind === "E" ? "gain" : "gm"}=${value(f[5]!, "spice", s)}`,
    );
  }
  if (kind === "V" || kind === "I") {
    if (f.length < 4) refuse(s, "Source value is missing.");
    const p: string[] = [];
    let i = 3;
    if (!/^(?:dc|ac|pulse\(|sin\(|pwl\()/iu.test(f[i]!))
      p.push(`dc=${value(f[i++]!, "spice", s)}`);
    if (f[i]?.toLowerCase() === "dc") {
      i++;
      if (!f[i]) refuse(s, "Missing DC value.");
      p.push(`dc=${value(f[i++]!, "spice", s)}`);
    }
    if (f[i]?.toLowerCase() === "ac") {
      i++;
      if (!f[i]) refuse(s, "Missing AC magnitude.");
      p.push(`mag=${value(f[i++]!, "spice", s)}`);
      if (f[i] && !/^(?:pulse|sin|pwl)\(/iu.test(f[i]!))
        p.push(`phase=${value(f[i++]!, "spice", s)}`);
    }
    if (f[i]) {
      const match = /^(pulse|sin|pwl)\((.*)\)$/iu.exec(f[i++]!);
      if (!match) refuse(s, "Unsupported source waveform.");
      const type = match[1]!.toLowerCase();
      const vals = fields(match[2]!, s);
      if (type === "pwl") {
        if (vals.length < 4 || vals.length % 2)
          refuse(s, "PWL requires complete pairs.");
        p.push(
          "type=pwl",
          `wave=[${vals.map((v) => value(v, "spice", s)).join(" ")}]`,
        );
      } else {
        const keys =
          type === "pulse"
            ? ["val0", "val1", "delay", "rise", "fall", "width", "period"]
            : ["sinedc", "ampl", "freq", "delay", "damp", "sinephase"];
        if (
          (type === "pulse" && vals.length !== 7) ||
          (type === "sin" && (vals.length < 3 || vals.length > 6))
        )
          refuse(s, "Supply the supported waveform parameters explicitly.");
        p.push(
          `type=${type === "sin" ? "sine" : type}`,
          ...vals.map((v, j) => `${keys[j]}=${value(v, "spice", s)}`),
        );
      }
    }
    if (i !== f.length) refuse(s, "Extra source parameters are unsupported.");
    return output(
      f.slice(1, 3),
      kind === "V" ? "vsource" : "isource",
      p.join(" "),
    );
  }
  if (kind === "X") {
    let pos = f.findIndex((t) => t.includes("="));
    if (pos < 0) pos = f.length;
    if (f[pos - 1]?.toLowerCase() === "params:") pos--;
    if (pos < 3) refuse(s, "Cannot locate subcircuit master and nodes.");
    const rest = f.slice(pos).filter((t) => t.toLowerCase() !== "params:");
    return output(
      f.slice(1, pos - 1),
      f[pos - 1]!,
      emitParameters(parameters(rest, s), s),
    );
  }
  const nodeCount = kind === "M" ? 4 : kind === "D" ? 2 : kind === "Q" ? 3 : 0;
  if (nodeCount && f.length >= nodeCount + 2) {
    // Four-terminal BJTs are not distinguishable from an optional area without
    // consulting model declarations. Reject that ambiguous shape here.
    return output(
      f.slice(1, nodeCount + 1),
      f[nodeCount + 1]!,
      emitParameters(parameters(f.slice(nodeCount + 2), s), s),
    );
  }
  refuse(s, `Unsupported SPICE instance ${name}.`);
}
function translate(s: Statement, ctx: Context): string[] {
  // Normalize assignment whitespace, while preserving quoted paths/expressions.
  const f = fields(s.text, s),
    head = f[0]!.toLowerCase();
  if (s.dialect === "spectre") {
    if (head === "subckt") {
      const match =
        /^subckt\s+(\S+)(?:\s+\(([^()]*)\)|\s+([^=]*?))?(?:\s+(\w+=.*))?$/iu.exec(
          s.text,
        );
      if (!match) refuse(s, "Invalid subcircuit declaration.");
      const ports = fields(match[2] ?? match[3] ?? "", s);
      const p = parameters(fields(match[4] ?? "", s), s);
      return [
        `.subckt ${match[1]}${ports.length ? " " + ports.join(" ") : ""}${p.size ? " params: " + emitParameters(p, s) : ""}`,
      ];
    }
    if (head === "ends") {
      if (f.length > 2) refuse(s, "Unexpected ends arguments.");
      return [".ends" + (f[1] ? " " + f[1] : "")];
    }
    if (head === "global") return [".global " + f.slice(1).join(" ")];
    if (head === "parameters")
      return [".param " + emitParameters(parameters(f.slice(1), s), s)];
    if (head === "include") {
      if (f.length < 2 || f.length > 3 || !/^"[^"\r\n]+"$/u.test(f[1]!))
        refuse(s, "Include requires a quoted path and optional section.");
      if (f[2] && !/^section=[A-Za-z_]\w*$/u.test(f[2]))
        refuse(s, "Unsupported include option.");
      return [f[2] ? `.lib ${f[1]} ${f[2].slice(8)}` : `.include ${f[1]}`];
    }
    if (f[1]?.toLowerCase() === "op") {
      noParameters(parameters(f.slice(2), s), s);
      return [".op"];
    }
    if (["ac", "dc", "tran"].includes(f[1]?.toLowerCase() ?? "")) {
      const analysis = f[1]!.toLowerCase(),
        p = parameters(f.slice(2), s);
      let out: string;
      const get = (k: string, def?: string) =>
        value(take(p, k, s, def), "spectre", s);
      if (analysis === "ac") {
        const sweep = ["dec", "oct", "lin"].find((k) => p.has(k));
        if (!sweep) refuse(s, "AC requires dec, oct or lin.");
        out = `.ac ${sweep} ${get(sweep)} ${get("start")} ${get("stop")}`;
      } else if (analysis === "dc")
        out = `.dc ${take(p, "source", s)} ${get("start")} ${get("stop")} ${get("step")}`;
      else
        out = `.tran ${get("step")} ${get("stop")}${p.has("start") || p.has("maxstep") ? " " + get("start", "0") : ""}${p.has("maxstep") ? " " + get("maxstep") : ""}`;
      noParameters(p, s);
      return [out];
    }
    return [spectreInstance(s, ctx)];
  }
  if (head === ".end") {
    if (f.length !== 1) refuse(s, "Unexpected .end arguments.");
    return [];
  }
  if (head === ".subckt") {
    let pos = f.findIndex(
      (t) => t.includes("=") || t.toLowerCase() === "params:",
    );
    if (pos < 0) pos = f.length;
    const p = parameters(
      f.slice(pos).filter((t) => t.toLowerCase() !== "params:"),
      s,
    );
    return [
      `subckt ${f[1]} (${f.slice(2, pos).join(" ")})`,
      ...(p.size ? ["parameters " + emitParameters(p, s)] : []),
    ];
  }
  if (head === ".ends") {
    if (f.length > 2) refuse(s, "Unexpected .ends arguments.");
    return ["ends" + (f[1] ? " " + f[1] : "")];
  }
  if (head === ".global") return ["global " + f.slice(1).join(" ")];
  if (head === ".param")
    return ["parameters " + emitParameters(parameters(f.slice(1), s), s)];
  if ([".include", ".inc", ".lib", ".model"].includes(head)) {
    if (
      (head === ".lib" && f.length !== 3) ||
      ([".include", ".inc"].includes(head) && f.length !== 2) ||
      (head === ".model" && f.length < 3)
    )
      refuse(s, "Unsupported library or model declaration.");
    // An included SPICE library remains SPICE. Native Spectre include syntax
    // would incorrectly reinterpret the model file's dialect.
    return ["simulator lang=spice", s.text, "simulator lang=spectre"];
  }
  if (head === ".op" && f.length === 1) return ["op1 op"];
  if (head === ".ac" && f.length === 5 && /^(dec|oct|lin)$/iu.test(f[1]!))
    return [
      `ac1 ac ${f[1]!.toLowerCase()}=${value(f[2]!, "spice", s)} start=${value(f[3]!, "spice", s)} stop=${value(f[4]!, "spice", s)}`,
    ];
  if (head === ".dc" && f.length === 5)
    return [
      `dc1 dc source=${f[1]} start=${value(f[2]!, "spice", s)} stop=${value(f[3]!, "spice", s)} step=${value(f[4]!, "spice", s)}`,
    ];
  if (
    head === ".tran" &&
    f.length >= 3 &&
    f.length <= 5 &&
    !f.some((t) => t.toLowerCase() === "uic")
  )
    return [
      `tran1 tran step=${value(f[1]!, "spice", s)} stop=${value(f[2]!, "spice", s)}${f[3] ? " start=" + value(f[3], "spice", s) : ""}${f[4] ? " maxstep=" + value(f[4], "spice", s) : ""}`,
    ];
  if (head.startsWith("."))
    refuse(s, `Unsupported SPICE directive ${head}; it has not been omitted.`);
  return [spiceInstance(s)];
}

/** SPICE folds node names; native Spectre distinguishes their case. Refuse
 * aliases whose meaning would change, instead of silently shorting/splitting. */
function checkNodeCase(
  s: Statement,
  scope: string,
  names: Map<string, string>,
  globals: Map<string, string>,
) {
  const f = fields(s.text, s),
    head = f[0]!.toLowerCase();
  let nodes: string[] = [];
  if (head === "subckt" || head === ".subckt") {
    const end = f.findIndex(
      (t) => t.includes("=") || t.toLowerCase() === "params:",
    );
    nodes = f
      .slice(2, end < 0 ? undefined : end)
      .flatMap((t) => fields(t.replace(/^\((.*)\)$/u, "$1"), s));
  } else if (s.dialect === "spectre") {
    const match = /^\S+\s*\(([^()]*)\)\s+/u.exec(s.text);
    if (match) nodes = fields(match[1]!, s);
  } else if (!head.startsWith(".")) {
    const kind = head[0];
    if (kind === "x") {
      let end = f.findIndex(
        (t) => t.includes("=") || t.toLowerCase() === "params:",
      );
      if (end < 0) end = f.length;
      nodes = f.slice(1, end - 1);
    } else {
      const count =
        kind === "m" || kind === "e" || kind === "g" ? 4 : kind === "q" ? 3 : 2;
      nodes = f.slice(1, count + 1);
    }
  }
  for (const node of nodes) {
    const key = `${scope}/${node.toLowerCase()}`,
      prior = globals.get(node.toLowerCase()) ?? names.get(key);
    if (prior && prior !== node)
      refuse(
        s,
        `Node names ${prior} and ${node} differ only in case; use one spelling before changing dialect.`,
        "NODE_CASE_COLLISION",
      );
    names.set(key, node);
  }
}

export function convertNetlist(
  options: NetlistConversionOptions,
): NetlistConversionResult {
  const { text, source, target } = options;
  try {
    const root: Statement = {
      line: 0,
      text: "",
      dialect: source === "spectre" ? "spectre" : "spice",
    };
    if (
      !isNetlistDialect(source) ||
      !isNetlistDialect(target) ||
      typeof text !== "string"
    )
      refuse(
        root,
        "Supply text and supported source/target dialects.",
        "INVALID_REQUEST",
      );
    if (new TextEncoder().encode(text).length > MAX_CONVERSION_BYTES)
      refuse(
        root,
        "Netlist exceeds the 512 KiB conversion limit.",
        "RESOURCE_LIMIT",
      );
    if (source === target || (source !== "spectre" && target !== "spectre"))
      return { status: "converted", text, source, target, issues: [] };
    // In an explicitly complete SPICE deck, the first physical line is a
    // simulator title. Structural fragments do not have that special rule.
    const inputText =
      source !== "spectre" && options.fragment === false
        ? text.replace(/^[^\r\n]*/u, "")
        : text;
    const input = statements(inputText, source);
    const ctx: Context = { subckts: new Set(), models: new Map() };
    const globals = new Map<string, string>();
    for (const s of input) {
      const f = fields(s.text, s);
      if (["global", ".global"].includes(f[0]!.toLowerCase()))
        for (const node of f.slice(1)) {
          const prior = globals.get(node.toLowerCase());
          if (prior && prior !== node)
            refuse(
              s,
              "Global nodes differ only in case.",
              "NODE_CASE_COLLISION",
            );
          globals.set(node.toLowerCase(), node);
        }
      if (["subckt", ".subckt"].includes(f[0]!.toLowerCase()) && !f[1])
        refuse(s, "Subcircuit name is missing.");
      if (["subckt", ".subckt"].includes(f[0]!.toLowerCase()) && f[1]) {
        if (ctx.subckts.has(f[1].toLowerCase()))
          refuse(s, "Duplicate subcircuit name.", "REFERENCE_COLLISION");
        ctx.subckts.add(f[1].toLowerCase());
      }
      if (
        s.dialect === "spice" &&
        f[0]?.toLowerCase() === ".model" &&
        f[1] &&
        f[2]
      ) {
        const modelClass = f[2].split("(")[0]!.toLowerCase();
        const designator = ["nmos", "pmos"].includes(modelClass)
          ? "M"
          : ["npn", "pnp"].includes(modelClass)
            ? "Q"
            : modelClass === "d"
              ? "D"
              : undefined;
        if (designator) ctx.models.set(f[1].toLowerCase(), designator);
      }
    }
    const out = [
      target === "spectre"
        ? "simulator lang=spectre"
        : "* Converted by Analog Canvas / netlist-crawler",
    ];
    const names = new Set<string>();
    const nodeNames = new Map<string, string>();
    let scope = "",
      depth = 0;
    for (const s of input) {
      const head = s.text.split(/\s+/u)[0]!.toLowerCase();
      if (head === "subckt" || head === ".subckt") {
        if (depth) refuse(s, "Nested subcircuit definitions are unsupported.");
        depth++;
        scope = fields(s.text, s)[1]!.toLowerCase();
      }
      if (head === "ends" || head === ".ends") {
        if (!depth) refuse(s, "Unmatched subcircuit end.");
        if (
          fields(s.text, s)[1] &&
          fields(s.text, s)[1]!.toLowerCase() !== scope
        )
          refuse(s, "Subcircuit end name does not match.");
        depth--;
      }
      if (!(s.dialect === "spice" && target !== "spectre"))
        checkNodeCase(s, scope, nodeNames, globals);
      const translated =
        s.dialect === "spice" && target !== "spectre"
          ? [s.text]
          : translate(s, ctx);
      for (const line of translated) {
        if (!line) continue;
        const isInstance =
          s.dialect === "spectre"
            ? /^(\S+)\s*\(/u.test(s.text) && head !== "subckt"
            : target === "spectre" && !head.startsWith(".");
        if (isInstance) {
          const name = line.split(/\s+/u)[0]!;
          const key = `${scope}/${name.toLowerCase()}`;
          if (names.has(key))
            refuse(
              s,
              `Converted reference ${name} collides in this cell.`,
              "REFERENCE_COLLISION",
            );
          names.add(key);
        }
        out.push(line);
      }
      if (!depth) scope = "";
    }
    if (depth) refuse(input.at(-1)!, "Unclosed subcircuit definition.");
    if (
      target !== "spectre" &&
      options.fragment === false &&
      !out.some((s) => s.toLowerCase() === ".end")
    )
      out.push(".end");
    const converted = out.join("\n") + "\n";
    if (new TextEncoder().encode(converted).length > MAX_CONVERSION_BYTES * 2)
      refuse(
        root,
        "Converted output exceeds the size limit.",
        "RESOURCE_LIMIT",
      );
    return { status: "converted", text: converted, source, target, issues: [] };
  } catch (error) {
    if (error instanceof ConversionError)
      return { status: "blocked", issues: [error.issue] };
    throw error;
  }
}
