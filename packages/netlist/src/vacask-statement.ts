import type { VacaskSourceStatement } from "./vacask-source.js";

/** Top-level assignment spans; expressions remain simulator-owned. */
export function vacaskAssignments(statement: VacaskSourceStatement) {
  const tokens = statement.tokens;
  const starts: number[] = [];
  let depth = 0;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!depth && token.kind === "word" && tokens[i + 1]?.value === "=")
      starts.push(i);
    if (token.kind === "symbol" && ["(", "[", "{"].includes(token.value))
      depth++;
    if (token.kind === "symbol" && [")", "]", "}"].includes(token.value))
      depth--;
  }
  return starts.map((index, i) => ({
    name: tokens[index]!.value,
    start: tokens[index + 2]?.start ?? tokens[index + 1]!.end,
    end: tokens[(starts[i + 1] ?? tokens.length) - 1]!.end,
  }));
}

export function isVacaskStatement(
  statement: VacaskSourceStatement,
  name: string,
) {
  const first = statement.tokens[0];
  return (
    first?.kind === "word" &&
    first.value === name &&
    statement.rawText.slice(0, first.end - first.start) === name
  );
}
