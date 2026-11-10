import dejaVuSansUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";
import dejaVuSansBoldUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import dejaVuSansBoldObliqueUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url";
import dejaVuSansObliqueUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url";
import { jsPDF } from "jspdf";
import {
  schematicRoundPeriodFontBase64,
  type SchematicTextFace,
} from "@icm/derived";
import metropolisUrl from "../fonts/metropolis/Metropolis-Regular.ttf?url";
import metropolisBoldUrl from "../fonts/metropolis/Metropolis-Bold.ttf?url";
import metropolisItalicUrl from "../fonts/metropolis/Metropolis-RegularItalic.ttf?url";
import metropolisBoldItalicUrl from "../fonts/metropolis/Metropolis-BoldItalic.ttf?url";
import serifUrl from "../fonts/liberation-serif/LiberationSerif-Regular.ttf?url";
import serifBoldUrl from "../fonts/liberation-serif/LiberationSerif-Bold.ttf?url";
import serifItalicUrl from "../fonts/liberation-serif/LiberationSerif-Italic.ttf?url";
import serifBoldItalicUrl from "../fonts/liberation-serif/LiberationSerif-BoldItalic.ttf?url";
import { metropolisGlyphs } from "./metropolis-coverage.generated.js";
import { serifGlyphs } from "./serif-coverage.generated.js";
import { cjkFaceUrls } from "./cjk-pdf-faces.generated.js";

import type { FormalExportSource, RasterExport } from "./index.js";
import { EXPORT_VERSION } from "./index.js";
import { rasterizeFormalSvgInBrowser } from "./browser-raster.js";
import { formalSvgTextFace } from "./browser-fonts.js";
import { cjkFaceForGlyph } from "./cjk-pdf-faces.js";
import {
  blankFor,
  omittedGlyphsNotice,
  unwritableGlyphs,
  WIDE_BLANK,
  writableCodePoints,
} from "./font-coverage.js";
import {
  normalizeFormalSvgForSvg2Pdf,
  setTextInFamilies,
  textGlyphsByStyle,
  type PdfFontStyle,
  type PdfGlyph,
} from "./svg2pdf-compat.js";

/**
 * Embed the same stack the canvas draws: Metropolis, DejaVu for glyphs it
 * lacks, and the round period; or, for a Document set in the Times-style
 * face, unmodified Liberation Serif and DejaVu. CJK text, which the canvas
 * draws in a system face, takes the CJK faces in either case; they have one
 * weight, so bold or italic CJK text is set upright and regular. Load only
 * the faces used by this export.
 */
