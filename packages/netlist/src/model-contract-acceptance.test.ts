import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  subcircuitDescriptor,
  builtInSubcircuitDescriptors,
  builtInModelContract,
} from "@icm/devices";
import { compileSourceSimulation } from "./simulation-source-compile.js";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import {
  generateCircuitSource,
  planCircuitSourceEdit,
} from "./simulation-circuit-source.js";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import { analyzeDesignNetlist, SIMULATION_DECK_GROUND } from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

function deviceFixture(
  symbolId: string,
  reference: string,
  pins: readonly (readonly [string, string])[],
  parameters: Record<string, string> = {},
) {
  const project = createEmptyProject(
    "device-proof",
    "Electrical acceptance",
    "dut",
  );
  const document = project.documents[0]!;
  document.instances.push({
    id: "device",
    symbolId,
    reference,
    placement: null,
    netlist: { parameters },
  });
  for (const [pinName, node] of pins) {
    document.nets.push({
      id: pinName,
      terminals: [{ instanceId: "device", pinName }],
    });
    if (node === "0") {
      document.instances.push({
        id: `gnd-${pinName}`,
        symbolId: "ground",
        placement: null,
      });
      document.nets
        .at(-1)!
        .terminals.push({ instanceId: `gnd-${pinName}`, pinName: "0" });
    } else
      document.connectivityEvidence.push({
        id: `hint-${pinName}`,
        kind: "net-name-hint",
        netId: pinName,
        sourceName: node,
        origin: "spice-import",
      });
  }
  const ir = analyzeDesignNetlist(project, {
    ...SIMULATION_DECK_GROUND,
    rootAsTopLevel: true,
  });
  if (!ir.ir) throw Error(JSON.stringify(ir.diagnostics));
  return { project, ir: ir.ir };
}

