import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";
import {
  flattenRichText,
  normalizeRichText,
  rewriteRichTextPlainText,
} from "./rich-text.js";

/** Electrical spelling of a styled identifier. Only subscript affects names;
 * weight, slant, color, overbars and superscripts remain presentation. */
export function richTextIdentifier(content: RichTextDocument): string {
  let result = "";
  let previousSubscript = false;
  const visit = (runs: readonly RichTextRun[], subscript = false): void => {
    for (const run of runs) {
      if (run.kind === "span")
        visit(run.children, subscript || run.style === "subscript");
      else {
        const value = flattenRichText({ runs: [run] });
        if (!value) continue;
        if (subscript && !previousSubscript && !result.endsWith("_"))
          result += "_";
        result += value;
        previousSubscript = subscript;
      }
    }
  };
  visit(content.runs);
  return result;
}

/** Legacy explicit formatting can omit the separator; never reinterpret its
 * stored source name merely by opening a historical drawing. */
export function richTextPresentsIdentifier(
  content: RichTextDocument,
  name: string,
): boolean {
  return (
    richTextIdentifier(content) === name || flattenRichText(content) === name
  );
}

/** Underscores, not guessed leading letters, introduce the default subscript. */
export function identifierTextDocument(name: string): RichTextDocument {
  if (!name) return { runs: [{ kind: "line-break" }] };
  const split = name.indexOf("_");
  const styled = (value: string): RichTextRun => ({
    kind: "span",
    style: "italic",
    children: [
      { kind: "span", style: "bold", children: [{ kind: "text", value }] },
    ],
  });
  return {
    runs:
      split > 0 && split < name.length - 1
        ? [
            styled(name.slice(0, split)),
            {
              kind: "span",
              style: "subscript",
              children: [styled(name.slice(split + 1))],
            },
          ]
        : [styled(name)],
  };
}

/** Rename while retaining authored non-name typography. Reconstruct script
 * boundaries from the actual name so removing '_' also removes its subscript. */
export function rewriteRichTextIdentifier(
  content: RichTextDocument,
  name: string,
): RichTextDocument {
  const visible = name.replace(/(?<=.)_(?=.)/u, "");
  const rewritten = rewriteRichTextPlainText(content, visible);
  const split = name.indexOf("_");
  const scriptStart = split > 0 && split < name.length - 1 ? split : Infinity;
  let offset = 0;
  const groups: { value: string; styles: RichTextStyle[] }[] = [];
  const collect = (
    runs: readonly RichTextRun[],
    styles: RichTextStyle[] = [],
  ): void => {
    for (const run of runs) {
      if (run.kind === "span") {
        collect(
          run.children,
          ["subscript", "uppercase", "lowercase"].includes(run.style)
            ? styles
            : [...new Set([...styles, run.style])],
        );
      } else if (run.kind === "text") {
        for (const value of run.value) {
          const next: RichTextStyle[] =
            offset++ >= scriptStart ? ["subscript", ...styles] : styles;
          const previous = groups.at(-1);
          if (
            previous &&
            JSON.stringify(previous.styles) === JSON.stringify(next)
          )
            previous.value += value;
          else groups.push({ value, styles: next });
        }
      }
    }
  };
  collect(rewritten.runs);
  return normalizeRichText({
    runs: groups.map(({ value, styles }) => {
      let run: RichTextRun = { kind: "text", value };
      for (const style of [...styles].reverse())
        run = { kind: "span", style, children: [run] };
      return run;
    }),
  });
}

export type LabelSubscriptCase = "preserve" | "uppercase" | "lowercase";
export function identifierSubscriptCase(
  name: string,
  mode: LabelSubscriptCase,
): string {
  const index = name.indexOf("_");
  if (index < 0 || mode === "preserve") return name;
  const suffix = name.slice(index + 1);
  return (
    name.slice(0, index + 1) +
    (mode === "uppercase" ? suffix.toUpperCase() : suffix.toLowerCase())
  );
}
