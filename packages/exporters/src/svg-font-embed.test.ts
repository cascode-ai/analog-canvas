import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  withMetropolisLineMetrics,
  embedSvgFontSubsets,
  svgTextCharacters,
  type SvgFontEmbedSources,
} from "./svg-font-embed.js";

const sources: SvgFontEmbedSources = {
  wasm: async () =>
    readFile(
      fileURLToPath(
        import.meta.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"),
      ),
    ),
  readFont: async (file) =>
    readFile(fileURLToPath(new URL(`../fonts/${file}`, import.meta.url))),
};

const label = (text: string, style = "font-style:italic;font-weight:700") =>
  `<text x="0" y="0"><tspan style="${style}">${text}</tspan></text>`;
const svg = (body: string, root = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${root}><style>@font-face{font-family:"ICM Round Period";src:url(data:font/ttf;base64,AA==) format("truetype");font-weight:400;font-style:normal;font-display:block;unicode-range:U+002E}text{font-family:'ICM Round Period','Metropolis',sans-serif}</style>${body}</svg>`;

describe("embedding ICM Schematic subsets", () => {
  it("reads each character in the face it is drawn in", () => {
    const source = svg(
      `<text><tspan style="font-style:italic;font-weight:400"><tspan style="font-weight:700">M</tspan></tspan><tspan font-weight="700">1&amp; </tspan>Ω</text>`,
    );
    const read = Object.fromEntries(
      [...svgTextCharacters(source)].map(([style, set]) => [
        style,
        [...set]
          .map((c) => String.fromCodePoint(c))
          .sort()
          .join(""),
      ]),
    );
    expect(read).toEqual({ boldItalic: "M", bold: " &1", regular: "Ω" });
  });

  it("embeds one small face per style, replacing the round period rules", async () => {
    const source = svg(label("M1") + label("VDD"));
    const embedded = await embedSvgFontSubsets(source, sources);
    expect(embedded).not.toContain('ICM Round Period";');
    // Only the bold italic the labels use.
    expect(embedded.match(/@font-face/gu)).toHaveLength(1);
    expect(embedded).toContain(
      "font-family:'ICM Schematic','ICM Round Period','Metropolis'",
    );
    // One face of five characters: a few kilobytes, not the 570 KB file.
    expect(embedded.length - source.length).toBeLessThan(10_000);
    // Embedding twice changes nothing.
    expect(await embedSvgFontSubsets(embedded, sources)).toBe(embedded);
  });

  it("leaves an SVG without text or with another Document face alone", async () => {
    const empty = svg("<line/>");
    expect(await embedSvgFontSubsets(empty, sources)).toBe(empty);
    const serif = svg(label("R1"), ' data-text-face="serif"');
    expect(await embedSvgFontSubsets(serif, sources)).toBe(serif);
  });

  it("sizes text boxes as the editor's Metropolis does", async () => {
    const embedded = await embedSvgFontSubsets(svg(label("M1")), sources);
    const font = Buffer.from(
      /base64,([A-Za-z0-9+/=]+)/u.exec(embedded)![1]!,
      "base64",
    );
    const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
    const table = (tag: string) => {
      for (let index = 0; index < view.getUint16(4); index += 1) {
        const record = 12 + index * 16;
        if (font.subarray(record, record + 4).toString("latin1") === tag)
          return view.getUint32(record + 8);
      }
      throw new Error(tag);
    };
    expect([
      view.getInt16(table("hhea") + 4),
      view.getInt16(table("hhea") + 6),
    ]).toEqual([795, -205]);
    expect(withMetropolisLineMetrics(new Uint8Array(12))).toHaveLength(12);
  });
});
