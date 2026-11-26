import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createEmptyProject, type CircuitProject } from "@icm/model";
import { subcircuitDescriptor } from "@icm/devices";

import { findBuiltInBodies } from "./built-in-bodies.js";
import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";
import { printVacaskWithLocations } from "./vacask-printer.js";

function amplifierCell(
  symbolId: string,
  options: {
    wireOptional?: boolean;
    parameters?: Record<string, string>;
    target?: string;
  } = {},
): CircuitProject {
  const project = createEmptyProject(`amp-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
  const descriptor = subcircuitDescriptor(symbolId)!;
  document.instances.push({
    id: "amp",
    symbolId,
    reference: "X1",
    placement: null,
    netlist: {
      binding: {
        kind: "unresolved-subcircuit",
        name: options.target ?? descriptor.target,
      },
      parameters: options.parameters ?? {},
    },
  });
  for (const port of descriptor.ports) {
    if (port.optional && !options.wireOptional) continue;
    const pinName = port.pinName ?? port.supply!;
    document.instances.push({
      id: `pin-${port.name}`,
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: `pin-${port.name}`, pinName: "P" },
        { instanceId: "amp", pinName },
      ],
    });
    document.netlist!.terminals.push({
      id: `terminal-${port.name}`,
      name: port.name,
      netId: port.name,
      direction: "inout",
      interfaceInstanceIds: [`pin-${port.name}`],
    });
  }
  return project;
}

function exported(project: CircuitProject) {
  const spiceResult = createDesignNetlistExport(project, {
    format: "spice",
    portCase: "upper",
  });
  expect(spiceResult.status, JSON.stringify(spiceResult.diagnostics)).toBe(
    "ready",
  );
  const spectreResult = createDesignNetlistExport(project, {
    format: "spectre",
    portCase: "upper",
  });
  expect(spectreResult.status, JSON.stringify(spectreResult.diagnostics)).toBe(
    "ready",
  );
  const analysis = analyzeDesignNetlist(project, { format: "spice" });
  expect(analysis.ir).not.toBeNull();
  const vacask = printVacaskWithLocations(analysis.ir!);
  expect(vacask.ok).toBe(true);
  return {
    spice: spiceResult.status === "ready" ? spiceResult.file.text : "",
    spectre: spectreResult.status === "ready" ? spectreResult.file.text : "",
    vacask: vacask.ok ? vacask.text : "",
  };
}

describe("extended op-amp and amplifier variants (#2443)", () => {
  it("exports single-to-diff-amplifier symmetrically about vocm in SPICE, Spectre and VACASK", () => {
    const { spice, spectre, vacask } = exported(
      amplifierCell("single-to-diff-amplifier", {
        parameters: { gain: "10", vocm: "0.9" },
      }),
    );
    expect(spice).toContain(
      ".subckt single_to_diff_amplifier VDD VSS VIN VOP VON params: gain=10 vocm=0",
    );
    expect(spice).toContain("EPLUS VOP ncm VIN 0 {gain/2}");
    expect(spice).toContain("EMINUS VON ncm 0 VIN {gain/2}");
    expect(spectre).toContain(
      "subckt single_to_diff_amplifier (VDD VSS VIN VOP VON)",
    );
    expect(vacask).toContain("subckt single_to_diff_amplifier");
  });

  it("exports fully-differential-transconductance with complementary gm/2 branches", () => {
    const { spice, spectre, vacask } = exported(
      amplifierCell("fully-differential-transconductance", {
        parameters: { gm: "2m" },
      }),
    );
    expect(spice).toContain(
      ".subckt fully_differential_transconductance VDD VSS VIP VIN VOP VON params: gm=1m",
    );
    expect(spice).toContain("GPLUS 0 VOP VIP VIN {gm/2}");
    expect(spice).toContain("GMINUS 0 VON VIN VIP {gm/2}");
    expect(spectre).toContain("GPLUS (0 VOP VIP VIN) vccs gm=gm/2");
    expect(vacask).toContain("subckt fully_differential_transconductance");
  });

  it("exports opamp-compensated for 1 or 2 compensation pins and recognizes both on import", () => {
    const single = exported(amplifierCell("opamp-compensated"));
    expect(single.spice).toContain(
      ".subckt opamp_compensated VDD VSS VIP VIN VOUT COMP1 params: gain=1e6 vhigh=5 vlow=-5",
    );
    expect(single.spice).toContain("Rcomp1 COMP1 0 1G");
    expect(single.spice).not.toContain("icm_opamp_compensated_2");
    expect(
      findBuiltInBodies(single.spice, "spice", "dut.sp").bodies,
    ).toContainEqual(
      expect.objectContaining({
        name: "opamp_compensated",
        symbolId: "opamp-compensated",
      }),
    );

    const dual = exported(
      amplifierCell("opamp-compensated", { wireOptional: true }),
    );
    expect(dual.spice).toContain(
      ".subckt icm_opamp_compensated_2 VDD VSS VIP VIN VOUT COMP1 COMP2 params: gain=1e6 vhigh=5 vlow=-5",
    );
    expect(dual.spice).toContain("Rcomp2 COMP2 0 1G");
    expect(dual.spectre).toContain(
      "subckt icm_opamp_compensated_2 (VDD VSS VIP VIN VOUT COMP1 COMP2)",
    );
    expect(
      findBuiltInBodies(dual.spice, "spice", "dut.sp").bodies,
    ).toContainEqual(
      expect.objectContaining({
        name: "icm_opamp_compensated_2",
        symbolId: "opamp-compensated",
      }),
    );
  });

  it("exports opamp-enable with and without optional GND and preserves custom targets", () => {
    const base = exported(amplifierCell("opamp-enable"));
    expect(base.spice).toContain(
      ".subckt opamp_enable VDD VSS VIP VIN VOUT EN params:",
    );
    const withGnd = exported(
      amplifierCell("opamp-enable", { wireOptional: true }),
    );
    expect(withGnd.spice).toContain(
      ".subckt icm_opamp_enable_gnd VDD VSS VIP VIN VOUT EN GND params:",
    );
    expect(withGnd.spice).toContain("Rgnd GND 0 1G");
    expect(
      findBuiltInBodies(withGnd.spectre, "spectre", "dut.scs").bodies,
    ).toContainEqual(
      expect.objectContaining({
        name: "icm_opamp_enable_gnd",
        symbolId: "opamp-enable",
      }),
    );

    const retargeted = exported(
      amplifierCell("opamp-enable", { wireOptional: true, target: "lm3876" }),
    );
    expect(retargeted.spice).toContain("X1 VDD VSS VIP VIN VOUT EN GND lm3876");
    expect(retargeted.spice).not.toContain("icm_opamp_enable_gnd");
  });

  it("exports opamp-bias with VBIAS and optional EN gating", () => {
    const base = exported(
      amplifierCell("opamp-bias", { parameters: { vbias: "0.75" } }),
    );
    expect(base.spice).toContain(
      ".subckt opamp_bias VDD VSS VIP VIN VOUT VBIAS params:",
    );
    expect(base.spice).toContain("Bbias nbias 0 V={vbias}");

    const withEn = exported(
      amplifierCell("opamp-bias", { wireOptional: true }),
    );
    expect(withEn.spice).toContain(
      ".subckt icm_opamp_bias_en VDD VSS VIP VIN VOUT VBIAS EN params:",
    );
    expect(
      findBuiltInBodies(withEn.spice, "spice", "dut.sp").bodies,
    ).toContainEqual(
      expect.objectContaining({
        name: "icm_opamp_bias_en",
        symbolId: "opamp-bias",
      }),
    );
  });

  it("exports differential-video-amplifier with DC-referenced G1/G2 pins", () => {
    const { spice, spectre } = exported(
      amplifierCell("differential-video-amplifier", {
        parameters: { gain: "100", vocm: "2.5" },
      }),
    );
    expect(spice).toContain(
      ".subckt differential_video_amplifier VDD VSS VIP VIN VOP VON G1 G2 params: gain=100 vocm=0",
    );
    expect(spice).toContain("RG1 G1 0 1G");
    expect(spice).toContain("RG2 G2 0 1G");
    expect(spectre).toContain("RG1 (G1 0) resistor r=1G");
  });

  it("exports differential-line-driver with complementary tri-state outputs", () => {
    const { spice, spectre, vacask } = exported(
      amplifierCell("differential-line-driver"),
    );
    expect(spice).toContain(
      ".subckt differential_line_driver VDD VSS VIN VOP VON EN params: vhigh=3.3 vlow=0 vt=1.5 ven=0.5 ron=50 roff=1e12",
    );
    expect(spectre).toContain(
      "subckt differential_line_driver (VDD VSS VIN VOP VON EN)",
    );
    expect(vacask).toContain("subckt differential_line_driver");
  });

  it.skipIf(!process.env.NGSPICE_BIN)(
    "simulates all new #2443 and #2444 subcircuit models cleanly in ngspice",
    () => {
      const ngspice = process.env.NGSPICE_BIN!;
      const runDeck = (name: string, spiceText: string, tb: string) => {
        const dir = mkdtempSync(join(tmpdir(), `icm-${name}-`));
        writeFileSync(join(dir, "dut.sp"), spiceText);
        writeFileSync(
          join(dir, "tb.cir"),
          `* ${name}\n.include dut.sp\n${tb}\n.end\n`,
        );
        const run = spawnSync(ngspice, ["-b", "tb.cir"], {
          cwd: dir,
          encoding: "utf8",
          timeout: 20000,
        });
        const log = `${run.stdout}\n${run.stderr}`;
        expect(run.status, log).toBe(0);
        expect(log).not.toMatch(/timestep too small|singular matrix/iu);
        const values: Record<string, number> = {};
        for (const line of log.split("\n")) {
          const match =
            /^\s*([a-z0-9_()]+)\s*=\s*([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/iu.exec(
              line,
            );
          if (match) values[match[1]!.toLowerCase()] = Number(match[2]);
        }
        return values;
      };

      // Enable/mute op-amp in closed-loop inverting gain -2
      const enSpice = exported(
        amplifierCell("opamp-enable", { wireOptional: true }),
      ).spice;
      const on = runDeck(
        "opamp-enable-on",
        enSpice,
        "Vdd vdd 0 5\nVss vss 0 -5\nVen en 0 3.3\nVin in 0 1\nRin in inv 10k\nRf inv out 20k\nRload out 0 10k\nXdut vdd vss 0 inv out en 0 dut\n.control\nop\nprint v(out)\n.endc",
      );
      expect(on["v(out)"]).toBeCloseTo(-2, 3);

      const muted = runDeck(
        "opamp-enable-muted",
        enSpice,
        "Vdd vdd 0 5\nVss vss 0 -5\nVen en 0 0\nVin in 0 1\nRin in inv 10k\nRf inv out 20k\nRload out 0 10k\nXdut vdd vss 0 inv out en 0 dut\n.control\nop\nprint v(out)\n.endc",
      );
      expect(muted["v(out)"]).toBeCloseTo(0.25, 3);

      // Differential line driver active vs tri-state
      const drvSpice = exported(
        amplifierCell("differential-line-driver"),
      ).spice;
      const active = runDeck(
        "line-driver-active",
        drvSpice,
        "Vdd vdd 0 3.3\nVin in 0 3.3\nVen en 0 3.3\nRterm vop von 100\nRp vop 0 100k\nRn von 0 100k\nXdut vdd 0 in vop von en dut\n.control\nop\nprint v(vop) v(von)\n.endc",
      );
      expect(active["v(vop)"]).toBeCloseTo(2.475, 2);
      expect(active["v(von)"]).toBeCloseTo(0.825, 2);

      // Relay energizing switches COM from NC to NO
      const relaySpice = exported(amplifierCell("relay")).spice;
      const energized = runDeck(
        "relay-on",
        relaySpice,
        "Vcoil cp 0 12\nVcom com 0 10\nRno no 0 1k\nRnc nc 0 1k\nXdut cp 0 com no nc dut\n.control\nop\nprint v(no) v(nc)\n.endc",
      );
      expect(energized["v(no)"]).toBeCloseTo(9.99, 2);
      expect(energized["v(nc)"]).toBeCloseTo(0, 4);
    },
  );
});
