import {
  formatLabelIdentifier,
  labelTextDocument,
  labelTypography,
  normalizeRichText,
} from "@icm/model";
import type {
  RichTextDocument,
  RichTextRun,
  SchematicDocument,
} from "@icm/model";

import type {
  SymbolDefinition,
  SymbolFormulaPresentation,
  SymbolPin,
} from "./schema.js";

export interface SignalFlowLayoutParameters {
  readonly formula?: string | undefined;
  /** The author's look for `formula`, drawn in place of the compact syntax. */
  readonly formulaFormat?: RichTextDocument | undefined;
  readonly coefficient?: string | undefined;
  /** Optional user-authored minimum body width. */
  readonly bodyWidth?: number | undefined;
  /** Optional user-authored minimum body height. */
  readonly bodyHeight?: number | undefined;
}

export interface SignalFlowFractionParts {
  readonly numerator: string;
  readonly denominator: string;
}

export interface SignalFlowFormulaLayout {
  readonly formula: string;
  /** The author's look, when one is stored for authored text. */
  readonly format: RichTextDocument | undefined;
  readonly coefficient: string | undefined;
  readonly fraction: SignalFlowFractionParts | null;
  readonly fontSize: number;
  readonly formulaWidth: number;
  readonly coefficientWidth: number;
  readonly coefficientGap: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly formulaX: number;
  readonly coefficientX: number;
  readonly inlineBaseline: number;
  readonly fractionBarY: number;
  readonly numeratorBaseline: number;
  readonly denominatorBaseline: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export interface AdaptiveSignalFlowBlockLayout {
  readonly formula: SignalFlowFormulaLayout;
  readonly shape: "rectangle" | "right-tapered-trapezoid";
  readonly body: { x: number; y: number; width: number; height: number };
  readonly pinSpan: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

const unicodeSuperscripts: Readonly<Record<string, string>> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
};

const unicodeSubscripts: Readonly<Record<string, string>> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "-",
  ₐ: "a",
  ₑ: "e",
  ₕ: "h",
  ᵢ: "i",
  ⱼ: "j",
  ₖ: "k",
  ₗ: "l",
  ₘ: "m",
  ₙ: "n",
  ₒ: "o",
  ₚ: "p",
  ᵣ: "r",
  ₛ: "s",
  ₜ: "t",
  ᵤ: "u",
  ᵥ: "v",
  ₓ: "x",
};

/** Normalise visual Unicode spellings without mutating persisted input. */
export function normalizeSignalFlowFormula(value: string): string {
  let normalized = "";
  let script: "super" | "sub" | null = null;
  for (const character of value.normalize("NFC")) {
    const superscript = unicodeSuperscripts[character];
    if (superscript !== undefined) {
      if (script !== "super") normalized += "^";
      normalized += superscript;
      script = "super";
      continue;
    }
    const subscript = unicodeSubscripts[character];
    if (subscript !== undefined) {
      if (script !== "sub") normalized += "_";
      normalized += subscript;
      script = "sub";
      continue;
    }
    script = null;
    normalized += character === "−" ? "-" : character;
  }
  return normalized;
}

function stripOuterParentheses(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && index < trimmed.length - 1) return trimmed;
  }
  return depth === 0 ? trimmed.slice(1, -1).trim() : trimmed;
}

/** Parse one top-level division; all other input remains safe literal text. */
export function parseSignalFlowFraction(
  value: string,
): SignalFlowFractionParts | null {
  const normalized = normalizeSignalFlowFormula(value).trim();
  let depth = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "/" && depth === 0) {
      const numerator = stripOuterParentheses(normalized.slice(0, index));
      const denominator = stripOuterParentheses(normalized.slice(index + 1));
      return numerator && denominator ? { numerator, denominator } : null;
    }
  }
  return null;
}

