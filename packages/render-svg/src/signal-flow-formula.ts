import type { SchematicStyleProfile } from "@icm/derived";
import {
  normalizeSignalFlowFormula,
  parseSignalFlowFraction,
  resolveSignalFlowFormulaLayout,
} from "@icm/symbols";
import type {
  SignalFlowLayoutParameters,
  SymbolDefinition,
} from "@icm/symbols";

/** Renderer-owned presentation metadata for a Transfer Function block. */
export type FormulaPresentation = NonNullable<
  SymbolDefinition["formulaPresentation"]
>;

export interface SignalFlowFormulaRenderOptions {
  /** Instance foreground overrides apply to renderer-owned presentation too. */
  foreground: string;
  profile: {
    typography: Pick<
      SchematicStyleProfile["typography"],
      "fontFamily" | "mathWeight"
    >;
    strokes: Pick<SchematicStyleProfile["strokes"], "annotation">;
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

/** Render ordinary formula text plus true SVG super/subscript tspans. */
export function renderSignalFlowInlineFormula(value: string): string {
  const normalized = normalizeSignalFlowFormula(value);
  let markup = "";
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
      markup += escapeXml(normalized.slice(cursor));
      break;
    }
    markup += escapeXml(normalized.slice(cursor, marker));
    const start = marker + 1;
    const end = scriptEnd(normalized, start);
    if (end === start) {
      markup += normalized[marker];
      cursor = start;
      continue;
    }
    const rawScript = normalized.slice(start, end);
    const script =
      rawScript.startsWith("(") && rawScript.endsWith(")")
        ? rawScript.slice(1, -1)
        : rawScript;
    const kind = normalized[marker] === "^" ? "superscript" : "subscript";
    markup += `<tspan data-role="formula-${kind}" baseline-shift="${kind === "superscript" ? "super" : "sub"}" font-size="70%">${escapeXml(script)}</tspan>`;
    cursor = end;
  }
  return markup;
}

/** Formula bounds consumed by formal export crop and adaptive frame layout. */
export function signalFlowFormulaLocalBounds(
  presentation: FormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
): { x: number; y: number; width: number; height: number } | undefined {
  return resolveSignalFlowFormulaLayout(presentation, parameters)?.bounds;
}

/**
 * Render renderer-owned formula text. Every preset and custom expression uses
 * one font size; fractions expand the frame rather than shrinking their text.
 */
export function renderSignalFlowFormula(
  presentation: FormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
  options: SignalFlowFormulaRenderOptions,
): string {
  const layout = resolveSignalFlowFormulaLayout(presentation, parameters);
  if (!presentation || !layout) return "";
  const family = escapeXml(options.profile.typography.fontFamily);
  const common = `fill="${escapeXml(options.foreground)}" stroke="none" font-family="${family}" font-weight="${options.profile.typography.mathWeight}"`;
  const body = layout.fraction
    ? `<g data-role="signal-flow-fraction"><text data-role="formula-numerator" x="${layout.formulaX}" y="${layout.numeratorBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.fraction.numerator)}</text><line data-role="formula-fraction-bar" x1="${layout.formulaX - layout.formulaWidth / 2}" y1="${layout.fractionBarY}" x2="${layout.formulaX + layout.formulaWidth / 2}" y2="${layout.fractionBarY}" stroke="${escapeXml(options.foreground)}" stroke-width="${options.profile.strokes.annotation}"/><text data-role="formula-denominator" x="${layout.formulaX}" y="${layout.denominatorBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.fraction.denominator)}</text></g>`
    : `<text data-role="formula-text" x="${layout.formulaX}" y="${layout.inlineBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.formula)}</text>`;
  const coefficientMarkup = layout.coefficient
    ? `<text data-role="formula-coefficient" x="${layout.coefficientX}" y="${layout.inlineBaseline}" text-anchor="end" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.coefficient)}·</text>`
    : "";
  return `<g data-role="signal-flow-formula" ${common}>${coefficientMarkup}${body}</g>`;
}

export { normalizeSignalFlowFormula, parseSignalFlowFraction };
