/**
 * The characters jsPDF can write in a TrueType face: those its Unicode
 * format 4 cmap maps to a glyph other than .notdef. jsPDF reads no other
 * cmap format and writes UTF-16 code units, so a character beyond the Basic
 * Multilingual Plane is never among them. jsPDF takes the first such table,
 * Windows Unicode BMP (3, 1) or any Unicode platform (0) one; so does this.
 */
export function writableCodePoints(face: Uint8Array): Set<number> {
  const data = new DataView(face.buffer, face.byteOffset, face.byteLength);
  const tables = data.getUint16(4);
  let cmap: number | undefined;
  for (let index = 0; index < tables; index += 1) {
    const record = 12 + index * 16;
    if (data.getUint32(record) === 0x636d6170 /* "cmap" */)
      cmap = data.getUint32(record + 8);
  }
  if (cmap === undefined) throw new Error("The font has no cmap table");
  const points = new Set<number>();
  const encodings = data.getUint16(cmap + 2);
  for (let index = 0; index < encodings; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = data.getUint16(record);
    const encoding = data.getUint16(record + 2);
    const subtable = cmap + data.getUint32(record + 4);
    if (data.getUint16(subtable) !== 4) continue;
    if (platform !== 0 && !(platform === 3 && encoding === 1)) continue;
    const segments = data.getUint16(subtable + 6) / 2;
    const ends = subtable + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const end = data.getUint16(ends + segment * 2);
      const start = data.getUint16(starts + segment * 2);
      const delta = data.getUint16(deltas + segment * 2);
      const rangeOffset = data.getUint16(rangeOffsets + segment * 2);
      for (let point = start; point <= end && point !== 0xffff; point += 1) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (point + delta) & 0xffff;
        else {
          const at =
            rangeOffsets + segment * 2 + rangeOffset + (point - start) * 2;
          glyph = data.getUint16(at);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) points.add(point);
      }
    }
    return points;
  }
  throw new Error("The font has no Unicode format 4 cmap");
}

/**
 * Control characters, joiners and variation selectors: nothing of their own
 * to draw, so leaving them out loses nothing.
 */
const INVISIBLE = /^[\p{Cc}\p{Default_Ignorable_Code_Point}]$/u;
/** Characters drawn an em wide: CJK, Hangul, kana and emoji. */
const WIDE =
  /^[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\p{Extended_Pictographic}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]$/u;

/** The ideographic space, an em wide, which the first CJK face holds. */
export const WIDE_BLANK = "\u3000";
/** The en space, half an em, which every DejaVu Sans face holds. */
export const NARROW_BLANK = "\u2002";

/**
 * What the PDF writes for a character no face holds: a blank about its
 * width, so the text after it stays where the canvas draws it, or nothing
 * for a character that draws nothing.
 */
export function blankFor(glyph: string): string {
  return INVISIBLE.test(glyph)
    ? ""
    : WIDE.test(glyph)
      ? WIDE_BLANK
      : NARROW_BLANK;
}

/**
 * The characters of a run a face cannot write and a reader would miss:
 * invisible ones are never counted.
 */
export function unwritableGlyphs(
  glyphs: Iterable<string>,
  writable: ReadonlySet<number>,
): string[] {
  return [...glyphs].filter(
    (glyph) =>
      !INVISIBLE.test(glyph) && !writable.has(glyph.codePointAt(0) ?? 0),
  );
}

/** The export's account of the characters a PDF was saved without. */
export function omittedGlyphsNotice(glyphs: readonly string[]): string {
  const named = glyphs.slice(0, 3).map((glyph) => {
    const point = (glyph.codePointAt(0) ?? 0).toString(16).toUpperCase();
    return `${glyph} (U+${point.padStart(4, "0")})`;
  });
  const rest = glyphs.length - named.length;
  const list = rest
    ? `${named.join(", ")} and ${rest} more`
    : named.length > 1
      ? `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`
      : named.join("");
  const them = glyphs.length === 1 ? "it" : "them";
  return `PDF saved without ${list}: no PDF font has ${them}. Export SVG or PNG to keep ${them}.`;
}