function scriptEnd(value: string, start: number): number {
  if (value[start] === "(") {
    const close = value.indexOf(")", start + 1);
    return close === -1 ? start : close + 1;
  }
  let end = start;
  // A sign may prefix a script (z^-1 or z^+1), but a later sign starts the
  // next formula term and must not be swallowed into the superscript/subscript.
  if (value[end] === "+" || value[end] === "-") end += 1;
  while (end < value.length && /[A-Za-z0-9]/u.test(value[end]!)) end += 1;
  return end;
}

export type SignalFlowInlinePart =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "superscript" | "subscript"; readonly value: string };

/**
 * Read one line of compact formula syntax: `^` raises the next term, and a
 * single `_` lowers it (`g_m`); anything else is literal text.
 */
export function parseSignalFlowInline(value: string): SignalFlowInlinePart[] {
  const normalized = normalizeSignalFlowFormula(value);
  const parts: SignalFlowInlinePart[] = [];
  const text = (part: string): void => {
    if (part) parts.push({ kind: "text", value: part });
  };
  let cursor = 0;
  const underscoreCount = [...normalized].filter(
    (character) => character === "_",
  ).length;
  while (cursor < normalized.length) {
    const superscript = normalized.indexOf("^", cursor);
    const subscript =
      underscoreCount === 1 ? normalized.indexOf("_", cursor) : -1;
    const marker =
      superscript === -1
        ? subscript
        : subscript === -1
          ? superscript
          : Math.min(superscript, subscript);
    if (marker === -1 || marker === normalized.length - 1) {
      text(normalized.slice(cursor));
      break;
    }
    text(normalized.slice(cursor, marker));
    const start = marker + 1;
    const end = scriptEnd(normalized, start);
    if (end === start) {
      text(normalized[marker]!);
      cursor = start;
      continue;
    }
    const rawScript = normalized.slice(start, end);
    parts.push({
      kind: normalized[marker] === "^" ? "superscript" : "subscript",
      value:
        rawScript.startsWith("(") && rawScript.endsWith(")")
          ? rawScript.slice(1, -1)
          : rawScript,
    });
    cursor = end;
  }
  return parts;
}

/**
 * The compact spelling of RichText — `^` and `_` for scripts, `/` for a sole
 * fraction — ignoring slant and weight, which the Symbol's own look supplies.
 * Null when the text has no compact spelling that reads back the same: an
 * overbar, a formula, a line break, a fraction beside other text, or scripts
 * mixed with the characters that mark them.
 */
export function signalFlowFormulaSource(
  document: RichTextDocument,
): string | null {
  let marked = false;
  const script = (value: string): string =>
    /^[+-]?[A-Za-z0-9]+$/u.test(value) ? value : `(${value})`;
  // A fraction part needs parentheses only around an operator; the sign of a
  // script (z^-1) is part of its term.
  const group = (value: string): string =>
    /[\s+\-*/]/u.test(value.replace(/[\^_][+-]/gu, "")) ? `(${value})` : value;
  const unwrap = (runs: readonly RichTextRun[]): readonly RichTextRun[] => {
    const only = runs.length === 1 ? runs[0] : undefined;
    return only?.kind === "span" &&
      (only.style === "bold" || only.style === "italic")
      ? unwrap(only.children)
      : runs;
  };
  const encode = (runs: readonly RichTextRun[]): string | null => {
    let source = "";
    for (const run of runs) {
      if (run.kind === "text") source += run.value;
      else if (run.kind === "span") {
        const inner = encode(run.children);
        if (inner === null) return null;
        if (run.style === "bold" || run.style === "italic") source += inner;
        else if (run.style === "superscript" || run.style === "subscript") {
          marked = true;
          source += `${run.style === "superscript" ? "^" : "_"}${script(inner)}`;
        } else return null;
      } else return null;
    }
    return source;
  };
  const top = unwrap(document.runs);
  const only = top.length === 1 ? top[0] : undefined;
  let source: string | null;
  if (only?.kind === "fraction") {
    const numerator = encode(unwrap(only.numerator.runs));
    const denominator = encode(unwrap(only.denominator.runs));
    source =
      numerator === null || denominator === null
        ? null
        : `${group(numerator)}/${group(denominator)}`;
    marked = true;
  } else source = encode(top);
  if (source === null) return null;
  // A literal marker beside real scripts would read back as syntax.
  if (marked && [...source].filter((c) => c === "_").length > 1) return null;
  return source;
}

