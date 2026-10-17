import type { RichTextDocument, RichTextRun } from "@icm/model";

/** How a run of RNL text is styled (language standard 13.6): as rnl's Document has it. */
export interface RnlRunStyle {
  /** Each superscript adds 1, each subscript takes 1 away. */
  level: number;
  bold: boolean;
  italic: boolean;
  overline: boolean;
}

/** A run of RNL text, or a fraction of two runs of runs. */
export type RnlRun =
  | { kind: "text"; text: string; style: RnlRunStyle }
  | { kind: "frac"; num: RnlRun[]; den: RnlRun[]; style: RnlRunStyle };

const PLAIN: RnlRunStyle = {
  level: 0,
  bold: false,
  italic: false,
  overline: false,
};

/** A plain one-line text as RNL lines of runs. */
export const plainLines = (text: string): RnlRun[][] => [
  [{ kind: "text", text, style: PLAIN }],
];

type Casing = "lowercase" | "uppercase" | null;

/**
 * An Analog Canvas rich text as RNL lines of runs. rnl writes them as text
 * markup, so this side never spells markup. A formula has no structured RNL
 * form here: its LaTeX source becomes plain text and is counted.
 */
export function rnlTextLines(text: RichTextDocument): {
  lines: RnlRun[][];
  formulas: number;
} {
  const lines: RnlRun[][] = [[]];
  let formulas = 0;
  const push = (line: RnlRun[], run: RnlRun) => {
    const last = line.at(-1);
    if (
      run.kind === "text" &&
      last?.kind === "text" &&
      sameStyle(last.style, run.style)
    )
      line[line.length - 1] = { ...last, text: last.text + run.text };
    else line.push(run);
  };
  const walk = (
    runs: readonly RichTextRun[],
    style: RnlRunStyle,
    casing: Casing,
    out: () => RnlRun[],
    lineBreak: () => void,
  ) => {
    for (const run of runs) {
      switch (run.kind) {
        case "text":
          push(out(), { kind: "text", text: cased(run.value, casing), style });
          break;
        case "line-break":
          lineBreak();
          break;
        case "math":
          formulas += 1;
          push(out(), { kind: "text", text: run.latex, style });
          break;
        case "span":
          walk(
            run.children,
            styled(style, run.style),
            run.style === "lowercase" || run.style === "uppercase"
              ? run.style
              : casing,
            out,
            lineBreak,
          );
          break;
        case "fraction": {
          const part = (document: RichTextDocument) => {
            const runs: RnlRun[] = [];
            walk(
              document.runs,
              PLAIN,
              casing,
              () => runs,
              () => undefined,
            );
            return runs;
          };
          out().push({
            kind: "frac",
            num: part(run.numerator),
            den: part(run.denominator),
            style,
          });
          break;
        }
      }
    }
  };
  walk(
    text.runs,
    PLAIN,
    null,
    () => lines.at(-1)!,
    () => lines.push([]),
  );
  while (lines.length > 1 && lines.at(-1)!.length === 0) lines.pop();
  while (lines.length > 1 && lines[0]!.length === 0) lines.shift();
  return { lines, formulas };
}

/**
 * RNL lines of runs as an Analog Canvas rich text, as `rnlTextLines` reads
 * one: each run in its spans, bold outside italic outside overbar outside
 * its scripts, and the lines broken where RNL breaks them. Null when there
 * is nothing to show.
 */
export function acRichText(
  lines: readonly (readonly RnlRun[])[],
): RichTextDocument | null {
  const runs: RichTextRun[] = [];
  lines.forEach((line, index) => {
    if (index) runs.push({ kind: "line-break" });
    for (const run of line) {
      if (run.kind === "text") {
        if (run.text)
          runs.push(spanned({ kind: "text", value: run.text }, run.style));
        continue;
      }
      const numerator = acRichText([run.num]);
      const denominator = acRichText([run.den]);
      if (numerator && denominator)
        runs.push(
          spanned({ kind: "fraction", numerator, denominator }, run.style),
        );
    }
  });
  return runs.some((run) => run.kind !== "line-break") ? { runs } : null;
}

/**
 * A run in the spans its style names: italic innermost, then bold, then the
 * scripts, then the overbar. A script stands outside bold as the editor
 * keeps it, since a subscript wrapped in bold is no longer stacked with the
 * superscript after it.
 */
function spanned(run: RichTextRun, style: RnlRunStyle): RichTextRun {
  let out = run;
  if (style.italic) out = { kind: "span", style: "italic", children: [out] };
  if (style.bold) out = { kind: "span", style: "bold", children: [out] };
  const script = style.level < 0 ? "subscript" : "superscript";
  for (let step = 0; step < Math.abs(style.level); step++)
    out = { kind: "span", style: script, children: [out] };
  if (style.overline) out = { kind: "span", style: "overbar", children: [out] };
  return out;
}

function styled(style: RnlRunStyle, mark: string): RnlRunStyle {
  switch (mark) {
    case "italic":
      return { ...style, italic: true };
    case "bold":
      return { ...style, bold: true };
    case "subscript":
      return { ...style, level: style.level - 1 };
    case "superscript":
      return { ...style, level: style.level + 1 };
    case "overbar":
      return { ...style, overline: true };
    default:
      return style;
  }
}

function cased(text: string, casing: Casing): string {
  if (casing === "lowercase") return text.toLowerCase();
  if (casing === "uppercase") return text.toUpperCase();
  return text;
}

function sameStyle(a: RnlRunStyle, b: RnlRunStyle): boolean {
  return (
    a.level === b.level &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.overline === b.overline
  );
}
