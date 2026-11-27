import {
  SchematicDocumentSchema,
  createEmptyProject,
  createRoutePath,
  parseProjectSnapshot,
  restoreProjectSnapshot,
  validateProjectResult,
} from "@icm/model";
import { buildCommittedProjectConnectivityIndex } from "@icm/derived";
import { InMemorySymbolResolver } from "@icm/symbols";
import { expect, it, vi } from "vitest";
import { buildCommittedCanvasScene, buildSvgScene } from "./render.js";

function wireProject(length: number) {
  const project = createEmptyProject("canvas", "Canvas");
  const cell = project.documents[0]!;
  cell.nets.push({ id: "signal", terminals: [] });
  cell.junctions.push(
    { id: "left", netId: "signal", position: { x: 0, y: 0 } },
    { id: "right", netId: "signal", position: { x: length, y: 0 } },
  );
  cell.routes.push(
    createRoutePath({
      id: "wire",
      netId: "signal",
      start: { kind: "junction", junctionId: "left" },
      end: { kind: "junction", junctionId: "right" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return parseProjectSnapshot(project);
}

it("draws the same formal SVG, bounds, paint runs and interaction order without reparsing an indexed committed Cell", () => {
  const project = wireProject(120);
  const cell = project.documents[0]!;
  const resolver = new InMemorySymbolResolver([]);
  const index = buildCommittedProjectConnectivityIndex(
    project,
    resolver,
  ).documents.get(cell.id);
  const expected = buildSvgScene(structuredClone(cell), resolver, {
    canvasPaintRuns: "primary",
  });
  const parse = vi.spyOn(SchematicDocumentSchema, "parse");
  try {
    const actual = buildCommittedCanvasScene(cell, resolver, index, "primary");
    expect(actual).toEqual(expected);
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});

it("reuses a history restore only with the read for its new live revision", () => {
  const source = wireProject(120);
  const resolver = new InMemorySymbolResolver([]);
  const previous = buildCommittedProjectConnectivityIndex(
    source,
    resolver,
  ).documents.get(source.topDocumentId);
  const restored = restoreProjectSnapshot(source, 4, () => 9);
  const cell = restored.documents[0]!;
  const current = buildCommittedProjectConnectivityIndex(
    restored,
    resolver,
  ).documents.get(cell.id);
  const expected = buildSvgScene(structuredClone(cell), resolver);
  const parse = vi.spyOn(SchematicDocumentSchema, "parse");
  try {
    expect(buildCommittedCanvasScene(cell, resolver, previous, false)).toEqual(
      expected,
    );
    expect(parse).toHaveBeenCalledTimes(1);
    expect(buildCommittedCanvasScene(cell, resolver, current, false)).toEqual(
      expected,
    );
    expect(parse).toHaveBeenCalledTimes(1);
  } finally {
    parse.mockRestore();
  }
});

it("uses canonical geometry when another Project has the same Cell ID and revision or the resolver changes", () => {
  const resolver = new InMemorySymbolResolver([]);
  const original = wireProject(120);
  const index = buildCommittedProjectConnectivityIndex(
    original,
    resolver,
  ).documents.get(original.topDocumentId);
  const other = wireProject(420);
  const cases = [
    { cell: other.documents[0]!, symbols: resolver },
    { cell: original.documents[0]!, symbols: new InMemorySymbolResolver([]) },
    { cell: structuredClone(original.documents[0]!), symbols: resolver },
  ];
  for (const { cell, symbols } of cases) {
    const expected = buildSvgScene(cell, symbols);
    const parse = vi.spyOn(SchematicDocumentSchema, "parse");
    try {
      expect(buildCommittedCanvasScene(cell, symbols, index, false)).toEqual(
        expected,
      );
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  }
});

it("preserves canonical ordered schema errors even for an indexed immutable public receipt", () => {
  const receipt = validateProjectResult(wireProject(120));
  if (!receipt.success) throw receipt.error;
  Object.assign(receipt.data.documents[0]!.nets[0]!, { unexpected: undefined });
  const project = parseProjectSnapshot(receipt.data);
  const cell = project.documents[0]!;
  const resolver = new InMemorySymbolResolver([]);
  const index = buildCommittedProjectConnectivityIndex(
    project,
    resolver,
  ).documents.get(cell.id);
  const canonical = SchematicDocumentSchema.safeParse(cell);
  if (canonical.success) throw new Error("invalid public receipt was accepted");
  expect(() => buildCommittedCanvasScene(cell, resolver, index, false)).toThrow(
    canonical.error,
  );
});
