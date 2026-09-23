import type {
  Annotation,
  RichTextDocument,
  RichTextRun,
  RichTextStyle,
  SchematicDocument,
} from "./schema.js";
import {
  formatLabelSubscripts,
  identifierTextDocument,
  identifierSubscriptCase,
  rewriteRichTextIdentifier,
} from "./identifier-text.js";
import { normalizeRichText } from "./rich-text.js";
import { voltageNodeTextDocument } from "./semantic-text.js";

/** Current drawing's naming typography, shared by labels, pins and block text. */
export function labelTypography(
  presentation: SchematicDocument["presentation"],
) {
  return {
    underscoreSubscript: presentation.labelUnderscoreSubscript ?? true,
    subscriptAfterFirst: presentation.labelSubscriptAfterFirst ?? false,
    subscriptCase: presentation.labelSubscriptCase ?? "preserve",
    subscriptItalic: presentation.labelSubscriptItalic ?? true,
    firstLetterItalic: presentation.labelFirstLetterItalic ?? true,
  };
}
export type LabelTypography = ReturnType<typeof labelTypography>;

export function labelIdentifierOptions(
  presentation: SchematicDocument["presentation"],
) {
  const options = labelTypography(presentation);
  return {
    underscoreSubscript:
      options.subscriptAfterFirst || options.underscoreSubscript,
  };
}

/** Explicit whole-drawing naming action, not a side effect of rendering. */
export function formatLabelIdentifier(
  name: string,
  options: Pick<LabelTypography, "subscriptAfterFirst" | "subscriptCase">,
): string {
  const overbar = name.length > 4 && name.endsWith("_bar");
  const body = overbar ? name.slice(0, -4) : name;
  const characters = [...body];
  const separated =
    options.subscriptAfterFirst &&
    /^[\p{L}][\p{L}\p{N}_]*$/u.test(body) &&
    characters.length > 1 &&
    characters[1] !== "_"
      ? `${characters[0]}_${characters.slice(1).join("")}`
      : body;
  return identifierSubscriptCase(
    separated + (overbar ? "_bar" : ""),
    options.subscriptCase,
  );
}

/** Only change the initial character's slant; retain every other authored style. */
export function formatLabelFirstLetter(
  content: RichTextDocument,
  italic: boolean | undefined,
): RichTextDocument {
  if (italic === undefined) return content;
  let first = true;
  const groups: { run: RichTextRun; styles: RichTextStyle[] }[] = [];
  const append = (run: RichTextRun, styles: RichTextStyle[]) => {
    const previous = groups.at(-1);
    if (
      run.kind === "text" &&
      previous?.run.kind === "text" &&
      JSON.stringify(previous.styles) === JSON.stringify(styles)
    )
      previous.run.value += run.value;
    else groups.push({ run, styles });
  };
  const visit = (runs: RichTextRun[], styles: RichTextStyle[] = []): void => {
    for (const run of runs) {
      if (run.kind === "span") {
        const inherited = ["subscript", "superscript"].includes(run.style)
          ? styles.filter((style) => style !== "italic")
          : styles;
        visit(run.children, [...inherited, run.style]);
      } else if (run.kind === "text") {
        for (const value of run.value) {
          append(
            { kind: "text", value },
            first
              ? [
                  ...styles.filter((style) => style !== "italic"),
                  ...(italic ? ["italic" as const] : []),
                ]
              : styles,
          );
          first = false;
        }
      } else append(run, styles);
    }
  };
  visit(content.runs);
  // Share enclosing styles across adjacent groups, particularly an overbar
  // spanning the initial and its subscript. Separate bars change the glyph.
  const nest = (items: typeof groups): RichTextRun[] => {
    const runs: RichTextRun[] = [];
    for (let index = 0; index < items.length;) {
      const item = items[index]!;
      const style = item.styles[0];
      if (!style) {
        runs.push(item.run);
        index++;
        continue;
      }
      const children: typeof groups = [];
      while (index < items.length && items[index]!.styles[0] === style) {
        const child = items[index++]!;
        children.push({ run: child.run, styles: child.styles.slice(1) });
      }
      runs.push({ kind: "span", style, children: nest(children) });
    }
    return runs;
  };
  return normalizeRichText({
    runs: nest(groups),
  });
}

export function labelTextDocument(
  name: string,
  presentation: SchematicDocument["presentation"],
): RichTextDocument {
  const options = labelTypography(presentation);
  return formatLabelFirstLetter(
    formatLabelSubscripts(
      identifierTextDocument(name, {
        underscoreSubscript:
          options.subscriptAfterFirst || options.underscoreSubscript,
      }),
      {
        italic: options.subscriptItalic,
      },
    ),
    presentation.labelFirstLetterItalic,
  );
}

/**
 * The format a supply marker's label is created with: an italic leading V
 * over an upright subscript, as in V_DD. Placement stores it on the label, so
 * a later rule or drawing-setting change never redraws a supply the author
 * has already seen, and the electrical name keeps its exact spelling. Other
 * spellings (AVDD, VDD_1V8) keep the ordinary label rules.
 */
export function supplyLabelFormat(name: string): RichTextDocument | undefined {
  return /^[Vv][\p{L}\p{N}]+$/u.test(name)
    ? voltageNodeTextDocument(name)
    : undefined;
}

/** Whether a stored format is still exactly the supply default for `name`. */
export function isSupplyLabelFormat(
  format: RichTextDocument,
  name: string,
): boolean {
  const expected = supplyLabelFormat(name);
  return (
    expected !== undefined &&
    JSON.stringify(normalizeRichText(format)) ===
      JSON.stringify(normalizeRichText(expected))
  );
}

/**
 * The format a bound label keeps when its name changes. An untouched supply
 * default follows the new spelling, or is dropped when that spelling has no
 * supply form; an authored format keeps its styling around the new text.
 */
export function renamedLabelFormat(
  annotation: Pick<Annotation, "kind" | "formatOverride">,
  previousName: string,
  nextName: string,
  presentation: SchematicDocument["presentation"],
): RichTextDocument | undefined {
  const format = annotation.formatOverride;
  if (!format) return undefined;
  if (
    annotation.kind === "power-label" &&
    isSupplyLabelFormat(format, previousName)
  )
    return supplyLabelFormat(nextName);
  return rewriteRichTextIdentifier(
    format,
    nextName,
    labelIdentifierOptions(presentation),
  );
}