const SCHEMATIC_FAMILY = "ICM Schematic";
const SERIF_FAMILY = "ICM Schematic Serif";
const SYMBOL_FAMILY = "ICM Symbols";
const PERIOD_FAMILY = "ICM Round Period";
// Letters, not digits: a family name token may not start with a digit.
const CJK_FAMILIES = cjkFaceUrls.map(
  (_, index) => `ICM CJK ${String.fromCharCode(65 + index)}`,
);
/** The face holding WIDE_BLANK: the first. */
const CJK_WIDE_BLANK_FAMILY = "ICM CJK A";
const periodUrl = `data:font/ttf;base64,${schematicRoundPeriodFontBase64}`;
function everyStyle(url: string): Record<PdfFontStyle, string> {
  return { normal: url, bold: url, italic: url, bolditalic: url };
}
const SCHEMATIC_FACES: Record<string, Record<PdfFontStyle, string>> = {
  [SCHEMATIC_FAMILY]: {
    normal: metropolisUrl,
    bold: metropolisBoldUrl,
    italic: metropolisItalicUrl,
    bolditalic: metropolisBoldItalicUrl,
  },
  [SERIF_FAMILY]: {
    normal: serifUrl,
    bold: serifBoldUrl,
    italic: serifItalicUrl,
    bolditalic: serifBoldItalicUrl,
  },
  [SYMBOL_FAMILY]: {
    normal: dejaVuSansUrl,
    bold: dejaVuSansBoldUrl,
    italic: dejaVuSansObliqueUrl,
    bolditalic: dejaVuSansBoldObliqueUrl,
  },
  [PERIOD_FAMILY]: everyStyle(periodUrl),
  ...Object.fromEntries(
    cjkFaceUrls.map((url, index) => [CJK_FAMILIES[index], everyStyle(url)]),
  ),
};
/** The family for a glyph neither primary face holds. */
function fallbackFamily(glyph: string): string {
  const face = cjkFaceForGlyph(glyph);
  return (face === undefined ? undefined : CJK_FAMILIES[face]) ?? SYMBOL_FAMILY;
}
const primaryGlyphs = new Set(metropolisGlyphs);
function familyForGlyph(glyph: string): string {
  return glyph === "."
    ? PERIOD_FAMILY
    : primaryGlyphs.has(glyph)
      ? SCHEMATIC_FAMILY
      : fallbackFamily(glyph);
}
const serifPrimaryGlyphs = new Set(serifGlyphs);
function serifFamilyForGlyph(glyph: string): string {
  return serifPrimaryGlyphs.has(glyph) ? SERIF_FAMILY : fallbackFamily(glyph);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

/** A face file, read once however many families and styles stand for it. */
interface FaceFile {
  file: string;
  bytes: ArrayBuffer;
  /** What jsPDF can write in it. */
  writable: ReadonlySet<number>;
}
type FaceFiles = (family: string, style: PdfFontStyle) => Promise<FaceFile>;

function faceFiles(): FaceFiles {
  const files = new Map<string, Promise<FaceFile>>();
  return (family, style) => {
    const sources = SCHEMATIC_FACES[family];
    if (!sources) throw new Error(`Unknown schematic font ${family}`);
    const url = sources[style];
    let file = files.get(url);
    if (!file) {
      file = (async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Vector PDF could not load the schematic font (HTTP ${response.status})`,
          );
        }
        const bytes = await response.arrayBuffer();
        return {
          file: `${family}-${style}.ttf`,
          bytes,
          writable: writableCodePoints(new Uint8Array(bytes)),
        };
      })();
      files.set(url, file);
    }
    return file;
  };
}

/** Each family a style's characters are set in, with its characters. */
function glyphsByFamily(
  glyphs: Iterable<string>,
  familyFor: (glyph: string) => string,
): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const glyph of glyphs) {
    const family = familyFor(glyph);
    const list = families.get(family) ?? [];
    families.set(family, list);
    list.push(glyph);
  }
  return families;
}

/**
 * Where each character of the scene's text goes, once the faces it asks
 * for are read: its own face, or, where that face lacks it, a blank of
 * about its width; jsPDF would write it as nothing, and the rest of its run
 * with it. The characters left out are returned for the export to name.
 */
export function pdfTextPlan(
  glyphs: ReadonlyMap<PdfFontStyle, ReadonlySet<string>>,
  textFace: SchematicTextFace,
  writable: (family: string, style: PdfFontStyle) => ReadonlySet<number>,
): {
  /** Where a character set in a style goes. */
  place: (glyph: string, style: PdfFontStyle) => PdfGlyph;
  omitted: string[];
} {
  const familyFor = textFace === "serif" ? serifFamilyForGlyph : familyForGlyph;
  const omitted = new Set<string>();
  for (const [style, set] of glyphs)
    for (const [family, list] of glyphsByFamily(set, familyFor))
      for (const glyph of unwritableGlyphs(list, writable(family, style)))
        omitted.add(glyph);
  return {
    place: (glyph, style) => {
      const family = familyFor(glyph);
      if (writable(family, style).has(glyph.codePointAt(0) ?? 0))
        return { family, text: glyph };
      const text = blankFor(glyph);
      return {
        family: text === WIDE_BLANK ? CJK_WIDE_BLANK_FAMILY : SYMBOL_FAMILY,
        text,
      };
    },
    omitted: [...omitted],
  };
}

/** Set the scene's text in the faces that hold it, as pdfTextPlan says. */
async function setTextInFaces(
  svg: SVGSVGElement,
  textFace: SchematicTextFace,
  files: FaceFiles,
): Promise<{
  families: Map<string, Set<PdfFontStyle>>;
  omitted: string[];
}> {
  const glyphs = textGlyphsByStyle(svg);
  const familyFor = textFace === "serif" ? serifFamilyForGlyph : familyForGlyph;
  const writable = new Map<string, ReadonlySet<number>>();
  for (const [style, set] of glyphs)
    for (const family of glyphsByFamily(set, familyFor).keys())
      writable.set(`${family}/${style}`, (await files(family, style)).writable);
  const plan = pdfTextPlan(
    glyphs,
    textFace,
    (family, style) => writable.get(`${family}/${style}`) ?? new Set(),
  );
  return {
    families: setTextInFamilies(svg, plan.place),
    omitted: plan.omitted,
  };
}

/**
 * Embed each face in the PDF, and add it to the page for the conversion:
 * svg2pdf measures text in the page to place what follows it, so the page
 * must measure with the face the PDF draws. Returns the page's release.
 */
async function embedSchematicFaces(
  pdf: jsPDF,
  families: ReadonlyMap<string, ReadonlySet<PdfFontStyle>>,
  files: FaceFiles,
): Promise<() => void> {
  const faces: FontFace[] = [];
  // svg2pdf measures in a text element of its own that names the family,
  // but the scene's stylesheet, once in the page, sets every text element's
  // family; give that element back the family it names.
  const measuring = document.createElement("style");
  measuring.textContent = [...families.keys()]
    .map((family) => `text[font-family="${family}"]{font-family:"${family}"}`)
    .join("");
  const release = () => {
    for (const face of faces) document.fonts.delete(face);
    measuring.remove();
  };
  document.head.append(measuring);
  try {
    const stored = new Set<string>();
    for (const [family, styles] of families) {
      for (const style of styles) {
        const { file, bytes } = await files(family, style);
        if (!stored.has(file)) {
          pdf.addFileToVFS(file, base64(new Uint8Array(bytes)));
          stored.add(file);
        }
        pdf.addFont(file, family, style);
        const face = new FontFace(family, bytes, {
          weight: style.startsWith("bold") ? "700" : "400",
          style: style.endsWith("italic") ? "italic" : "normal",
        });
        await face.load();
        document.fonts.add(face);
        faces.push(face);
      }
    }
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

function formalSvgElement(source: FormalExportSource): {
  host: HTMLDivElement;
  svg: SVGSVGElement;
} {
  const template = document.createElement("template");
  template.innerHTML = source.svg;
  const svg = template.content.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("Formal export did not produce an SVG element");
  }

  // svg2pdf reads inherited styles and computed geometry from the live DOM. The
  // formal scene is renderer-generated, not user-supplied SVG, and this hidden
  // host is removed immediately after conversion.
  svg.setAttribute("width", String(source.bounds.width));
  svg.setAttribute("height", String(source.bounds.height));
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;pointer-events:none;";
  host.append(svg);
  document.body.append(host);
  normalizeFormalSvgForSvg2Pdf(svg);
  return { host, svg };
}

export { omittedGlyphsRefusal } from "./font-coverage.js";

/** A vector PDF, and what it could not write. */
export interface VectorPdfExport {
  bytes: Uint8Array;
  /** Characters no PDF face holds, written as blank space. */
  omitted: string[];
  /** Says so, for the person or Agent that asked; absent when none. */
  notice?: string;
}

/** Converts the canonical formal SVG into a vector PDF in the browser. */
export async function vectorizeFormalSvgInBrowser(
  source: FormalExportSource,
): Promise<VectorPdfExport> {
  const widthPoints = source.bounds.width * 0.75;
  const heightPoints = source.bounds.height * 0.75;
  const pdf = new jsPDF({
    orientation: widthPoints > heightPoints ? "landscape" : "portrait",
    unit: "pt",
    format: [widthPoints, heightPoints],
    compress: true,
    precision: 16,
  });
  pdf.setProperties({
    title: "Analog Canvas schematic",
    author: "Analog Canvas",
    creator: `Analog Canvas exporter ${EXPORT_VERSION}`,
  });
  pdf.setCreationDate(new Date("2000-01-01T00:00:00.000Z"));

  const { host, svg } = formalSvgElement(source);
  let releaseFaces = () => {};
  try {
    const files = faceFiles();
    const { families, omitted } = await setTextInFaces(
      svg,
      formalSvgTextFace(source.svg),
      files,
    );
    releaseFaces = await embedSchematicFaces(pdf, families, files);
    // svg2pdf's published UMD entry reads browser globals while it is loaded.
    // Loading it only for an actual browser PDF request keeps the exporter
    // module usable in Node-based editor tests and headless tooling.
    const { svg2pdf } = await import("svg2pdf.js");
    await svg2pdf(svg, pdf, {
      x: 0,
      y: 0,
      width: widthPoints,
      height: heightPoints,
      loadExternalStyleSheets: false,
      loadImages: false,
    });
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    return omitted.length
      ? { bytes, omitted, notice: omittedGlyphsNotice(omitted) }
      : { bytes, omitted };
  } finally {
    releaseFaces();
    host.remove();
  }
}

/** Backward-compatible combined export for callers that explicitly need both. */
export async function exportFormalArtifactsInBrowser(
  source: FormalExportSource,
): Promise<{ png: RasterExport; pdf: VectorPdfExport }> {
  const png = await rasterizeFormalSvgInBrowser(source);
  return { png, pdf: await vectorizeFormalSvgInBrowser(source) };
}
