import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import type { DesignNetlistIR, DesignNetlistInstance } from "./ir.js";
import {
  printVacaskWithLocations,
  vacaskIdentifier,
  vacaskProjectValue,
} from "./vacask-printer.js";

function card(
  reference: string,
  deviceClass: DesignNetlistInstance["deviceClass"],
  values: Record<string, string>,
  nets = ["input", "0"],
): DesignNetlistInstance {
  return {
    id: reference,
    reference,
    invocationKind: "primitive",
    deviceClass,
    target: null,
    parameters: Object.entries(values).map(([name, rawValue]) => ({
      name,
      rawValue,
    })),
    nodes: nets.map((netName, index) => ({ pinName: String(index), netName })),
  };
}
function design(instances: DesignNetlistInstance[]): DesignNetlistIR {
  return {
    topCellId: "top",
    globals: ["0", "VDD!"],
    cells: [{ id: "top", name: "top", ports: [], nets: [], instances }],
  };
}
function printed(ir: DesignNetlistIR, top = true) {
  const result = printVacaskWithLocations(ir, top);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result;
}

function multipliedDesign(): DesignNetlistIR {
  const ir = design(
    [1, 2, 3].flatMap((n) => [
      card(`VM${n}`, "voltage-source", { dc: "1" }, [`supply${n}`, "0"]),
      {
        ...card(
          `XM${n}`,
          "hierarchical",
          n === 3 ? {} : { m: n === 1 ? "2" : "5" },
          [`supply${n}`, "0"],
        ),
        invocationKind: "subcircuit" as const,
        target: "outer",
      },
    ]),
  );
  const ports = [
    { id: "p", name: "p", netName: "p" },
    { id: "n", name: "n", netName: "n" },
  ];
  ir.cells.push(
    {
      id: "outer",
      name: "outer",
      ports,
      nets: [],
      instances: [
        {
          ...card("XL", "hierarchical", { m: "3" }, ["p", "n"]),
          invocationKind: "subcircuit",
          target: "leaf",
        },
      ],
    },
    {
      id: "leaf",
      name: "leaf",
      ports,
      nets: [],
      instances: [
        card("R", "resistor", { value: "1k", m: "4" }, ["p", "n"]),
        card("I", "current-source", { dc: "1m" }, ["p", "n"]),
        card("VL", "voltage-source", { dc: "2" }, ["local", "n"]),
        card("RL", "resistor", { value: "1k", m: "4" }, ["local", "n"]),
      ],
    },
  );
  return ir;
}

