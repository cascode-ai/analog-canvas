import { inspectSimulationSourceGraph } from "@icm/netlist";
import { parseSpiceNumber } from "@icm/spice";
import type { SimulationProbe } from "@icm/spice-run";
import type { OutputSemantics } from "./contract.js";

type Meaning = {
  valueKind: OutputSemantics["valueKind"];
  unit: string;
  constant?: number;
};
export type NativeDeclarations = ReadonlyMap<string, string | null>;
const unknown = (): Meaning => ({ valueKind: "unknown", unit: "" });

/** Only reached source is evidence. Conflicting assignments are deliberately ambiguous:
 * we do not pretend to execute loops, branches, setplot or the ngspice interpreter. */
export function nativeOutputDeclarations(
  files: readonly { path: string; text: string }[],
  entry: string,
): NativeDeclarations {
  const graph = inspectSimulationSourceGraph({
    kind: "source",
    entry,
    configPath: "experiment.json",
    files: [...files],
    circuitBindings: [],
    dependencies: [],
  });
  const declarations = new Map<string, string | null>();
  const firstAssignments = new Map<string, number>();
  let dynamic = false;
  for (const { statement } of graph.statements) {
    if (statement.kind !== "control_command") continue;
    const command = statement.command.toLowerCase();
    if (
      [
        "if",
        "while",
        "dowhile",
        "repeat",
        "foreach",
        "goto",
        "settype",
        "destroy",
        "unset",
      ].includes(command)
    )
      dynamic = true;
    if (command !== "let") continue;
    const match = /^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/iu.exec(
      statement.arguments.join(" "),
    );
    if (!match) continue;
    const key = match[1]!.toLowerCase(),
      expression = match[2]!.trim();
    if (!firstAssignments.has(key))
      firstAssignments.set(key, firstAssignments.size);
    declarations.set(
      key,
      declarations.has(key) && declarations.get(key) !== expression
        ? null
        : expression,
    );
  }
  for (const [name, expression] of declarations) {
    // A future declaration is not evidence for a value captured earlier.
    const forwardReference = expression
      ?.match(/[a-z_][a-z0-9_]*/giu)
      ?.some(
        (token) =>
          (firstAssignments.get(token.toLowerCase()) ?? -1) >=
          firstAssignments.get(name)!,
      );
    if (dynamic || forwardReference) declarations.set(name, null);
  }
  return declarations;
}

/** A bounded semantic reader, never a second numeric evaluator. Unsupported syntax
 * stays unknown, and vector spellings (_db, _deg, etc.) carry no authority. */
