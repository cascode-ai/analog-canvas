import { describe, expect, it } from "vitest";
import { SimulationSourceInputSchema } from "@icm/model";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";

function inspect(files: Record<string, string>, extra: object = {}) {
  return inspectSimulationSourceGraph(
    SimulationSourceInputSchema.parse({
      kind: "source",
      entry: "tb/run.cir",
      configPath: "experiment.json",
      files: Object.entries(files).map(([path, text]) => ({ path, text })),
      circuitBindings: [],
      dependencies: [],
      ...extra,
    }),
  );
}
describe("source include graph", () => {
  it("preserves include order and repetition, including first-line fragment cards", () => {
    const graph = inspect({
      "tb/run.cir":
        '* title\n.include "../r.spice"\n.include "../r.spice"\n.end\n',
      "r.spice": "R1 a 0 1k\n",
    });
    expect(graph.paths).toEqual(["tb/run.cir", "r.spice", "r.spice"]);
    expect(
      graph.statements.filter((s) => s.statement.kind === "instance"),
    ).toHaveLength(2);
    expect(graph.diagnostics).toEqual([]);
  });
  it("selects library sections without executing other sections", () => {
    const graph = inspect({
      "tb/run.cir": '* title\n.lib "../corners.spice" tt\n',
      "corners.spice":
        ".lib tt\nR1 a 0 1k\n.endl tt\n.lib ff\nR2 a 0 2k\n.endl ff\n",
    });
    expect(
      graph.statements
        .filter((s) => s.statement.kind === "instance")
        .map((s) => s.statement.rawText),
    ).toEqual(["R1 a 0 1k"]);
    expect(graph.diagnostics).toEqual([]);
  });
  it("reports missing files, root escapes and cycles with source locations", () => {
    const graph = inspect({
      "tb/run.cir":
        '* title\n.include "missing"\n.include "../../escape"\n.include "run.cir"\n',
    });
    expect(graph.diagnostics.map((d) => d.code)).toEqual([
      "SIMULATION_FILE_MISSING",
      "SIMULATION_INCLUDE_PATH",
      "SIMULATION_INCLUDE_CYCLE",
    ]);
    expect(graph.diagnostics.every((d) => d.sourceRef)).toBe(true);
  });
  it("treats generated paths and explicit dependency mounts as opaque owners", () => {
    const graph = inspect(
      {
        "tb/run.cir":
          '* title\n.include "../circuit.spice"\n.lib "../models.spice" tt\n',
      },
      {
        circuitBindings: [
          {
            id: "b",
            documentId: "d",
            path: "circuit.spice",
            emission: "subcircuit",
          },
        ],
        dependencies: [
          { id: "m", mountPath: "models.spice", sha256: "a".repeat(64) },
        ],
      },
    );
    expect(graph.paths).toEqual([
      "tb/run.cir",
      "circuit.spice",
      "models.spice",
    ]);
    expect(graph.diagnostics).toEqual([]);
  });
});
