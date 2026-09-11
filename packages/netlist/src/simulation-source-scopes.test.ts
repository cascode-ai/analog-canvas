import { describe, expect, it } from "vitest";
import { SimulationSourceInputSchema } from "@icm/model";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import {
  resolveAuthoredCircuitScope,
  listAuthoredCircuitScopes,
} from "./simulation-source-scopes.js";
import type { DesignNetlistIR } from "./ir.js";

const binding = {
  id: "b",
  path: "dut.spice",
  documentId: "dut",
  emission: "subcircuit" as const,
};
const circuit: DesignNetlistIR = {
  topCellId: "dut",
  globals: ["VDD"],
  cells: [
    {
      id: "dut",
      name: "DUT",
      ports: [{ id: "p", name: "in", netName: "in" }],
      instances: [],
      nets: [],
    },
  ],
};
it("enumerates distinct authored DUT calls without guessing conditional or recursive paths", () => {
  const input = SimulationSourceInputSchema.parse({
    kind: "source",
    entry: "run.cir",
    configPath: "experiment.json",
    dependencies: [],
    circuitBindings: [binding],
    files: [
      {
        path: "run.cir",
        text: "* test\nX1 a DUT\nX2 b DUT\n.if x\nX3 c DUT\n.endif\n.end\n",
      },
    ],
  });
  expect(
    listAuthoredCircuitScopes(
      inspectSimulationSourceGraph(input),
      binding,
      circuit,
    ).map((scope) => scope.callPath),
  ).toEqual([["X1"], ["X2"]]);
});
function scope(text: string, callPath: string[]) {
  const graph = inspectSimulationSourceGraph(
    SimulationSourceInputSchema.parse({
      kind: "source",
      entry: "run.cir",
      configPath: "experiment.json",
      files: [{ path: "run.cir", text }],
      circuitBindings: [binding],
      dependencies: [],
    }),
  );
  return resolveAuthoredCircuitScope(graph, binding, circuit, {
    bindingId: "b",
    callPath,
  });
}
describe("authored call-path acquisition mapping", () => {
  it("crosses formal interfaces recursively while preserving ground and globals", () => {
    const resolved = scope(
      '* calls\n.include "dut.spice"\n.subckt WRAPPER port\nXD port DUT\n.ends\nXW input WRAPPER\n',
      ["xw", "xd"],
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.vector("v(in)")).toBe("v(input)");
    expect(resolved.vector("v(mid)")).toBe("v(xw.xd.mid)");
    expect(resolved.vector("v(VDD)")).toBe("v(vdd)");
    expect(resolved.vector("v(0)")).toBe("v(0)");
    expect(resolved.vector("i(vicmprb001)")).toBe("i(v.xw.xd.vicmprb001)");
    expect(resolved.vector("i(v.xchild.vicmprb001)")).toBe(
      "i(v.xw.xd.xchild.vicmprb001)",
    );
  });
  it("does not confuse sibling calls or infer through ambiguous/conditional calls", () => {
    const text = '* calls\n.include "dut.spice"\nX1 left DUT\nX2 right DUT\n';
    for (const [name, node] of [
      ["X1", "left"],
      ["X2", "right"],
    ]) {
      const resolved = scope(text, [name!]);
      expect(resolved.ok && resolved.vector("v(in)")).toBe(`v(${node})`);
    }
    expect(scope(`${text}X1 other DUT\n`, ["X1"]).ok).toBe(false);
    expect(scope("* calls\n.if (1)\nX1 left DUT\n.endif\n", ["X1"]).ok).toBe(
      false,
    );
    expect(scope("* calls\nX1 a b DUT\n", ["X1"]).ok).toBe(false);
  });
});
