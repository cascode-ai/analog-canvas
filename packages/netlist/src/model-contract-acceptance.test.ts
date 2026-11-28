import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";
import { generatedBehavioralModel } from "./generated-models.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
} from "./simulation-circuit-source.js";

function fixture(symbolId: string, parameters: Record<string, string> = {}) {
  const project = createEmptyProject("acceptance", "Model contracts", "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "DUT";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "block",
    reference: "X1",
    symbolId,
    placement: null,
    netlist: {
      binding: {
        kind: "unresolved-subcircuit",
        name:
          symbolId === "comparator"
            ? "icm_ideal_comparator"
            : descriptor.target,
      },
      parameters,
    },
  });
  // The optional VOCM pin stays unwired: the default `vocm` 0 body, as
  // differential-opamp-vocm.test.ts covers the wired one (#2443).
  const ports = descriptor.ports.filter(
    (p) => (symbolId !== "comparator" || !p.supply) && !p.optional,
  );
  for (const port of ports) {
    const pinName = port.pinName ?? port.supply!;
    const sourceName =
      port.name === "VSS" ||
      (port.name === "VIN" && ports.some((p) => p.name === "VIP"))
        ? "0"
        : port.name;
    document.nets.push({
      id: port.name,
      terminals: [{ instanceId: "block", pinName }],
    });
    if (sourceName === "0") {
      const id = `gnd-${port.name}`;
      document.instances.push({ id, symbolId: "ground", placement: null });
      document.nets.at(-1)!.terminals.push({ instanceId: id, pinName: "0" });
    } else
      document.connectivityEvidence.push({
        id: `hint-${port.name}`,
        kind: "net-name-hint",
        netId: port.name,
        sourceName,
        origin: "spice-import",
      });
  }
  const folder = createSimulationFolder({
    id: "f",
    name: "Acceptance",
    profileId: "local",
    documentId: document.id,
  });
  return { project, folder, ports: ports.map((p) => p.name), document };
}

