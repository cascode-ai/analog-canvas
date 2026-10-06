import type { SourceSpan } from "@icm/model";
import {
  SimulationSpecLabelSchema,
  SimulationSpecResultSchema,
  type SimulationSpecCondition,
  type SimulationSpecResult,
} from "./spec-contract.js";

/**
 * A line that declares a Spec: `* @spec NAME [CONDITION] [unit=…] [group=…]
 * [label=…]` in ngspice source, the same after `//` in VACASK source. The
 * grammar after the marker is shared.
 */
export const SIMULATION_SPEC_LINE = /^\s*(?:\*|\/\/)\s*@spec\b/iu;

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const number = (text: string | undefined): number | null =>
  text && DECIMAL.test(text) && Number.isFinite(Number(text))
    ? Number(text)
    : null;
const quote = (text: string) => JSON.stringify(text);
const excerpt = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed;
};

export interface SimulationSpecAnnotation {
  name: string;
  unit: string;
  expected: SimulationSpecCondition | null;
  label?: SimulationSpecResult["label"];
  group?: string;
  /**
   * Why the annotation is invalid, each naming the offending token and the
   * form accepted instead; empty when it is valid. A run reports them as the
   * `invalid-spec` detail, and the Code editor on the annotation's line.
   */
  problems: string[];
}

/** SPICE scale suffixes as powers of ten; a SPICE number ignores letters after one. */
const SPICE_SCALES: Readonly<Record<string, number>> = {
  t: 12,
  g: 9,
  meg: 6,
  k: 3,
  m: -3,
  u: -6,
  n: -9,
  p: -12,
  f: -15,
};

/** The same number in the notation a Spec accepts, for a SPICE-suffixed one. */
function spiceSuffixReplacement(token: string): string | undefined {
  const match =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d+))?(meg|mil|[tgkmunpf])[a-z]*$/iu.exec(
      token,
    );
  if (!match) return undefined;
  const mantissa = match[1]!;
  const exponent = Number(match[2] ?? 0);
  const suffix = match[3]!;
  const scaled = (power: number) => `${mantissa}e${exponent + power}`;
  if (suffix.toLowerCase() === "mil")
    return String(
      Number((Number(`${mantissa}e${exponent}`) * 25.4e-6).toPrecision(12)),
    );
  // SPICE reads M as milli; most other tools, VACASK among them, as mega.
  if (suffix === "M")
    return `${scaled(-3)} (SPICE reads M as milli) or ${scaled(6)} for mega`;
  return scaled(SPICE_SCALES[suffix.toLowerCase()]!);
}

function numberProblem(role: string, token: string): string[] {
  if (number(token) !== null) return [];
  if (DECIMAL.test(token))
    return [`${role} ${quote(token)} is too large to be a finite number.`];
  const replacement = spiceSuffixReplacement(token);
  return [
    replacement
      ? `${role} ${quote(token)} is not a decimal or scientific number; write ${replacement}.`
      : `${role} ${quote(token)} is not a decimal or scientific number such as 0.5 or 2e-3.`,
  ];
}

const CONDITIONS =
  "< N, <= N, > N, >= N, range MIN MAX or target VALUE tol TOLERANCE";

/** Why the tokens after the name are not a condition; never empty. */
function conditionProblems(tokens: readonly string[]): string[] {
  const misplaced = tokens.find((token) => token.startsWith("unit="));
  if (misplaced)
    return [
      `${quote(misplaced)} is out of place; declare the unit once, after the condition.`,
    ];
  const [op = "", a = "", b = "", c = ""] = tokens;
  const written = quote(tokens.join(" "));
  const glued = /^(<=|>=|<|>)([^=].*)$/u.exec(op);
  if (glued && tokens.length === 1)
    return [
      `Condition ${written} needs a space after ${glued[1]}: write ${glued[1]} ${glued[2]}.`,
    ];
  let problems: string[];
  let otherwise = `Condition ${written} is not one of ${CONDITIONS}.`;
  if (["<", "<=", ">", ">="].includes(op)) {
    if (tokens.length !== 2)
      return [
        `Condition ${written} is not ${op} N; write one bound after ${op}.`,
      ];
    problems = numberProblem("Bound", a);
  } else if (op === "range") {
    if (tokens.length !== 3)
      return [`Condition ${written} is not range MIN MAX.`];
    problems = [...numberProblem("Bound", a), ...numberProblem("Bound", b)];
    otherwise = `Range ${a} ${b} has its minimum above its maximum; write range ${b} ${a}.`;
  } else if (op === "target") {
    if (tokens.length !== 4 || b !== "tol")
      return [`Condition ${written} is not target VALUE tol TOLERANCE.`];
    problems = [
      ...numberProblem("Target", a),
      ...numberProblem("Tolerance", c),
    ];
    otherwise = `Tolerance ${c} is negative; write the absolute tolerance ${c.replace(/^-/u, "")}.`;
  } else return [`${quote(op)} does not start a condition; use ${CONDITIONS}.`];
  return problems.length ? problems : [otherwise];
}

