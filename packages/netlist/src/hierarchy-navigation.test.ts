import { expect, it } from "vitest";
import type { HierarchyFrame } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  buildProjectConnectivityIndex,
  findHierarchyPaths,
  traceHierarchyNet,
} from "@icm/derived";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  analyzeDesignNetlist,
  printSpiceNetlist,
  printSpectreNetlist,
} from "./index.js";
import { hierarchyNavigationFixture } from "../../../netlists/hierarchy-navigation/fixture";

it("round-trips four Cells and exports every level in SPICE and Spectre", () => {
  const project = parseProject(serializeProject(hierarchyNavigationFixture()));
  const analysis = analyzeDesignNetlist(project);
  expect(analysis.diagnostics.filter((d) => d.severity === "error")).toEqual(
    [],
  );
  expect(analysis.ir!.cells).toHaveLength(4);
  const spice = printSpiceNetlist(analysis.ir!);
  const spectre = printSpectreNetlist(analysis.ir!);
  expect(spice).toMatch(/X1 .* Channel gain=20/u);
  expect(spice).toMatch(/X2 .* Channel gain=30/u);
  expect(spice).toMatch(/XA .* Amplifier/u);
  expect(spice).toMatch(/XP .* Pair/u);
  expect(spice).toMatch(/R1 .* \{gain\}/u);
  expect(spectre).toContain("subckt Channel");
  expect(spectre).toContain("subckt Amplifier");
  expect(spectre).toContain("subckt Pair");
});

it("keeps two distinct three-edge occurrence paths and traces across every boundary", () => {
  const project = hierarchyNavigationFixture();
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const index = buildProjectConnectivityIndex(project, resolver);
  const paths = findHierarchyPaths(index, "top", "pair")!;
  expect(paths.map((path) => path.map((f) => f.instanceId))).toEqual([
    ["X1", "XA", "XP"],
    ["X2", "XA", "XP"],
  ]);
  for (const expectedPath of paths) {
    let currentId = "top";
    let path: readonly HierarchyFrame[] = [];
    for (const frame of expectedPath) {
      const trace = traceHierarchyNet(index, currentId, "IN", undefined, path)!;
      const hop = trace.hops.find(
        (h) =>
          h.direction === "down" &&
          h.frame.instanceId === frame.instanceId &&
          h.from.documentId === currentId &&
          JSON.stringify(h.from.hierarchyPath) === JSON.stringify(path),
      )!;
      expect(hop.to.documentId).toBe(frame.childDocumentId);
      path = hop.to.hierarchyPath;
      currentId = hop.to.documentId;
    }
    expect(path).toEqual(expectedPath);
    for (const frame of [...expectedPath].reverse()) {
      const trace = traceHierarchyNet(index, currentId, "IN", undefined, path)!;
      const hop = trace.hops.find(
        (h) =>
          h.direction === "up" &&
          h.frame.instanceId === frame.instanceId &&
          h.from.documentId === currentId &&
          JSON.stringify(h.from.hierarchyPath) === JSON.stringify(path),
      )!;
      expect(hop.to.documentId).toBe(frame.parentDocumentId);
      path = hop.to.hierarchyPath;
      currentId = hop.to.documentId;
    }
    expect(currentId).toBe("top");
    expect(path).toEqual([]);
  }
});
