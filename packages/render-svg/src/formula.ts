import {
  layoutLabelFormula,
  type LabelFormulaGlyph,
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
export const LABEL_FORMULA_TYPOGRAPHY = "label-v2";
export const MATHJAX_FORMULA_TYPOGRAPHY = "sans-v3";

/**
 * A formula set in label type: text in the labels' own font, letters in
 * italic and subscripts upright, fraction bars and overlines as lines in the
 * labels' stroke — so a formula and a label beside it match exactly.
 *
 * The layout measures with the label advance tables, but a viewer may draw
 * the label font stack in another face (Arial, where DejaVu Sans is not
 * installed). So each run of symbols is one text element whose glyphs follow
 * one another by the real font's advances, as a label's do, with the layout's
 * spacing and script offsets as relative shifts. A formula that is one run
 * stands at its anchor as a label would; with fractions or fences between
 * runs, each run and lone glyph centres in the space the layout gave it, so
 * a narrower face leaves even gaps rather than one wide one.
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
  // A slant override on the text slants the whole formula, as it does a
  // label; otherwise letters are italic and their subscripts upright.
  const font = (glyph: LabelFormulaGlyph) =>
    `font-size="${number(glyph.size)}" font-style="${glyph.italic || options.italic === true ? "italic" : "normal"}" font-weight="${glyph.bold ? "bold" : "normal"}"`;
  // The items in drawing order as runs of flowing glyphs, lone glyphs (a
  // fence or radical sign) and rules.
  type Segment =
    | { kind: "run"; glyphs: LabelFormulaGlyph[] }
    | { kind: "glyph"; glyph: LabelFormulaGlyph }
    | {
        kind: "rule";
        rule: Extract<LabelFormulaLayout["items"][number], { kind: "rule" }>;
      };
  const segments: Segment[] = [];
  for (const item of layout.items) {
    const last = segments.at(-1);
    if (item.kind === "rule") segments.push({ kind: "rule", rule: item });
    else if (item.flow === undefined)
      segments.push({ kind: "glyph", glyph: item });
    else if (last?.kind === "run" && last.glyphs[0]!.flow === item.flow)
      last.glyphs.push(item);
    else segments.push({ kind: "run", glyphs: [item] });
  }
  const hugs = (segment: Segment | undefined, side: "left" | "right") =>
    segment?.kind === "glyph" && segment.glyph.hug === side;
  const place = (
    anchor: "start" | "middle" | "end",
    start: number,
    end: number,
  ) =>
    left +
    (anchor === "start" ? start : anchor === "end" ? end : (start + end) / 2);

  const rendered = segments.map((segment, index) => {
    if (segment.kind === "rule") {
      const { x1, x2, y } = segment.rule;
      return `<line x1="${number(left + x1)}" y1="${number(options.baselineY + y)}" x2="${number(left + x2)}" y2="${number(options.baselineY + y)}" stroke="${color}" stroke-width="${profile.strokes.annotation}"/>`;
    }
    if (segment.kind === "glyph") {
      // A fence or radical sign, stretched about its baseline, kept against
      // what it encloses: a radical sign ends where its overbar begins.
      const { glyph } = segment;
      const anchor =
        glyph.hug === "right"
          ? "end"
          : glyph.hug === "left"
            ? "start"
            : "middle";
      const x = place(anchor, glyph.x, glyph.x + glyph.advance);
      const y = options.baselineY + glyph.y;
      return glyph.scaleY
        ? `<text transform="translate(${number(x)} ${number(y)}) scale(1 ${number(glyph.scaleY)})" x="0" y="0" text-anchor="${anchor}" ${font(glyph)}>${escapeXml(glyph.text)}</text>`
        : `<text x="${number(x)}" y="${number(y)}" text-anchor="${anchor}" ${font(glyph)}>${escapeXml(glyph.text)}</text>`;
    }
    // One run is the whole formula: it stands at its anchor, as a label
    // does. Otherwise a run keeps against a fence or radical sign beside
    // it, or centres in its space.
    const { glyphs } = segment;
    const after = hugs(segments[index - 1], "right");
    const before = hugs(segments[index + 1], "left");
    const anchor =
      segments.length === 1
        ? options.alignment
        : after && !before
          ? "start"
          : before && !after
            ? "end"
            : "middle";
    const start = Math.min(...glyphs.map((glyph) => glyph.x));
    const end = Math.max(...glyphs.map((glyph) => glyph.x + glyph.advance));
    const first = glyphs[0]!;
    let penX = first.x;
    let penY = first.y;
    const spans = glyphs
      .map((glyph) => {
        const dx = glyph.x - penX;
        const dy = glyph.y - penY;
        penX = glyph.x + glyph.advance;
        penY = glyph.y;
        return `<tspan${Math.abs(dx) > 1e-6 ? ` dx="${number(dx)}"` : ""}${Math.abs(dy) > 1e-6 ? ` dy="${number(dy)}"` : ""} ${font(glyph)}>${escapeXml(glyph.text)}</tspan>`;
      })
      .join("");
    return `<text x="${number(place(anchor, start, end))}" y="${number(options.baselineY + first.y)}" text-anchor="${anchor}">${spans}</text>`;
  });
  return `<g data-role="formula" data-formula-typography="${LABEL_FORMULA_TYPOGRAPHY}" font-family="${escapeXml(profile.typography.fontFamily).replaceAll('"', "&quot;")}" fill="${color}" color="${color}">${rendered.join("")}</g>`;
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
