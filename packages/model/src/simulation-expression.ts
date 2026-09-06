import type { SimulationExpression } from "./schema/simulation.js";

export type SimulationExpressionParseResult =
  | { readonly ok: true; readonly expression: SimulationExpression }
  | {
      readonly ok: false;
      readonly code: "SYNTAX" | "UNKNOWN_SYMBOL" | "UNKNOWN_FUNCTION";
      readonly message: string;
      readonly offset: number;
    };

type Token =
  | { kind: "number"; text: string; offset: number }
  | { kind: "identifier"; text: string; offset: number }
  | {
      kind: "operator";
      text: "+" | "-" | "*" | "/" | "(" | ")";
      offset: number;
    }
  | { kind: "end"; text: ""; offset: number };

function tokenize(source: string): Token[] | SimulationExpressionParseResult {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (/\s/u.test(source[offset]!)) {
      offset++;
      continue;
    }
    const rest = source.slice(offset);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(rest)?.[0];
    if (number) {
      tokens.push({ kind: "number", text: number, offset });
      offset += number.length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest)?.[0];
    if (identifier) {
      tokens.push({ kind: "identifier", text: identifier, offset });
      offset += identifier.length;
      continue;
    }
    const operator = source[offset];
    if (operator && "+-*/()".includes(operator)) {
      tokens.push({
        kind: "operator",
        text: operator as Extract<Token, { kind: "operator" }>["text"],
        offset,
      });
      offset++;
      continue;
    }
    return {
      ok: false,
      code: "SYNTAX",
      message: `Unexpected character ${JSON.stringify(source[offset])}`,
      offset,
    };
  }
  tokens.push({ kind: "end", text: "", offset: source.length });
  return tokens;
}

const unaryFunctions = new Map<
  string,
  Extract<SimulationExpression, { operand: SimulationExpression }>["kind"]
>([
  ["mag", "magnitude"],
  ["magnitude", "magnitude"],
  ["abs", "absolute"],
  ["db20", "db20"],
  ["phase", "phase"],
  ["real", "real"],
  ["imag", "imaginary"],
  ["imaginary", "imaginary"],
]);

/** Parse a bounded arithmetic expression whose names resolve to stable leaves. */
export function parseSimulationExpression(
  source: string,
  symbols: ReadonlyMap<string, SimulationExpression>,
): SimulationExpressionParseResult {
  const tokenized = tokenize(source);
  if (!Array.isArray(tokenized)) return tokenized;
  const tokens = tokenized;
  let index = 0;
  let failure: Exclude<SimulationExpressionParseResult, { ok: true }> | null =
    null;
  const current = () => tokens[index]!;
  const fail = (
    code: Exclude<SimulationExpressionParseResult, { ok: true }>["code"],
    message: string,
    offset = current().offset,
  ) => {
    failure ??= { ok: false, code, message, offset };
    return null;
  };
  const primary = (): SimulationExpression | null => {
    const token = current();
    if (token.kind === "number") {
      index++;
      return { kind: "constant", value: Number(token.text) };
    }
    if (token.kind === "operator" && token.text === "-") {
      index++;
      const operand = primary();
      return operand ? { kind: "negate", operand } : null;
    }
    if (token.kind === "operator" && token.text === "(") {
      index++;
      const expression = additive();
      if (current().kind !== "operator" || current().text !== ")")
        return fail("SYNTAX", "Expected closing parenthesis");
      index++;
      return expression;
    }
    if (token.kind === "identifier") {
      index++;
      if (current().kind === "operator" && current().text === "(") {
        const kind = unaryFunctions.get(token.text.toLowerCase());
        if (!kind)
          return fail(
            "UNKNOWN_FUNCTION",
            `Unknown function ${token.text}`,
            token.offset,
          );
        index++;
        const operand = additive();
        if (current().kind !== "operator" || current().text !== ")")
          return fail(
            "SYNTAX",
            `Expected closing parenthesis after ${token.text}`,
          );
        index++;
        return operand ? { kind, operand } : null;
      }
      const match = [...symbols.entries()].find(
        ([name]) => name.toLowerCase() === token.text.toLowerCase(),
      )?.[1];
      return match
        ? structuredClone(match)
        : fail("UNKNOWN_SYMBOL", `Unknown output ${token.text}`, token.offset);
    }
    return fail("SYNTAX", "Expected a number, output name, or expression");
  };
  const multiplicative = (): SimulationExpression | null => {
    let left = primary();
    while (
      current().kind === "operator" &&
      (current().text === "*" || current().text === "/")
    ) {
      const operator = current().text;
      index++;
      const right = primary();
      if (!left || !right) return null;
      left = { kind: operator === "*" ? "multiply" : "divide", left, right };
    }
    return left;
  };
  const additive = (): SimulationExpression | null => {
    let left = multiplicative();
    while (
      current().kind === "operator" &&
      (current().text === "+" || current().text === "-")
    ) {
      const operator = current().text;
      index++;
      const right = multiplicative();
      if (!left || !right) return null;
      left = { kind: operator === "+" ? "add" : "subtract", left, right };
    }
    return left;
  };
  const expression = additive();
  if (!failure && current().kind !== "end")
    fail("SYNTAX", `Unexpected token ${current().text}`);
  return (
    failure ??
    (expression
      ? { ok: true, expression }
      : {
          ok: false,
          code: "SYNTAX",
          message: "Expression is empty",
          offset: 0,
        })
  );
}

export function simulationExpressionDependencies(
  expression: SimulationExpression,
): readonly Extract<SimulationExpression, { kind: "voltage" | "current" }>[] {
  if (expression.kind === "voltage" || expression.kind === "current")
    return [expression];
  if (expression.kind === "constant") return [];
  if ("operand" in expression)
    return simulationExpressionDependencies(expression.operand);
  return [
    ...simulationExpressionDependencies(expression.left),
    ...simulationExpressionDependencies(expression.right),
  ];
}
