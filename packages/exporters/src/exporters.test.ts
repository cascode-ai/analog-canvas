import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyDocument, createRoutePath } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { createFormalExportSource } from "./index.js";
import { exportFormalArtifacts } from "./node.js";

describe("formal exporters", () => {
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
