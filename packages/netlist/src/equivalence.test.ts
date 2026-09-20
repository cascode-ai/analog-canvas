import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import type { DesignNetlistIR, DesignNetlistInstance } from "./ir.js";
import {
  compareElectricalGraphs,
  electricalGraphTopologySimilarity,
  electricalGraphFromIR,
  projectElectricalGraph,
  type ElectricalGraphResult,
} from "./equivalence.js";

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
function circuit(
  instances: DesignNetlistInstance[],
  ports: string[] = [],
): DesignNetlistIR {
  return {
    topCellId: "top",
    globals: [],
    cells: [
      {
        id: "top",
        name: "dut",
        ports: ports.map((name) => ({ id: name, name, netName: name })),
        instances,
        nets: [
          ...new Set(
            instances.flatMap((item) => item.nodes.map((node) => node.netName)),
          ),
        ].map((name) => ({ id: name, name, scope: "local" })),
      },
    ],
  };
}
function ready(result: ElectricalGraphResult) {
  expect(result.status, JSON.stringify(result)).toBe("ready");
  if (result.status !== "ready") throw new Error(result.reason);
  return result.graph;
}
function compare(a: DesignNetlistIR, b: DesignNetlistIR) {
  return compareElectricalGraphs(
    ready(electricalGraphFromIR(a)),
    ready(electricalGraphFromIR(b)),
  );
}

describe("electrical duplicate comparison", () => {
  it("ignores instance/net names, ordering, and passive orientation; normalizes engineering numbers exactly", () => {
    const a = circuit(
      [resistor("R1", "in", "n"), resistor("R2", "n", "out", "0.1u")],
      ["in", "out"],
    );
    const b = circuit(
      [
        resistor("renamed2", "end", "middle", "100n"),
        resistor("renamed1", "middle", "start", "1.e3"),
      ],
      ["start", "end"],
    );
    expect(compare(a, b)).toBe("equal");
    b.cells[0]!.instances[0]!.parameters[0]!.rawValue = "100.000000000000001n";
    expect(compare(a, b)).toBe("different");
  });

  it("does not confuse equal degree/count summaries with equivalent connectivity", () => {
    const ring = circuit(
      Array.from({ length: 6 }, (_, i) =>
        resistor(`R${i}`, `${i}`, `${(i + 1) % 6}`),
      ),
    );
    const triangles = circuit(
      Array.from({ length: 6 }, (_, i) =>
        resistor(`R${i}`, `${i}`, `${Math.floor(i / 3) * 3 + ((i + 1) % 3)}`),
      ),
    );
    const a = ready(electricalGraphFromIR(ring));
    const b = ready(electricalGraphFromIR(triangles));
    expect(a.bucket).toBe(b.bucket);
    expect(compareElectricalGraphs(a, b)).toBe("different");
    expect(compareElectricalGraphs(a, a, 1)).toBe("unknown");
    expect(compareElectricalGraphs(a, a)).toBe("equal");
  });

  it("preserves MOS terminal roles, model and parameter differences, and ordered ports", () => {
    const mos: DesignNetlistInstance = {
      id: "M1",
      reference: "M1",
      deviceClass: "mos",
      invocationKind: "primitive",
      target: "NMOS",
      nodes: ["D", "G", "S", "B"].map((pinName) => ({
        pinName,
        netName: pinName,
      })),
      parameters: [{ name: "w", rawValue: "1u" }],
    };
    const a = circuit([mos], ["D", "G", "S", "B"]);
    for (const change of ["pins", "model", "value", "ports"] as const) {
      const b = structuredClone(a);
      const instance = b.cells[0]!.instances[0]!;
      if (change === "pins")
        [instance.nodes[0]!.netName, instance.nodes[1]!.netName] = ["G", "D"];
      if (change === "model") instance.target = "PMOS";
      if (change === "value") instance.parameters[0]!.rawValue = "2u";
      if (change === "ports") b.cells[0]!.ports.reverse();
      expect(compare(a, b), change).toBe("different");
    }
  });

  it("expands simple hierarchy without letting hierarchy names or drawing boundaries decide", () => {
    const flat = circuit([resistor("R1", "in", "out")], ["in", "out"]);
    const nested = circuit(
      [
        {
          id: "X1",
          reference: "X1",
          deviceClass: "hierarchical",
          invocationKind: "subcircuit",
          target: "child",
          parameters: [],
          nodes: [
            { pinName: "a", netName: "in" },
            { pinName: "b", netName: "out" },
          ],
        },
      ],
      ["in", "out"],
    );
    const child = circuit([resistor("R99", "a", "b")], ["a", "b"]).cells[0]!;
    child.id = "child";
    child.name = "child";
    nested.cells.push(child);
    expect(compare(flat, nested)).toBe("equal");
    child.formalParameters = [{ name: "r", defaultValue: "1k" }];
    expect(electricalGraphFromIR(nested)).toMatchObject({
      status: "uncheckable",
      reason: expect.stringContaining("Parameterized"),
    });
  });

  it("respects black-box target and terminal position", () => {
    const box: DesignNetlistInstance = {
      id: "X1",
      reference: "X1",
      deviceClass: "hierarchical",
      invocationKind: "subcircuit",
      target: "amplifier",
      parameters: [],
      nodes: [
        { pinName: "VIP", netName: "in" },
        { pinName: "VOP", netName: "out" },
      ],
    };
    const a = circuit([box], ["in", "out"]);
    const b = structuredClone(a);
    b.cells[0]!.instances[0]!.nodes.reverse();
    expect(compare(a, b)).toBe("different");
    b.cells[0]!.instances[0]!.nodes.reverse();
    b.cells[0]!.instances[0]!.target = "comparator";
    expect(compare(a, b)).toBe("different");
  });

  it("includes external subcircuit parameter defaults in its contract", () => {
    const a = circuit(
      [
        {
          id: "X1",
          reference: "X1",
          deviceClass: "hierarchical",
          invocationKind: "subcircuit",
          target: "amp",
          nodes: [{ pinName: "in", netName: "in" }],
          parameters: [],
        },
      ],
      ["in"],
    );
    a.externalMasters = [
      {
        id: "amp",
        name: "amp",
        terminals: [{ id: "in", name: "in", direction: "input" }],
        formalParameters: [{ name: "gain", defaultValue: "10" }],
      },
    ];
    const b = structuredClone(a);
    b.externalMasters![0]!.formalParameters[0]!.defaultValue = "20";
    expect(compare(a, b)).toBe("different");
    b.externalMasters![0]!.formalParameters[0]!.defaultValue = "1e1";
    expect(compare(a, b)).toBe("equal");
  });

  it("ignores actual Project artwork, but rejects incomplete connectivity and empty drawings", () => {
    const project = createEmptyProject("p", "First title");
    const document = project.documents[0]!;
    document.instances = ["M1", "M2"].map((id) => ({
      id,
      reference: id,
      symbolId: "nmos",
      placement: null,
      netlist: { parameters: {} },
    }));
    document.nets = ["D", "G", "S"].map((pinName) => ({
      id: pinName,
      terminals: document.instances.map((instance) => ({
        instanceId: instance.id,
        pinName,
      })),
    }));
    const before = structuredClone(project);
    const a = ready(projectElectricalGraph(project));
    expect(project).toEqual(before);
    project.name = "Different title";
    document.instances[0]!.reference = "M99";
    document.instances[0]!.placement = {
      position: { x: 999, y: -200 },
      rotation: 90,
      mirror: "none",
    };
    document.instances.reverse();
    expect(
      compareElectricalGraphs(a, ready(projectElectricalGraph(project))),
    ).toBe("equal");
    document.instances[0]!.symbolId = "pmos";
    expect(
      compareElectricalGraphs(a, ready(projectElectricalGraph(project))),
    ).toBe("different");
    document.nets.pop();
    expect(projectElectricalGraph(project).status).toBe("uncheckable");
    expect(
      projectElectricalGraph(createEmptyProject("empty", "Empty")).status,
    ).toBe("uncheckable");
  });

  it("keeps global identities and treats behavioral references as uncheckable", () => {
    const a = circuit([resistor("R1", "power", "local")]);
    a.cells[0]!.nets[0]!.scope = "global";
    const b = structuredClone(a);
    b.cells[0]!.nets[0]!.scope = "local";
    expect(compare(a, b)).toBe("different");
    a.cells[0]!.instances[0]!.parameters[0]!.rawValue = "v(local)";
    expect(electricalGraphFromIR(a).status).toBe("uncheckable");
  });
});

