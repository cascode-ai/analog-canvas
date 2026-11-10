import { createEmptyProject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildProjectSearchIndex } from "./project-search.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** A community Capacitor C1 (by its library symbol ID) beside an op-amp X1. */
function project() {
  const project = createEmptyProject("find", "Find");
  const document = project.documents[0]!;
  const capacitor = builtInSymbols.find((symbol) => symbol.id === "capacitor")!;
  project.componentDefinitions = [
    {
      symbol: {
        ...structuredClone(capacitor),
        id: "user-20e13ae8-5f1c",
        name: "Capacitor",
      },
    },
  ];
  document.instances.push(
    {
      id: "C1",
      reference: "C1",
      symbolId: "user-20e13ae8-5f1c",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1p" } },
    },
    {
      id: "X1",
      reference: "X1",
      symbolId: "opamp",
      placement: { position: { x: 200, y: 0 }, rotation: 0, mirror: "none" },
    },
  );
  return project;
}

const found = (query: string, withResolver = true) =>
  buildProjectSearchIndex(project(), withResolver ? { resolver } : {})
    .search(query)
    .map((result) => [result.locator.objectId, result.field]);

describe("Find in Circuit", () => {
  it("finds a community component by the name people see (#2185)", () => {
    expect(found("capacitor", false)).toEqual([["C1", "component-name"]]);
    expect(found("CAPAC", false)).toEqual([["C1", "component-name"]]);
  });

  it("names built-in symbols as the Library does", () => {
    expect(found("operational")).toEqual([["X1", "component-name"]]);
    expect(found("operational", false)).toEqual([]);
  });

  it("keeps matching the Reference, parameters and symbol ID", () => {
    expect(found("c1")).toEqual([["C1", "instance-id"]]);
    expect(found("1p")).toEqual([["C1", "property"]]);
    expect(found("user-20e13ae8")).toEqual([["C1", "symbol"]]);
  });
});
