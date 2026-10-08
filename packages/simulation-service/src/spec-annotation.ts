import type { SourceSpan } from "@icm/model";
import type { SimulationSourceDiagnostic } from "@icm/netlist";
import { parseSpiceNumber, spiceScaleFactor } from "@icm/spice";
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
const SIMULATION_SPEC_LINE = /^\s*(?:\*|\/\/)\s*@spec\b/iu;

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

const SPICE_NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu;

/** The same number in the notation a Spec accepts, for a SPICE-suffixed one. */
function spiceSuffixReplacement(token: string): string | undefined {
  const parsed = parseSpiceNumber(token);
  if (!parsed?.suffix) return undefined;
  if (parsed.suffix === "mil")
    return String(Number(parsed.value.toPrecision(12)));
  const numeric = SPICE_NUMERIC.exec(token)![0];
  const [mantissa, exponent = "0"] = numeric.split(/e/iu);
  const scaled = (power: number) => `${mantissa}e${Number(exponent) + power}`;
  const power = Math.round(Math.log10(spiceScaleFactor(parsed.suffix)!));
  // SPICE reads M as milli; most other tools, VACASK among them, as mega.
  if (parsed.suffix === "m" && token[numeric.length] === "M")
    return `${scaled(power)} (SPICE reads M as milli) or ${scaled(6)} for mega`;
  return scaled(power);
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

const LIMIT_OPERATORS = ["<", "<=", ">", ">="] as const;
type LimitOperator = (typeof LIMIT_OPERATORS)[number];
const isLimitOperator = (op: string): op is LimitOperator =>
  (LIMIT_OPERATORS as readonly string[]).includes(op);

/**
 * Read the tokens after the name as one condition, or say why they are not
 * one. Each form is read once, so what a run accepts and what it explains
 * cannot drift apart.
 */
function parseCondition(tokens: readonly string[]): {
  condition: SimulationSpecCondition | null;
  problems: string[];
} {
  const refuse = (...problems: string[]) => ({ condition: null, problems });
  const misplaced = tokens.find((token) => token.startsWith("unit="));
  if (misplaced)
    return refuse(
      `${quote(misplaced)} is out of place; declare the unit once, after the condition.`,
    );
  const [op = "", a = "", b = "", c = ""] = tokens;
  const written = quote(tokens.join(" "));
  const glued = /^(<=|>=|<|>)([^=].*)$/u.exec(op);
  if (glued && tokens.length === 1)
    return refuse(
      `Condition ${written} needs a space after ${glued[1]}: write ${glued[1]} ${glued[2]}.`,
    );
  if (isLimitOperator(op)) {
    if (tokens.length !== 2)
      return refuse(
        `Condition ${written} is not ${op} N; write one bound after ${op}.`,
      );
    const problems = numberProblem("Bound", a);
    if (problems.length) return refuse(...problems);
    return {
      condition: { kind: "limit", operator: op, value: number(a)! },
      problems: [],
    };
  }
  if (op === "range") {
    if (tokens.length !== 3)
      return refuse(`Condition ${written} is not range MIN MAX.`);
    const problems = [
      ...numberProblem("Bound", a),
      ...numberProblem("Bound", b),
    ];
    if (problems.length) return refuse(...problems);
    const minimum = number(a)!;
    const maximum = number(b)!;
    if (minimum > maximum)
      return refuse(
        `Range ${a} ${b} has its minimum above its maximum; write range ${b} ${a}.`,
      );
    return { condition: { kind: "range", minimum, maximum }, problems: [] };
  }
  if (op === "target") {
    if (tokens.length !== 4 || b !== "tol")
      return refuse(`Condition ${written} is not target VALUE tol TOLERANCE.`);
    const problems = [
      ...numberProblem("Target", a),
      ...numberProblem("Tolerance", c),
    ];
    if (problems.length) return refuse(...problems);
    const tolerance = number(c)!;
    if (tolerance < 0)
      return refuse(
        `Tolerance ${c} is negative; write the absolute tolerance ${c.replace(/^-/u, "")}.`,
      );
    return {
      condition: { kind: "target", value: number(a)!, tolerance },
      problems: [],
    };
  }
  return refuse(`${quote(op)} does not start a condition; use ${CONDITIONS}.`);
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
  const parsedCondition = tokens.length ? parseCondition(tokens) : null;
  const expected = parsedCondition?.condition ?? null;

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
    nameProblems.push(
      !name
        ? "Name the measurement: write @spec NAME, then an optional condition, unit=, group= and label=."
        : name.startsWith("unit=")
          ? `Name the measurement before ${name}: write @spec NAME ${name}.`
          : `Name ${quote(name)} is not a measurement name; use letters, digits and underscores, starting with a letter or underscore.`,
    );
  if (!expected) {
    if (parsedCondition) conditionIssues.push(...parsedCondition.problems);
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
export type SimulationSpecAnnotationDiagnostic = SimulationSourceDiagnostic & {
  code: "SIMULATION_SPEC_INVALID";
  severity: "warning";
  path: string;
  sourceRef: SourceSpan;
};

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