/** The compact metric, applied to RichText: scripts keep full width. */
function richTextWidth(runs: readonly RichTextRun[], fontSize: number): number {
  let width = 0;
  for (const run of runs) {
    if (run.kind === "text") width += [...run.value].length * fontSize * 0.62;
    else if (run.kind === "span")
      width += richTextWidth(run.children, fontSize);
    else if (run.kind === "fraction")
      width +=
        Math.max(
          richTextWidth(run.numerator.runs, fontSize),
          richTextWidth(run.denominator.runs, fontSize),
        ) +
        fontSize * 0.5;
    else if (run.kind === "math")
      width +=
        run.latex.replace(/\\[A-Za-z]+/gu, "x").replace(/[{}^_\s]/gu, "")
          .length *
        fontSize *
        0.62;
  }
  return width;
}

/** Whether RichText stacks lines, as a fraction or a built-up formula does. */
function richTextStacks(runs: readonly RichTextRun[]): boolean {
  return runs.some((run) =>
    run.kind === "fraction"
      ? true
      : run.kind === "span"
        ? richTextStacks(run.children)
        : run.kind === "math"
          ? run.display === "block" || /\\d?frac\b/u.test(run.latex)
          : false,
  );
}

function visualCharacterCount(value: string): number {
  // Superscript markers are syntax, but every visible glyph—including
  // parentheses—must reserve space. One underscore is accepted as compact
  // subscript syntax (g_m); multiple underscores remain literal so existing
  // names such as very_long_formula keep their authored presentation.
  const normalized = normalizeSignalFlowFormula(value);
  const underscoreCount = [...normalized].filter(
    (character) => character === "_",
  ).length;
  const visible =
    underscoreCount === 1 ? normalized.replaceAll("_", "") : normalized;
  return visible.replaceAll("^", "").length;
}

/** Stable conservative text metric used consistently by every renderer. */
export function approximateSignalFlowInlineWidth(
  value: string,
  fontSize: number,
): number {
  return Math.max(
    fontSize * 0.72,
    visualCharacterCount(value) * fontSize * 0.62,
  );
}