export function inferNativeExpression(
  text: string,
  resolve: (name: string) => Meaning,
  depth = 0,
): Meaning {
  if (depth > 32 || text.length > 8192) return unknown();
  const expression = text.trim();
  if (!expression) return unknown();
  const recurse = (s: string) => inferNativeExpression(s, resolve, depth + 1);
  let nesting = 0;
  const splits: { index: number; operator: string }[] = [];
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i]!;
    if (c === "(") nesting++;
    else if (c === ")") {
      if (--nesting < 0) return unknown();
    } else if (!nesting && "+-*/".includes(c)) {
      const prefix = expression.slice(0, i).trimEnd();
      if (!prefix || /[+\-*/(]$/u.test(prefix) || /\d[eE]$/u.test(prefix))
        continue;
      splits.push({ index: i, operator: c });
    }
  }
  if (nesting) return unknown();
  const split =
    splits.filter((s) => "+-".includes(s.operator)).at(-1) ?? splits.at(-1);
  if (split) {
    const left = recurse(expression.slice(0, split.index)),
      right = recurse(expression.slice(split.index + 1));
    const op = split.operator;
    if (left.constant !== undefined && right.constant !== undefined) {
      const n =
        op === "+"
          ? left.constant + right.constant
          : op === "-"
            ? left.constant - right.constant
            : op === "*"
              ? left.constant * right.constant
              : left.constant / right.constant;
      return Number.isFinite(n)
        ? { valueKind: "real", unit: "1", constant: n }
        : unknown();
    }
    const valueKind =
      left.valueKind === "unknown" || right.valueKind === "unknown"
        ? "unknown"
        : left.valueKind === "complex" || right.valueKind === "complex"
          ? "complex"
          : "real";
    if (!left.unit || !right.unit) return { valueKind, unit: "" };
    if (op === "+" || op === "-")
      return { valueKind, unit: left.unit === right.unit ? left.unit : "" };
    // The conventional explicit radians-to-degrees conversion, not a name heuristic.
    if (
      op === "*" &&
      ((left.unit === "rad" &&
        right.constant !== undefined &&
        Math.abs(right.constant - 180 / Math.PI) < 1e-10) ||
        (right.unit === "rad" &&
          left.constant !== undefined &&
          Math.abs(left.constant - 180 / Math.PI) < 1e-10))
    )
      return { valueKind, unit: "deg" };
    if (op === "*")
      return {
        valueKind,
        unit:
          left.unit === "1"
            ? right.unit
            : right.unit === "1"
              ? left.unit
              : `${left.unit}·${right.unit}`,
      };
    return {
      valueKind,
      unit:
        left.unit === right.unit
          ? "1"
          : right.unit === "1"
            ? left.unit
            : `${left.unit}/${right.unit}`,
    };
  }
  if (expression.startsWith("(") && expression.endsWith(")"))
    return recurse(expression.slice(1, -1));
  if (/^[+-]/u.test(expression)) {
    const value = recurse(expression.slice(1));
    return value.constant === undefined
      ? value
      : {
          ...value,
          constant: expression[0] === "-" ? -value.constant : value.constant,
        };
  }
  const numeric = parseSpiceNumber(expression);
  if (numeric && !numeric.trailingUnit)
    return { valueKind: "real", unit: "1", constant: numeric.value };
  if (expression.toLowerCase() === "pi")
    return { valueKind: "real", unit: "1", constant: Math.PI };
  const call = /^([a-z_][a-z0-9_]*)\((.*)\)$/iu.exec(expression);
  if (call) {
    const name = call[1]!.toLowerCase(),
      operandText = call[2]!;
    if (name === "v" || name === "i") return resolve(expression.toLowerCase());
    const operand = recurse(operandText);
    if (name === "db") return { valueKind: "real", unit: "dB" };
    if (name === "ph" || name === "cph")
      return { valueKind: "real", unit: "rad" };
    if (["real", "imag", "mag", "abs"].includes(name))
      return { valueKind: "real", unit: operand.unit };
    return unknown();
  }
  return /^[a-z_][a-z0-9_]*$/iu.test(expression)
    ? resolve(expression.toLowerCase())
    : unknown();
}

export function nativeProbeMeaning(
  probe: SimulationProbe,
  probes: readonly SimulationProbe[],
  ac: boolean,
  declarations: NativeDeclarations,
): { unit: string; semantics: OutputSemantics } {
  const visited = new Set<string>();
  const meanings = new Map<string, Meaning>();
  const byName = new Map(probes.map((p) => [p.name.toLowerCase(), p]));
  function resolve(name: string): Meaning {
    const cached = meanings.get(name);
    if (cached) return cached;
    if (visited.has(name) || visited.size >= 32) return unknown();
    if (declarations.has(name)) {
      const expression = declarations.get(name);
      if (!expression) return unknown();
      visited.add(name);
      const value = inferNativeExpression(expression, resolve);
      visited.delete(name);
      meanings.set(name, value);
      return value;
    }
    const raw = byName.get(name);
    if (!raw) return unknown();
    const quantity = raw.quantity.toLowerCase();
    if (quantity === "decibel") return { valueKind: "real", unit: "dB" };
    if (quantity === "phase") return { valueKind: "real", unit: "rad" };
    if (!ac) return { valueKind: "real", unit: raw.unit ?? "" };
    // Physical acquisitions remain complex even with an entirely zero imaginary array.
    if (/^(?:v|i)\(.+\)$/iu.test(name) || name.startsWith("@"))
      return { valueKind: "complex", unit: raw.unit ?? "" };
    return unknown();
  }
  const expression = declarations.get(probe.name.toLowerCase());
  const meaning = resolve(probe.name.toLowerCase());
  return {
    unit: meaning.unit,
    semantics: {
      valueKind: meaning.valueKind,
      quantity: probe.quantity,
      origin: declarations.has(probe.name.toLowerCase()) ? "expression" : "raw",
      ...(expression ? { expression } : {}),
    },
  };
}
