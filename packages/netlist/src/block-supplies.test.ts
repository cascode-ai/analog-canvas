import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { IDEAL_COMPARATOR_TARGET, subcircuitDescriptor } from "@icm/devices";
import { createEmptyProject, type CircuitProject } from "@icm/model";

import { createDesignNetlistExport } from "./export.js";

/**
 * One Cell holding one block with no supply drawn: each signal pin is a Cell
 * port named after the block's port, and VDD/VSS meet nothing.
 */
function unpoweredBlock(symbolId: string): CircuitProject {
  const project = createEmptyProject(`unpowered-${symbolId}`, symbolId, "dut");
  const document = project.documents[0]!;
  document.netlist!.name = "dut";
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
  for (const port of descriptor.ports.filter((item) => !item.supply)) {
    const id = `port-${port.name}`;
    document.instances.push({ id, symbolId: "port", placement: null });
    document.nets.push({
      id: port.name,
      terminals: [
        { instanceId: id, pinName: "P" },
        { instanceId: "block", pinName: port.pinName ?? port.name },
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

describe("blocks whose body never reads its supplies", () => {
  it.each([
    ["opamp", "X1 0 0 VIP VIN VOUT opamp", "X1 (0 0 VIP VIN VOUT) opamp"],
    [
      "opamp-differential",
      "X1 0 0 VIP VIN VOP VON opamp_differential",
      "X1 (0 0 VIP VIN VOP VON) opamp_differential",
    ],
    ["adder", "X1 0 0 A B Y adder", "X1 (0 0 A B Y) adder"],
  ] as const)(
    "export a %s with no supply drawn, its unused supplies on ground",
    (symbolId, spiceCard, spectreCard) => {
      // A textbook switched-capacitor integrator draws an op-amp and no
      // supply, and its ideal body never reads one (#1253).
      for (const [format, card] of [
        ["spice", spiceCard],
        ["spectre", spectreCard],
      ] as const) {
        const result = createDesignNetlistExport(unpoweredBlock(symbolId), {
          format,
        });
        expect(result.status, format).toBe("ready");
        if (result.status !== "ready") continue;
        expect(result.file.text).toContain(card);
        expect(result.file.text).not.toMatch(/\.global|^global/mu);
        expect(
          result.diagnostics.filter(
            (item) => item.code === "MISSING_BLOCK_SUPPLY",
          ),
        ).toEqual([]);
      }
    },
  );

  it("export a multiplier unpowered in SPICE, where its body is built in", () => {
    const spice = createDesignNetlistExport(unpoweredBlock("multiplier"));
    expect(spice.status).toBe("ready");
    if (spice.status === "ready")
      expect(spice.file.text).toContain("X1 0 0 A B Y multiplier");
    // In Spectre the reader's own multiplier is called, which may use its
    // supplies, so it gets the Cell's default ones, as a MOS body does.
    const spectre = createDesignNetlistExport(unpoweredBlock("multiplier"), {
      format: "spectre",
    });
    expect(spectre.status).toBe("ready");
    if (spectre.status === "ready") {
      expect(spectre.file.text).toContain("subckt dut (VDD VSS A B Y)");
      expect(spectre.file.text).toContain("X1 (VDD VSS A B Y) multiplier");
    }
  });

  it("power a Project's own op-amp from the Cell's default supplies", () => {
    // A transistor-level `opamp` Cell or external model may use VDD/VSS.
    const project = unpoweredBlock("opamp");
    project.externalSubcircuitDefinitions = [
      {
        id: "own-opamp",
        name: "opamp",
        terminals: ["VDD", "VSS", "VIP", "VIN", "VOUT"].map((name) => ({
          id: `own-${name}`,
          name,
          direction: "inout" as const,
        })),
        formalParameters: [],
        source: { kind: "declaration-only" },
      },
    ] as unknown as CircuitProject["externalSubcircuitDefinitions"];
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toContain(".subckt dut VDD VSS VIP VIN VOUT");
    expect(result.file.text).toContain("X1 VDD VSS VIP VIN VOUT opamp");
  });

  it("export an ideal comparator with no supply drawn and no VDD pin", () => {
    // A flash ADC drawn with ground and no VDD gained a VDD Cell Pin that
    // nothing inside used: the ideal comparator's call has no supply nodes.
    const project = unpoweredBlock("comparator");
    project.documents[0]!.instances[0]!.netlist!.binding = {
      kind: "unresolved-subcircuit",
      name: IDEAL_COMPARATOR_TARGET,
    };
    const result = createDesignNetlistExport(project);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.file.text).toMatch(/^\.subckt dut VIP VIN VOUT$/mu);
    expect(result.file.text).toMatch(
      /^X1 VIP VIN VOUT icm_ideal_comparator$/mu,
    );
  });

  it("give a block whose body uses its supplies the Cell's default ones", () => {
    // As an unconnected MOS body does: a new VDD pin and ground, no global.
    for (const [symbolId, card] of [
      ["inverter", "X1 VDD VSS A Y inverter"],
      ["adc", "X1 VDD VSS VIN VOUT adc"],
    ] as const) {
      const result = createDesignNetlistExport(unpoweredBlock(symbolId));
      expect(result.status, symbolId).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.file.text).toContain(card);
      expect(result.file.text).toMatch(/^\.subckt dut VDD VSS /mu);
      expect(result.file.text).not.toMatch(/\.global/u);
    }
  });
});

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

/** Skips cleanly where ngspice is absent; the hosted gate never skips. */
describe.skipIf(!ngspiceOnPath())(
  "an unpowered ideal op-amp under ngspice",
  () => {
    it("amplifies with its supplies on ground", () => {
      const result = createDesignNetlistExport(unpoweredBlock("opamp"));
      if (result.status !== "ready") throw new Error("opamp blocked");
      const deck = [
        "* unpowered ideal op-amp",
        result.file.text.replace(/^\.end\s*$/mu, ""),
        "VP vip 0 1u",
        "VN vin 0 0",
        "XD vip vin vout dut",
        ".op",
        ".control",
        "run",
        "print v(vout)",
        ".endc",
        ".end",
      ].join("\n");
      const directory = mkdtempSync(join(tmpdir(), "icm-unpowered-"));
      try {
        writeFileSync(join(directory, "deck.cir"), deck, "utf8");
        const output = execFileSync("ngspice", ["-b", "deck.cir"], {
          cwd: directory,
          encoding: "utf8",
        });
        // Open-loop gain 1e6 times 1 µV.
        const vout = Number(/v\(vout\)\s*=\s*(\S+)/u.exec(output)?.[1]);
        expect(vout).toBeCloseTo(1, 6);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
);
