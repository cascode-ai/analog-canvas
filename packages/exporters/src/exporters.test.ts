import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

import { createEmptyDocument, createRoutePath } from "@icm/model";
import { globalSchematicTypography } from "@icm/derived";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { createFormalExportSource } from "./index.js";
import { exportFormalArtifacts, rasterizeSvgBytes } from "./node.js";

describe("formal exporters", () => {
  it.each(["Regular", "RegularItalic", "Bold", "BoldItalic"])(
    "keeps the original %s ellipsis when composing the round-period face",
    (face) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><text x="10" y="60" font-size="48" font-family="${globalSchematicTypography.fontFamily}" font-weight="${face.startsWith("Bold") ? "bold" : "normal"}" font-style="${face.endsWith("Italic") ? "italic" : "normal"}">…</text></svg>`;
      const original = new Resvg(svg, {
        font: {
          loadSystemFonts: false,
          fontFiles: [
            resolve(
              process.cwd(),
              `packages/exporters/fonts/metropolis/Metropolis-${face}.ttf`,
            ),
          ],
          defaultFontFamily: "Metropolis",
        },
      })
        .render()
        .asPng();
      expect(Buffer.from(rasterizeSvgBytes(svg, 180))).toEqual(original);
    },
  );

  it.each([
    ["end", 10],
    ["middle", 10],
    ["end", -6],
    ["middle", -6],
  ] as const)(
    "includes a %s-anchored formula's %s-unit spacing in its alignment",
    (anchor, gap) => {
      // Pinned Bold Italic advances: R = 700 and minus = 636 units / 1000 em.
      const width = (0.7 + 0.636) * 20 + gap;
      const start = 100 - width * (anchor === "end" ? 1 : 0.5);
      const svg = (x: number, alignment: string) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><g data-role="formula" font-family="${globalSchematicTypography.fontFamily}"><text x="${x}" y="50" text-anchor="${alignment}" font-size="20" font-style="italic" font-weight="bold"><tspan>R</tspan><tspan dx="${gap}">−</tspan></text><line x1="101" y1="44" x2="150" y2="44" stroke="black"/></g></svg>`;
      expect(Buffer.from(rasterizeSvgBytes(svg(100, anchor), 180))).toEqual(
        Buffer.from(rasterizeSvgBytes(svg(start, "start"), 180)),
      );
    },
  );

  it.each(["R", "β", "R.β"])(
    "preserves four distinct headless font styles for %s",
    (glyph) => {
      const renders = [
        ["normal", "normal"],
        ["bold", "normal"],
        ["normal", "italic"],
        ["bold", "italic"],
      ].map(([weight, style]) =>
        Buffer.from(
          rasterizeSvgBytes(
            `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><text x="10" y="60" font-size="48" font-family="${globalSchematicTypography.fontFamily}" font-weight="${weight}" font-style="${style}">${glyph}</text></svg>`,
            160,
          ),
        ).toString("base64"),
      );
      expect(new Set(renders).size).toBe(4);
    },
  );

  it("crops formal file exports to one line-width of surrounding whitespace", () => {
    const document = createEmptyDocument("tight-crop", "Tight crop");
    document.nets.push({ id: "net", terminals: [] });
    document.junctions.push(
      { id: "left", netId: "net", position: { x: 0, y: 0 } },
      { id: "right", netId: "net", position: { x: 100, y: 0 } },
    );
    document.routes.push(
      createRoutePath({
        id: "route",
        netId: "net",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "right" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resolver = new InMemorySymbolResolver([]);

    const compact = createFormalExportSource(document, resolver);
    expect(compact.bounds).toEqual({ x: -2, y: -2, width: 104, height: 4 });
    expect(compact.svg).toContain('viewBox="-2 -2 104 4"');

    const explicit = createFormalExportSource(document, resolver, {
      margin: 10,
    });
    expect(explicit.bounds).toEqual({
      x: -10,
      y: -10,
      width: 120,
      height: 20,
    });
  });

  it("derives SVG, PNG, and PDF from one formal scene", async () => {
    const project = parseProject(
      readFileSync(
        resolve(
          process.cwd(),
          "fixtures/projects/differential-stage/project.icproj.json",
        ),
        "utf8",
      ),
    );
    const document = project.documents.find(
      (candidate) => candidate.id === project.topDocumentId,
    )!;
    const source = createFormalExportSource(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      { title: project.name },
    );
    const artifacts = await exportFormalArtifacts(source, 3);
    expect(new TextDecoder().decode(artifacts.svg)).toBe(source.svg);
    expect([...artifacts.png.bytes.slice(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(new TextDecoder().decode(artifacts.pdf.slice(0, 8))).toMatch(
      /^%PDF-/u,
    );
    expect(artifacts.png.width).toBe(Math.round(source.bounds.width * 3));
    expect(artifacts.png.height).toBe(Math.round(source.bounds.height * 3));
    expect(source.svg).toContain('data-layer="formal"');
    expect(source.svg).not.toMatch(/editor-overlay|hit-target|flightline/u);
  });
});
