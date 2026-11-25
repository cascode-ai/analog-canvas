/**
 * One overbar for every path that draws one (#2619): the generic rich-text
 * renderer, the positioned one and the PDF. A bar is a solid line about a
 * Metropolis stem thick, a little clear of the tallest glyph it covers, from
 * the first covered glyph's ink to the last one's. A font's own overline
 * (its underline thickness, 0.02 em) drew a faint hairline at label size.
 */

/** The bar's thickness, em: about a Metropolis Bold stem. */
export const OVERBAR_THICKNESS_EM = 0.08;
/** Clear space between the covered glyphs' top and the bar, em: 1.5 units at label size. */
export const OVERBAR_GAP_EM = 0.1;

/** Metropolis's cap height, which its digits and ICM Greek capitals share. */
const CAP_TOP_EM = 0.69;
/** Ascenders, and Greek letters that reach above the cap height. */
const TALL_TOP_EM = 0.72;
/** The x height, with overshoot. */
const SHORT_TOP_EM = 0.53;
const TALL = /[bdfhklt̀-ͯβδζθλξϑϕ]/u;
const SHORT = /^[acegmnopqrsuvwxyzıαγεηικμνοπρςστυφχψωϵϰϱ\s]+$/u;

/** How far `text` reaches above its baseline, em. */
export function overbarGlyphTopEm(text: string): number {
  if (TALL.test(text)) return TALL_TOP_EM;
  if (SHORT.test(text)) return SHORT_TOP_EM;
  return CAP_TOP_EM;
}

export interface OverbarLine {
  x1: number;
  x2: number;
  /** The bar's centre line. */
  y: number;
  thickness: number;
}

/**
 * The bar over ink from `left` to `right` whose highest glyph top stands at
 * `top` (SVG y, down), for text `fontSize` units tall.
 */
export function overbarLine(ink: {
  left: number;
  right: number;
  top: number;
  fontSize: number;
}): OverbarLine {
  const thickness = ink.fontSize * OVERBAR_THICKNESS_EM;
  return {
    x1: ink.left,
    x2: ink.right,
    y: ink.top - ink.fontSize * OVERBAR_GAP_EM - thickness / 2,
    thickness,
  };
}

function number(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * The bar as SVG: a line stroked in `color`, or, with no color, a rectangle
 * filled with whatever its group fills text with (a theme's currentColor).
 */
export function overbarLineSvg(line: OverbarLine, color?: string): string {
  if (color === undefined)
    return `<rect data-text-decoration="overbar" x="${number(line.x1)}" y="${number(line.y - line.thickness / 2)}" width="${number(line.x2 - line.x1)}" height="${number(line.thickness)}"/>`;
  return `<line data-text-decoration="overbar" x1="${number(line.x1)}" y1="${number(line.y)}" x2="${number(line.x2)}" y2="${number(line.y)}" stroke="${color}" stroke-width="${number(line.thickness)}"/>`;
}
