import { createEmptyDocument, createEmptyProject } from "@icm/model";
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
  it("finds every Bench occurrence from either top setting and still finds independent definitions", () => {
    const source = createEmptyProject("find-roots", "Find roots", "Top");
    const bench = createEmptyDocument("Bench", "Bench");
    const gain = createEmptyDocument("Gain", "Gain");
    const spare = createEmptyDocument("Spare", "Spare");
    for (const [cell, id] of [
      [gain, "RSENSE"],
      [spare, "RSPARE"],
    ] as const)
      cell.instances.push({ id, symbolId: "resistor", placement: null });
    bench.instances = ["X1", "X2"].map((id) => ({
      id,
      reference: id,
      symbolId: "cell-gain",
      placement: null,
      netlist: {
        binding: { kind: "subcircuit" as const, childDocumentId: "Gain" },
        parameters: {},
      },
    }));
    source.documents.push(bench, gain, spare);
    for (const topDocumentId of ["Top", "Bench"]) {
      const index = buildProjectSearchIndex({ ...source, topDocumentId });
      expect(
        index
          .search("RSENSE")
          .map(({ locator }) =>
            locator.hierarchyPath.map(({ parentDocumentId, instanceId }) => [
              parentDocumentId,
              instanceId,
            ]),
          ),
      ).toEqual([[["Bench", "X1"]], [["Bench", "X2"]]]);
      expect(index.search("RSPARE")[0]?.locator.hierarchyPath).toEqual([]);
    }
    bench.instances = Array.from({ length: 51 }, (_, index) => ({
      ...bench.instances[0]!,
      id: `X${index + 1}`,
    }));
    const bounded =
      buildProjectSearchIndex(source).searchWithCoverage("RSENSE");
    expect(bounded.results).toHaveLength(50);
    expect(bounded.truncated).toBe(true);
  });

  it("matches an exact parameter key and value without changing the ordinary text search", () => {
    const source = project();
    const doc = source.documents[0]!;
    doc.instances = [
      {
        id: "M1",
        reference: "M1",
        placement: null,
        symbolId: "nmos",
        netlist: {
          parameters: {
            w: "2u",
            l: "180n",
            expression: "A==B",
            "coeff[1]": "2u",
            μ: "3u",
            ready: "0",
          },
        },
      },
      {
        id: "M2",
        reference: "M2",
        placement: null,
        symbolId: "nmos-w=2u-template",
        netlist: { parameters: { w: "1u", l: "2u" } },
      },
    ];
    doc.instances.push({ id: "ready-port", symbolId: "port", placement: null });
    doc.nets.push({
      id: "ready-net",
      terminals: [{ instanceId: "ready-port", pinName: "P" }],
    });
    doc.netlist!.terminals.push({
      id: "ready-terminal",
      name: "READY=1",
      netId: "ready-net",
      direction: "passive",
      interfaceInstanceIds: ["ready-port"],
    });
    const index = buildProjectSearchIndex(source);
    expect(
      index.search("W = 2U").map(({ locator }) => locator.objectId),
    ).toEqual(["M1"]);
    expect(index.search("w=2u").map(({ locator }) => locator.objectId)).toEqual(
      ["M1"],
    );
    expect(index.search("2u").map(({ locator }) => locator.objectId)).toEqual([
      "M1",
      "M2",
    ]);
    expect(index.search("w=2")).toEqual([]);
    expect(
      index.search("coeff[1]=2u").map(({ locator }) => locator.objectId),
    ).toEqual(["M1"]);
    expect(index.search("Μ=3u").map(({ locator }) => locator.objectId)).toEqual(
      ["M1"],
    );
    expect(
      index.search("READY=1").map(({ locator }) => locator.objectId),
    ).toEqual(["ready-net"]);
    expect(index.search("A==B").map(({ locator }) => locator.objectId)).toEqual(
      ["M1"],
    );
  });
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