describe("native VACASK circuit projection", () => {
  it("uses native calls with dimensional numeric values, not copied SPICE suffixes", () => {
    const result = printed(
      design([
        card("R1", "resistor", { value: "1M", m: "2" }, ["input", "mid"]),
        card("C1", "capacitor", { value: "2N" }, ["mid", "0"]),
        card("L1", "inductor", { value: "1u" }),
        card("V1", "voltage-source", {
          dc: "3",
          acMagnitude: "1",
          acPhase: "90",
        }),
      ]),
    );
    expect(result.text).toContain('load "resistor.osdi"');
    expect(result.text).toContain("global 'VDD!'");
    expect(result.text).toContain(
      "R1 (input mid) __icm_resistor r=0.001 $mfactor=2",
    );
    expect(result.text).toContain("C1 (mid 0) __icm_capacitor c=2e-9");
    expect(result.text).toContain("L1 (input 0) __icm_inductor l=0.000001");
    expect(result.text).toContain(
      'V1 (input 0) __icm_vsource type="dc" dc=3 mag=1 phase=90',
    );
    expect(result.text).not.toContain(".control");
    expect(result.instances).toHaveLength(4);
    for (const p of result.parameters)
      expect(result.text.slice(p.startOffset, p.endOffset)).toBe(p.rawValue);
    for (const i of result.instances)
      expect(result.text.slice(i.startOffset, i.endOffset)).toMatch(
        new RegExp(`^${i.instanceId} \\(`),
      );
  });

  it("keeps pulse and sine/AC phase mappings distinct", () => {
    const result = printed(
      design([
        card("V1", "voltage-source", {
          waveform: "pulse",
          low: "0",
          high: "1",
          delay: "1u",
          rise: "1n",
          fall: "2n",
          width: "3u",
          period: "10u",
        }),
        card("I1", "current-source", {
          waveform: "sin",
          offset: "1m",
          amplitude: "2m",
          frequency: "1g",
          phase: "30",
          acMagnitude: "1",
          acPhase: "90",
          damping: "4",
          delay: "1u",
        }),
      ]),
    );
    expect(result.text).toContain(
      'type="pulse" val0=0 val1=1 delay=0.000001 rise=1e-9 fall=2e-9 width=0.000003 period=0.000009999999999999999',
    );
    expect(result.text).toContain(
      'type="sine" mag=1 phase=90 sinedc=0.001 ampl=0.002 freq=1000000000 delay=0.000001 theta=4 tdphase=30',
    );
  });

  it("emits PWL point pairs and retains a reversible source parameter range", () => {
    const result = printed(
      design([
        card("V1", "voltage-source", {
          waveform: "pwl",
          pwlPoints: "0 0, 1u 1, 2u 0",
        }),
      ]),
    );
    const span = result.parameters.find((p) => p.parameter === "pwlPoints")!;
    expect(result.text.slice(span.startOffset, span.endOffset)).toBe(
      "[0, 0, 0.000001, 1, 0.000002, 0]",
    );
  });

  it("preserves formal pin order and internal net spellings across two occurrences", () => {
    const ir = design([]);
    ir.cells[0]!.instances = ["X1", "X2"].map((reference) => ({
      ...card(reference, "hierarchical", { r: "2k" }, [
        "input",
        reference + "out",
      ]),
      invocationKind: "subcircuit",
      target: "divider",
    }));
    ir.cells.push({
      id: "child",
      name: "divider",
      nets: [],
      ports: [
        { id: "pi", name: "in", netName: "in+" },
        { id: "po", name: "out", netName: "out-" },
      ],
      formalParameters: [{ name: "r", defaultValue: "1k" }],
      instances: [card("R1", "resistor", { value: "{r}" }, ["in+", "out-"])],
    });
    const result = printed(ir);
    expect(result.text).toContain(
      "subckt divider ('in+' 'out-')\nparameters r=1000",
    );
    expect(result.text).toContain("R1 ('in+' 'out-') __icm_resistor r=(r)");
    expect(result.text).toContain("X1 (input X1out) divider r=2000");
    expect(result.text).toContain("X2 (input X2out) divider r=2000");
    expect(
      result.instances.find((i) => i.instanceId === "R1")?.documentId,
    ).toBe("child");
  });

  it("does not mistake a model-backed subcircuit resistor for an ideal primitive", () => {
    const external = {
      ...card("XR1", "resistor", { w: "1", l: "5.5" }),
      invocationKind: "subcircuit" as const,
      target: "native_resistor",
    };
    const result = printed(design([external]));
    expect(result.text).toContain("XR1 (input 0) native_resistor w=1 l=5.5");
    expect(result.text).not.toContain('load "resistor.osdi"');
  });

  it("resolves known formal parameter casing before entering the case-sensitive language", () => {
    const ir = design([
      {
        ...card("X1", "hierarchical", { r: "2k" }),
        invocationKind: "subcircuit",
        target: "child",
      },
    ]);
    ir.cells.push({
      id: "child",
      name: "child",
      ports: [],
      nets: [],
      formalParameters: [{ name: "R", defaultValue: "1k" }],
      instances: [card("R1", "resistor", { value: "{r}" })],
    });
    const result = printed(ir);
    expect(result.text).toContain("X1 (input 0) child R=2000");
    expect(result.text).toContain("R1 (input 0) __icm_resistor r=(R)");
  });

  it("avoids alias collisions with authored model names", () => {
    const result = printed(
      design([
        card("R1", "resistor", { value: "1k" }),
        { ...card("D1", "diode", {}), target: "__icm_resistor" },
      ]),
    );
    expect(result.text).toContain("model __icm_resistor_ resistor");
    expect(result.text).toContain("D1 (input 0) __icm_resistor");
  });

  it("returns located diagnostics for incomplete sources and missing models", () => {
    const result = printVacaskWithLocations(
      design([
        card("V1", "voltage-source", { waveform: "pulse" }),
        card("M1", "mos", {}),
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.objectIds)).toEqual([
      ["V1"],
      ["M1"],
    ]);
    expect(result.diagnostics.map((d) => d.primary.kind)).toEqual([
      "instance",
      "instance",
    ]);
  });

  it("does not invent defaults for required Cell parameters or a missing top", () => {
    const ir = design([]);
    ir.cells[0]!.formalParameters = [{ name: "r" }];
    expect(printVacaskWithLocations(ir).ok).toBe(false);
    expect(printVacaskWithLocations({ ...ir, topCellId: "missing" }).ok).toBe(
      false,
    );
  });

  it("reports unqualified subcircuit multiplicity instead of silently ignoring it", () => {
    const result = printVacaskWithLocations(
      design([
        {
          ...card("X1", "hierarchical", { m: "2" }),
          invocationKind: "subcircuit",
          target: "external",
        },
      ]),
    );
    expect(!result.ok && result.diagnostics[0]?.code).toBe(
      "VACASK_UNMAPPED_SUBCIRCUIT_MULTIPLICITY",
    );
  });

  it("forwards and multiplies owned nested Cell factors without duplicating source spans", () => {
    const result = printed(multipliedDesign());
    expect(result.text).toContain("subckt outer (p n)\nparameters $mfactor=1");
    expect(result.text).toContain("subckt leaf (p n)\nparameters $mfactor=1");
    expect(result.text).toContain("XM1 (supply1 0) outer $mfactor=2");
    expect(result.text).toContain("XL (p n) leaf $mfactor=($mfactor*3)");
    expect(result.text).toContain(
      "R (p n) __icm_resistor r=1000 $mfactor=($mfactor*4)",
    );
    expect(result.text).toContain(
      'I (p n) __icm_isource type="dc" dc=0.001 $mfactor=$mfactor',
    );
    expect(result.text).toContain(
      'VL (local n) __icm_vsource type="dc" dc=2\n',
    );
    const span = result.parameters.find(
      (p) => p.instanceId === "XL" && p.parameter === "m",
    )!;
    // A mapped edit replaces only this instance's factor, not the forwarding.
    expect(result.text.slice(span.startOffset, span.endOffset)).toBe("3");
    expect(span.rawValue).toBe("3");
    expect(
      result.parameters.some(
        (p) => p.instanceId === "I" && p.parameter === "$mfactor",
      ),
    ).toBe(false);
  });

  it("reports an external wrapper reached through multiplied hierarchy", () => {
    const ir = multipliedDesign();
    ir.cells
      .find((c) => c.id === "leaf")!
      .instances.push({
        ...card("XPDK", "mos", {}, ["p", "p", "n", "n"]),
        invocationKind: "subcircuit",
        target: "unqualified_native_wrapper",
      });
    const result = printVacaskWithLocations(ir, true);
    expect(!result.ok && result.diagnostics[0]).toMatchObject({
      code: "VACASK_UNMAPPED_SUBCIRCUIT_MULTIPLICITY",
      documentId: "leaf",
      objectIds: ["XPDK"],
    });
  });

  it("does not overwrite an ordinary formal parameter with forwarding", () => {
    const ir = multipliedDesign();
    ir.cells.find((c) => c.id === "outer")!.formalParameters = [
      { name: "m", defaultValue: "1" },
    ];
    const result = printVacaskWithLocations(ir);
    expect(!result.ok && result.diagnostics[0]?.code).toBe(
      "VACASK_MULTIPLICITY_PARAMETER_CONFLICT",
    );
  });

  it("rejects two source fields that would assign the same native parameter", () => {
    const result = printVacaskWithLocations(
      design([
        card("V1", "voltage-source", { dc: "1", acMagnitude: "1", mag: "2" }),
      ]),
    );
    expect(!result.ok && result.diagnostics[0]?.code).toBe(
      "VACASK_DUPLICATE_PARAMETER",
    );
  });
});

describe("project scalar semantics at the VACASK boundary", () => {
  it.each([
    ["1M", "0.001"],
    ["1meg", "1000000"],
    ["1g", "1000000000"],
    ["10uF", "0.000009999999999999999"],
  ])("preserves %s", (input, expected) =>
    expect(vacaskProjectValue(input)).toBe(expected),
  );
  it("translates expression tokens without evaluating parameter dependencies", () => {
    expect(vacaskProjectValue("{Gain*1M + 2^3 + log(100)}")).toBe(
      "(Gain*0.001 + 2**3 + log(100))",
    );
    expect(vacaskProjectValue("'sqrt(r*1k)' ")).toBe("(sqrt(r*1000))");
    expect(vacaskProjectValue("1 k")).toBe("(1 k)");
  });
  it.each(["1e999", "{r}; control", "{pwr(r,2)}", "{r%2}"])(
    "refuses an unverified or unsafe projection: %s",
    (raw) => expect(() => vacaskProjectValue(raw)).toThrow(),
  );
  it("quotes punctuation/reserved words without changing case or inventing a new Net", () => {
    expect(vacaskIdentifier("control")).toBe("'control'");
    expect(vacaskIdentifier("Vout+")).toBe("'Vout+'");
    expect(vacaskIdentifier("a'b")).toBe("'a''b'");
    expect(vacaskIdentifier("Vout")).toBe("Vout");
    expect(() => vacaskIdentifier("out\ncontrol")).toThrow();
  });
});

// Opt-in real-kernel evidence. Ordinary unit CI does not pretend to qualify a
// missing simulator. Set both variables to a pinned VACASK installation.
it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
  "executes printer-generated hierarchy, multiplicity and waveform sources in native VACASK",
  () => {
    const ir = design([
      card("V1", "voltage-source", { dc: "3" }),
      card("Vlog", "voltage-source", { dc: "{log(100)}" }, ["logvalue", "0"]),
      ...["X1", "X2"].map((reference, index) => ({
        ...card(reference, "hierarchical", { r: index === 0 ? "1k" : "2k" }, [
          "input",
          reference + "out",
        ]),
        invocationKind: "subcircuit" as const,
        target: "divider",
      })),
      card(
        "Vs",
        "voltage-source",
        {
          waveform: "sin",
          offset: "1",
          amplitude: "2",
          frequency: "1k",
          phase: "30",
          acMagnitude: "1",
          acPhase: "90",
        },
        ["sine", "0"],
      ),
      card(
        "Vp",
        "voltage-source",
        { waveform: "pwl", pwlPoints: "0 0, 1m 1, 2m 0" },
        ["pwl", "0"],
      ),
    ]);
    ir.cells.push({
      id: "child",
      name: "divider",
      nets: [],
      ports: [
        { id: "pi", name: "in", netName: "in+" },
        { id: "po", name: "out", netName: "out-" },
      ],
      formalParameters: [{ name: "r", defaultValue: "1k" }],
      instances: [
        card("R1", "resistor", { value: "{r}" }, ["in+", "out-"]),
        card("R2", "resistor", { value: "2k" }, ["out-", "0"]),
      ],
    });
    const multiplied = multipliedDesign();
    ir.cells[0]!.instances.push(...multiplied.cells[0]!.instances);
    ir.cells.push(...multiplied.cells.slice(1));
    const source =
      printed(ir).text +
      '\ncontrol\n abort always\n options rawfile="ascii" strictsave=2\n save default\n analysis op1 op\n analysis ac1 ac from=1k to=1k mode="lin" points=1\n analysis tran1 tran stop=2m step=20u maxstep=20u\nendc\n';
    const cwd = mkdtempSync(join(tmpdir(), "icm-vacask-printer-"));
    writeFileSync(join(cwd, "circuit.sim"), source);
    const startup = join(cwd, "vacaskrc.toml");
    writeFileSync(startup, "# controlled native printer qualification\n");
    const run = spawnSync(
      process.env.VACASK_BIN!,
      ["--tomlfile", startup, "-se", "-sp", "-qp", "circuit.sim"],
      {
        cwd,
        env: {
          ...process.env,
          SIM_MODULE_PATH: process.env.VACASK_MODULES,
          OMP_NUM_THREADS: "1",
          OPENBLAS_NUM_THREADS: "1",
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
    writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
    expect(run.error, `Evidence: ${cwd}`).toBeUndefined();
    expect(run.status, `${run.stdout}\n${run.stderr}\nEvidence: ${cwd}`).toBe(
      0,
    );
    const plot = (name: string) => {
      const result = parseVacaskRawfile(readFileSync(join(cwd, name), "utf8"));
      if (!result.ok) throw Error(result.error.message);
      return result.plots[0]!;
    };
    const op = plot("op1.raw"),
      ac = plot("ac1.raw"),
      tran = plot("tran1.raw");
    const v = (p: typeof op, name: string) =>
      p.vectors.find((v) => v.variable.name === name)!;
    expect(v(op, "X1out").real[0]).toBeCloseTo(2, 9);
    expect(v(op, "X2out").real[0]).toBeCloseTo(1.5, 9);
    expect(v(op, "sine").real[0]).toBeCloseTo(2, 9);
    expect(v(op, "logvalue").real[0]).toBeCloseTo(Math.log(100), 9);
    for (const [n, multiplier] of [
      [1, 2],
      [2, 5],
      [3, 1],
    ]) {
      expect(v(op, `VM${n}:flow(br)`).real[0]).toBeCloseTo(
        -multiplier! * 3 * (4 / 1000 + 0.001),
        10,
      );
      // The internal ideal voltage source reports total load current, not
      // a per-replica current divided by the inherited factor.
      expect(v(op, `XM${n}:XL:VL:flow(br)`).real[0]).toBeCloseTo(
        (-multiplier! * 3 * 4 * 2) / 1000,
        10,
      );
    }
    expect(v(ac, "sine").real[0]).toBeCloseTo(0, 9);
    expect(v(ac, "sine").imag![0]).toBeCloseTo(1, 9);
    v(tran, "time").real.forEach((time, index) => {
      expect(v(tran, "sine").real[index]).toBeCloseTo(
        1 + 2 * Math.sin(2 * Math.PI * 1000 * time + Math.PI / 6),
        8,
      );
      expect(v(tran, "pwl").real[index]).toBeCloseTo(
        time <= 0.001 ? time / 0.001 : (0.002 - time) / 0.001,
        8,
      );
    });
  },
  20000,
);