describe("shared built-in model acceptance", () => {
  it("emits a shared generated model once across bound files in ngspice and rejects authored shadowing", () => {
    const { project, folder, document } = fixture("nand-gate");
    document.netlist!.name = "CellA";
    const second = structuredClone(document);
    second.id = "second";
    second.netlist!.name = "CellB";
    project.documents.push(second);
    folder.input.entry = "run.cir";
    folder.input.circuitBindings = [
      {
        id: "a",
        documentId: document.id,
        path: "a.inc",
        emission: "subcircuit",
      },
      {
        id: "b",
        documentId: second.id,
        path: "b.inc",
        emission: "subcircuit",
      },
    ];
    const entry = {
      path: folder.input.entry,
      text: "Shared\n.include b.inc\n.include a.inc\n.op\n.end\n",
    };
    folder.input.files = [
      folder.input.files.find((f) => f.path === folder.input.configPath)!,
      entry,
    ];
    const compile = () => compileNgspiceSourceSimulation(project, folder);
    const compiled = compile();
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    const generated = compiled.generated.map((f) => f.text).join("\n");
    expect(generated.match(/^\.subckt nand_gate /gmu)).toHaveLength(1);
    expect(generated).toContain("td=10p");
    expect(generated).toContain("CellA");
    expect(generated).toContain("CellB");
    entry.text += "\n.subckt nand_gate a b y vdd vss\n.ends\n";
    const shadowed = compile();
    expect(shadowed).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "SIMULATION_GENERATED_DEFINITION_SHADOWED",
        }),
      ]),
    });
  });

  it("round-trips gain and refuses generated-body edits in ngspice", () => {
    const { project, folder, document } = fixture("opamp", { gain: "123" });
    const source = generateCircuitSource(
      project,
      folder.input.circuitBindings[0]!,
      undefined,
      "ngspice",
    );
    expect(source.ok, JSON.stringify(source)).toBe(true);
    if (!source.ok) return;
    expect(
      source.source.parameters.filter((p) => p.instanceId === "block"),
    ).toHaveLength(1);
    expect(
      source.source.parameters.every((p) => p.documentId === document.id),
    ).toBe(true);
    const span = source.source.parameters.find((p) => p.parameter === "gain")!;
    const edit = planCircuitSourceEdit(
      source.source,
      source.source.text.slice(0, span.startOffset) +
        "456" +
        source.source.text.slice(span.endOffset),
    );
    expect(edit.ok && edit.changes).toMatchObject([
      { instanceId: "block", parameter: "gain", value: "456" },
    ]);
    expect(source.source.text).toMatch(/^Bcore /imu);
    expect(
      planCircuitSourceEdit(
        source.source,
        source.source.text.replace(/^Bcore /imu, "Bbroken "),
      ).ok,
    ).toBe(false);
  });

  it
    .skipIf(!process.env.NGSPICE_BIN)
    .each([
      "opamp",
      "opamp-differential",
      "voltage-amplifier",
      "transconductance",
      "differential-transconductance",
    ])("executes %s OP/DC/AC/TRAN in real ngspice", (symbol) => {
    const { project, folder } = fixture(
      symbol,
      symbol.includes("transconductance") ? { gm: "1m" } : { gain: "100" },
    );
    const output = symbol === "opamp-differential" ? "VOP" : "VOUT";
    // The fixture's negative signal input is grounded. No implicit global supply.
    const input =
      symbol === "voltage-amplifier" || symbol === "transconductance"
        ? "VIN"
        : "VIP";
    const entry = `Acceptance\n.include circuit.spice\nVrail VDD 0 1.8\nVin ${input} 0 DC 10m AC 1 PULSE(0 10m 1n 1n 1n 5n 10n)\nRload ${output} 0 1k\n.control\nop\nwrdata op.txt v(${output})\ndc Vin 0 10m 5m\nwrdata dc.txt v(${output})\nac dec 2 1 1k\nwrdata ac.txt v(${output})\ntran 1n 20n\nwrdata tran.txt v(${output})\n.endc\n.end\n`;
    folder.input.files.find((f) => f.path === folder.input.entry)!.text = entry;
    const compiled = compileNgspiceSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    const dir = mkdtempSync(join(tmpdir(), "icm-model-ng-"));
    for (const f of compiled.files) writeFileSync(join(dir, f.path), f.text);
    const run = spawnSync(
      process.env.NGSPICE_BIN!,
      ["-b", folder.input.entry],
      { cwd: dir, encoding: "utf8", timeout: 30000, windowsHide: true },
    );
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const rows = (file: string) =>
      readFileSync(join(dir, file), "utf8")
        .trim()
        .split(/\n/u)
        .map((row) => row.trim().split(/\s+/u).map(Number));
    const expected = symbol.includes("transconductance")
      ? 0.01
      : symbol === "opamp-differential"
        ? 0.5
        : 1;
    expect(rows("op.txt")[0]![1]).toBeCloseTo(expected, 6);
    expect(rows("dc.txt").at(-1)![1]).toBeCloseTo(expected, 6);
    // The op-amp's output, 0.8 V below its 1.8 V supply limit, bends its
    // small-signal gain 2e-8 short of the gain (#1463).
    expect(rows("ac.txt")[0]![1]).toBeCloseTo(
      expected / 0.01,
      symbol === "opamp" ? 4 : 6,
    );
    expect(rows("tran.txt").flat().every(Number.isFinite)).toBe(true);
  });

  // With the gain inside its limit, the Wien bridge stopped ngspice with
  // "timestep too small" as its output reached the limit (#1463).
  it.skipIf(!process.env.NGSPICE_BIN).each([
    {
      // R1 = R2, so f = 1/(2RC ln 3).
      circuit: "astable",
      cards: "RT out n1 10k\nCT n1 0 100n\nR1 out n0 10k\nR2 n0 0 10k",
      start: ".ic v(n1)=0.01\n.tran 2u 40m uic",
      hertz: 1 / (2 * 1e4 * 1e-7 * Math.log(3)),
      tolerance: 0.01,
    },
    {
      // f = 1/(2πRC); a loop gain of 3.2 starts it and the limit holds it.
      circuit: "Wien-bridge",
      cards:
        "C1 out n2 10n\nR1 n2 n0 10k\nC2 n0 0 10n\nR2 n0 0 10k\nR3 out n1 22k\nR4 n1 0 10k\nIKICK 0 n0 PULSE(0 1u 0 1u 1u 10u)",
      start: ".tran 1u 40m",
      hertz: 1 / (2 * Math.PI * 1e4 * 1e-8),
      tolerance: 0.03,
    },
  ])(
    "saturates an op-amp $circuit oscillator at ±5 V in real ngspice",
    ({ cards, start, hertz, tolerance }) => {
      const dir = mkdtempSync(join(tmpdir(), "icm-opamp-limit-"));
      writeFileSync(
        join(dir, "deck.cir"),
        [
          "Ideal op-amp oscillator",
          ...generatedBehavioralModel("opamp"),
          cards,
          "X1 0 0 n0 n1 out opamp",
          start,
          ".meas tran t1 when v(out)=0 rise=3 from=20m",
          ".meas tran t2 when v(out)=0 rise=4 from=20m",
          ".meas tran top max v(out) from=20m",
          ".meas tran bottom min v(out) from=20m",
          ".end",
        ].join("\n"),
      );
      const run = spawnSync(process.env.NGSPICE_BIN!, ["-b", "deck.cir"], {
        cwd: dir,
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
      });
      const log = run.stdout + run.stderr;
      expect(log).not.toMatch(/timestep too small/iu);
      const measured = (name: string) =>
        Number(new RegExp(`^${name}\\s*=\\s*(\\S+)`, "mu").exec(log)?.[1]);
      expect(
        Math.abs(1 / (measured("t2") - measured("t1")) / hertz - 1),
      ).toBeLessThan(tolerance);
      expect(measured("top")).toBeCloseTo(5, 2);
      expect(measured("bottom")).toBeCloseTo(-5, 2);
    },
  );

  it.skipIf(!process.env.NGSPICE_BIN).each([
    { vhigh: "VDD", vlow: "0", delta: -0.01, positive: 0, negative: 1.8 },
    { vhigh: "VDD", vlow: "0", delta: 0, positive: 0.9, negative: 0.9 },
    { vhigh: "VDD", vlow: "0", delta: 0.01, positive: 1.8, negative: 0 },
    { vhigh: "2", vlow: "-1", delta: -0.01, positive: -1, negative: 2 },
    { vhigh: "2", vlow: "-1", delta: 0, positive: 0.5, negative: 0.5 },
    { vhigh: "2", vlow: "-1", delta: 0.01, positive: 2, negative: -1 },
  ])(
    "executes the fully differential comparator in ngspice: high=$vhigh input=$delta",
    ({ vhigh, vlow, delta, positive, negative }) => {
      const { project, folder } = fixture("comparator-differential", {
        vhigh,
        vlow,
        vtransition: "1m",
      });
      folder.input.entry = "run.sp";
      folder.input.circuitBindings[0]!.path = "circuit.sp";
      folder.input.circuitBindings[0]!.emission = "top-level";
      const text = `Differential comparator\n.include circuit.sp\nVrail VDD 0 1.8\nVin VIP 0 ${delta}\n.control\nop\nwrdata positive.txt v(VOP)\nwrdata negative.txt v(VON)\n.endc\n.end\n`;
      folder.input.files = [
        {
          path: folder.input.configPath,
          text: '{"version":2,"environment":{"profileId":"local"}}',
        },
        { path: folder.input.entry, text },
      ];
      const compiled = compileNgspiceSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (!compiled.ok) return;
      const dir = mkdtempSync(join(tmpdir(), "icm-fd-comparator-"));
      for (const file of compiled.files)
        writeFileSync(join(dir, file.path), file.text);
      const run = spawnSync(
        process.env.NGSPICE_BIN!,
        ["-b", folder.input.entry],
        { cwd: dir, encoding: "utf8", timeout: 30000, windowsHide: true },
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const actual = ["positive.txt", "negative.txt"].map((file) =>
        Number(readFileSync(join(dir, file), "utf8").trim().split(/\s+/u)[1]),
      );
      expect(actual[0]).toBeCloseTo(positive, 7);
      expect(actual[1]).toBeCloseTo(negative, 7);
      expect(actual[0]! + actual[1]!).toBeCloseTo(positive + negative, 7);
    },
    60000,
  );
});
