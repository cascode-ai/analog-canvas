import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readVacaskSimulationData } from "@icm/spice-run";
import { inspectNativeAnalyses } from "./native-source-analysis.js";

function inspect(text: string) {
  return inspectNativeAnalyses({
    kind: "source",
    entry: "run.sim",
    configPath: "experiment.json",
    files: [{ path: "run.sim", text }],
    circuitBindings: [],
    dependencies: [],
  });
}
const fixture = (dir: string, path: string) =>
  readFileSync(
    new URL(`../../../netlists/${dir}/${path}`, import.meta.url),
    "utf8",
  );
describe("native source-derived analysis meaning", () => {
  it.each([
    [
      "vacask-divider",
      "divider.sim",
      ["divider_op.raw", "divider_dc.raw"],
      ["dc", "op"],
    ],
    ["vacask-rc", "rc.sim", ["rc_ac.raw"], ["ac"]],
    ["vacask-rc", "result-transient.sim", ["result_tran.raw"], ["tran"]],
    ["vacask-resistor-noise", "noise.sim", ["resistor_noise.raw"], ["noise"]],
    [
      "vacask-resistor-noise",
      "current-reference.sim",
      ["current_noise.raw"],
      ["noise"],
    ],
  ] as const)(
    "maps %s / %s from source into actual raw files",
    (dir, source, paths, expected) => {
      const text = fixture(dir, source);
      const plan = inspect(text);
      expect(plan.warnings).toEqual([]);
      const read = readVacaskSimulationData(
        paths.map((path) => ({ path, text: fixture(dir, path) })),
        plan.projections,
      );
      expect(read.status, JSON.stringify(read)).toBe("read");
      if (read.status === "read")
        expect(read.data.analyses.map((a) => a.analysis).sort()).toEqual(
          [...expected].sort(),
        );
    },
  );
  it("uses native case and mega/milli semantics and retains auxiliary OP", () => {
    const plan = inspect(`Title
control
analysis AC ac from=1m to=1M mode="lin" points=4 writeop=1
analysis ac ac from=1 to=1k mode="dec" points=2
endc
`);
    expect(plan.projections.map((p) => p.artifactPath)).toEqual([
      "AC.raw",
      "AC.op.raw",
      "ac.raw",
    ]);
    expect(plan.analyses[0]).toMatchObject({
      startHz: 0.001,
      stopHz: 1e6,
      points: 5,
    });
  });
  it("does not invent units, sweep identity or values for native programs beyond static evidence", () => {
    const text = `Title
control
mc monte samples=2
analysis inside op
endmc
sweep first variable="a" from=0 to=1 step=1
sweep second variable="b" from=0 to=1 step=1
analysis multidimensional op
analysis noise noise out="x" in="X1:V1" from=1 to=1k mode="dec" points=2
analysis missing op write=0
analysis symbolic op write=(enabled)
analysis unsupported hb
endc
`;
    const plan = inspect(text);
    expect(plan.projections).toEqual([]);
    expect(plan.warnings).toHaveLength(5);
    expect(text).toContain("write=(enabled)");
  });
  it("refuses ambiguous source attribution after repeated output names", () => {
    const plan = inspect(
      'Title\ncontrol\nanalysis same op\nanalysis same ac from=1 to=10 points=1 mode="dec"\nendc\n',
    );
    expect(plan.projections).toEqual([]);
    expect(plan.warnings[0]).toContain("ambiguous");
  });
});
