import type {
  SymbolDefinition,
  SymbolFormulaPresentation,
  SymbolPin,
} from "./schema.js";

export interface SignalFlowLayoutParameters {
  readonly formula?: string | undefined;
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
  const coefficient = presentation.supportsCoefficient
    ? parameters?.coefficient?.trim() || undefined
    : undefined;
  const fraction = parseSignalFlowFraction(formula);
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
    : approximateSignalFlowInlineWidth(formula, fontSize);
  const coefficientWidth = coefficient
    ? approximateSignalFlowInlineWidth(`${coefficient}·`, fontSize)
    : 0;
  const coefficientGap = coefficient ? fontSize * 0.3 : 0;
  const contentWidth = formulaWidth + coefficientWidth + coefficientGap;
  // A stacked fraction needs a full line-height between its bar and the
  // denominator baseline. Anything tighter lets the denominator's ascenders
  // visually merge with the stroked bar in browser SVG rasterization.
  const contentHeight = fontSize * (fraction ? 3 : 1.25);
  const formulaX =
    presentation.center.x + (coefficientWidth + coefficientGap) / 2;
  const coefficientX = formulaX - formulaWidth / 2 - coefficientGap;
  return {
    formula,
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

function snapUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
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
  const pinSpan = snapUp(width / 2 + frame.leadLength, 10);
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
