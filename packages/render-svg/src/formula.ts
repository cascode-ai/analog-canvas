import type { SchematicStyleProfile } from "@icm/derived";
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

/**
 * Render one atomic formula at the same baseline/alignment boundary used by
 * ordinary SVG text. The returned nested SVG contains paths only, so the
 * formal SVG, PNG, and vector-PDF pipelines consume one visual artifact.
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
  },
): string | null {
  const formula = soleRichTextMathRun(document);
  if (!formula) return null;
  const request = {
    latex: formula.latex,
    display: formula.display,
    profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
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
      return `<svg ${retained} x="${number(left)}" y="${number(top)}" width="${number(width)}" height="${number(height)}" color="${color}" overflow="visible" data-role="formula">`;
    },
  );
}