describe("electrical topology similarity", () => {
  it("ranks the same topology above a partial or unrelated circuit without treating values as structure", () => {
    const reference = ready(
      electricalGraphFromIR(
        circuit(
          [resistor("R1", "in", "n"), resistor("R2", "n", "out")],
          ["in", "out"],
        ),
      ),
    );
    const differentValues = ready(
      electricalGraphFromIR(
        circuit(
          [
            resistor("A", "start", "middle", "2k"),
            resistor("B", "middle", "end", "3k"),
          ],
          ["start", "end"],
        ),
      ),
    );
    const partial = ready(
      electricalGraphFromIR(
        circuit([resistor("R1", "in", "out")], ["in", "out"]),
      ),
    );
    const unrelated = ready(
      electricalGraphFromIR(
        circuit(
          [
            {
              id: "M1",
              reference: "M1",
              deviceClass: "mos",
              invocationKind: "primitive",
              target: "NMOS",
              nodes: ["D", "G", "S", "B"].map((pinName) => ({
                pinName,
                netName: pinName,
              })),
              parameters: [],
            },
          ],
          ["D", "G", "S", "B"],
        ),
      ),
    );

    expect(electricalGraphTopologySimilarity(reference, differentValues)).toBe(
      1,
    );
    expect(
      electricalGraphTopologySimilarity(reference, partial),
    ).toBeGreaterThan(electricalGraphTopologySimilarity(reference, unrelated));
    expect(electricalGraphTopologySimilarity(reference, partial)).toBeLessThan(
      1,
    );
  });

  it("retains recognizable transistor polarity while ignoring model spelling", () => {
    const mos = (target: string) =>
      ready(
        electricalGraphFromIR(
          circuit([
            {
              id: "M1",
              reference: "M1",
              deviceClass: "mos",
              invocationKind: "primitive",
              target,
              nodes: ["D", "G", "S", "B"].map((pinName) => ({
                pinName,
                netName: pinName,
              })),
              parameters: [{ name: "w", rawValue: "1u" }],
            },
          ]),
        ),
      );
    expect(
      electricalGraphTopologySimilarity(mos("NMOS"), mos("nfet_01v8")),
    ).toBe(1);
    expect(
      electricalGraphTopologySimilarity(mos("NMOS"), mos("PMOS")),
    ).toBeLessThan(1);
  });
});
