import sansUrl from "../fonts/DejaVuSans.schematic.woff?url";
import sansBoldUrl from "../fonts/DejaVuSans-Bold.schematic.woff?url";
import sansBoldObliqueUrl from "../fonts/DejaVuSans-BoldOblique.schematic.woff?url";
import sansObliqueUrl from "../fonts/DejaVuSans-Oblique.schematic.woff?url";

/**
 * DejaVu Sans, the schematic font stack's first face, served with the editor
 * (#1413). Label measurement reads its tables, while a browser without it
 * installed (macOS, Windows) drew labels in the narrower Arial: a label
 * reported touching its part looked clear of it. The faces are subset to the
 * characters schematic text uses (scripts/generate-schematic-fonts.mjs);
 * anything else falls back glyph by glyph to the rest of the stack.
 */
export const SCHEMATIC_FONT_FAMILY = "DejaVu Sans";

/** The characters the faces hold, as their generator subsets them. */
export const SCHEMATIC_FONT_UNICODE_RANGE = [
  "U+0020-007E",
  "U+00A0-017F",
  "U+0300-036F",
  "U+0370-03FF",
  "U+2010-2027",
  "U+2030-205E",
  "U+2070-209F",
  "U+2100-214F",
  "U+2190-21FF",
  "U+2200-22FF",
  "U+25A0-25FF",
].join(",");

const FACES = [
  { url: sansUrl, weight: 400, style: "normal", local: "DejaVu Sans" },
  { url: sansBoldUrl, weight: 700, style: "normal", local: "DejaVu Sans Bold" },
  {
    url: sansObliqueUrl,
    weight: 400,
    style: "italic",
    local: "DejaVu Sans Oblique",
  },
  {
    url: sansBoldObliqueUrl,
    weight: 700,
    style: "italic",
    local: "DejaVu Sans Bold Oblique",
  },
] as const;

/**
 * One face's rule: an installed DejaVu Sans first, else `source`. Text shows
 * in the next face of the stack until it arrives, and characters the subset
 * lacks are drawn by the stack's next face; label positions do not depend
 * on it, as they come from the tables.
 */
function fontFaceRule(face: (typeof FACES)[number], source: string): string {
  return `@font-face{font-family:"${SCHEMATIC_FONT_FAMILY}";src:local("${face.local}"),${source};font-weight:${face.weight};font-style:${face.style};font-display:swap;unicode-range:${SCHEMATIC_FONT_UNICODE_RANGE}}`;
}

/**
 * The faces for a page that draws schematic text, each fetched when text
 * first needs it.
 */
export const schematicWebFontFaceCss = FACES.map((face) =>
  fontFaceRule(face, `url("${face.url}") format("woff")`),
).join("");

let inlined: Promise<string> | undefined;

/**
 * The same faces inside the CSS itself, for an SVG drawn as an image, which
 * loads nothing: a PNG of a schematic then shows the face its labels were
 * measured in. Read once per page; a failed read is tried again next time.
 */
export function inlineSchematicWebFontFaceCss(
  fetchLike: typeof fetch = fetch,
): Promise<string> {
  inlined ??= Promise.all(
    FACES.map(async (face) => {
      const response = await fetchLike(face.url);
      if (!response.ok)
        throw new Error(`Schematic font unavailable (HTTP ${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let start = 0; start < bytes.length; start += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
      return fontFaceRule(
        face,
        `url("data:font/woff;base64,${btoa(binary)}") format("woff")`,
      );
    }),
  )
    .then((rules) => rules.join(""))
    .catch((error: unknown) => {
      inlined = undefined;
      throw error;
    });
  return inlined;
}

/** An SVG document with these rules as the first thing it styles. */
export function withSchematicFontFaces(svg: string, css: string): string {
  const open = /<svg\b[^>]*>/u.exec(svg);
  // An empty <svg/> draws no text.
  if (!open || open[0].endsWith("/>")) return svg;
  const end = open.index + open[0].length;
  return `${svg.slice(0, end)}<style>${css}</style>${svg.slice(end)}`;
}
