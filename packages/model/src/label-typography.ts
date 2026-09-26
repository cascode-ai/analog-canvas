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
  hasItalicScripts,
  normalizeRichText,
  rewriteRichTextPlainText,
  sameStyledText,
  uprightScripts,
} from "./rich-text.js";
import {
  currentNodeTextDocument,
  deviceLetterReferenceTextDocument,
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

/** I then letters or digits, but not an input (IN, INP, INN) or IO. */
const CURRENT_NAME = /^[Ii](?![Nn])(?![Oo]$)[\p{L}\p{N}]+$/u;

export interface RoleLabelFormatOptions {
  /**
   * The single letter the labelled device's References start with — R, C,
   * L, M, Q, D, V, I… — when it has one. The model knows no devices, so the
   * caller that does passes it.
   */
  readonly deviceLetter?: string;
}

/**
 * The standard look a role-labelled name is created with, stored on the
 * label so later rule or drawing-setting changes never redraw it. The name
 * keeps its exact spelling; a spelling without a standard form gets none.
 * - supply, voltage node (Cell Pin, Net label): italic V over an upright
 *   subscript (V_DD, V_in, V_BP, V_casP)
 * - a Cell Pin or Net label named for a current: italic I over an upright
 *   subscript (I_out, I_REF, I₁), except an input's IN… or an IO pin
 * - device reference that starts with its device letter: that letter in
 *   italic over an upright subscript of the rest (M₁, R₁₂, R_L1, C_L, R_FB)
 * - any other device reference: italic letters over an upright index, so a
 *   block named for what it is keeps its letters together (OA₁, XU₀)
 */
export function roleLabelFormat(
  role: LabelRole,
  name: string,
  options: RoleLabelFormatOptions = {},
): RichTextDocument | undefined {
  if (role === "device-reference") {
    const letter = options.deviceLetter;
    if (
      letter &&
      /^\p{L}$/u.test(letter) &&
      /^\p{L}[\p{L}\p{N}]+$/u.test(name) &&
      name.slice(0, 1).toUpperCase() === letter.toUpperCase()
    )
      return deviceLetterReferenceTextDocument(name);
    return /^\p{L}+\p{N}+$/u.test(name)
      ? deviceReferenceTextDocument(name)
      : undefined;
  }
  if (/^[Vv][\p{L}\p{N}]+$/u.test(name)) return voltageNodeTextDocument(name);
  return role === "voltage-node" && CURRENT_NAME.test(name)
    ? currentNodeTextDocument(name)
    : undefined;
}

/** Whether a stored format is still exactly the standard look for `name`. */
export function isRoleLabelFormat(
  format: RichTextDocument,
  role: LabelRole,
  name: string,
  options: RoleLabelFormatOptions = {},
): boolean {
  const expected = roleLabelFormat(role, name, options);
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
  options: RoleLabelFormatOptions = {},
): RichTextDocument | undefined {
  const format = annotation.formatOverride;
  if (!format) return undefined;
  const role = labelRole(annotation);
  if (role && isRoleLabelFormat(format, role, previousName, options))
    return roleLabelFormat(role, nextName, options);
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

/** One existing label a look pass would restyle. */
export interface LabelLookChange {
  readonly annotationId: string;
  readonly name: string;
  readonly format: RichTextDocument;
  /**
   * `standard`: the role's standard look (V_DD, M₁, V_in), for a label with
   * no look of its own or one whose stored look only repeats its historical
   * look. `upright`: the label's own look with its scripts upright.
   */
  readonly kind: "standard" | "upright";
  readonly role?: LabelRole;
}

export interface LabelLookChanges {
  readonly labels: LabelLookChange[];
  /**
   * The drawing never chose a subscript slant, so the historical default
   * slants the subscripts of labels without a look of their own; setting
   * `labelSubscriptItalic` to false draws them upright.
   */
  readonly uprightSubscripts: boolean;
}

export interface LabelLookChangeOptions {
  /**
   * Also restyle looks the editor stored before these standards: a stored
   * copy of a label's historical look takes its standard look, and a script
   * slanted by the surrounding italic is drawn upright. Only for drawings
   * made before scripts defaulted to upright, since an author may now slant
   * a script on purpose.
   */
  readonly legacyLooks?: boolean;
  /** The device letter of the Instance a Reference label names, if any. */
  readonly deviceLetterOf?: (annotation: Annotation) => string | undefined;
}

const drawsScripts = (document: RichTextDocument): boolean =>
  JSON.stringify(document).includes('"subscript"') ||
  JSON.stringify(document).includes('"superscript"');

/**
 * How an existing drawing's labels would reach the standard: drawn supply,
 * device Reference, Cell Pin and Net labels without a look of their own take
 * their standard look, and subscripts default to upright. Names never change,
 * an author's own look is kept, and a label that is not drawn is left as it
 * is. `legacyLooks` also restyles looks stored before these standards.
 */
export function labelLookChanges(
  document: SchematicDocument,
  options: LabelLookChangeOptions = {},
): LabelLookChanges {
  const labels: LabelLookChange[] = [];
  let slantedUnformatted = false;
  for (const annotation of document.annotations) {
    if (!annotation.binding || annotation.visible === false) continue;
    const name = boundAnnotationName(document, annotation)?.trim();
    if (!name) continue;
    const role = labelRole(annotation);
    const deviceLetter = options.deviceLetterOf?.(annotation);
    const standard = role
      ? roleLabelFormat(role, name, deviceLetter ? { deviceLetter } : {})
      : undefined;
    const format = annotation.formatOverride;
    const historical = labelTextDocument(name, document.presentation);
    if (
      role &&
      standard &&
      (!format ||
        (options.legacyLooks === true && sameStyledText(format, historical)))
    ) {
      labels.push({
        annotationId: annotation.id,
        name,
        format: standard,
        kind: "standard",
        role,
      });
      continue;
    }
    if (format) {
      if (options.legacyLooks === true && hasItalicScripts(format))
        labels.push({
          annotationId: annotation.id,
          name,
          format: uprightScripts(format),
          kind: "upright",
          ...(role ? { role } : {}),
        });
    } else if (drawsScripts(historical)) slantedUnformatted = true;
  }
  return {
    labels,
    // An explicit `true` is the drawing's own choice and stays.
    uprightSubscripts:
      slantedUnformatted &&
      document.presentation.labelSubscriptItalic === undefined,
  };
}
