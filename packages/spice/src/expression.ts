export interface SpiceNumber {
  raw: string;
  coefficient: number;
  suffix: string | null;
  trailingUnit: string;
  value: number;
}

const SCALE_FACTORS: Record<string, number> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  mil: 25.4e-6,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
};

const SPICE_NUMBER_PATTERN =
  /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?([a-z]*)$/iu;

export function parseSpiceNumber(raw: string): SpiceNumber | null {
  const match = SPICE_NUMBER_PATTERN.exec(raw.trim());
  if (!match) return null;
  const coefficient = Number(match[1]);
  if (!Number.isFinite(coefficient)) return null;
  const suffix = match[2]?.toLowerCase() ?? null;
  const factor = suffix ? SCALE_FACTORS[suffix]! : 1;
  return {
    raw,
    coefficient,
    suffix,
    trailingUnit: match[3] ?? "",
    value: coefficient * factor,
  };
}

/** Exact identity for literal comparison, not floating-point evaluation.
 * Share the evaluator's grammar, suffixes and ignored trailing unit text.
 * Keep decimal powers symbolic: even 1e400 never allocates 400 zeroes.
 * Over-budget literals are uncheckable, never rounded into an equality. */
export function canonicalSpiceNumber(raw: string): string | null {
  if (raw.length > 4096) return null;
  const match = SPICE_NUMBER_PATTERN.exec(raw.trim());
  if (!match) return null;
  const decimal = (text: string) => {
    const [coefficient, exponent = "0"] = text.toLowerCase().split("e");
    const fractionLength = coefficient!.split(".")[1]?.length ?? 0;
    return {
      digits: BigInt(coefficient!.replace(".", "")),
      exponent: BigInt(exponent) - BigInt(fractionLength),
    };
  };
  const coefficient = decimal(match[1]!);
  // These finite decimal constants are the existing SPICE scale authority,
  // including mil = 25.4e-6; no separate suffix table or numeric multiplication.
  const factor = decimal(
    String(SCALE_FACTORS[match[2]?.toLowerCase() ?? ""] ?? 1),
  );
  const product = coefficient.digits * factor.digits;
  if (product === 0n) return "0";
  const digits = product.toString();
  const significant = digits.replace(/0+$/u, "");
  const exponent =
    coefficient.exponent +
    factor.exponent +
    BigInt(digits.length - significant.length);
  return `${significant}e${exponent}`;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: string }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "comma" };

function tokenize(raw: string): Token[] | null {
  const text = raw
    .trim()
    .replace(/^\{([\s\S]*)\}$/u, "$1")
    .replace(/^'([\s\S]*)'$/u, "$1");
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number =
      /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpfa])?[a-z]*/iu.exec(
        rest,
      );
    if (number) {
      const parsed = parseSpiceNumber(number[0]);
      if (!parsed) return null;
      tokens.push({ kind: "number", value: parsed.value });
      index += number[0].length;
      continue;
    }
    const identifier = /^[a-z_][a-z0-9_.]*/iu.exec(rest);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const operator = /^(?:\|\||&&|==|!=|<=|>=|\*\*|[+\-*/\\%^!<>])/u.exec(rest);
    if (operator) {
      tokens.push({ kind: "operator", value: operator[0] });
      index += operator[0].length;
      continue;
    }
    if (rest[0] === "(") tokens.push({ kind: "left" });
    else if (rest[0] === ")") tokens.push({ kind: "right" });
    else if (rest[0] === ",") tokens.push({ kind: "comma" });
    else return null;
    index += 1;
  }
  return tokens;
}

const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "\\": 6,
  "%": 6,
  "^": 7,
  "**": 7,
};

function binary(operator: string, left: number, right: number): number | null {
  switch (operator) {
    case "||":
      return left !== 0 || right !== 0 ? 1 : 0;
    case "&&":
      return left !== 0 && right !== 0 ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "!=":
      return left !== right ? 1 : 0;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? null : left / right;
    case "\\":
      return right === 0 ? null : Math.trunc(left / right);
    case "%":
      return right === 0 ? null : left % right;
    case "^":
    case "**":
      return left ** right;
    default:
      return null;
  }
}

const FUNCTIONS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  int: Math.trunc,
  ln: Math.log,
  log: Math.log10,
  max: Math.max,
  min: Math.min,
  nint: Math.round,
  pow: Math.pow,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

export function evaluateSpiceExpression(
  raw: string,
  symbols: ReadonlyMap<string, number> | Record<string, number> = {},
): number | null {
  const tokens = tokenize(raw);
  if (!tokens) return null;
  const expressionTokens = tokens;
  const symbolMap =
    symbols instanceof Map
      ? symbols
      : new Map(
          Object.entries(symbols).map(([name, value]) => [
            name.toLowerCase(),
            value,
          ]),
        );
  let cursor = 0;

  function primary(): number | null {
    const token = expressionTokens[cursor];
    if (!token) return null;
    if (token.kind === "operator" && ["+", "-", "!"].includes(token.value)) {
      cursor += 1;
      const value = primary();
      if (value === null) return null;
      if (token.value === "+") return value;
      if (token.value === "-") return -value;
      return value === 0 ? 1 : 0;
    }
    if (token.kind === "number") {
      cursor += 1;
      return token.value;
    }
    if (token.kind === "left") {
      cursor += 1;
      const value = expression(1);
      if (expressionTokens[cursor]?.kind !== "right") return null;
      cursor += 1;
      return value;
    }
    if (token.kind !== "identifier") return null;
    cursor += 1;
    const name = token.value.toLowerCase();
    if (expressionTokens[cursor]?.kind !== "left")
      return symbolMap.get(name) ?? null;
    cursor += 1;
    const values: number[] = [];
    if (expressionTokens[cursor]?.kind !== "right") {
      while (true) {
        const value = expression(1);
        if (value === null) return null;
        values.push(value);
        if (expressionTokens[cursor]?.kind !== "comma") break;
        cursor += 1;
      }
    }
    if (expressionTokens[cursor]?.kind !== "right") return null;
    cursor += 1;
    const implementation = FUNCTIONS[name];
    if (!implementation) return null;
    const result = implementation(...values);
    return Number.isFinite(result) ? result : null;
  }

  function expression(minimumPrecedence: number): number | null {
    let left = primary();
    if (left === null) return null;
    while (true) {
      const token = expressionTokens[cursor];
      if (token?.kind !== "operator") break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minimumPrecedence) break;
      cursor += 1;
      const right = expression(
        token.value === "^" || token.value === "**"
          ? precedence
          : precedence + 1,
      );
      if (right === null) return null;
      left = binary(token.value, left, right);
      if (left === null || !Number.isFinite(left)) return null;
    }
    return left;
  }

  const value = expression(1);
  return value !== null && cursor === expressionTokens.length ? value : null;
}

export function expressionIsStructurallyValid(raw: string): boolean {
  const tokens = tokenize(raw);
  if (!tokens) return false;
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "left") depth += 1;
    if (token.kind === "right") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
