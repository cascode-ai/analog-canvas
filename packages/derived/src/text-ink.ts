import type { DerivedRect, RichTextDocument } from "@icm/model";
import { measureLabelText, type RichTextMetrics } from "./rich-text-layout.js";
import type { SchematicStyleProfile } from "./style-profile.js";

/** Height of the label font's capitals and figures, in em. */
export const LABEL_CAP_HEIGHT_EM = 0.72;

/** Descent of g, j, p, q and y below the baseline, in em of the label font. */
const DESCENDER_EM = 0.24;

/**
 * How far a label's ink reaches below its baseline, in em of its font: a
 * subscript's or a fraction's figures, a descender (g, p, y), or nothing.
 */
export function labelInkDescentEm(
  content: RichTextDocument,
  typography: SchematicStyleProfile["typography"],
): number {
  let subscript = false;
  let descender = false;
  const visit = (runs: RichTextDocument["runs"]): void => {
    for (const run of runs) {
      if (run.kind === "text") {
        if (/[gjpqy]/u.test(run.value)) descender = true;
      } else if (run.kind === "span") {
        if (run.style === "subscript") subscript = true;
        visit(run.children);
      } else if (run.kind === "fraction") subscript = true;
    }
  };
  visit(content.runs);
  if (subscript)
    return typography.subscriptScale * typography.subscriptBaselineShiftEm;
  return descender ? DESCENDER_EM : 0;
}

/**
 * Where upright text's glyphs reach across when each of its lines stands on
 * `x` by `alignment`, as the renderer anchors them: from the first glyph's
 * outline to the last one's, in the label advance tables (measureLabelText).
 * An end-aligned value's first figure stands where the served face draws it.
 * Null for text that draws nothing.
 */
export function uprightTextInkSpan(
  content: RichTextDocument,
  metrics: RichTextMetrics,
  alignment: "start" | "middle" | "end",
  x: number,
): { left: number; width: number } | null {
  let left = Infinity;
  let right = -Infinity;
  for (const line of measureLabelText(content, metrics).lines) {
    if (!line.ink) continue;
    const start =
      alignment === "start"
        ? x
        : alignment === "end"
          ? x - line.width
          : x - line.width / 2;
    left = Math.min(left, start + line.ink.left);
    right = Math.max(right, start + line.ink.right);
  }
  return left <= right ? { left, width: right - left } : null;
}

/**
 * What upright text whose first line stands on `baseline` draws: from its
 * capitals, or a stacked fraction's numerator `fractionAscent` above them,
 * down `descentEm` (in em) under its last line, and across `left` to
 * `left + width` (uprightTextInkSpan). `layoutHeight` is the measured height
 * of all its lines. Labels and free drawing text share it, so a finding about
 * one is measured as a finding about the other.
 */
export function uprightTextInkBounds(text: {
  left: number;
  width: number;
  baseline: number;
  fontSize: number;
  fractionAscent: number;
  descentEm: number;
  layoutHeight: number;
}): DerivedRect {
  const capHeight = text.fontSize * LABEL_CAP_HEIGHT_EM;
  return {
    x: text.left,
    y: text.baseline - capHeight - text.fractionAscent,
    width: text.width,
    height:
      capHeight +
      text.fractionAscent +
      text.fontSize * text.descentEm +
      Math.max(0, text.layoutHeight - text.fontSize * 1.35),
  };
}
