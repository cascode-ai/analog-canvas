import { describe, expect, it } from "vitest";
import { electricalGraphFromIR, type ElectricalGraph } from "./equivalence.js";
import { compareTopologyCorrespondence } from "./topology-correspondence.js";
import type { DesignNetlistIR, DesignNetlistInstance } from "./ir.js";

function resistor(
  id: string,
  a: string,
  b: string,
  value = "1k",
): DesignNetlistInstance {
  return {
    id,
    reference: id,
    deviceClass: "resistor",
    invocationKind: "primitive",
    target: null,
    nodes: [
      { pinName: "1", netName: a },
      { pinName: "2", netName: b },
    ],
    parameters: [{ name: "value", rawValue: value }],
  };
}
function mos(
  id: string,
  d: string,
  g: string,
  s: string,
  model = "NMOS",
  w = "1u",
): DesignNetlistInstance {
  return {
    id,
    reference: id,
    deviceClass: "mos",
    invocationKind: "primitive",
    target: model,
    nodes: [
      { pinName: "D", netName: d },
      { pinName: "G", netName: g },
      { pinName: "S", netName: s },
      { pinName: "B", netName: "0" },
    ],
    parameters: [
      { name: "w", rawValue: w },
      { name: "l", rawValue: "180n" },
      { name: "m", rawValue: "1" },
    ],
  };
}
function ir(instances: DesignNetlistInstance[]): DesignNetlistIR {
  return {
    topCellId: "top",
    globals: [],
    cells: [
      {
        id: "top",
        name: "dut",
        ports: [],
        instances,
        nets: [
          ...new Set(
            instances.flatMap((device) =>
              device.nodes.map((node) => node.netName),
            ),
          ),
        ].map((name) => ({ id: name, name, scope: "local" })),
      },
    ],
  };
}
function graph(
  input: DesignNetlistInstance[] | DesignNetlistIR,
): ElectricalGraph {
  const result = electricalGraphFromIR(
    Array.isArray(input) ? ir(input) : input,
  );
  if (result.status !== "ready") throw new Error(result.reason);
  return result.graph;
}

