/** Native scalar expressions cannot replace point lists or derived digital-clock controls. */
export function supportsScalarParameterExpression(
  symbolId: string,
  parameter: string,
): boolean {
  return parameter !== "pwlPoints" && symbolId !== "pulse-voltage-source";
}

/**
 * Recognize one delimited native parameter expression, without evaluating it.
 * Unknown parameters/functions belong to ngspice. Card delimiters and unfinished
 * grouping do not belong inside a reversible Circuit parameter slot.
 */
export function parameterExpressionBody(value: string): string | undefined {
  const text = value.trim();
  if (!(
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ))
    return undefined;
  const body = text.slice(1, -1).trim();
  if (
    !body ||
    /[\r\n;"'$\\]/u.test(body) ||
    /[+*/%^=<>!&|?:,-]\s*$/u.test(body)
  )
    return undefined;
  const stack: string[] = [];
  for (const char of body) {
    if (char === "(" || char === "{") stack.push(char);
    else if (char === ")" || char === "}") {
      if (stack.pop() !== (char === ")" ? "(" : "{")) return undefined;
    } else if (!/[A-Za-z0-9_.,+\-*/%^=<>!&|?:\s]/u.test(char)) return undefined;
  }
  return stack.length ? undefined : body;
}

/** Conservative lexical references, including repairable incomplete slots. */
export function parameterReferences(value: string): readonly {
  name: string;
  from: number;
  to: number;
}[] {
  const result: { name: string; from: number; to: number }[] = [];
  // Numbers consume exponent and unit suffixes before identifier recognition.
  const tokens =
    /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?[A-Za-z]*|[A-Za-z_][A-Za-z0-9_.]*/giu;
  for (const match of value.matchAll(tokens)) {
    const name = match[0];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) continue;
    const from = match.index;
    const to = from + name.length;
    if (/^\s*\(/u.test(value.slice(to))) continue;
    result.push({ name, from, to });
  }
  return result;
}

/** Retain expression spelling, delimiters and whitespace outside renamed tokens. */
export function renameParameterReference(
  value: string,
  from: string,
  to: string,
): string {
  const references = parameterReferences(value).filter(
    (reference) => reference.name.toLowerCase() === from.toLowerCase(),
  );
  if (!references.length) return value;
  const delimited = /^[{']/u.test(value.trim());
  if (parameterExpressionBody(delimited ? value : `{${value}}`) === undefined)
    throw new Error(
      `Cannot safely rename a reference in unsupported parameter syntax: ${value}`,
    );
  let result = value;
  for (const reference of [...references].reverse()) {
    result = result.slice(0, reference.from) + to + result.slice(reference.to);
  }
  return result;
}
