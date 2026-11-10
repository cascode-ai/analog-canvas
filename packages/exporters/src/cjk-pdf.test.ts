import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { jsPDF } from "jspdf";
import { schematicRoundPeriodFontBase64 } from "@icm/derived";
import { describe, expect, it } from "vitest";

import { pdfTextPlan } from "./browser-pdf.js";
import { cjkFaceForGlyph } from "./cjk-pdf-faces.js";
import { cjkFaceUrls } from "./cjk-pdf-faces.generated.js";
import {
  blankFor,
  NARROW_BLANK,
  omittedGlyphsNotice,
  unwritableGlyphs,
  WIDE_BLANK,
  writableCodePoints,
} from "./font-coverage.js";
import type { PdfFontStyle } from "./svg2pdf-compat.js";

function face(path: string): Uint8Array {
  return readFileSync(new URL(`../fonts/${path}`, import.meta.url));
}
const cjkFace = (index: number) =>
  face(`cjk/ICMCJK-${String.fromCharCode(65 + index)}.ttf`);
const metropolis = face("metropolis/Metropolis-Regular.ttf");
const dejaVuDirectory = dirname(
  createRequire(import.meta.url).resolve("dejavu-fonts-ttf/package.json"),
);
const dejaVu = (name: string) =>
  readFileSync(join(dejaVuDirectory, "ttf", `${name}.ttf`));

/**
 * The text a PDF shows, as an extractor reads it: each `<hex> Tj` decoded
 * through the ToUnicode map of the font the preceding `Tf` selected.
 */
