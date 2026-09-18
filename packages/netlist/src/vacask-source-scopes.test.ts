import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimulationSourceInputSchema } from "@icm/model";
import { inspectVacaskSourceGraph } from "./vacask-source.js";
import { vacaskCircuitScopes } from "./vacask-source-scopes.js";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import type { DesignNetlistIR } from "./ir.js";

const binding = {
  id: "b",
  path: "dut.inc",
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
function scopes(text: string) {
  const graph = inspectVacaskSourceGraph(
    SimulationSourceInputSchema.parse({
      kind: "source",
      entry: "run.sim",
      configPath: "experiment.json",
      files: [{ path: "run.sim", text }],
      circuitBindings: [binding],
      dependencies: [],
    }),
  );
  expect(graph.diagnostics).toEqual([]);
  return vacaskCircuitScopes(graph, binding, circuit);
}
function resolve(text: string, callPath: string[]) {
  return scopes(text).resolve({ bindingId: "b", callPath });
}
const source = `Native occurrence identity proof
ground 0
model voltage vsource
V (Left 0) voltage dc=1
v (left 0) voltage dc=2
include "dut.inc"
subckt Wrapper (port)
  subckt Link (p)
    XD (p) DUT
  ends
  XL (port) Link
ends
subckt Other (port)
  subckt Link (p)
    XD (local) DUT
    Vlocal (local 0) voltage dc=4
  ends
  XL (port) Link
ends
X1 (Left) Wrapper
x1 (left) Wrapper
X2 (Left) Other
control
  abort always
  options rawfile="ascii" strictsave=2
  save default
  analysis proof op
endc
`;
describe("native authored occurrence mapping", () => {
  it("resolves case-distinct siblings, local definitions and formal ports without flattening scopes", () => {
    const resolver = scopes(source);
    const paths = resolver.list().map((s) => s.callPath);
    expect(paths).toEqual([
      ["X1", "XL", "XD"],
      ["x1", "XL", "XD"],
      ["X2", "XL", "XD"],
    ]);
    for (const [call, actual] of [
      ["X1", "Left"],
      ["x1", "left"],
      ["X2", "X2:XL:local"],
    ]) {
      const resolved = resolver.resolve({
        bindingId: "b",
        callPath: [call!, "XL", "XD"],
      });
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) continue;
      expect(resolved.node("in")).toBe(actual);
      expect(resolved.node("inner")).toBe(`${call}:XL:XD:inner`);
      expect(resolved.node("VDD")).toBe("VDD");
      expect(resolved.node("vdd")).toBe(`${call}:XL:XD:vdd`);
      expect(resolved.node("0")).toBe("0");
      expect(resolved.instance("S")).toBe(`${call}:XL:XD:S`);
    }
    expect(
      resolver.resolve({ bindingId: "wrong", callPath: paths[0]! }).ok,
    ).toBe(false);
    expect(
      resolver.resolve({ bindingId: "b", callPath: ["X1", "xl", "XD"] }).ok,
    ).toBe(false);
  });
  it("keeps quoted reference spelling but not quote delimiters in the resulting path", () => {
    const resolved = resolve("Title\n'X-1' (Actual) DUT\n", ["X-1"]);
    expect(resolved.ok && resolved.node("in")).toBe("Actual");
    expect(resolved.ok && resolved.node("internal")).toBe("X-1:internal");
  });
  it("does not mistake a locally shadowing subcircuit or model for the generated DUT", () => {
    for (const declaration of [
      "subckt DUT (p)\nends",
      "model DUT vsource",
      "@if condition\nmodel DUT vsource\n@end",
    ]) {
      const text = `Title\nsubckt Wrapper (p)\n${declaration}\nXD (p) DUT\nends\nX1 (input) Wrapper\n`;
      expect(scopes(text).list()).toEqual([]);
      expect(resolve(text, ["X1", "XD"]).ok).toBe(false);
    }
  });
  it("does not expose local definitions outside their owner, but allows the top-level fallback", () => {
    const text =
      "Title\nsubckt Link (p)\nXD (p) DUT\nends\nsubckt Wrapper (p)\nXL (p) Link\nsubckt Private (p)\nXD (p) DUT\nends\nends\nX1 (a) Wrapper\nX2 (b) Private\n";
    expect(
      scopes(text)
        .list()
        .map((s) => s.callPath),
    ).toEqual([["X1", "XL", "XD"]]);
    expect(resolve(text, ["X2", "XD"]).ok).toBe(false);
  });
  it("does not assign Canvas identity to conditional, duplicate or arity-mismatched calls", () => {
    for (const text of [
      "@if enabled\nX1 (p) DUT\n@end",
      "X1 (p) DUT\nX1 (q) DUT",
      "X1 (p q) DUT",
    ]) {
      expect(scopes(`Title\n${text}\n`).list()).toEqual([]);
      expect(resolve(`Title\n${text}\n`, ["X1"]).ok).toBe(false);
    }
  });
  it("terminates recursive definitions while retaining independent valid calls", () => {
    const text =
      "Title\nsubckt Loop (p)\nAgain (p) Loop\nends\nX0 (p) Loop\nX1 (q) DUT\ncontrol\nFake (z) DUT\nendc\n";
    expect(
      scopes(text)
        .list()
        .map((s) => s.callPath),
    ).toEqual([["X1"]]);
  });
  it("resolves model leaves with the same local shadowing and exact instance identity", () => {
    const resolver = scopes(`Title
model core resistor
subckt Device (d g s b)
model core sp_bsim4v8
N (d g s b) core
n (d g s b) core
subckt Inner (d g s b)
model core bsim4v8
leaf (d g s b) core
ends
X (d g s b) Inner
ends
`);
    expect(resolver.primitiveModels("Device")).toEqual([
      { path: ["N"], module: "sp_bsim4v8" },
      { path: ["n"], module: "sp_bsim4v8" },
      { path: ["X", "leaf"], module: "bsim4v8" },
    ]);
    expect(resolver.primitiveModels("Inner")).toEqual([]);
    expect(resolver.primitiveModels("core")).toEqual([
      { path: [], module: "resistor" },
    ]);
  });
  it("does not invent model leaves through conditional, duplicate or recursive definitions/calls", () => {
    for (const body of [
      "@if enabled\nN (p) core\n@end",
      "N (p) core\nN (q) core",
      "Again (p) Device",
      "model core sp_bsim4v8\nmodel core bsim4v8\nN (p) core",
      "model core sp_bsim4v8\nsubckt core (p)\nends\nN (p) core",
    ])
      expect(
        scopes(
          `Title\nmodel core sp_bsim4v8\nsubckt Device (p)\n${body}\nends\n`,
        ).primitiveModels("Device"),
      ).toEqual([]);
    const conditional = scopes(
      "Title\nmodel core sp_bsim4v8\n@if enabled\nsubckt Device (p)\nN (p) core\nends\n@end\n",
    );
    expect(conditional.primitiveModels("Device")).toEqual([]);
  });
});

