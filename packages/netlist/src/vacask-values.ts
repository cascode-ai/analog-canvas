import { parameterExpressionBody } from "@icm/devices";
import { inspectVacaskSource } from "./vacask-source.js";
import { vacaskProjectValue } from "./vacask-printer.js";

/** Native literal values, not an evaluator. dfllexer.l: M is mega, m is milli. */
export function vacaskNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (/^[+-]?0[xX][0-9a-fA-F]+$/u.test(text)) {
    const value =
      (text.startsWith("-") ? -1 : 1) * Number(text.replace(/^[+-]/u, ""));
    return Number.isFinite(value) ? value : undefined;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text))
    return Number.isFinite(Number(text)) ? Number(text) : undefined;
  const match =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(meg|mil|[munpfakKMGTxX])[A-Za-z_]*$/u.exec(
      text,
    );
  if (!match) return undefined;
  const scales: Record<string, number> = {
    meg: 1e6,
    mil: 25.4e-6,
    m: 1e-3,
    u: 1e-6,
    n: 1e-9,
    p: 1e-12,
    f: 1e-15,
    a: 1e-18,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    x: 1e6,
    X: 1e6,
  };
  const value = Number(match[1]) * scales[match[2]!]!;
  return Number.isFinite(value) ? value : undefined;
}

/** Reverse only the scalar subset owned by Canvas. Free authored VACASK files
 * are not restricted here. Never feed native suffixes directly to SPICE. */
export function vacaskValueToProject(text: string): string {
  const raw = text.trim();
  const number = vacaskNumber(raw);
  if (number !== undefined) return String(number);
  if (!raw || /[\r\n;{}'"\\]|\/\/|\/\*/u.test(raw))
    throw Error(
      "Finish a native scalar or parenthesized expression; statements and comments are not Circuit values.",
    );
  const prefix = "parameters value=";
  const inspected = inspectVacaskSource("value", prefix + raw);
  if (inspected.diagnostics.length || inspected.statements.length !== 1)
    throw Error("Finish the native parameter expression before applying.");
  let rest = raw,
    body = "",
    operand = true;
  const groups: boolean[] = [];
  const invalid = () => {
    throw Error(
      "Finish a reversible native scalar expression; adjacent operands and extra statements are not allowed.",
    );
  };
  while (rest) {
    const whitespace = /^\s+/u.exec(rest)?.[0];
    if (whitespace) {
      body += whitespace;
      rest = rest.slice(whitespace.length);
      continue;
    }
    const literal =
      /^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+|(?:meg|mil|[munpfakKMGTxX])[A-Za-z_]*)?)/u.exec(
        rest,
      )?.[0];
    if (literal) {
      const value = vacaskNumber(literal);
      if (!operand || value === undefined) invalid();
      body += String(value);
      rest = rest.slice(literal.length);
      operand = false;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest)?.[0];
    if (identifier) {
      if (!operand || /^(?:inf|nan)$/iu.test(identifier)) invalid();
      body += identifier;
      rest = rest.slice(identifier.length);
      const call = /^\s*\(/u.exec(rest)?.[0];
      if (call) {
        body += call;
        rest = rest.slice(call.length);
        groups.push(true);
      } else operand = false;
      continue;
    }
    const operator = /^(?:\*\*|&&|\|\||==|!=|<=|>=|[+\-*/!<>() ,])/u.exec(
      rest,
    )?.[0];
    if (!operator) invalid();
    if (operator === "(") {
      if (!operand) invalid();
      groups.push(false);
    } else if (operator === ")") {
      if (operand || !groups.length) invalid();
      groups.pop();
    } else if (operator === ",") {
      if (operand || groups.at(-1) !== true) invalid();
      operand = true;
    } else if (operand) {
      if (!["+", "-", "!"].includes(operator!)) invalid();
    } else {
      if (operator === "!") invalid();
      operand = true;
    }
    body += operator;
    rest = rest.slice(operator!.length);
  }
  if (operand || groups.length) invalid();
  if (body.startsWith("(") && body.endsWith(")")) {
    let depth = 0;
    const closesEarly = [...body].some((ch, i) => {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      return depth === 0 && i < body.length - 1;
    });
    if (!closesEarly) body = body.slice(1, -1);
  }
  const value = `{${body}}`;
  if (parameterExpressionBody(value) === undefined)
    throw Error(
      "This expression cannot be represented as a Canvas parameter; use an authored native file for free code.",
    );
  // The forward translator must accept it too, before any Project write.
  vacaskProjectValue(value);
  return value;
}
