import { layout } from "./label-formula-layout.js";
import { Unsupported } from "./label-formula-nodes.js";
import { parse } from "./label-formula-parser.js";

/**
 * A LaTeX formula set in the labels' own type: the schematic label font, a
 * letter in italic, a subscript, digit or operator upright — V_{in} reads as
 * the label V_in does. Layout follows TeX's rules for fractions, scripts,
 * large operators and operator spacing, measured with the same advance
 * tables as label text, so a formula and a label beside it match glyph for
 * glyph.
 *
 * Everything the formula editor offers is set this way: fractions, roots,
 * scripts and limits, sums, products and integrals, accents, fences,
 * matrices, cases and aligned rows, and the symbol and font commands. LaTeX
 * outside that set returns null (`labelFormulaProblem` names what), and the
 * editor refuses it; a formula saved before then keeps its old typesetting.
 */
export interface LabelFormulaGlyph {
  kind: "glyph";
  /** Left edge from the formula's left edge. */
  x: number;
  /** Baseline offset from the formula's baseline, positive downward. */
  y: number;
  text: string;
  size: number;
  italic: boolean;
  bold: boolean;
  /** The glyph's width by the label advance tables. */
  advance: number;
  /**
   * Glyphs sharing a flow are one run of text — symbols, operators and their
   * scripts — drawn as label text is, each after the last by the real font's
   * advance, so their spacing matches a label's in whatever font the viewer
   * has. Fractions, radicals and fences are placed by the layout.
   */
  flow?: number;
  /**
   * Where a run of flowing glyphs stands in the space the layout gave it, when
   * the real font is narrower than the tables. A run keeps against the box
   * beside it — the first in a row against what follows, the last against
   * what precedes, one inside fences or a radical against them — so the
   * spare width falls at the row's outer edges, where nothing touches it.
   * A run between two boxes, or alone in its row, centres.
   */
  anchor?: "start" | "middle" | "end";
  /**
   * The side a fence or radical sign keeps against what it encloses: an
   * opening fence or a radical sign its right, a closing fence its left.
   */
  hug?: "left" | "right";
  /** Vertical stretch of a sized delimiter or radical, about its baseline. */
  scaleY?: number;
  /** Horizontal stretch of a wide accent or arrow, about its centre. */
  scaleX?: number;
}

export interface LabelFormulaRule {
  kind: "rule";
  x1: number;
  x2: number;
  y: number;
  /** Line weight, in the text's own proportion, as TeX's rules are. */
  thickness: number;
}

/**
 * A stroke drawn rather than typed: a radical sign and its overbar as one
 * line, so they meet exactly whatever font the viewer has.
 */
export interface LabelFormulaPath {
  kind: "path";
  points: { x: number; y: number }[];
  thickness: number;
}

export interface LabelFormulaLayout {
  width: number;
  /** Extent above the baseline. */
  ascent: number;
  /** Extent below the baseline. */
  descent: number;
  items: (LabelFormulaGlyph | LabelFormulaRule | LabelFormulaPath)[];
}

export interface LabelFormulaOptions {
  fontSize: number;
  bold: boolean;
  /** A whole-text slant override, applied before glyph measurement. */
  italic?: boolean;
  display: "inline" | "block";
  subscriptScale: number;
  subscriptBaselineShiftEm: number;
  subscriptHorizontalGapEm: number;
}

/** Lay out `latex` in label type, or null when it uses LaTeX label type does not set. */
export function layoutLabelFormula(
  latex: string,
  options: LabelFormulaOptions,
): LabelFormulaLayout | null {
  try {
    const nodes = parse(latex);
    if (nodes.length === 0) return null;
    return layout(nodes, options);
  } catch {
    return null;
  }
}

/**
 * Why `latex` cannot be set in label type, for the formula editor to say
 * before it inserts it; null when it can.
 */
export function labelFormulaProblem(latex: string): string | null {
  try {
    const nodes = parse(latex);
    if (nodes.length === 0) return "The formula is empty";
    layout(nodes, {
      fontSize: 15,
      bold: true,
      display: "block",
      subscriptScale: 0.76,
      subscriptBaselineShiftEm: 0.44,
      subscriptHorizontalGapEm: 0.046,
    });
    return null;
  } catch (error) {
    if (!(error instanceof Unsupported)) return "This formula cannot be set";
    const what = error.message;
    if (what === "&")
      return "& separates columns only inside a matrix, cases or aligned block";
    if (what === "\\\\")
      return "\\\\ starts a new row only inside a matrix, cases or aligned block";
    if (what.startsWith("\\")) return `${what} is not supported in formulas`;
    return `The formula is incomplete (${what})`;
  }
}
