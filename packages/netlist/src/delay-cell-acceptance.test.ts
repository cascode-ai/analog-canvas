import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { delayCellFixture } from "./delay-cell-fixture.test-support.js";

type Trace = { time: number[]; values: Record<string, number[]> };
function crossings(trace: Trace, name: string, rising: boolean): number[] {
  const values = trace.values[name]!;
  const result: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1]!;
    const next = values[i]!;
    if (
      rising ? previous < 1.1 && next >= 1.1 : previous > 1.1 && next <= 1.1
    ) {
      result.push(
        trace.time[i - 1]! +
          ((1.1 - previous) / (next - previous)) *
            (trace.time[i]! - trace.time[i - 1]!),
      );
    }
  }
  return result;
}

function run(transistor = false, load = "100f"): Trace {
  const project = delayCellFixture(transistor, load);
  const folder = createSimulationFolder({
    id: "proof",
    name: "Delay proof",
    profileId: "local",
    documentId: "dut",
  });
  folder.input.entry = "run.cir";
  folder.input.circuitBindings[0]!.path = "circuit.inc";
  folder.input.circuitBindings[0]!.emission = "top-level";
  const outputs = transistor
    ? ["input", "output"]
    : ["input", "first", "output", "suppressed"];
  const inputWave = transistor
    ? "0,0.2,1n,0.2,1.002n,2,11n,2,11.002n,0.2,20n,0.2"
    : "0,0.2,1n,0.2,1.002n,2,5n,2,5.002n,0.2,10n,0.2";
  const pulseWave = "0,0.2,7n,0.2,7.002n,2,7.012n,2,7.014n,0.2,10n,0.2";
  const source = `Delay Cell acceptance\n.include circuit.inc\nVdd VDD 0 2\nVref reference 0 0.2\nVin input 0 PWL(${inputWave.replaceAll(",", " ")})\n${transistor ? ".model DN NMOS(level=1 vto=0.5 kp=200u)\n.model DP PMOS(level=1 vto=-0.5 kp=100u)" : `Vpulse pulse 0 PWL(${pulseWave.replaceAll(",", " ")})`}\n.control\nset numdgt=15\ntran 0.5p 10n 0 0.5p\nwrdata trace.txt ${outputs.map((name) => `v(${name})`).join(" ")}\n.endc\n.end\n`;
  folder.input.files = [
    {
      path: folder.input.configPath,
      text: '{"version":2,"environment":{"profileId":"local"}}',
    },
    {
      path: folder.input.entry,
      text: transistor
        ? source.replace("tran 0.5p 10n", "tran 0.5p 20n")
        : source,
    },
  ];
  const compiled = compileNgspiceSourceSimulation(project, folder);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const directory = mkdtempSync(join(tmpdir(), "icm-delay-"));
  for (const file of compiled.files)
    writeFileSync(join(directory, file.path), file.text);
  const result = spawnSync(
    process.env.NGSPICE_BIN!,
    ["-b", folder.input.entry],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
    },
  );
  expect(
    result.status,
    `${directory}\n${result.error?.message ?? ""}\n${result.stdout}${result.stderr}`,
  ).toBe(0);
  const rows = readFileSync(join(directory, "trace.txt"), "utf8")
    .trim()
    .split(/\n/u)
    .map((row) => row.trim().split(/\s+/u).map(Number));
  return {
    time: rows.map((row) => row[0]!),
    values: Object.fromEntries(
      outputs.map((name, i) => [name, rows.map((row) => row[2 * i + 1]!)]),
    ),
  };
}

describe.skipIf(!process.env.NGSPICE_BIN)("Delay Cell in real ngspice", () => {
  it("measures both 100 ps edges, cascaded delay and narrow-pulse rejection with nonzero VSS", () => {
    const trace = run();
    for (const rising of [true, false]) {
      const input = crossings(trace, "input", rising)[0]!;
      const first = crossings(trace, "first", rising)[0]!;
      const output = crossings(trace, "output", rising)[0]!;
      expect(Math.abs((first - input) / 1e-10 - 1)).toBeLessThan(0.03);
      expect(Math.abs((output - input) / 2e-10 - 1)).toBeLessThan(0.03);
    }
    expect(Math.max(...trace.values.suppressed!)).toBeLessThan(0.25);
    expect(trace.values.output!.every(Number.isFinite)).toBe(true);
  }, 120000);
  it("executes the bound four-MOS Cell, with longer physical delay when capacitance doubles", () => {
    const traces = [run(true, "100f"), run(true, "200f")];
    for (const trace of traces) {
      expect(Math.max(...trace.values.output!)).toBeGreaterThan(1.95);
      expect(Math.min(...trace.values.output!)).toBeLessThan(0.25);
    }
    const delays = traces.map(
      (trace) =>
        crossings(trace, "output", true)[0]! -
        crossings(trace, "input", true)[0]!,
    );
    expect(delays[0]).toBeGreaterThan(1e-12);
    expect(delays[1]! / delays[0]!).toBeGreaterThan(1.7);
  }, 120000);
});
