/**
 * The PDF's faces for CJK text (#2179): Noto Sans SC, Regular, cut so an
 * export fetches only the faces its text uses. The canvas and PNG draw such
 * text in a system face, which a PDF cannot borrow. The first face holds
 * punctuation, kana, full-width forms and the everyday hanzi; the others
 * the remaining ideographs in code-point order (fonts/cjk/README.md).
 */
import { cjkCommonGlyphs, cjkFaceStarts } from "./cjk-pdf-faces.generated.js";

/**
 * The Unicode blocks the faces are cut from. Keep in step with BLOCKS in
 * scripts/generate-cjk-pdf-faces.py.
 */
const CJK_BLOCKS: readonly (readonly [number, number])[] = [
  [0x3000, 0x33ff],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe1f],
  [0xfe30, 0xfe4f],
  [0xff00, 0xffef],
];
const common = new Set(cjkCommonGlyphs);

/**
 * The index in cjkFaceUrls of the face cut for a character from the CJK
 * blocks, or undefined outside them. The face may still lack it, as the
 * source does a few code points; the exporter reads the face's cmap.
 */
export function cjkFaceForGlyph(glyph: string): number | undefined {
  const point = glyph.codePointAt(0) ?? 0;
  if (!CJK_BLOCKS.some(([first, last]) => point >= first && point <= last))
    return undefined;
  if (common.has(glyph)) return 0;
  let face = 0;
  for (const [index, start] of cjkFaceStarts.entries())
    if (point >= start) face = index + 1;
  return face;
}