describe("parameter-aware topology correspondence", () => {
  it("finds a full witness under renaming, reordering, passive reversal and equivalent units", () => {
    const a = graph([
      resistor("R1", "a", "b", "1k"),
      resistor("R2", "a", "b", "2k"),
    ]);
    const b = graph([
      resistor("renamed2", "y", "x", "2000"),
      resistor("renamed1", "x", "y", "1e3"),
    ]);
    const result = compareTopologyCorrespondence(a, b);
    expect(result).toMatchObject({
      exact: true,
      netlistMatch: "equal",
      similarity: 1,
      parameterSimilarity: 1,
      matchedDevices: 2,
      limited: false,
    });
    expect(
      result.pairs.map((pair) => [
        pair.source.instanceId,
        pair.target.instanceId,
      ]),
    ).toEqual([
      ["R1", "renamed1"],
      ["R2", "renamed2"],
    ]);
  });
  it("ranks W/L/m and model changes by degree without confusing them with topology", () => {
    const a = graph([mos("M1", "out", "in", "0")]);
    const near = graph([mos("M9", "out", "in", "0", "NMOS", "1.1u")]);
    const far = graph([mos("M9", "out", "in", "0", "NMOS", "100u")]);
    const model = graph([mos("M9", "out", "in", "0", "NMOS_LVT")]);
    const result = compareTopologyCorrespondence(a, near);
    expect(result.exact).toBe(true);
    expect(result.structureSimilarity).toBe(1);
    expect(result.netlistMatch).toBe("different");
    expect(result.similarity).toBeLessThan(1);
    expect(result.similarity).toBeGreaterThan(
      compareTopologyCorrespondence(a, far).similarity,
    );
    expect(compareTopologyCorrespondence(a, model)).toMatchObject({
      exact: true,
      netlistMatch: "different",
    });
    for (const parameter of ["l", "m"]) {
      const device = mos("M9", "out", "in", "0");
      device.parameters.find((item) => item.name === parameter)!.rawValue =
        parameter === "l" ? "1u" : "8";
      expect(
        compareTopologyCorrespondence(a, graph([device])).similarity,
      ).toBeLessThan(1);
    }
  });
  it("retains the common branch but excludes changed device types and polarity", () => {
    const a = graph([
      mos("M1", "out", "in", "0"),
      resistor("R1", "vdd", "out"),
    ]);
    const b = graph([
      mos("M2", "out", "in", "0", "PMOS"),
      resistor("R2", "vdd", "out"),
    ]);
    const result = compareTopologyCorrespondence(a, b);
    expect(result).toMatchObject({
      exact: false,
      matchedDevices: 1,
      sourceDevices: 2,
      targetDevices: 2,
    });
    expect(
      result.pairs.map((pair) => [
        pair.source.instanceId,
        pair.target.instanceId,
      ]),
    ).toEqual([["R1", "R2"]]);
    expect(
      compareTopologyCorrespondence(
        graph([mos("N", "a", "b", "0")]),
        graph([mos("P", "a", "b", "0", "PMOS")]),
      ).matchedDevices,
    ).toBe(0);
  });
  it("cannot map all series devices onto parallel devices or collapse distinct nets", () => {
    const series = graph([resistor("R1", "a", "b"), resistor("R2", "b", "c")]);
    const parallel = graph([
      resistor("R3", "a", "b"),
      resistor("R4", "a", "b"),
    ]);
    expect(compareTopologyCorrespondence(series, parallel)).toMatchObject({
      exact: false,
      matchedDevices: 1,
    });
    expect(
      compareTopologyCorrespondence(
        graph([mos("M1", "out", "out", "0")]),
        graph([mos("M2", "out", "in", "0")]),
      ),
    ).toMatchObject({ exact: false, matchedDevices: 0 });
  });
  it("maps a true partial subcircuit despite added external devices", () => {
    const small = graph([resistor("R1", "a", "b"), resistor("R2", "b", "c")]);
    const large = graph([
      resistor("R7", "x", "y"),
      resistor("R8", "y", "z"),
      mos("M3", "z", "in", "0"),
    ]);
    const result = compareTopologyCorrespondence(small, large);
    expect(result).toMatchObject({
      exact: false,
      matchedDevices: 2,
      sourceDevices: 2,
      targetDevices: 3,
    });
    expect(result.similarity).toBeGreaterThan(0.5);
    expect(result.similarity).toBeLessThan(1);
    expect(compareTopologyCorrespondence(large, small).matchedDevices).toBe(2);
  });
  it("keeps distinct occurrence paths when the same child Cell is instantiated twice", () => {
    const source = ir([]);
    const child = ir([resistor("inside", "a", "b")]).cells[0]!;
    child.id = "child";
    child.name = "amp";
    child.ports = [
      { id: "a", name: "a", netName: "a" },
      { id: "b", name: "b", netName: "b" },
    ];
    source.cells.push(child);
    source.cells[0]!.instances = ["X1", "X2"].map((id, index) => ({
      id,
      reference: id,
      deviceClass: "hierarchical",
      invocationKind: "subcircuit",
      target: "amp",
      parameters: [],
      nodes: [
        { pinName: "a", netName: String(index) },
        { pinName: "b", netName: String(index + 1) },
      ],
    }));
    source.cells[0]!.nets = ["0", "1", "2"].map((name) => ({
      id: name,
      name,
      scope: "local",
    }));
    const result = compareTopologyCorrespondence(
      graph(source),
      graph([resistor("R1", "0", "1"), resistor("R2", "1", "2")]),
    );
    expect(result).toMatchObject({ exact: true, matchedDevices: 2 });
    expect(result.pairs.map((pair) => pair.source.path)).toEqual([
      ["X1", "inside"],
      ["X2", "inside"],
    ]);
  });
  it("reports a bounded search instead of inventing a complete correspondence", () => {
    const a = graph(
      Array.from({ length: 10 }, (_, i) =>
        resistor(`R${i}`, String(i), String((i + 1) % 10)),
      ),
    );
    const b = graph(
      Array.from({ length: 10 }, (_, i) =>
        resistor(`R${i}`, String(i), String((i + 1) % 10), "2k"),
      ),
    );
    const result = compareTopologyCorrespondence(a, b, 2);
    expect(result.limited).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.similarity).toBeLessThan(1);
    expect(new Set(result.pairs.map((pair) => pair.target.vertex)).size).toBe(
      result.pairs.length,
    );
  });
});