function nativeRun(files: readonly { path: string; text: string }[]) {
  const dir = mkdtempSync(join(tmpdir(), "icm-model-native-"));
  for (const f of files) writeFileSync(join(dir, f.path), f.text);
  const wslDirectory = `/mnt/${dir[0]!.toLowerCase()}${dir.slice(2).replaceAll("\\", "/")}`;
  const startup = process.env.VACASK_WSL_BIN
    ? process.env.VACASK_WSL_STARTUP
    : process.env.VACASK_STARTUP;
  const args = [...(startup ? ["--tomlfile", startup] : []), "run.sim"];
  const run = spawnSync(
    process.env.VACASK_WSL_BIN ? "wsl.exe" : process.env.VACASK_BIN!,
    process.env.VACASK_WSL_BIN
      ? [
          "-d",
          "Ubuntu",
          "--cd",
          wslDirectory,
          "--",
          "env",
          ...(process.env.VACASK_WSL_LIBS
            ? [`LD_LIBRARY_PATH=${process.env.VACASK_WSL_LIBS}`]
            : []),
          process.env.VACASK_WSL_BIN,
          ...args,
        ]
      : args,
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 60000,
      env: process.env,
      windowsHide: true,
    },
  );
  expect(run.status, `Directory ${dir}\n${run.stdout}${run.stderr}`).toBe(0);
  return (file: string, output: string) => {
    const raw = parseVacaskRawfile(readFileSync(join(dir, file), "utf8"));
    expect(raw.ok, JSON.stringify(raw)).toBe(true);
    if (!raw.ok) throw Error(raw.error.message);
    const vector = raw.plots[0]!.vectors.find(
      (v) => v.variable.name === output,
    );
    expect(vector, `Missing measured ${output} in ${file}`).toBeDefined();
    return vector!;
  };
}

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
  const ports = descriptor.ports.filter(
    (p) => symbolId !== "comparator" || !p.supply,
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

const registeredModels = [
  ...new Map(
    builtInSubcircuitDescriptors
      .filter((d) => builtInModelContract(d.target))
      .map((d) => [d.target, d.symbolId]),
  ).values(),
  "comparator",
];

describe("shared built-in model acceptance", () => {
  it.each(["ngspice", "vacask"] as const)(
    "emits a shared generated model once across bound files in %s and rejects authored shadowing",
    (engine) => {
      const { project, folder, document } = fixture("nand-gate");
      document.netlist!.name = "CellA";
      const second = structuredClone(document);
      second.id = "second";
      second.netlist!.name = "CellB";
      project.documents.push(second);
      const native = engine === "vacask";
      folder.input.entry = native ? "run.sim" : "run.cir";
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
        text: native
          ? 'Shared\ninclude "b.inc"\ninclude "a.inc"\ncontrol\nanalysis proof op\nendc\n'
          : "Shared\n.include b.inc\n.include a.inc\n.op\n.end\n",
      };
      folder.input.files = [
        folder.input.files.find((f) => f.path === folder.input.configPath)!,
        entry,
      ];
      const compile = () =>
        native
          ? compileSourceSimulation(project, folder)
          : compileNgspiceSourceSimulation(project, folder);
      const compiled = compile();
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (!compiled.ok) return;
      const generated = compiled.generated.map((f) => f.text).join("\n");
      expect(
        generated.match(
          native ? /^subckt nand_gate /gmu : /^\.subckt nand_gate /gmu,
        ),
      ).toHaveLength(1);
      expect(generated).toContain(native ? "td=1e-11" : "td=10p");
      expect(generated).toContain("CellA");
      expect(generated).toContain("CellB");
      entry.text += native
        ? "\nsubckt nand_gate (a b y vdd vss)\nends\n"
        : "\n.subckt nand_gate a b y vdd vss\n.ends\n";
      const shadowed = compile();
      expect(shadowed).toMatchObject({
        ok: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "SIMULATION_GENERATED_DEFINITION_SHADOWED",
          }),
        ]),
      });
    },
  );
  it.each(["ngspice", "vacask"] as const)(
    "round-trips gain and refuses generated-body edits in %s",
    (engine) => {
      const { project, folder, document } = fixture("opamp", { gain: "123" });
      const source = generateCircuitSource(
        project,
        folder.input.circuitBindings[0]!,
        undefined,
        engine,
      );
      expect(source.ok, JSON.stringify(source)).toBe(true);
      if (!source.ok) return;
      expect(
        source.source.parameters.filter((p) => p.instanceId === "block"),
      ).toHaveLength(1);
      expect(
        source.source.parameters.every((p) => p.documentId === document.id),
      ).toBe(true);
      const span = source.source.parameters.find(
        (p) => p.parameter === "gain",
      )!;
      const edit = planCircuitSourceEdit(
        source.source,
        source.source.text.slice(0, span.startOffset) +
          "456" +
          source.source.text.slice(span.endOffset),
      );
      expect(edit.ok && edit.changes).toMatchObject([
        { instanceId: "block", parameter: "gain", value: "456" },
      ]);
      expect(
        planCircuitSourceEdit(
          source.source,
          source.source.text.replace("ECORE", "EBROKEN"),
        ).ok,
      ).toBe(false);
    },
  );

  it("compiles native generated analog masters without treating them as Canvas Documents", () => {
    const { project, folder } = fixture("opamp", { gain: "100" });
    folder.input.entry = "run.sim";
    folder.input.circuitBindings[0]!.path = "circuit.sim";
    folder.input.files = [
      {
        path: folder.input.configPath,
        text: '{"version":2,"environment":{"profileId":"local"}}',
      },
      {
        path: "run.sim",
        text: 'Native\ninclude "circuit.sim"\ncontrol\nanalysis proof op\nendc\n',
      },
    ];
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.generated[0]!.text).toContain(
      "subckt opamp (VDD VSS VIP VIN VOUT)",
    );
    expect(
      compiled.generated[0]!.parameters.some(
        (p) => p.instanceId === "block" && p.parameter === "gain",
      ),
    ).toBe(true);
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
    expect(rows("ac.txt")[0]![1]).toBeCloseTo(expected / 0.01, 6);
    expect(rows("tran.txt").flat().every(Number.isFinite)).toBe(true);
  });

  it
    .skipIf(!process.env.VACASK_BIN && !process.env.VACASK_WSL_BIN)
    .each(registeredModels)(
    "executes the actual generated %s model in native VACASK",
    (symbol) => {
      const descriptor = subcircuitDescriptor(symbol)!;
      const target =
        symbol === "comparator" ? "icm_ideal_comparator" : descriptor.target;
      const metadata = builtInModelContract(target)!;
      const voltageGain =
        metadata.parameters.some((p) => p.name === "gain") &&
        metadata.family === "linear";
      const { project, folder, ports } = fixture(
        symbol,
        voltageGain ? { gain: "100" } : {},
      );
      folder.input.entry = "run.sim";
      folder.input.circuitBindings[0]!.path = "circuit.sim";
      folder.input.circuitBindings[0]!.emission = "top-level";
      const output = descriptor.ports.find(
        (p) => p.direction === "output",
      )!.name;
      const inputs = descriptor.ports
        .filter(
          (p) =>
            p.direction === "input" &&
            !p.supply &&
            !(p.name === "VIN" && ports.includes("VIP")),
        )
        .map((p) => p.name);
      const text = `Native acceptance\ninclude "circuit.sim"\nmodel vs vsource\nmodel rr resistor\nload "resistor.osdi"\nrail (VDD 0) vs dc=1.8\n${inputs.map((p) => `vin${p} (${p} 0) vs dc=0.01 mag=1`).join("\n")}\nRload (${output} 0) rr r=1000\ncontrol\nabort always\noptions rawfile=\"ascii\"\nsave default\nanalysis proof op\nanalysis freq ac from=1 to=1000 mode=\"dec\" points=2\nanalysis time tran stop=2n step=0.1n\nendc\n`;
      folder.input.files = [
        {
          path: folder.input.configPath,
          text: '{"version":2,"environment":{"profileId":"local"}}',
        },
        { path: "run.sim", text },
      ];
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (!compiled.ok) return;
      const read = nativeRun(compiled.files);
      const expected =
        metadata.family === "logic"
          ? /^(?:inverter|nand_|nor_|xnor_)/u.test(target)
            ? 1.8
            : 0
          : target === "multiplier"
            ? 0.0001
            : target === "adc" || target === "dac"
              ? 1.8 / 256
              : target === "adder"
                ? inputs.length * 0.01
                : target.includes("transconductance")
                  ? 0.01
                  : target === "opamp_differential"
                    ? 0.5
                    : 1;
      expect(read("proof.raw", output).real[0]).toBeCloseTo(expected, 7);
      expect(read("time.raw", output).real.every(Number.isFinite)).toBe(true);
      expect(read("freq.raw", output).real.every(Number.isFinite)).toBe(true);
    },
    60000,
  );

  it
    .skipIf(!process.env.VACASK_BIN && !process.env.VACASK_WSL_BIN)
    .each([0.8, -0.8])(
    "measures native transformer polarity and gain at k=%s",
    (k) => {
      const { ir } = deviceFixture(
        "xfmr",
        "X1",
        [
          ["P+", "pri"],
          ["P-", "0"],
          ["S+", "sec"],
          ["S-", "0"],
        ],
        { lp: "1m", ls: "4m", k: String(k) },
      );
      const printed = printVacaskWithLocations(ir, true);
      expect(printed.ok).toBe(true);
      if (!printed.ok) return;
      const read = nativeRun([
        { path: "circuit.sim", text: printed.text },
        {
          path: "run.sim",
          text: `Transformer\ninclude "circuit.sim"\nmodel vs vsource\nmodel rr resistor\nload "resistor.osdi"\nvin (drive 0) vs dc=0 mag=1\nrsource (drive pri) rr r=0.001\nrload (sec 0) rr r=1e6\ncontrol\nabort always\noptions rawfile="ascii"\nsave default\nanalysis proof ac from=1k to=10k mode="dec" points=2\nendc\n`,
        },
      ]);
      expect(read("proof.raw", "sec").real[0]).toBeCloseTo(2 * k, 4);
    },
    60000,
  );

  it
    .skipIf(!process.env.VACASK_BIN && !process.env.VACASK_WSL_BIN)
    .each(["ideal-switch", "closed-switch", "externally-controlled-switch"])(
    "measures native %s phase control without changing annotation semantics",
    (symbol) => {
      const pins =
        symbol === "externally-controlled-switch"
          ? ([
              ["P", "in"],
              ["N", "out"],
              ["CTRL", "clk"],
            ] as const)
          : ([
              ["1", "in"],
              ["2", "out"],
            ] as const);
      const { ir } = deviceFixture(symbol, "S1", pins);
      const control = symbol === "externally-controlled-switch" ? "clk" : "S1";
      const printed = printVacaskWithLocations(ir, true);
      expect(printed.ok).toBe(true);
      if (!printed.ok) return;
      const read = nativeRun([
        { path: "circuit.sim", text: printed.text },
        {
          path: "run.sim",
          text: `Switch\ninclude "circuit.sim"\nload "resistor.osdi"\nmodel vs vsource\nmodel rr resistor\nvin (in 0) vs dc=1\nvclock (${control} 0) vs dc=0\nrload (out 0) rr r=1000\ncontrol\nabort always\noptions rawfile="ascii" vntol=1e-10 abstol=1e-15 reltol=1e-6\nsave default\nanalysis off op\nsweep clock instance="vclock" parameter="dc" values=[1]\nanalysis on op\nanalysis freq ac from=1 to=1000 mode="dec" points=2\nanalysis time tran stop=2n step=0.1n\nendc\n`,
        },
      ]);
      expect(read("off.raw", "out").real[0]).toBeCloseTo(0, 6);
      expect(read("on.raw", "out").real[0]).toBeCloseTo(1000 / 1001, 6);
      expect(read("time.raw", "out").real.every(Number.isFinite)).toBe(true);
    },
    60000,
  );

  it
    .skipIf(!process.env.VACASK_BIN && !process.env.VACASK_WSL_BIN)
    .each(
      [
        "ideal-switch",
        "closed-switch",
        "simple-switch",
        "externally-controlled-switch",
      ].flatMap((symbol) =>
        [false, true].map((reactive) => ({ symbol, reactive })),
      ),
    )(
    "executes hard $symbol edges with reactive=$reactive and preserves the RC state",
    ({ symbol, reactive }) => {
      const { ir } = deviceFixture(
        symbol,
        "S1",
        symbol === "externally-controlled-switch"
          ? [
              ["P", "in"],
              ["N", "out"],
              ["CTRL", "clk"],
            ]
          : [
              ["1", "in"],
              ["2", "out"],
            ],
      );
      const control = symbol === "externally-controlled-switch" ? "clk" : "S1";
      const printed = printVacaskWithLocations(ir, true);
      expect(printed.ok).toBe(true);
      if (!printed.ok) return;
      const read = nativeRun([
        { path: "circuit.sim", text: printed.text },
        {
          path: "run.sim",
          text: `Hard switch\ninclude "circuit.sim"\nload "resistor.osdi"\nload "capacitor.osdi"\nmodel vs vsource\nmodel rr resistor\nmodel cc capacitor\nvin (in 0) vs dc=1\nvclock (${control} 0) vs type="pulse" val0=0 val1=1 delay=1n rise=1n fall=1n width=5n period=10n\nrload (out 0) rr r=1000\n${reactive ? "cload (out 0) cc c=100p\n" : ""}control\nabort always\noptions rawfile="ascii" vntol=1e-10 abstol=1e-15 reltol=1e-6\nsave default\nanalysis time tran stop=35n step=0.1n\nendc\n`,
        },
      ]);
      const times = read("time.raw", "time").real;
      const output = read("time.raw", "out").real;
      const controls = read("time.raw", control).real;
      expect(times.at(-1)).toBeCloseTo(35e-9, 18);
      expect(times.length).toBeGreaterThan(50);
      expect(output.every(Number.isFinite)).toBe(true);
      const off = 1000 / (1000 + 1e12);
      const on = 1000 / 1001;
      if (!reactive) {
        for (const [i, value] of output.entries())
          expect(value).toBeCloseTo(controls[i]! > 0.5 ? on : off, 7);
        // Both directions must have actual accepted event points, not a DC-only run.
        for (const edge of [1.5, 7.5, 11.5, 17.5, 21.5, 27.5, 31.5])
          expect(
            Math.min(...times.map((t) => Math.abs(t - edge * 1e-9))),
          ).toBeLessThan(1e-16);
      } else {
        // Independent analytic solution of the piecewise linear RC circuit.
        // Charge remains continuous; only conductance changes at the hard edge.
        const edges = [1.5, 7.5, 11.5, 17.5, 21.5, 27.5, 31.5].map(
          (t) => t * 1e-9,
        );
        const expected = (time: number) => {
          let value = off;
          let previous = 0;
          let closed = false;
          for (const boundary of [...edges, time]) {
            const end = Math.min(boundary, time);
            const resistance = closed ? 1 : 1e12;
            const steady = closed ? on : off;
            const tau = 100e-12 / (1 / resistance + 1 / 1000);
            value =
              steady + (value - steady) * Math.exp(-(end - previous) / tau);
            if (end === time) break;
            previous = end;
            closed = !closed;
          }
          return value;
        };
        for (const [i, value] of output.entries())
          expect(Math.abs(value - expected(times[i]!))).toBeLessThan(5e-5);
      }
    },
    60000,
  );
});
