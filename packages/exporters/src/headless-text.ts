import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import {
  DOCUMENT_TEXT_FACE_FONT_FAMILIES,
  globalSchematicTypography,
  type SchematicTextFace,
} from "@icm/derived";
import { formalSvgTextFace } from "./text-face.js";

/**
 * What both headless rasterizers share: the native one in ./node.ts and the
 * WebAssembly one in ./headless-raster.ts. Each loads the same font files and
 * draws the same rewritten SVG, so a PNG made without a browser looks the
 * same wherever it is made.
 */

type DocumentTextFace = Exclude<SchematicTextFace, "metropolis">;

/** One font file: from this package's fonts/ directory, or a DejaVu face. */
export interface HeadlessFontFile {
  readonly source: "exporters" | "dejavu";
  readonly file: string;
}

const exporterFonts = (path: (style: string) => string) =>
  ["Regular", "Bold", "Italic", "BoldItalic"].map(
    (style): HeadlessFontFile => ({
      source: "exporters",
      file: `${path(style)}.ttf`,
    }),
  );

const SCHEMATIC_FONTS = ["Regular", "Bold", "RegularItalic", "BoldItalic"].map(
  (face): HeadlessFontFile => ({
    source: "exporters",
    file: `ICMSchematic-${face}.ttf`,
  }),
);

const DEJAVU_FONTS = [
  "DejaVuSans.ttf",
  "DejaVuSans-Bold.ttf",
  "DejaVuSans-Oblique.ttf",
  "DejaVuSans-BoldOblique.ttf",
  "DejaVuSerif.ttf",
  "DejaVuSerif-Bold.ttf",
  "DejaVuSerif-Italic.ttf",
  "DejaVuSerif-BoldItalic.ttf",
].map((file): HeadlessFontFile => ({ source: "dejavu", file }));

/**
 * The faces a Document may choose (#1725): the family resvg finds in their
 * files, which the PDF embeds too, and those files. Latin Modern Roman is
 * read as its TrueType subsets, ICM Modern.
 */
const DOCUMENT_FACE_FONTS: Readonly<
  Record<
    DocumentTextFace,
    { family: string; files: readonly HeadlessFontFile[] }
  >
> = {
  serif: {
    family: "Liberation Serif",
    files: exporterFonts(
      (style) => `liberation-serif/LiberationSerif-${style}`,
    ),
  },
  sans: {
    family: "Liberation Sans",
    files: exporterFonts((style) => `liberation-sans/LiberationSans-${style}`),
  },
  "latin-modern": {
    family: "ICM Modern",
    files: exporterFonts((style) => `ICMModern-${style}`),
  },
};

/** The fonts one SVG is drawn with and the families resvg falls back to. */
export function headlessFontPlan(svg: string): {
  files: readonly HeadlessFontFile[];
  defaultFontFamily: string;
  sansSerifFamily: string;
  serifFamily: string;
} {
  const face = formalSvgTextFace(svg);
  return {
    // Only the face the SVG's root names besides Metropolis.
    files: [
      ...SCHEMATIC_FONTS,
      ...(face === "metropolis" ? [] : DOCUMENT_FACE_FONTS[face].files),
      ...DEJAVU_FONTS,
    ],
    defaultFontFamily: "ICM Schematic",
    sansSerifFamily: "ICM Schematic",
    serifFamily: "DejaVu Serif",
  };
}

/** The formal SVG's browser serif stack, which resvg draws as DejaVu Serif. */
export function withHeadlessSerif(svg: string): string {
  return svg.replace("Georgia,'Times New Roman',serif", "DejaVu Serif");
}

/** resvg can reshape a mixed-family run with one fallback face. The composed
 * face keeps each style's Latin, symbols and period together. */
export function withHeadlessTextCompatibility(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  // A Document set in a face of its choosing (#1725) draws in that face,
  // then DejaVu.
  const families = [
    [globalSchematicTypography.fontFamily, '"ICM Schematic"'],
    ...Object.entries(DOCUMENT_FACE_FONTS).map(
      ([face, { family }]) =>
        [
          DOCUMENT_TEXT_FACE_FONT_FAMILIES[face as DocumentTextFace],
          `"${family}","DejaVu Sans"`,
        ] as const,
    ),
  ];
  for (const style of Array.from(document.getElementsByTagName("style")))
    for (const [family, headless] of families)
      style.textContent =
        style.textContent?.replaceAll(
          `font-family:${family}`,
          `font-family:${headless}`,
        ) ?? "";
  for (const element of Array.from(document.getElementsByTagName("*")))
    for (const [family, headless] of families)
      if (element.getAttribute("font-family") === family)
        element.setAttribute("font-family", headless.replaceAll('"', ""));
  // resvg 2.6 ignores relative glyph spacing when measuring a text anchor.
  // Label formulas use flat flowing runs; include their dx in the anchor so
  // operators clear adjoining fraction bars and scripts remain centered.
  for (const formula of Array.from(document.getElementsByTagName("g"))) {
    if (formula.getAttribute("data-role") !== "formula") continue;
    for (const text of Array.from(formula.getElementsByTagName("text"))) {
      const anchor = text.getAttribute("text-anchor");
      const factor = anchor === "end" ? 1 : anchor === "middle" ? 0.5 : 0;
      if (factor === 0) continue;
      const spans = Array.from(text.getElementsByTagName("tspan"));
      if (
        spans.some((span) => span.parentNode !== text || span.hasAttribute("x"))
      )
        continue;
      const spacing = spans.reduce(
        (sum, span) => sum + Number(span.getAttribute("dx") ?? 0),
        0,
      );
      const x = Number(text.getAttribute("x"));
      if (Number.isFinite(spacing) && Number.isFinite(x) && spacing !== 0)
        text.setAttribute("x", String(x - factor * spacing));
    }
  }
  return new XMLSerializer().serializeToString(document);
}
