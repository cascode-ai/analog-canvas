import { schematicTextMetrics } from "./schematic-text-metrics.generated.js";

/** Glyphs measured from the same Metropolis / DejaVu faces the editor serves. */
export const SCHEMATIC_MEASURED_GLYPHS = schematicTextMetrics.glyphs;

function faceMetrics(style: "plain" | "bold" | "italic" | "boldItalic") {
  const face = schematicTextMetrics[style];
  return new Map(
    [...SCHEMATIC_MEASURED_GLYPHS].map((glyph, index) => [
      glyph,
      {
        advance: face.advances[index]!,
        left: face.bearings[index * 2]!,
        right: face.bearings[index * 2 + 1]!,
      },
    ]),
  );
}
const faces = {
  plain: faceMetrics("plain"),
  bold: faceMetrics("bold"),
  italic: faceMetrics("italic"),
  boldItalic: faceMetrics("boldItalic"),
};
function metricsFor(weight: "plain" | "bold", italic: boolean) {
  return faces[italic ? (weight === "bold" ? "boldItalic" : "italic") : weight];
}
/** The round period's dot stands 0.105 em into its 0.36 em advance. */
const roundPeriod = { advance: 0.36, left: 0.105, right: 0.105 };

function glyphAdvanceEm(
  glyph: string,
  widths: ReadonlyMap<string, { advance: number }>,
): number {
  return glyph === "."
    ? roundPeriod.advance
    : (widths.get(glyph)?.advance ??
        (/\p{Mark}/u.test(glyph)
          ? 0
          : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
                glyph,
              )
            ? 1
            : 0.7));
}

export function schematicTextAdvanceEm(
  value: string,
  weight: "plain" | "bold",
  italic = false,
): number {
  const widths = metricsFor(weight, italic);
  return [...value].reduce(
    (width, glyph) => width + glyphAdvanceEm(glyph, widths),
    0,
  );
}

/**
 * Where a run of schematic text puts ink, in em from where it starts: from
 * the first glyph's outline to the last one's, each glyph advancing as
 * schematicTextAdvanceEm adds them up. Italic faces supply their own advances
 * and ink bearings. A glyph the tables do not hold inks its whole advance.
 * Null for a run that draws nothing, such as a space.
 */
export function schematicTextInkEm(
  value: string,
  weight: "plain" | "bold",
  italic = false,
): { left: number; right: number } | null {
  const widths = metricsFor(weight, italic);
  let x = 0;
  let left = Infinity;
  let right = -Infinity;
  for (const glyph of value) {
    const advance = glyphAdvanceEm(glyph, widths);
    if (advance > 0 && !/\s/u.test(glyph)) {
      const side =
        glyph === "."
          ? roundPeriod
          : (widths.get(glyph) ?? { left: 0, right: 0 });
      left = Math.min(left, x + side.left);
      right = Math.max(right, x + advance - side.right);
    }
    x += advance;
  }
  return left <= right ? { left, right } : null;
}
