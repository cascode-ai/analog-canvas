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
