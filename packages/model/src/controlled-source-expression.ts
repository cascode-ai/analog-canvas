import type { RichTextDocument, RichTextRun } from "./schema.js";

export type LinearControlledSourceKind = "vcvs" | "vccs" | "cccs" | "ccvs";

export const LINEAR_CONTROLLED_SOURCE_KINDS = new Set<string>([
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
]);

/** Drawing-only copy; neither its spelling nor its formatting binds a Net. */
export function defaultControlledSourceExpression(
  kind: LinearControlledSourceKind,
  ordinal = "",
): string {
  const inputVoltage = `v_{${ordinal || "i"}}`;
  const sensedCurrent = `i_{${ordinal || "x"}}`;
  switch (kind) {
    case "vcvs":
      return `A_{v}${inputVoltage}`;
    case "vccs":
      return `g_{m}${inputVoltage}`;
    case "cccs":
      return `β${sensedCurrent}`;
    case "ccvs":
      return `R_{m}${sensedCurrent}`;
  }
}

/** The same RichText spans and subscript renderer used by other canvas labels. */
export function controlledSourceExpressionDocument(
  source: string,
): RichTextDocument {
  const runs: RichTextRun[] = [];
  const scripted = /_\{([^{}]+)\}|_([^\s{}])/gu;
  let last = 0;
  const base = (value: string): RichTextRun => ({
    kind: "span",
    style: "italic",
    children: [
      {
        kind: "span",
        style: "bold",
        children: [{ kind: "text", value }],
      },
    ],
  });
  for (const match of source.matchAll(scripted)) {
    const offset = match.index ?? 0;
    if (offset > last) runs.push(base(source.slice(last, offset)));
    runs.push({
      kind: "span",
      style: "subscript",
      children: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: match[1] ?? match[2] ?? "" }],
        },
      ],
    });
    last = offset + match[0].length;
  }
  if (last < source.length) runs.push(base(source.slice(last)));
  return { runs: runs.length ? runs : [{ kind: "line-break" }] };
}

/** Expose a script-aware JSON spelling for directly edited RichText. */
export function controlledSourceExpressionSource(
  content: RichTextDocument,
): string {
  const visit = (runs: readonly RichTextRun[], subscript = false): string =>
    runs
      .map((run) => {
        if (run.kind === "text") return run.value;
        if (run.kind === "line-break") return " ";
        if (run.kind !== "span") return "";
        const text = visit(
          run.children,
          subscript || run.style === "subscript",
        );
        return run.style === "subscript" && !subscript ? `_{${text}}` : text;
      })
      .join("");
  return visit(content.runs).trim();
}
