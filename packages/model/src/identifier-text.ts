import type { RichTextDocument, RichTextRun, RichTextStyle } from "./schema.js";
import {
  flattenRichText,
  normalizeRichText,
  rewriteRichTextPlainText,
} from "./rich-text.js";

/** Electrical spelling of a styled identifier: subscripts introduce `_`, and
 * an overbar marks the whole identifier with a trailing `_bar`. Weight,
 * slant, color and superscripts remain presentation. */
export function richTextIdentifier(content: RichTextDocument): string {
  let result = "";
  let previousSubscript = false;
  let hasOverbar = false;
  const visit = (
    runs: readonly RichTextRun[],
    subscript = false,
    overbar = false,
  ): void => {
    for (const run of runs) {
      if (run.kind === "span")
        visit(
          run.children,
          subscript || run.style === "subscript",
          overbar || run.style === "overbar",
        );
      else {
        const value = flattenRichText({ runs: [run] });
        if (!value) continue;
        hasOverbar ||= overbar;
        if (subscript && !previousSubscript && !result.endsWith("_"))
          result += "_";
        result += value;
        previousSubscript = subscript;
      }
    }
  };
  visit(content.runs);
  return result + (hasOverbar ? "_bar" : "");
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

function identifierParts(name: string): { body: string; overbar: boolean } {
  const overbar = name.length > 4 && name.endsWith("_bar");
  return { body: overbar ? name.slice(0, -4) : name, overbar };
}

/** A terminal `_bar` becomes an overbar; the first remaining underscore
 * introduces the default subscript. No spelling is guessed from leading letters. */
export function identifierTextDocument(name: string): RichTextDocument {
  if (!name) return { runs: [{ kind: "line-break" }] };
  const { body, overbar } = identifierParts(name);
  const split = body.indexOf("_");
  const styled = (value: string): RichTextRun => ({
    kind: "span",
    style: "italic",
    children: [
      { kind: "span", style: "bold", children: [{ kind: "text", value }] },
    ],
  });
  const runs: RichTextRun[] =
    split > 0 && split < body.length - 1
      ? [
          styled(body.slice(0, split)),
          {
            kind: "span",
            style: "subscript",
            children: [styled(body.slice(split + 1))],
          },
        ]
      : [styled(body)];
  return {
    runs: overbar ? [{ kind: "span", style: "overbar", children: runs }] : runs,
  };
}

/** Rename while retaining authored non-name typography. Reconstruct script
 * boundaries and the overbar from the actual name. */
export function rewriteRichTextIdentifier(
  content: RichTextDocument,
  name: string,
): RichTextDocument {
  const { body, overbar } = identifierParts(name);
  const visible = body.replace(/(?<=.)_(?=.)/u, "");
  const rewritten = rewriteRichTextPlainText(content, visible);
  const split = body.indexOf("_");
  const scriptStart =
    split > 0 && split < body.length - 1
      ? [...body.slice(0, split)].length
      : Infinity;
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
          [
            "subscript",
            "uppercase",
            "lowercase",
            ...(!overbar ? ["overbar"] : []),
          ].includes(run.style)
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
  // Keep a partial authored bar where it was. A whole-name bar belongs outside
  // all styled runs so renaming a subscript does not split its horizontal line.
  const wrapOverbar =
    overbar &&
    (!groups.some(({ styles }) => styles.includes("overbar")) ||
      groups.every(({ styles }) => styles.includes("overbar")));
  const runs = groups.map(({ value, styles }) => {
    let run: RichTextRun = { kind: "text", value };
    for (const style of [...styles].reverse()) {
      if (wrapOverbar && style === "overbar") continue;
      run = { kind: "span", style, children: [run] };
    }
    return run;
  });
  return normalizeRichText({
    runs: wrapOverbar
      ? [{ kind: "span", style: "overbar", children: runs }]
      : runs,
  });
}

export type LabelSubscriptCase = "preserve" | "uppercase" | "lowercase";

/** Change only explicit subscript runs, leaving baseline text and other styles
 * intact. Script spans reset inherited slant in the shared SVG/text renderers. */
export function formatLabelSubscripts(
  content: RichTextDocument,
  options: {
    case?: LabelSubscriptCase | undefined;
    italic?: boolean | undefined;
  },
): RichTextDocument {
  if (
    options.italic === undefined &&
    (!options.case || options.case === "preserve")
  )
    return content;
  const visit = (runs: RichTextRun[], subscript = false): RichTextRun[] =>
    runs.flatMap((run): RichTextRun[] => {
      if (run.kind === "text" && subscript && options.case !== undefined)
        return [
          {
            ...run,
            value:
              options.case === "uppercase"
                ? run.value.toUpperCase()
                : options.case === "lowercase"
                  ? run.value.toLowerCase()
                  : run.value,
          },
        ];
      if (run.kind !== "span") return [run];
      const children = visit(
        run.children,
        subscript || run.style === "subscript",
      );
      if (
        subscript &&
        ((run.style === "italic" && options.italic !== undefined) ||
          (["uppercase", "lowercase"].includes(run.style) &&
            options.case !== undefined &&
            options.case !== "preserve"))
      )
        return children;
      return [
        {
          ...run,
          children:
            run.style === "subscript" && options.italic === true
              ? [{ kind: "span", style: "italic", children }]
              : children,
        },
      ];
    });
  return { runs: visit(content.runs) };
}

export function identifierSubscriptCase(
  name: string,
  mode: LabelSubscriptCase,
): string {
  const { body, overbar } = identifierParts(name);
  const index = body.indexOf("_");
  if (index < 0 || mode === "preserve") return name;
  const suffix = body.slice(index + 1);
  return (
    body.slice(0, index + 1) +
    (mode === "uppercase" ? suffix.toUpperCase() : suffix.toLowerCase()) +
    (overbar ? "_bar" : "")
  );
}
