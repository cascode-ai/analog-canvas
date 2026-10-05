import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  builtInSubcircuitDescriptors,
  subcircuitDescriptor,
} from "@icm/devices";
import { createEmptyProject, type CircuitProject } from "@icm/model";

import { createDesignNetlistExport } from "./export.js";
import { idealAnalogBlockCell } from "./ideal-analog-block-models.js";
import { IDEAL_LOGIC_TARGETS } from "./ideal-logic-gate-models.js";
import {
  IDEAL_SIGNAL_TARGETS,
  spiceIdealSignalSubcircuit,
} from "./ideal-signal-block-models.js";

/**
 * One Cell holding one block, every pin of which is also a Cell port named
 * after the pin, so a test bench can drive it directly.
 */
function blockCell(symbolId: string, cell = "dut"): CircuitProject {
  const project = createEmptyProject(`block-${symbolId}`, symbolId, cell);
  const document = project.documents[0]!;
  document.netlist!.name = cell;
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "block",
    symbolId,
    reference: "X1",
    placement: null,
    netlist: {
      binding: { kind: "unresolved-subcircuit", name: descriptor.target },
      parameters: {},
    },
  });
  for (const port of descriptor.ports) {
    const pin = port.pinName ?? port.name;
    const id = `port-${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: id, pinName: "P" },
        ...(port.supply ? [] : [{ instanceId: "block", pinName: pin }]),
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: port.name,
      netId: port.name,
      direction: "inout",
      interfaceInstanceIds: [id],
    });
  }
  return project;
}

describe("generated block bodies", () => {
  it("leave no Library block without one", () => {
    // A block added to the Library without a body fails here. The bare
    // `comparator` is the older drawings' target; a placed comparator is
    // bound to the generated icm_ideal_comparator instead.
    const missing = [
      ...new Set(builtInSubcircuitDescriptors.map((item) => item.target)),
    ].filter(
      (target) =>
        target !== "comparator" &&
        !idealAnalogBlockCell(target, "spice") &&
        !IDEAL_LOGIC_TARGETS.includes(target) &&
        !IDEAL_SIGNAL_TARGETS.includes(target),
    );
    expect(missing).toEqual([]);
  });

  it("write the multiplier and the converters as single B-sources", () => {
    expect(spiceIdealSignalSubcircuit("multiplier")).toEqual([
      "* Ideal multiplier: V(Y) = gain*V(A)*V(B) from ground",
      ".subckt multiplier VDD VSS A B Y params: gain=1",
      "BY Y 0 V={gain*V(A)*V(B)}",
      ".ends multiplier",
    ]);
    expect(spiceIdealSignalSubcircuit("adc")).toEqual([
      "* Ideal ADC: 2^bits levels between VSS and VDD, no clock",
      ".subckt adc VDD VSS VIN VOUT params: bits=8",
      "BQ VOUT VSS V={max(V(VDD,VSS),1u)/pow(2,bits)*min(max(floor(V(VIN,VSS)*pow(2,bits)/max(V(VDD,VSS),1u)),0),pow(2,bits)-1)}",
      ".ends adc",
    ]);
  });

  it("export the adder in SPICE and in Spectre from two unity sources", () => {
    const spice = createDesignNetlistExport(blockCell("adder"));
    expect(spice.status).toBe("ready");
    if (spice.status !== "ready") return;
    expect(spice.file.text).toContain(".subckt adder VDD VSS A B Y");
    expect(spice.file.text).toContain("ESUMA Y nsum A 0 {1}");
    expect(spice.file.text).toContain("ESUMB nsum 0 B 0 {1}");

    const spectre = createDesignNetlistExport(blockCell("adder"), {
      format: "spectre",
    });
    expect(spectre.status).toBe("ready");
    if (spectre.status !== "ready") return;
    expect(spectre.diagnostics).toEqual([]);
    expect(spectre.file.text).toMatch(/^subckt adder \(VDD VSS A B Y\)$/mu);
    expect(spectre.file.text).toMatch(/^ESUMA \(Y nsum A 0\) vcvs gain=1$/mu);
    expect(spectre.file.text).toMatch(/^ESUMB \(nsum 0 B 0\) vcvs gain=1$/mu);
  });

  it.each([
    ["+", "+", "adder", "1", "1"],
    ["-", "+", "adder_minus_a", "-1", "1"],
    ["+", "-", "adder_minus_b", "1", "-1"],
    ["-", "-", "adder_minus_ab", "-1", "-1"],
  ] as const)(
    "export an adder signed A%s B%s as %s, its sources' gains following the signs",
    (signA, signB, body, gainA, gainB) => {
      const project = blockCell("adder");
      project.documents[0]!.instances[0]!.netlist!.parameters = {
        signA,
        signB,
      };
      const spice = createDesignNetlistExport(project);
      expect(spice.status).toBe("ready");
      if (spice.status !== "ready") return;
      // The signs choose the body and are no parameter of the call.
      expect(spice.file.text).toMatch(
        new RegExp(`^X1 VDD VSS A B Y ${body}$`, "mu"),
      );
      expect(spice.file.text).not.toMatch(/sign/iu);
      expect(spice.file.text).toContain(`.subckt ${body} VDD VSS A B Y\n`);
      expect(spice.file.text).toContain(`ESUMA Y nsum A 0 {${gainA}}`);
      expect(spice.file.text).toContain(`ESUMB nsum 0 B 0 {${gainB}}`);
      expect(spice.file.text).toContain(`.ends ${body}\n`);

      const spectre = createDesignNetlistExport(project, { format: "spectre" });
      expect(spectre.status).toBe("ready");
      if (spectre.status !== "ready") return;
      expect(spectre.diagnostics).toEqual([]);
      expect(spectre.file.text).toMatch(
        new RegExp(`^subckt ${body} \\(VDD VSS A B Y\\)$`, "mu"),
      );
      expect(spectre.file.text).toMatch(
        new RegExp(`^ESUMB \\(nsum 0 B 0\\) vcvs gain=${gainB}$`, "mu"),
      );
    },
  );

  it("export an adder that adds both inputs exactly as before signs existed", () => {
    // Every adder drawn before #1324 has no sign; a new one stores both +.
    const unsigned = blockCell("adder");
    const signed = blockCell("adder");
    signed.documents[0]!.instances[0]!.netlist!.parameters = {
      signA: "+",
      signB: "+",
    };
    for (const format of ["spice", "spectre"] as const) {
      const before = createDesignNetlistExport(unsigned, { format });
      const after = createDesignNetlistExport(signed, { format });
      expect(before.status).toBe("ready");
      if (before.status !== "ready" || after.status !== "ready")
        throw new Error(`${format} export blocked`);
      expect(after.file.text).toBe(before.file.text);
    }
  });

  it("give two adders with different signs a body each", () => {
    const project = blockCell("adder");
    const document = project.documents[0]!;
    const sum = document.instances[0]!;
    document.instances.push({
      ...structuredClone(sum),
      id: "difference",
      reference: "X2",
      netlist: { ...sum.netlist!, parameters: { signA: "+", signB: "-" } },
    });
    for (const net of document.nets)
      for (const terminal of [...net.terminals])
        if (terminal.instanceId === "block")
          net.terminals.push({ ...terminal, instanceId: "difference" });
    const spice = createDesignNetlistExport(project);
    expect(spice.status).toBe("ready");
    if (spice.status !== "ready") return;
    expect(spice.file.text).toMatch(/^X1 VDD VSS A B Y adder$/mu);
    expect(spice.file.text).toMatch(/^X2 VDD VSS A B Y adder_minus_b$/mu);
    expect(spice.file.text.match(/^\.subckt adder /gmu)).toHaveLength(1);
    expect(spice.file.text.match(/^\.subckt adder_minus_b /gmu)).toHaveLength(
      1,
    );
    expect(spice.externalMasterCount).toBe(0);
  });

  it("refuse an adder sign other than + or -", () => {
    const project = blockCell("adder");
    project.documents[0]!.instances[0]!.netlist!.parameters = { signB: "−" };
    const spice = createDesignNetlistExport(project);
    expect(spice.status).toBe("blocked");
    expect(spice.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "INVALID_ADDER_SIGN",
        severity: "error",
        objectIds: ["block"],
        parameter: "signB",
      }),
    );
  });

  it("warn that an adder bound to another subcircuit calls it whatever its signs", () => {
    const project = blockCell("adder");
    project.documents[0]!.instances[0]!.netlist = {
      binding: { kind: "unresolved-subcircuit", name: "my_difference" },
      parameters: { signA: "+", signB: "-" },
    };
    const spice = createDesignNetlistExport(project);
    expect(spice.status).toBe("ready");
    if (spice.status !== "ready") return;
    expect(spice.file.text).toMatch(/^X1 VDD VSS A B Y my_difference$/mu);
    expect(spice.diagnostics).toEqual([
      expect.objectContaining({
        code: "ADDER_SIGN_NOT_EXPORTED",
        severity: "warning",
        objectIds: ["block"],
      }),
    ]);
  });

  it.each(["multiplier", "adc", "dac"])(
    "export the %s ready in SPICE, and to Spectre with a warning",
    (symbolId) => {
      const target = subcircuitDescriptor(symbolId)!.target;
      const spice = createDesignNetlistExport(blockCell(symbolId));
      expect(spice.status).toBe("ready");
      if (spice.status !== "ready") return;
      expect(
        spice.file.text.split(new RegExp(`^\\.subckt ${target} `, "mu")),
      ).toHaveLength(2);
      expect(spice.externalMasterCount).toBe(0);

      const spectre = createDesignNetlistExport(blockCell(symbolId), {
        format: "spectre",
      });
      expect(spectre.status).toBe("ready");
      expect(spectre.diagnostics).toEqual([
        expect.objectContaining({
          code: "SPECTRE_MODEL_NOT_INCLUDED",
          severity: "warning",
          objectIds: ["block"],
        }),
      ]);
    },
  );
});

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Skips cleanly where ngspice is absent; the hosted gate never skips. */
describe.skipIf(!ngspiceOnPath())(
  "generated block bodies under ngspice",
  () => {
    it("add, multiply and quantize as their symbols say", () => {
      const cells = [
        ["adder", "sum_cell"],
        ["adder", "difference_cell"],
        ["multiplier", "product_cell"],
        ["adc", "adc_cell"],
        ["dac", "dac_cell"],
      ] as const;
      const exported = cells.map(([symbolId, cell]) => {
        const project = blockCell(symbolId, cell);
        // The DAC's resolution comes from Properties, as a call parameter.
        if (symbolId === "dac")
          project.documents[0]!.instances[0]!.netlist!.parameters.bits = "3";
        // A residue or loop error: input B subtracts.
        if (cell === "difference_cell")
          project.documents[0]!.instances[0]!.netlist!.parameters.signB = "-";
        const result = createDesignNetlistExport(project);
        if (result.status !== "ready") throw new Error(`${symbolId} blocked`);
        return result.file.text;
      });
      const deck = [
        "* generated block bodies",
        ...exported.map((text) => text.replace(/^\.end\s*$/mu, "")),
        "VDD vdd 0 1.8",
        "VA a 0 SIN(0.2 0.1 1meg)",
        "VB b 0 0.5",
        "VR ramp 0 PWL(0 -0.1 10u 1.9)",
        "XS vdd 0 a b ysum sum_cell",
        "XF vdd 0 a b ydiff difference_cell",
        "XM vdd 0 a b yprod product_cell",
        "XA vdd 0 ramp yadc adc_cell",
        "XD vdd 0 ramp ydac dac_cell",
        ".tran 10n 10u",
        ".control",
        "run",
        ...[
          ["sum_start", "ysum", "0"],
          ["sum_peak", "ysum", "0.25u"],
          ["difference_start", "ydiff", "0"],
          ["difference_peak", "ydiff", "0.25u"],
          ["product_start", "yprod", "0"],
          ["product_peak", "yprod", "0.25u"],
          ["adc_below", "yadc", "0.2u"],
          ["adc_mid", "yadc", "5.5u"],
          ["adc_top", "yadc", "9.9u"],
          ["dac_mid", "ydac", "5.5u"],
        ].map(
          ([name, node, at]) => `meas tran ${name} FIND v(${node}) AT=${at}`,
        ),
        ".endc",
        ".end",
      ].join("\n");
      const directory = mkdtempSync(join(tmpdir(), "icm-blocks-"));
      try {
        writeFileSync(join(directory, "deck.cir"), deck, "utf8");
        const output = execFileSync("ngspice", ["-b", "deck.cir"], {
          cwd: directory,
          encoding: "utf8",
        });
        const measured = Object.fromEntries(
          [...output.matchAll(/^(\w+)\s+=\s+(\S+)/gmu)].map((match) => [
            match[1],
            Number(match[2]),
          ]),
        );
        expect(measured.sum_start).toBeCloseTo(0.7, 3);
        expect(measured.sum_peak).toBeCloseTo(0.8, 3);
        // V(A) − V(B): 0.2 − 0.5, then 0.3 − 0.5 at the sine's peak.
        expect(measured.difference_start).toBeCloseTo(-0.3, 3);
        expect(measured.difference_peak).toBeCloseTo(-0.2, 3);
        expect(measured.product_start).toBeCloseTo(0.1, 3);
        expect(measured.product_peak).toBeCloseTo(0.15, 3);
        // 8 bits over 1.8 V: LSB = 1.8/256 V. The ramp at 5.5 µs is 1.0 V,
        // 142 whole LSBs; below the range the code is 0, above it 255.
        const lsb = 1.8 / 256;
        expect(measured.adc_below).toBeCloseTo(0, 6);
        expect(measured.adc_mid).toBeCloseTo(142 * lsb, 4);
        expect(measured.adc_top).toBeCloseTo(255 * lsb, 4);
        // Three bits: LSB = 0.225 V, and 1.0 V is four whole LSBs.
        expect(measured.dac_mid).toBeCloseTo(4 * 0.225, 4);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
);