export function resolveSignalFlowFormulaLayout(
  presentation: SymbolFormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
): SignalFlowFormulaLayout | undefined {
  if (!presentation) return undefined;
  const formula = parameters?.formula?.trim() || presentation.defaultFormula;
  // A look belongs to the authored text it styles, never to a default.
  const format = parameters?.formula?.trim()
    ? parameters.formulaFormat
    : undefined;
  const coefficient = presentation.supportsCoefficient
    ? parameters?.coefficient?.trim() || undefined
    : undefined;
  const fraction = format ? null : parseSignalFlowFraction(formula);
  const soleFraction =
    format?.runs.length === 1 && format.runs[0]!.kind === "fraction";
  const fontSize = presentation.fontSize;
  // Fractions keep the same character size as inline formulae. The frame
  // grows vertically instead of shrinking numerator/denominator text.
  const formulaWidth = fraction
    ? Math.max(
        presentation.fractionBarWidth ?? 0,
        Math.max(
          approximateSignalFlowInlineWidth(fraction.numerator, fontSize),
          approximateSignalFlowInlineWidth(fraction.denominator, fontSize),
        ) +
          fontSize * 0.5,
      )
    : format
      ? Math.max(
          soleFraction ? (presentation.fractionBarWidth ?? 0) : 0,
          fontSize * 0.72,
          richTextWidth(format.runs, fontSize),
        )
      : approximateSignalFlowInlineWidth(formula, fontSize);
  const stacked = format ? richTextStacks(format.runs) : fraction !== null;
  const coefficientWidth = coefficient
    ? approximateSignalFlowInlineWidth(`${coefficient}·`, fontSize)
    : 0;
  const coefficientGap = coefficient ? fontSize * 0.3 : 0;
  const contentWidth = formulaWidth + coefficientWidth + coefficientGap;
  // A stacked fraction needs a full line-height between its bar and the
  // denominator baseline. Anything tighter lets the denominator's ascenders
  // visually merge with the stroked bar in browser SVG rasterization.
  const contentHeight = fontSize * (stacked ? 3 : 1.25);
  const formulaX =
    presentation.center.x + (coefficientWidth + coefficientGap) / 2;
  const coefficientX = formulaX - formulaWidth / 2 - coefficientGap;
  return {
    formula,
    format,
    coefficient,
    fraction,
    fontSize,
    formulaWidth,
    coefficientWidth,
    coefficientGap,
    contentWidth,
    contentHeight,
    formulaX,
    coefficientX,
    inlineBaseline: presentation.center.y + fontSize * 0.34,
    fractionBarY: presentation.center.y,
    numeratorBaseline: presentation.center.y - fontSize * 0.5,
    denominatorBaseline: presentation.center.y + fontSize * 1.25,
    bounds: {
      x: presentation.center.x - contentWidth / 2,
      y: presentation.center.y - contentHeight / 2,
      width: contentWidth,
      height: contentHeight,
    },
  };
}

/**
 * Whether a Symbol's body word draws in the drawing's label typography, as a
 * converter's ADC or a lettered amplifier's A do, rather than upright as the
 * transfer function of a Signal Flow block.
 */
export function signalFlowBodyUsesLabelTypography(
  presentation: SymbolFormulaPresentation,
): boolean {
  return !presentation.supportsCoefficient && !presentation.adaptiveFrame;
}

const BODY_WORD = /^[\p{L}][\p{L}\p{N}_]*$/u;

/** A single letter, with an index or a subscript: A, A1, A_v, G_m. */
const BODY_QUANTITY = /^\p{L}(?:\p{N}*|_[\p{L}\p{N}]+)$/u;

function withoutItalic(runs: readonly RichTextRun[]): RichTextRun[] {
  return runs.flatMap((run): RichTextRun[] =>
    run.kind === "span"
      ? run.style === "italic"
        ? withoutItalic(run.children)
        : [{ ...run, children: withoutItalic(run.children) }]
      : run.kind === "fraction"
        ? [
            {
              ...run,
              numerator: { runs: withoutItalic(run.numerator.runs) },
              denominator: { runs: withoutItalic(run.denominator.runs) },
            },
          ]
        : [run],
  );
}

/**
 * A body word drawn in the drawing's label typography, when it is one. As in
 * textbook notation, a single-letter quantity (an amplifier's A, A_v) slants
 * like a label, while a word or abbreviation (ADC, DAC, LPF) stands upright.
 */
export function signalFlowBodyWordDocument(
  formula: string,
  drawing: SchematicDocument["presentation"],
): RichTextDocument | undefined {
  if (!BODY_WORD.test(formula)) return undefined;
  const look = labelTextDocument(
    formatLabelIdentifier(formula, {
      ...labelTypography(drawing),
      // A Symbol's body word is a name, not a designator with an implicit
      // index. Keep ADC, DAC and authored words whole; an explicit
      // underscore still requests a subscript.
      subscriptAfterFirst: false,
    }),
    drawing,
  );
  return BODY_QUANTITY.test(formula)
    ? look
    : normalizeRichText({ runs: withoutItalic(look.runs) });
}

/**
 * The body text as the RichText it draws as, so it edits like any label: the
 * author's stored look, a body word in label typography, or a transfer
 * function read from its compact syntax into scripts and a fraction, upright
 * at the math weight.
 */
