import { boundAnnotationName } from "./schema/bound-annotation-text.js";
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
  richTextPresentsIdentifier,
} from "./identifier-text.js";
import {
  flattenRichText,
  normalizeRichText,
  rewriteRichTextPlainText,
  sameStyledText,
} from "./rich-text.js";
import {
  deviceReferenceTextDocument,
  voltageNodeTextDocument,
} from "./semantic-text.js";

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
 * Labels whose standard look comes from what they label: supply markers,
 * device References, and the voltage nodes Cell Pins and Net labels name.
 */
export type LabelRole = "supply" | "device-reference" | "voltage-node";

/** The role that gives a bound label a standard look, if any. */
export function labelRole(
  annotation: Pick<Annotation, "kind" | "binding">,
): LabelRole | undefined {
  if (annotation.kind === "power-label") return "supply";
  // A Net label names a voltage node, as a Cell Pin does (V_in, V_BP).
  if (annotation.kind === "net-label")
    return annotation.binding?.kind === "net-name" ? "voltage-node" : undefined;
  if (annotation.kind !== "instance-label") return undefined;
  if (annotation.binding?.kind === "instance-reference")
    return "device-reference";
  if (annotation.binding?.kind === "cell-terminal-name") return "voltage-node";
  return undefined;
}

/**
 * The standard look a role-labelled name is created with, stored on the
 * label so later rule or drawing-setting changes never redraw it. The name
 * keeps its exact spelling; a spelling without a standard form gets none.
 * - supply, voltage node (Cell Pin, Net label): italic V over an upright
 *   subscript (V_DD, V_in, V_BP, V_casP)
 * - device reference: italic letters over an upright index (M₁, R₁₂)
 */
export function roleLabelFormat(
  role: LabelRole,
  name: string,
): RichTextDocument | undefined {
  if (role === "device-reference")
    return /^\p{L}+\p{N}+$/u.test(name)
      ? deviceReferenceTextDocument(name)
      : undefined;
  return /^[Vv][\p{L}\p{N}]+$/u.test(name)
    ? voltageNodeTextDocument(name)
    : undefined;
}

/** Whether a stored format is still exactly the standard look for `name`. */
export function isRoleLabelFormat(
  format: RichTextDocument,
  role: LabelRole,
  name: string,
): boolean {
  const expected = roleLabelFormat(role, name);
  return expected !== undefined && sameStyledText(format, expected);
}

/** The standard look of a supply marker's label (VDD Power, drawn rails). */
export function supplyLabelFormat(name: string): RichTextDocument | undefined {
  return roleLabelFormat("supply", name);
}

/** Whether a stored format is still exactly the supply default for `name`. */
export function isSupplyLabelFormat(
  format: RichTextDocument,
  name: string,
): boolean {
  return isRoleLabelFormat(format, "supply", name);
}

/**
 * The format a bound label keeps when its name changes. An untouched
 * standard look follows the new spelling, or is dropped when that spelling
 * has no standard form; an authored format keeps its styling around the new
 * text.
 */
export function renamedLabelFormat(
  annotation: Pick<Annotation, "kind" | "binding" | "formatOverride">,
  previousName: string,
  nextName: string,
  presentation: SchematicDocument["presentation"],
): RichTextDocument | undefined {
  const format = annotation.formatOverride;
  if (!format) return undefined;
  const role = labelRole(annotation);
  if (role && isRoleLabelFormat(format, role, previousName))
    return roleLabelFormat(role, nextName);
  // A format that spells its name character by character keeps each
  // character's style, so an authored subscript survives the rename. A new
  // name with an underscore places its subscript at that underscore, the
  // historical encoding a stored display may use to spell its name.
  if (!nextName.includes("_") && flattenRichText(format) === previousName)
    return rewriteRichTextPlainText(format, nextName);
  return rewriteRichTextIdentifier(
    format,
    nextName,
    labelIdentifierOptions(presentation),
  );
}

/**
 * A format that still spells `name`. Restyling never renames, so when a
 * styling change leaves a character the old look hid (an underscore that
 * began a removed subscript), that character is shown again rather than
 * dropped from the electrical name.
 */
export function formatPresentingName(
  format: RichTextDocument,
  name: string,
): RichTextDocument {
  return richTextPresentsIdentifier(format, name)
    ? format
    : rewriteRichTextPlainText(format, name);
}

/** One existing label that would take its stored standard look. */
export interface StandardLabelLookChange {
  readonly annotationId: string;
  readonly role: LabelRole;
  readonly name: string;
  readonly format: RichTextDocument;
}

/**
 * The standard looks an existing drawing's unformatted supply, device
 * Reference, Cell Pin and Net labels would take. Names never change, an
 * author's own format is never replaced, and a label that is not drawn is
 * left as it is.
 */
export function standardLabelLookChanges(
  document: SchematicDocument,
): StandardLabelLookChange[] {
  const changes: StandardLabelLookChange[] = [];
  for (const annotation of document.annotations) {
    if (
      annotation.formatOverride ||
      !annotation.binding ||
      annotation.visible === false
    )
      continue;
    const role = labelRole(annotation);
    if (!role) continue;
    const name = boundAnnotationName(document, annotation)?.trim();
    if (!name) continue;
    const format = roleLabelFormat(role, name);
    if (format)
      changes.push({ annotationId: annotation.id, role, name, format });
  }
  return changes;
}