function extractText(pdf: string): string {
  const objects = new Map(
    [...pdf.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/gu)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
  const resources = new Map(
    [...pdf.matchAll(/\/(F\d+) (\d+) 0 R/gu)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
  const toUnicode = (font: string) => {
    const dictionary = objects.get(resources.get(font)!)!;
    const cmap = objects.get(/\/ToUnicode (\d+) 0 R/u.exec(dictionary)![1]!)!;
    return new Map(
      [...cmap.matchAll(/<([0-9a-f]{4})><([0-9a-f]{4})>/gu)].map((match) => [
        match[1]!,
        String.fromCharCode(Number.parseInt(match[2]!, 16)),
      ]),
    );
  };
  let text = "";
  for (const [, font, hex] of pdf.matchAll(
    /\/(F\d+) [\d.]+ Tf[^<]*<([0-9a-f]*)> Tj/gu,
  )) {
    const map = toUnicode(font!);
    for (const code of hex!.match(/.{4}/gu) ?? [])
      text += code === "0000" ? "�" : (map.get(code) ?? "�");
  }
  return text;
}

describe("CJK text in vector PDF (#2179)", () => {
  it("reads which characters a face can write from its cmap", () => {
    const latin = writableCodePoints(metropolis);
    expect(latin.has(0x41)).toBe(true);
    expect(latin.has(0x6d4b)).toBe(false);
    const period = writableCodePoints(
      Buffer.from(schematicRoundPeriodFontBase64, "base64"),
    );
    expect(period.has(0x2e)).toBe(true);
    const symbols = writableCodePoints(dejaVu("DejaVuSans-Bold"));
    expect(symbols.has(0x3a9)).toBe(true);
    expect(symbols.has(0x6d4b)).toBe(false);
  });

  it("names the characters a face lacks, but not invisible ones", () => {
    const latin = writableCodePoints(metropolis);
    expect(unwritableGlyphs([..."测试 ABC\n123"], latin)).toEqual(["测", "试"]);
    // A joiner and a variation selector draw nothing of their own.
    expect(
      unwritableGlyphs([..."😀\u200d\ufe0f"], writableCodePoints(cjkFace(0))),
    ).toEqual(["😀"]);
  });

  it("writes a left-out character as a blank its blank face holds", () => {
    expect(blankFor("한")).toBe(WIDE_BLANK);
    expect(blankFor("😀")).toBe(WIDE_BLANK);
    expect(blankFor("ก")).toBe(NARROW_BLANK);
    expect(blankFor("\u200d")).toBe("");
    expect(writableCodePoints(cjkFace(0)).has(WIDE_BLANK.codePointAt(0)!)).toBe(
      true,
    );
    for (const style of ["", "-Bold", "-Oblique", "-BoldOblique"])
      expect(
        writableCodePoints(dejaVu(`DejaVuSans${style}`)).has(
          NARROW_BLANK.codePointAt(0)!,
        ),
      ).toBe(true);
  });

  it("says plainly what a PDF was saved without", () => {
    expect(omittedGlyphsNotice(["한"])).toBe(
      "PDF saved without 한 (U+D55C): no PDF font has it. Export SVG or PNG to keep it.",
    );
    expect(omittedGlyphsNotice(["한", "😀", "㐀", "ก"])).toBe(
      "PDF saved without 한 (U+D55C), 😀 (U+1F600), 㐀 (U+3400) and 1 more: no PDF font has them. Export SVG or PNG to keep them.",
    );
  });

  it("finds each CJK character in the face cut for it", () => {
    expect(cjkFaceUrls).toHaveLength(14);
    for (const [index] of cjkFaceUrls.entries()) {
      const misplaced = [...writableCodePoints(cjkFace(index))].filter(
        (point) => cjkFaceForGlyph(String.fromCodePoint(point)) !== index,
      );
      expect(misplaced).toEqual([]);
    }
    expect(cjkFaceForGlyph("测")).toBe(0);
    expect(cjkFaceForGlyph("試")).toBeGreaterThan(0);
    // Outside the CJK blocks: Latin, Greek, Hangul, Extension A, emoji.
    for (const glyph of ["A", "Ω", "한", "㐀", "😀"])
      expect(cjkFaceForGlyph(glyph)).toBeUndefined();
  });

  it("writes 测试 ABC 123 as text an extractor reads back", () => {
    const pdf = new jsPDF({ unit: "pt", format: [300, 80], compress: false });
    const faces = [
      ["ICM CJK common", cjkFace(cjkFaceForGlyph("测")!)],
      ["ICM CJK rare", cjkFace(cjkFaceForGlyph("試")!)],
      ["ICM Schematic", metropolis],
    ] as const;
    for (const [family, bytes] of faces) {
      pdf.addFileToVFS(`${family}.ttf`, Buffer.from(bytes).toString("base64"));
      pdf.addFont(`${family}.ttf`, family, "normal");
    }
    pdf.setFont("ICM CJK common").text("测试", 10, 40);
    pdf.setFont("ICM Schematic").text(" ABC 123", 42, 40);
    pdf.setFont("ICM CJK rare").text("試", 120, 40, { angle: 30 });
    const output = pdf.output();
    expect(extractText(output)).toBe("测试 ABC 123試");
    // jsPDF embeds the glyphs used, not the 1.2 MB face.
    expect(output.length).toBeLessThan(200_000);
  });

  it("saves 测한 ABC 123 with its hanzi, naming the Hangul it leaves out", () => {
    const faces: Record<string, Uint8Array> = {
      "ICM Schematic": metropolis,
      "ICM Symbols": dejaVu("DejaVuSans"),
      "ICM CJK A": cjkFace(0),
    };
    const read = (family: string) => {
      const bytes = faces[family];
      if (!bytes) throw new Error(`Unexpected face ${family}`);
      return bytes;
    };
    const text = "测한 ABC 123";
    const style: PdfFontStyle = "normal";
    const plan = pdfTextPlan(
      new Map([[style, new Set(text)]]),
      "metropolis",
      (family) => writableCodePoints(read(family)),
    );
    expect(plan.omitted).toEqual(["한"]);
    expect(omittedGlyphsNotice(plan.omitted)).toContain("without 한 (U+D55C)");

    // Runs of one face, as setTextInFamilies sets them.
    const runs: { family: string; text: string }[] = [];
    for (const glyph of text) {
      const placed = plan.place(glyph, style);
      const last = runs.at(-1);
      if (last?.family === placed.family) last.text += placed.text;
      else runs.push({ ...placed });
    }
    const pdf = new jsPDF({ unit: "pt", format: [300, 80], compress: false });
    for (const family of new Set(runs.map((run) => run.family))) {
      pdf.addFileToVFS(
        `${family}.ttf`,
        Buffer.from(read(family)).toString("base64"),
      );
      pdf.addFont(`${family}.ttf`, family, "normal");
    }
    let x = 10;
    for (const run of runs) {
      pdf.setFont(run.family).text(run.text, x, 40);
      x += pdf.getTextWidth(run.text);
    }
    expect(extractText(pdf.output())).toBe(`测${WIDE_BLANK} ABC 123`);
  });
});
