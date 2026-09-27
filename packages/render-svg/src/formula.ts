import {
  layoutLabelFormula,
  type LabelFormulaLayout,
  type SchematicStyleProfile,
} from "@icm/derived";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  CANONICAL_FORMULA_FONT_SIZE,
  cachedFormulaResult,
} from "@icm/math-typesetting/cache";
import { soleRichTextMathRun } from "@icm/model";
import type { RichTextDocument } from "@icm/model";

function number(value: number): string {
  return String(Number(value.toFixed(6)));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Formula typography markers; a stored preview without them is redrawn. */
export const LABEL_FORMULA_TYPOGRAPHY = "label-v1";
export const MATHJAX_FORMULA_TYPOGRAPHY = "sans-v3";

/**
 * A formula set in label type: text in the labels' own font, letters in
 * italic and subscripts upright, fraction bars and overlines as lines in the
 * labels' stroke — so a formula and a label beside it match exactly.
 */
function renderLabelFormula(
  layout: LabelFormulaLayout,
  profile: SchematicStyleProfile,
  options: {
    x: number;
    baselineY: number;
    alignment: "start" | "middle" | "end";
    color?: string;
    italic?: boolean;
  },
): string {
  const left =
    options.alignment === "start"
      ? options.x
      : options.alignment === "end"
        ? options.x - layout.width
        : options.x - layout.width / 2;
  const color = options.color ?? profile.foreground;
  const items = layout.items
    .map((item) => {
      if (item.kind === "rule")
        return `<line x1="${number(left + item.x1)}" y1="${number(options.baselineY + item.y)}" x2="${number(left + item.x2)}" y2="${number(options.baselineY + item.y)}" stroke="${color}" stroke-width="${profile.strokes.annotation}"/>`;
      const x = left + item.x;
      const y = options.baselineY + item.y;
      // A slant override on the text slants the whole formula, as it does a
      // label; otherwise letters are italic and their subscripts upright.
      const italic = item.italic || options.italic === true;
      const font = `font-size="${number(item.size)}" font-style="${italic ? "italic" : "normal"}" font-weight="${item.bold ? "bold" : "normal"}"`;
      return item.scaleY
        ? `<text transform="translate(${number(x)} ${number(y)}) scale(1 ${number(item.scaleY)})" x="0" y="0" ${font}>${escapeXml(item.text)}</text>`
        : `<text x="${number(x)}" y="${number(y)}" ${font}>${escapeXml(item.text)}</text>`;
    })
    .join("");
  return `<g data-role="formula" data-formula-typography="${LABEL_FORMULA_TYPOGRAPHY}" font-family="${escapeXml(profile.typography.fontFamily).replaceAll('"', "&quot;")}" fill="${color}" color="${color}">${items}</g>`;
}

/**
 * Render one atomic formula at the same baseline/alignment boundary used by
 * ordinary SVG text. A formula label type can set is drawn as label text;
 * anything else is the typesetter's nested SVG of paths, so the formal SVG,
 * PNG, and vector-PDF pipelines consume one visual artifact either way.
 */
export function renderFormulaDocument(
  document: RichTextDocument,
  profile: SchematicStyleProfile,
  options: {
    x: number;
    baselineY: number;
    fontSize: number;
    alignment: "start" | "middle" | "end";
    color?: string;
    bold?: boolean;
    italic?: boolean;
  },
): string | null {
  const formula = soleRichTextMathRun(document);
  if (!formula) return null;
  const label = layoutLabelFormula(formula.latex, {
    fontSize: options.fontSize,
    bold: options.bold ?? true,
    display: formula.display,
    subscriptScale: profile.typography.subscriptScale,
    subscriptBaselineShiftEm: profile.typography.subscriptBaselineShiftEm,
    subscriptHorizontalGapEm: profile.typography.subscriptHorizontalGapEm,
  });
  if (label) return renderLabelFormula(label, profile, options);
  const request = {
    latex: formula.latex,
    display: formula.display,
    profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
    bold: options.bold ?? true,
    italic: options.italic ?? false,
  } as const;
  const result = cachedFormulaResult(request);
  if (!result) {
    return `<text data-role="formula-pending" x="${number(options.x)}" y="${number(options.baselineY)}" text-anchor="${options.alignment}" font-size="${number(options.fontSize)}" fill="${options.color ?? profile.foreground}">${escapeXml(formula.latex)}</text>`;
  }
  if (!result.ok) {
    throw new Error(`Cannot render formula: ${result.diagnostic.message}`);
  }

  const { artifact } = result;
  const scale = options.fontSize / CANONICAL_FORMULA_FONT_SIZE;
  const width = artifact.width * scale;
  const height = artifact.height * scale;
  const baseline = artifact.baseline * scale;
  const left =
    options.alignment === "start"
      ? options.x
      : options.alignment === "end"
        ? options.x - width
        : options.x - width / 2;
  const top = options.baselineY - baseline;
  const color = options.color ?? profile.foreground;
  return artifact.svg.replace(
    /^<svg\b([^>]*)>/,
    (_match: string, attributes: string) => {
      const retained = attributes
        .replace(/\s(?:x|y|width|height|overflow)="[^"]*"/g, "")
        .trim();
      return `<svg ${retained} x="${number(left)}" y="${number(top)}" width="${number(width)}" height="${number(height)}" color="${color}" overflow="visible" data-role="formula" data-formula-typography="${MATHJAX_FORMULA_TYPOGRAPHY}">`;
    },
  );
}