function labelProblem(
  raw: string,
  value: unknown,
  issues: readonly { path: readonly PropertyKey[] }[],
): string {
  if (value === "") return 'Label "" is empty; write label="Text".';
  if (typeof value === "string" && value.length > 256)
    return "Label is longer than 256 characters.";
  const [field, index] = issues[0]?.path ?? [];
  const runs = (value as { runs?: unknown } | null)?.runs;
  if (field === "runs" && typeof index === "number" && Array.isArray(runs))
    return `Label run ${index + 1}, ${excerpt(JSON.stringify(runs[index]) ?? "")}, is not a text, bold, italic, subscript, superscript, overbar or inline math run.`;
  return `Label ${excerpt(raw)} is not a supported label; write a JSON string, up to 16 text and style runs, or one inline math run on its own.`;
}

function groupProblem(raw: string, value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text)
    return `Group ${raw} is empty; write group=Name or group="Display name".`;
  if (text.length > 80)
    return `Group ${excerpt(raw)} is longer than 80 characters.`;
  return `Group ${excerpt(raw)} contains a control character; keep it to one line.`;
}

/**
 * Read one Spec annotation line. v1 deliberately has no executable
 * expressions or inferred unit conversions; a value the grammar refuses is
 * explained, never converted.
 */
export function parseSimulationSpecAnnotation(
  text: string,
): SimulationSpecAnnotation {
  const nameProblems: string[] = [];
  const conditionIssues: string[] = [];
  const unitProblems: string[] = [];
  const groupProblems: string[] = [];
  const labelProblems: string[] = [];
  // One optional JSON label at the end; reuse the canonical RichText contract,
  // never interpret authored HTML or introduce another markup dialect.
  const labelStart = [...text.matchAll(/"(?:\\.|[^"\\])*"|\s+label=/gu)].find(
    (match) => /^\s+label=$/u.test(match[0]),
  );
  let label: SimulationSpecResult["label"];
  if (labelStart) {
    const raw = text.slice(labelStart.index + labelStart[0].length);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      labelProblems.push(
        `Label ${excerpt(raw)} is not JSON; write label="Text" or a RichText document, last on the line.`,
      );
    }
    if (!labelProblems.length) {
      const parsed = SimulationSpecLabelSchema.safeParse(
        typeof value === "string" ? { runs: [{ kind: "text", value }] } : value,
      );
      if (parsed.success) label = parsed.data;
      else labelProblems.push(labelProblem(raw, value, parsed.error.issues));
    }
  }
  let group: string | undefined;
  let groupCount = 0;
  const metadataText = (
    labelStart ? text.slice(0, labelStart.index) : text
  ).replace(/\s+group=("(?:\\.|[^"\\])*"|[^\s]+)/gu, (_match, raw: string) => {
    groupCount++;
    let value: unknown = raw;
    if (raw.startsWith('"'))
      try {
        value = JSON.parse(raw);
      } catch {
        groupProblems.push(
          `Group ${excerpt(raw)} is not a closed JSON string; write group=Name or group="Display name".`,
        );
        return "";
      }
    const parsed = SimulationSpecResultSchema.shape.group.safeParse(value);
    if (parsed.success) group = parsed.data;
    else groupProblems.push(groupProblem(raw, value));
    return "";
  });
  if (groupCount > 1)
    groupProblems.push(
      `Group is declared ${groupCount} times; keep one group= per annotation.`,
    );
  const tokens = metadataText
    .trim()
    .replace(/^(?:\*|\/\/)\s*@spec\b/iu, "")
    .trim()
    .split(/\s+/u);
  const name = tokens.shift() ?? "";
  let unit = "";
  let unitDeclared = false;
  if (tokens.at(-1)?.startsWith("unit=")) {
    unit = tokens.pop()!.slice(5);
    unitDeclared = true;
  }
  const [op, a, b, c] = tokens;
  const first = number(a),
    second = number(b),
    tolerance = number(c);
  let expected: SimulationSpecCondition | null = null;
  if (
    tokens.length === 2 &&
    ["<", "<=", ">", ">="].includes(op ?? "") &&
    first !== null
  )
    expected = {
      kind: "limit",
      operator: op as "<" | "<=" | ">" | ">=",
      value: first,
    };
  if (
    tokens.length === 3 &&
    op === "range" &&
    first !== null &&
    second !== null &&
    first <= second
  )
    expected = { kind: "range", minimum: first, maximum: second };
  if (
    tokens.length === 4 &&
    op === "target" &&
    first !== null &&
    b === "tol" &&
    tolerance !== null &&
    tolerance >= 0
  )
    expected = { kind: "target", value: first, tolerance };

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
    nameProblems.push(
      !name
        ? "Name the measurement: write @spec NAME, then an optional condition, unit=, group= and label=."
        : name.startsWith("unit=")
          ? `Name the measurement before ${name}: write @spec NAME ${name}.`
          : `Name ${quote(name)} is not a measurement name; use letters, digits and underscores, starting with a letter or underscore.`,
    );
  if (!expected) {
    if (tokens.length) conditionIssues.push(...conditionProblems(tokens));
    // A measurement-only annotation needs a unit, group or label. An invalid
    // label or group already says what is wrong with it.
    else if (
      !unit &&
      !labelStart &&
      !groupCount &&
      name &&
      !name.startsWith("unit=")
    )
      conditionIssues.push(
        unitDeclared
          ? "unit= is empty; write unit=UNIT, or add a condition such as <= 1.8."
          : `${quote(name)} has no condition; add one such as <= 1.8, or declare unit=, group= or label= to list the measurement without a limit.`,
      );
  }
  if (!/^[A-Za-z0-9_/%°µΩ.-]*$/u.test(unit)) {
    const refused = new Set(
      [...unit].filter((ch) => !/[A-Za-z0-9_/%°µΩ.-]/u.test(ch)),
    );
    unitProblems.push(
      /^".*"$/u.test(unit)
        ? `Write the unit without quotes: unit=${unit.slice(1, -1)}.`
        : `Unit ${quote(unit)} contains ${[...refused].map(quote).join(", ")}; use letters, digits and the characters _ / % ° µ Ω . - only.`,
    );
  }
  return {
    name,
    unit,
    expected,
    ...(label ? { label } : {}),
    ...(group ? { group } : {}),
    problems: [
      ...nameProblems,
      ...conditionIssues,
      ...unitProblems,
      ...groupProblems,
      ...labelProblems,
    ],
  };
}

