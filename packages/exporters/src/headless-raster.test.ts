import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProject } from "@icm/project-protocol";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  measureFormalExportSourceHeadless,
  rasterizeFormalSvgHeadless,
} from "./headless-raster.js";
import { createFormalExportSource } from "./index.js";
import { exportFormalArtifacts } from "./node.js";

function differentialStage() {
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
  return createFormalExportSource(
    document,
    new InMemorySymbolResolver(builtInSymbols),
    { title: project.name },
  );
}

describe("WebAssembly formal raster", () => {
  it("draws the PNG the native exporter draws", async () => {
    const source = differentialStage();
    const png = await rasterizeFormalSvgHeadless(source, 3);
    const native = await exportFormalArtifacts(source, 3);
    expect(png.width).toBe(native.png.width);
    expect(png.height).toBe(native.png.height);
    expect(Buffer.from(png.bytes)).toEqual(Buffer.from(native.png.bytes));
  });

  it("crops to what it draws, background included, and keeps that crop", async () => {
    const source = differentialStage();
    const measured = await measureFormalExportSourceHeadless(source, 2);
    const { x, y, width, height } = measured.bounds;
    expect(measured.svg).toContain(`viewBox="${x} ${y} ${width} ${height}"`);
    expect(measured.svg).toContain(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}"`,
    );
    // A crop of the crop does not move: everything drawn is inside it.
    const again = await measureFormalExportSourceHeadless(measured, 2);
    for (const key of ["x", "y", "width", "height"] as const)
      expect(again.bounds[key]).toBeCloseTo(measured.bounds[key], 3);
    // The estimate and the measurement agree to within a label's height.
    for (const key of ["x", "y", "width", "height"] as const)
      expect(Math.abs(measured.bounds[key] - source.bounds[key])).toBeLessThan(
        20,
      );
  });
});
