import type { SchematicStyleProfile } from "@icm/derived";
import { transformPoint } from "@icm/model";
import { renderFormulaDocument } from "./formula.js";
import { renderFractionText } from "./fraction-text.js";
import { renderPositionedOverbarScriptDocument } from "./positioned-rich-text.js";
import { renderRichTextDocument } from "./rich-text.js";
import type { RichTextDocument, SchematicDocument } from "@icm/model";
import {
  normalizeSignalFlowFormula,
  parseSignalFlowFraction,
  parseSignalFlowInline,
  resolveSignalFlowFormulaLayout,
  signalFlowBodyWordDocument,
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
  /** Body names use explicit script marks and drawing typography; expressions stay formulas. */
  labels?: {
    presentation: SchematicDocument["presentation"];
    profile: SchematicStyleProfile;
  };
  /** Instance foreground overrides apply to renderer-owned presentation too. */
  foreground: string;
  profile: SchematicStyleProfile;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Render ordinary formula text plus true SVG super/subscript tspans. */
export function renderSignalFlowInlineFormula(value: string): string {
  return parseSignalFlowInline(value)
    .map((part) =>
      part.kind === "text"
        ? escapeXml(part.value)
        : `<tspan data-role="formula-${part.kind}" baseline-shift="${part.kind === "superscript" ? "super" : "sub"}" font-size="70%">${escapeXml(part.value)}</tspan>`,
    )
    .join("");
}

/**
 * An authored look draws exactly as a label with the same RichText would:
 * fractions keep their bars, a formula typesets, overbars and scripts keep
 * their positions. Unstyled runs are upright at the plain weight.
 */
function renderBodyRichText(
  format: RichTextDocument,
  profile: SchematicStyleProfile,
  options: { x: number; y: number; fontSize: number; color: string },
): string {
  const fractions = renderFractionText(format, profile, {
    ...options,
    alignment: "middle",
  });
  if (fractions) return fractions;
  const formula = renderFormulaDocument(format, profile, {
    x: options.x,
    baselineY: options.y,
    fontSize: options.fontSize,
    alignment: "middle",
    color: options.color,
  });
  if (formula) return formula;
  const plain = `font-size="${options.fontSize}" style="font-style:normal;font-weight:${profile.typography.plainWeight}"`;
  const positioned = renderPositionedOverbarScriptDocument(format, profile, {
    ...options,
    alignment: "middle",
  });
  if (positioned)
    return `<text data-role="formula-text" x="${options.x}" y="${options.y}" text-anchor="start" ${plain}>${positioned.tspans}</text>${positioned.decorations}`;
  return `<text data-role="formula-text" x="${options.x}" y="${options.y}" text-anchor="middle" ${plain}>${renderRichTextDocument(format, profile, { fontSize: options.fontSize, lineOriginX: options.x })}</text>`;
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
  const paint = `fill="${escapeXml(options.foreground)}" stroke="none" font-family="${family}"`;
  const common = `${paint} font-weight="${options.profile.typography.mathWeight}"`;
  const coefficientText = layout.coefficient
    ? `<text data-role="formula-coefficient" x="${layout.coefficientX}" y="${layout.inlineBaseline}" text-anchor="end" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.coefficient)}·</text>`
    : "";
  if (layout.format) {
    const body = renderBodyRichText(layout.format, options.profile, {
      x: layout.formulaX,
      y: layout.inlineBaseline,
      fontSize: layout.fontSize,
      color: options.foreground,
    });
    const coefficient = coefficientText
      ? `<g font-weight="${options.profile.typography.mathWeight}">${coefficientText}</g>`
      : "";
    return `<g data-role="signal-flow-formula" data-formatted="true" ${paint}>${coefficient}${body}</g>`;
  }
  const word = options.labels
    ? signalFlowBodyWordDocument(layout.formula, options.labels.presentation)
    : undefined;
  const inline = word
    ? renderRichTextDocument(word, options.labels!.profile, {
        fontSize: layout.fontSize,
      })
    : renderSignalFlowInlineFormula(layout.formula);
  const body = layout.fraction
    ? `<g data-role="signal-flow-fraction"><text data-role="formula-numerator" x="${layout.formulaX}" y="${layout.numeratorBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.fraction.numerator)}</text><line data-role="formula-fraction-bar" x1="${layout.formulaX - layout.formulaWidth / 2}" y1="${layout.fractionBarY}" x2="${layout.formulaX + layout.formulaWidth / 2}" y2="${layout.fractionBarY}" stroke="${escapeXml(options.foreground)}" stroke-width="${options.profile.strokes.annotation}"/><text data-role="formula-denominator" x="${layout.formulaX}" y="${layout.denominatorBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.fraction.denominator)}</text></g>`
    : `<text data-role="formula-text" x="${layout.formulaX}" y="${layout.inlineBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${inline}</text>`;
  return `<g data-role="signal-flow-formula" ${common}>${coefficientText}${body}</g>`;
}

/**
 * Render Symbol body text at its transformed centre without transforming the
 * glyphs themselves. A mirrored or quarter-turned Symbol still moves its
 * label with the body, while letters, signs, scripts, and fraction bars stay
 * readable in screen coordinates.
 */
export function renderUprightSignalFlowFormula(
  presentation: FormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
  placement: NonNullable<SchematicDocument["instances"][number]["placement"]>,
  options: SignalFlowFormulaRenderOptions,
): string {
  if (!presentation) return "";
  const formula = renderSignalFlowFormula(presentation, parameters, options);
  if (!formula) return "";
  const worldCenter = transformPoint(
    presentation.center,
    placement.position,
    placement,
  );
  const translateX = worldCenter.x - presentation.center.x;
  const translateY = worldCenter.y - presentation.center.y;
  return `<g data-role="upright-signal-flow-formula" transform="translate(${translateX} ${translateY})">${formula}</g>`;
}

export { normalizeSignalFlowFormula, parseSignalFlowFraction };