/** A Spec annotation the run will refuse, located on its line. */
export interface SimulationSpecAnnotationDiagnostic {
  code: "SIMULATION_SPEC_INVALID";
  severity: "warning";
  message: string;
  path: string;
  sourceRef: SourceSpan;
}

/**
 * Check one source file's Spec annotations with the parser a run uses, so a
 * save and a run cannot disagree. The message is the `invalid-spec` detail
 * the run would report. A warning, not an error: an invalid rule never
 * prevents a run.
 */
export function simulationSpecAnnotationDiagnostics(
  path: string,
  text: string,
): SimulationSpecAnnotationDiagnostic[] {
  const diagnostics: SimulationSpecAnnotationDiagnostic[] = [];
  let offset = 0;
  text.split(/(?<=\n)/u).forEach((physical, index) => {
    const line = physical.replace(/\r?\n$/u, "");
    const problems = SIMULATION_SPEC_LINE.test(line)
      ? parseSimulationSpecAnnotation(line).problems
      : [];
    if (problems.length) {
      const start = line.length - line.trimStart().length;
      const end = line.trimEnd().length;
      diagnostics.push({
        code: "SIMULATION_SPEC_INVALID",
        severity: "warning",
        message: problems.join(" "),
        path,
        sourceRef: {
          fileId: path,
          start: { offset: offset + start, line: index + 1, column: start + 1 },
          end: { offset: offset + end, line: index + 1, column: end + 1 },
        },
      });
    }
    offset += physical.length;
  });
  return diagnostics;
}