export function signalFlowBodyTextDocument(
  presentation: SymbolFormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
  drawing: SchematicDocument["presentation"],
): RichTextDocument | undefined {
  const layout = resolveSignalFlowFormulaLayout(presentation, parameters);
  if (!presentation || !layout) return undefined;
  if (layout.format) return layout.format;
  const word = signalFlowBodyUsesLabelTypography(presentation)
    ? signalFlowBodyWordDocument(layout.formula, drawing)
    : undefined;
  if (word) return word;
  const inline = (value: string): RichTextRun[] =>
    parseSignalFlowInline(value).map((part) =>
      part.kind === "text"
        ? { kind: "text", value: part.value }
        : {
            kind: "span",
            style: part.kind,
            children: [{ kind: "text", value: part.value }],
          },
    );
  const runs: RichTextRun[] = layout.fraction
    ? [
        {
          kind: "fraction",
          numerator: { runs: inline(layout.fraction.numerator) },
          denominator: { runs: inline(layout.fraction.denominator) },
        },
      ]
    : inline(layout.formula);
  return normalizeRichText({
    runs: [{ kind: "span", style: "bold", children: runs }],
  });
}

function snapUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function snapDown(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

export function resolveAdaptiveSignalFlowBlockLayout(
  definition: Pick<SymbolDefinition, "formulaPresentation">,
  parameters: SignalFlowLayoutParameters | undefined,
): AdaptiveSignalFlowBlockLayout | undefined {
  const presentation = definition.formulaPresentation;
  const frame = presentation?.adaptiveFrame;
  const formula = resolveSignalFlowFormulaLayout(presentation, parameters);
  if (!presentation || !frame || !formula) return undefined;
  const requestedWidth = parameters?.bodyWidth ?? 0;
  const requestedHeight = parameters?.bodyHeight ?? 0;
  const width = snapUp(
    Math.max(
      frame.minBodyWidth,
      requestedWidth,
      formula.contentWidth + frame.horizontalPadding * 2,
    ),
    10,
  );
  const height = snapUp(
    Math.max(
      frame.minBodyHeight,
      requestedHeight,
      formula.contentHeight + frame.verticalPadding * 2,
    ),
    10,
  );
  const body = {
    x: presentation.center.x - width / 2,
    y: presentation.center.y - height / 2,
    width,
    height,
  };
  const bodyHalfWidth = width / 2;
  // Treat leadLength as a ceiling. Rounding the body edge plus that ceiling
  // upward can turn a one-cell lead into 15 units when the body ends on a
  // half-grid; choose the furthest eligible grid point that stays inside it.
  const pinSpan = Math.max(
    snapUp(bodyHalfWidth, 10),
    snapDown(bodyHalfWidth + frame.leadLength, 10),
  );
  return {
    formula,
    shape: frame.shape ?? "rectangle",
    body,
    pinSpan,
    bounds: {
      x: presentation.center.x - pinSpan,
      y: body.y,
      width: pinSpan * 2,
      height,
    },
  };
}

/** Resolve presentation-driven pin geometry while retaining pin identity. */
export function resolveSignalFlowPinAt(
  definition: Pick<SymbolDefinition, "formulaPresentation">,
  pin: Pick<SymbolPin, "at" | "direction">,
  parameters: SignalFlowLayoutParameters | undefined,
): { x: number; y: number } {
  const layout = resolveAdaptiveSignalFlowBlockLayout(definition, parameters);
  const center = definition.formulaPresentation?.center;
  if (!layout || !center || pin.at.y !== center.y) return pin.at;
  if (pin.direction === "west") {
    return { x: center.x - layout.pinSpan, y: center.y };
  }
  if (pin.direction === "east") {
    return { x: center.x + layout.pinSpan, y: center.y };
  }
  return pin.at;
}