it.skipIf(!process.env.VACASK_BIN)(
  "binds the resolver's native node and instance paths to actual kernel output",
  () => {
    const cwd = mkdtempSync(join(tmpdir(), "icm-native-scopes-"));
    writeFileSync(join(cwd, "run.sim"), source);
    writeFileSync(
      join(cwd, "dut.inc"),
      "subckt DUT (in)\nS (inner in) voltage dc=0.25\nends\n",
    );
    const startup = join(cwd, "startup.toml");
    writeFileSync(startup, "# controlled native occurrence proof\n");
    const run = spawnSync(
      process.env.VACASK_BIN!,
      ["--tomlfile", startup, "-n", "1", "-b", "1", "run.sim"],
      { cwd, encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
    writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
    writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
    expect(run.error, cwd).toBeUndefined();
    expect(run.status, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(0);
    const parsed = parseVacaskRawfile(
      readFileSync(join(cwd, "proof.raw"), "utf8"),
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const values = new Map(
      parsed.plots[0]!.vectors.map((v) => [v.variable.name, v.real[0]]),
    );
    const resolver = scopes(source);
    for (const [name, expected] of [
      ["X1", 1],
      ["x1", 2],
      ["X2", 4],
    ] as const) {
      const resolved = resolver.resolve({
        bindingId: "b",
        callPath: [name, "XL", "XD"],
      });
      if (!resolved.ok) throw new Error(resolved.message);
      expect(values.get(resolved.node("in"))).toBe(expected);
      expect(values.get(resolved.node("inner"))).toBe(expected + 0.25);
      expect(values.has(`${resolved.instance("S")}:flow(br)`)).toBe(true);
    }
  },
);
